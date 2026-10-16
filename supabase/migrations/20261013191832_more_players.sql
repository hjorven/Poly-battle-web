-- Poly Battle: Online-Partien mit bis zu 5 Menschen
--
-- Bisher gab es genau zwei menschliche Plätze (player_1, player_2). Jetzt
-- stehen alle Plätze in `seats` (Rolle -> Hash der Spieler-Kennung). Welche
-- Rollen Menschen sind, steht im Spielstand: alle `players` ohne die in `ai`.
--
--  * join_match vergibt den nächsten freien menschlichen Platz.
--  * save_match verlangt, dass alle menschlichen Plätze besetzt sind, und
--    lässt wie bisher nur den Spieler schreiben, der am Zug ist.
--  * player_1/player_2 werden weiter mitgeschrieben (ältere Clients).

alter table public.matches add column if not exists seats jsonb not null default '{}'::jsonb;

-- Bestehende Partien übernehmen.
update public.matches
   set seats = jsonb_strip_nulls(jsonb_build_object('player_1', player_1, 'player_2', player_2))
 where seats = '{}'::jsonb and (player_1 is not null or player_2 is not null);

-- Menschliche Rollen laut Spielstand (ohne KI), in Spielreihenfolge.
create or replace function public.pb_human_roles(s jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(p order by ord), array[]::text[])
    from jsonb_array_elements_text(coalesce(s->'players', '["player_1","player_2"]'::jsonb)) with ordinality as x(p, ord)
   where not coalesce(s->'ai', '[]'::jsonb) ? p
$$;

create or replace function public.pb_role_of(m public.matches, h text)
returns text
language sql
stable
set search_path = ''
as $$
  select k from jsonb_each_text(m.seats) as e(k, v) where v = h limit 1
$$;

create or replace function public.pb_public_match(m public.matches)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(m)
    - 'player_1' - 'player_2' - 'skip_requested_by' - 'seats'
    || jsonb_build_object(
      'player_1', m.seats ? 'player_1',
      'player_2', m.seats ? 'player_2',
      'joined', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(m.seats) as k),
      'humans', to_jsonb(public.pb_human_roles(m.game_state))
    )
$$;

create or replace function public.create_match(p_state jsonb, p_token text)
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
  h := public.pb_hash(p_token);
  insert into public.matches (game_state, current_turn, player_1, seats)
  values (p_state, coalesce(p_state->>'turn', 'player_1'), h, jsonb_build_object('player_1', h))
  returning * into m;
  return public.pb_public_match(m);
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
  if r is null then
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
  return jsonb_build_object('match', public.pb_public_match(m), 'role', r);
end;
$$;

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
  update public.matches
     set game_state = p_state,
         current_turn = coalesce(p_state->>'turn', current_turn),
         last_move_at = now()
   where id = p_id;
  return jsonb_build_object('rev', new_rev);
end;
$$;

revoke all on function public.pb_human_roles(jsonb) from public;
revoke all on function public.pb_role_of(public.matches, text) from public;
revoke all on function public.create_match(jsonb, text) from public;
revoke all on function public.join_match(uuid, text) from public;
revoke all on function public.save_match(uuid, text, jsonb) from public;
grant execute on function public.create_match(jsonb, text) to anon, authenticated;
grant execute on function public.join_match(uuid, text) to anon, authenticated;
grant execute on function public.save_match(uuid, text, jsonb) to anon, authenticated;

-- Supabase vergibt für neue Funktionen Rechte an anon/authenticated: interne
-- Hilfsfunktionen nur über die security-definer-Funktionen nutzbar machen.
revoke execute on function public.pb_human_roles(jsonb) from anon, authenticated;
revoke execute on function public.pb_role_of(public.matches, text) from anon, authenticated;
revoke execute on function public.pb_public_match(public.matches) from public, anon, authenticated;
