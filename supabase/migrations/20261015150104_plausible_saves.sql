-- Poly Battle: Plausibilitätsprüfung beim Speichern von Online-Partien
--
-- Der Server rechnet die Spielregeln nicht nach (das wäre ein zweites
-- Regelwerk in SQL). Er prüft aber, ob ein neuer Stand im Vergleich zum
-- gespeicherten überhaupt möglich ist: Runde, Technologien, Sterne,
-- Einheiten, Städte und Sieg. Die Grenzen sind großzügig, normales Spiel
-- (auch mit KI-Zügen zwischen zwei Speicherungen) wird nie abgewiesen.
--
-- Testpartien aus dem Admin-Panel (game_state.admin = true) werden nicht
-- geprüft. Die Markierung lässt sich nicht wieder entfernen; das Spiel zeigt
-- sie allen Mitspielern an.

create or replace function public.pb_check_plausible(old_s jsonb, new_s jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  p text;
  old_round int := coalesce((old_s->>'round')::int, 1);
  new_round int := coalesce((new_s->>'round')::int, 1);
  rounds int;
  cities_old int;
  cities_new int;
  units_old int;
  units_new int;
  stars_old int;
  stars_new int;
  techs_old jsonb;
  techs_new jsonb;
  w text := new_s->>'winner';
  limit_round int := (new_s->>'turnLimit')::int;
begin
  if coalesce((old_s->>'admin')::boolean, false) and not coalesce((new_s->>'admin')::boolean, false) then
    return 'Testpartie-Markierung darf nicht entfernt werden';
  end if;
  if coalesce((new_s->>'admin')::boolean, false) then
    return null;
  end if;
  -- Mehr als eine Runde auf einmal nur, wenn kein Mensch mehr Städte hat
  -- (dann spielen die KI-Stämme bis zum Ende unter sich weiter).
  if new_round < old_round then
    return 'Unmögliche Runde';
  end if;
  if new_round > old_round + 1 and exists (
    select 1 from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c
     where c->>'owner' is not null
       and not coalesce(new_s->'ai', '[]'::jsonb) ? (c->>'owner')) then
    return 'Unmögliche Runde';
  end if;
  rounds := new_round - old_round + 1;
  for p in select jsonb_array_elements_text(coalesce(new_s->'players', '[]'::jsonb)) loop
    techs_old := coalesce(old_s->'techs'->p, '[]'::jsonb);
    techs_new := coalesce(new_s->'techs'->p, '[]'::jsonb);
    if not (techs_new @> techs_old) then
      return 'Technologien dürfen nicht verloren gehen';
    end if;
    if jsonb_array_length(techs_new) > jsonb_array_length(techs_old) + 8 * rounds then
      return 'Zu viele neue Technologien';
    end if;
    select count(*) into cities_old from jsonb_array_elements(coalesce(old_s->'cities', '[]'::jsonb)) c where c->>'owner' = p;
    select count(*) into cities_new from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c where c->>'owner' = p;
    if cities_new > cities_old + 4 * rounds then
      return 'Zu viele neue Städte';
    end if;
    select count(*) into units_old from jsonb_array_elements(coalesce(old_s->'units', '[]'::jsonb)) u where u->>'owner' = p;
    select count(*) into units_new from jsonb_array_elements(coalesce(new_s->'units', '[]'::jsonb)) u where u->>'owner' = p;
    if units_new > units_old + (2 * greatest(cities_old, cities_new) + 4) * rounds then
      return 'Zu viele neue Einheiten';
    end if;
    stars_old := coalesce((old_s->'stars'->>p)::int, 0);
    stars_new := coalesce((new_s->'stars'->>p)::int, 0);
    if stars_new < 0 or stars_new > stars_old + (60 + 45 * greatest(cities_old, cities_new)) * rounds then
      return 'Unmöglich viele Sterne';
    end if;
  end loop;
  if w is not null and coalesce(new_s->>'endReason', '') not in ('score', 'mission') then
    if exists (select 1 from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c
               where c->>'owner' is not null and c->>'owner' <> w) then
      return 'Sieg passt nicht zum Spielstand';
    end if;
  end if;
  if w is not null and new_s->>'endReason' = 'score' and (limit_round is null or new_round < limit_round) then
    return 'Sieg nach Punkten erst am Rundenlimit';
  end if;
  return null;
end;
$$;

revoke all on function public.pb_check_plausible(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.save_match(p_id uuid, p_token text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  r text;
  old_rev int;
  new_rev int;
  bad text;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Ungültiger Spielstand';
  end if;
  if pg_column_size(p_state) > 262144 then
    raise exception 'Spielstand zu groß';
  end if;
  select * into m from public.matches where id = p_id for update;
  if not found then
    raise exception 'Spiel nicht gefunden';
  end if;
  r := public.pb_role_of(m, public.pb_hash(coalesce(p_token, '')));
  if r is null then
    raise exception 'Du bist in diesem Spiel kein Spieler';
  end if;
  if exists (select 1 from unnest(public.pb_human_roles(m.game_state)) as x where not m.seats ? x) then
    raise exception 'Noch nicht alle Mitspieler beigetreten';
  end if;
  if m.game_state->>'winner' is not null then
    raise exception 'Spiel ist bereits vorbei';
  end if;
  if m.current_turn is distinct from r then
    raise exception 'Du bist nicht am Zug';
  end if;
  -- Die Zusammensetzung (Spieler, KI) darf sich nicht ändern.
  if (p_state->'players') is distinct from (m.game_state->'players')
     or coalesce(p_state->'ai', '[]'::jsonb) is distinct from coalesce(m.game_state->'ai', '[]'::jsonb) then
    raise exception 'Spielerliste darf sich nicht ändern';
  end if;
  old_rev := coalesce((m.game_state->>'rev')::int, 0);
  new_rev := coalesce((p_state->>'rev')::int, 0);
  if new_rev <= old_rev then
    raise exception 'Veralteter Spielstand';
  end if;
  -- Neu: Ist der Stand im Vergleich zum gespeicherten überhaupt möglich?
  bad := public.pb_check_plausible(m.game_state, p_state);
  if bad is not null then
    raise exception 'Spielstand abgelehnt: %', bad;
  end if;
  update public.matches
     set game_state = p_state,
         current_turn = coalesce(p_state->>'turn', current_turn),
         last_move_at = now()
   where id = p_id;
  return jsonb_build_object('rev', new_rev);
end;
$$;

revoke all on function public.save_match(uuid, text, jsonb) from public;
grant execute on function public.save_match(uuid, text, jsonb) to anon, authenticated;
