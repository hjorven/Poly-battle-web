-- Poly Battle: Online-Partien nur für Mitspieler, Zugzeit, Aufgeben, KI-Übergabe
--
-- Vorher konnte jeder mit dem öffentlichen Schlüssel alle Partien auslesen
-- (Lese-Regel `true`): ganze Karte ohne Nebel, und über die Liste aller IDs
-- freie Plätze in fremden Partien besetzen. Verließ jemand eine Partie, hing
-- sie für immer.
--
-- Jetzt:
--  * Kein direkter Lesezugriff mehr auf `matches`. Gelesen wird über
--    pb_get_match / join_match; laufende Partien sehen nur Mitspieler,
--    Zuschauer erst nach Spielende.
--  * Realtime schickt nach jeder Änderung nur eine Klingel („rev N“) auf den
--    öffentlichen Kanal `match-<id>`; den Stand holt der Client geprüft ab.
--  * pb_hand_to_ai: Aufgeben (eigener Stamm geht an die KI), freien Platz mit
--    der KI füllen, oder nach 24 Stunden ohne Zug den Stamm des Abwesenden an
--    die KI geben.
--  * KI-Züge: Wer zuletzt gespeichert hat, rechnet die KI. Bleibt eine KI
--    länger als 2 Minuten hängen (Tab geschlossen), darf jeder Mitspieler
--    übernehmen.
--  * Testpartien (game_state.admin) nur mit gültigem Admin-Schlüssel; nur
--    dann entfällt die Plausibilitätsprüfung.
--  * Partien, die 30 Tage ruhen (oder 7 Tage ohne Mitspieler), werden beim
--    Anlegen neuer Partien aufgeräumt.

-- --- Lesen sperren ---------------------------------------------------------------

drop policy if exists "matches select" on public.matches;
revoke all on public.matches from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime drop table public.matches;
  end if;
end $$;

-- --- Hilfsfunktionen ------------------------------------------------------------

-- Prüfwert des Admin-Schlüssels (wie ADMIN_CHECK in js/admin.js). Neues
-- Passwort: `npm run admin-passwort` gibt die passende Anweisung aus.
create or replace function public.pb_admin_check()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'bb5f3a11c3a31872ff6e9eab6f22e98bf68cbf7282592f0539deff43fcdb2d5a'::text
$$;

create or replace function public.pb_admin_ok(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key is not null and p_key ~ '^[0-9a-f]{64}$'
     and encode(sha256(convert_to(p_key, 'UTF8')), 'hex') = public.pb_admin_check()
$$;

-- Ist die Rolle im Spielstand eine KI?
create or replace function public.pb_is_ai(s jsonb, r text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select r is not null and coalesce(s->'ai', '[]'::jsonb) ? r
$$;

-- Was ein Spieler (r) oder Zuschauer (r = null) von einer Partie sieht.
-- Laufende Partien zeigen Zuschauern keinen Spielstand (sonst ließe sich der
-- Nebel mit einem zweiten Browserfenster umgehen).
create or replace function public.pb_match_view(m public.matches, r text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.pb_public_match(m)
    || jsonb_build_object(
      'role', r,
      'last_move_at', m.last_move_at,
      'hidden', r is null and m.game_state->>'winner' is null and not coalesce((m.game_state->>'abandoned')::boolean, false)
    )
    || case when r is null and m.game_state->>'winner' is null and not coalesce((m.game_state->>'abandoned')::boolean, false)
         then jsonb_build_object('game_state', null) else '{}'::jsonb end
$$;

-- --- Klingel bei jeder Änderung -------------------------------------------------

create or replace function public.pb_match_ring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('rev', coalesce((new.game_state->>'rev')::int, 0), 'joined', (select count(*) from jsonb_object_keys(new.seats))),
    'moved', 'match-' || new.id::text, false);
  return null;
exception when others then
  -- Ohne Klingel geht nichts verloren: der Client fragt beim Öffnen ohnehin nach.
  return null;
end;
$$;

drop trigger if exists pb_match_ring on public.matches;
create trigger pb_match_ring after update on public.matches
  for each row execute function public.pb_match_ring();

-- --- Partie anlegen, beitreten, lesen -------------------------------------------

drop function if exists public.create_match(jsonb, text);
create or replace function public.create_match(p_state jsonb, p_token text, p_admin_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  h text;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'Ungültige Spieler-Kennung';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'Ungültiger Spielstand';
  end if;
  if pg_column_size(p_state) > 262144 then
    raise exception 'Spielstand zu groß';
  end if;
  if cardinality(public.pb_human_roles(p_state)) < 2 or not ('player_1' = any(public.pb_human_roles(p_state))) then
    raise exception 'Mindestens zwei menschliche Spieler nötig';
  end if;
  if coalesce((p_state->>'admin')::boolean, false) and not public.pb_admin_ok(p_admin_key) then
    raise exception 'Testpartien nur mit Admin-Schlüssel';
  end if;
  -- Aufräumen: lange ruhende Partien und solche, denen nie jemand beitrat.
  delete from public.matches
   where last_move_at < now() - interval '30 days'
      or (last_move_at < now() - interval '7 days'
          and exists (select 1 from unnest(public.pb_human_roles(game_state)) as x where not seats ? x));
  h := public.pb_hash(p_token);
  insert into public.matches (game_state, current_turn, player_1, seats)
  values (p_state, coalesce(p_state->>'turn', 'player_1'), h, jsonb_build_object('player_1', h))
  returning * into m;
  return public.pb_match_view(m, 'player_1');
end;
$$;

create or replace function public.join_match(p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  h text;
  r text;
  free text;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'Ungültige Spieler-Kennung';
  end if;
  select * into m from public.matches where id = p_id for update;
  if not found then
    return null;
  end if;
  h := public.pb_hash(p_token);
  r := public.pb_role_of(m, h);
  if r is null and m.game_state->>'winner' is null then
    select x into free from unnest(public.pb_human_roles(m.game_state)) as x
     where not m.seats ? x limit 1;
    if free is not null then
      update public.matches
         set seats = seats || jsonb_build_object(free, h),
             player_2 = case when free = 'player_2' then h else player_2 end
       where id = p_id
      returning * into m;
      r := free;
    end if;
  end if;
  return jsonb_build_object('match', public.pb_match_view(m, r), 'role', r);
end;
$$;

-- Lesen ohne Platz zu nehmen (nach jeder Klingel).
create or replace function public.pb_get_match(p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  m public.matches;
  r text;
begin
  select * into m from public.matches where id = p_id;
  if not found then
    return null;
  end if;
  r := public.pb_role_of(m, public.pb_hash(coalesce(p_token, '')));
  return jsonb_build_object('match', public.pb_match_view(m, r), 'role', r);
end;
$$;

-- Eigene Partien (für die Liste im Menü, auch auf einem anderen Gerät).
create or replace function public.pb_my_matches(p_token text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'last_move_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
          'id', m.id,
          'role', public.pb_role_of(m, public.pb_hash(coalesce(p_token, ''))),
          'round', coalesce((m.game_state->>'round')::int, 1),
          'turn', m.game_state->>'turn',
          'winner', m.game_state->>'winner',
          'abandoned', coalesce((m.game_state->>'abandoned')::boolean, false),
          'ai', coalesce(m.game_state->'ai', '[]'::jsonb),
          'humans', to_jsonb(public.pb_human_roles(m.game_state)),
          'joined', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(m.seats) as k),
          'tribes', m.game_state->'tribes',
          'last_move_at', m.last_move_at) as x
        from public.matches m
       where p_token is not null and length(p_token) >= 16
         and exists (select 1 from jsonb_each_text(m.seats) e where e.value = public.pb_hash(p_token))
       order by m.last_move_at desc
       limit 30
    ) t
$$;

-- --- Speichern -------------------------------------------------------------------

-- Plausibilität: wie bisher, nur entscheidet jetzt save_match, ob eine
-- Testpartie vorliegt (mit geprüftem Schlüssel).
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

drop function if exists public.save_match(uuid, text, jsonb);
create or replace function public.save_match(p_id uuid, p_token text, p_state jsonb, p_admin_key text default null)
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
  ai_stalled boolean;
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
  if m.game_state->>'winner' is not null or coalesce((m.game_state->>'abandoned')::boolean, false) then
    raise exception 'Spiel ist bereits vorbei';
  end if;
  if public.pb_is_ai(m.game_state, r) then
    raise exception 'Dein Stamm wird von der KI gespielt';
  end if;
  -- Eine KI ist dran, aber wer sie rechnet, meldet sich nicht mehr: dann
  -- darf jeder Mitspieler übernehmen.
  ai_stalled := public.pb_is_ai(m.game_state, m.game_state->>'turn') and m.last_move_at < now() - interval '2 minutes';
  if m.current_turn is distinct from r and not ai_stalled then
    raise exception 'Du bist nicht am Zug';
  end if;
  if (p_state->'players') is distinct from (m.game_state->'players')
     or coalesce(p_state->'ai', '[]'::jsonb) is distinct from coalesce(m.game_state->'ai', '[]'::jsonb) then
    raise exception 'Spielerliste darf sich nicht ändern';
  end if;
  old_rev := coalesce((m.game_state->>'rev')::int, 0);
  new_rev := coalesce((p_state->>'rev')::int, 0);
  if new_rev <= old_rev then
    raise exception 'Veralteter Spielstand';
  end if;
  if coalesce((p_state->>'admin')::boolean, false) and not coalesce((m.game_state->>'admin')::boolean, false)
     and not public.pb_admin_ok(p_admin_key) then
    raise exception 'Testpartien nur mit Admin-Schlüssel';
  end if;
  -- Testpartien mit gültigem Schlüssel werden nicht geprüft, alle anderen schon.
  if not (coalesce((p_state->>'admin')::boolean, false) and public.pb_admin_ok(p_admin_key)) then
    bad := public.pb_check_plausible(m.game_state, p_state);
    if bad is not null then
      raise exception 'Spielstand abgelehnt: %', bad;
    end if;
  end if;
  update public.matches
     set game_state = p_state,
         -- Ist als Nächstes eine KI dran, rechnet sie, wer gerade gespeichert hat.
         current_turn = case when public.pb_is_ai(p_state, p_state->>'turn') then r
                             else coalesce(p_state->>'turn', current_turn) end,
         last_move_at = now()
   where id = p_id;
  return jsonb_build_object('rev', new_rev);
end;
$$;

-- --- Aufgeben, freien Platz füllen, Abwesende ersetzen -----------------------------

create or replace function public.pb_hand_to_ai(p_id uuid, p_token text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  r text;
  s jsonb;
  why text;
begin
  select * into m from public.matches where id = p_id for update;
  if not found then
    raise exception 'Spiel nicht gefunden';
  end if;
  r := public.pb_role_of(m, public.pb_hash(coalesce(p_token, '')));
  if r is null or public.pb_is_ai(m.game_state, r) then
    raise exception 'Du bist in diesem Spiel kein Spieler';
  end if;
  if m.game_state->>'winner' is not null or coalesce((m.game_state->>'abandoned')::boolean, false) then
    raise exception 'Spiel ist bereits vorbei';
  end if;
  if p_role is null or not (p_role = any(public.pb_human_roles(m.game_state))) then
    raise exception 'Diesen Platz gibt es nicht';
  end if;
  if p_role = r then
    why := 'resign';
  elsif not m.seats ? p_role then
    why := 'empty';
  elsif m.game_state->>'turn' = p_role and m.last_move_at < now() - interval '24 hours' then
    why := 'timeout';
  else
    raise exception 'Erst nach 24 Stunden ohne Zug möglich';
  end if;

  s := m.game_state;
  s := jsonb_set(s, '{ai}', coalesce(s->'ai', '[]'::jsonb) || to_jsonb(p_role));
  s := jsonb_set(s, '{handed}', coalesce(s->'handed', '{}'::jsonb) || jsonb_build_object(p_role, why));
  s := jsonb_set(s, '{rev}', to_jsonb(coalesce((s->>'rev')::int, 0) + 1));
  -- Kein Mensch mehr übrig: Partie ist zu Ende.
  if cardinality(public.pb_human_roles(s)) = 0 then
    s := s || jsonb_build_object('abandoned', true);
  end if;

  update public.matches
     set game_state = s,
         -- Ist der übergebene Stamm gerade dran, rechnet der Aufrufer die KI.
         -- Wer selbst aufgibt, rechnet nicht mehr: dann gilt die KI sofort als
         -- hängend und jeder Mitspieler übernimmt.
         current_turn = case when s->>'turn' = p_role and why <> 'resign' then r else current_turn end,
         last_move_at = case when s->>'turn' <> p_role then last_move_at
                             when why = 'resign' then now() - interval '121 seconds'
                             else now() end
   where id = p_id
  returning * into m;
  return jsonb_build_object('match', public.pb_match_view(m, r), 'role', r);
end;
$$;

-- --- Rechte ----------------------------------------------------------------------

revoke all on function public.pb_admin_check() from public, anon, authenticated;
revoke all on function public.pb_admin_ok(text) from public, anon, authenticated;
revoke all on function public.pb_is_ai(jsonb, text) from public, anon, authenticated;
revoke all on function public.pb_match_view(public.matches, text) from public, anon, authenticated;
revoke all on function public.pb_match_ring() from public, anon, authenticated;
revoke all on function public.pb_check_plausible(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_match(jsonb, text, text) from public;
revoke all on function public.join_match(uuid, text) from public;
revoke all on function public.pb_get_match(uuid, text) from public;
revoke all on function public.pb_my_matches(text) from public;
revoke all on function public.save_match(uuid, text, jsonb, text) from public;
revoke all on function public.pb_hand_to_ai(uuid, text, text) from public;
grant execute on function public.create_match(jsonb, text, text) to anon, authenticated;
grant execute on function public.join_match(uuid, text) to anon, authenticated;
grant execute on function public.pb_get_match(uuid, text) to anon, authenticated;
grant execute on function public.pb_my_matches(text) to anon, authenticated;
grant execute on function public.save_match(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.pb_hand_to_ai(uuid, text, text) to anon, authenticated;
