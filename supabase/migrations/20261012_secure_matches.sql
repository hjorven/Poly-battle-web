-- Poly Battle: Online-Partien absichern
--
-- Vorher: RLS-Regeln mit `true` – jeder mit dem öffentlichen Schlüssel konnte
-- jede Partie überschreiben und die Spieler-Kennungen (Klartext) auslesen.
--
-- Jetzt:
--  * Schreiben nur noch über die Funktionen create_match / join_match /
--    save_match (security definer), die prüfen, wer schreibt.
--  * Spieler-Kennungen werden nur als SHA-256-Hash gespeichert.
--  * save_match lässt nur den Spieler schreiben, der laut Datenbank am Zug
--    ist, und nur neuere Stände (game_state.rev muss steigen).
--  * Lesen bleibt offen (nötig für Realtime und Zuschauer).

create or replace function public.pb_hash(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'sha256:' || encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

create or replace function public.pb_public_match(m public.matches)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(m)
    - 'player_1' - 'player_2' - 'skip_requested_by'
    || jsonb_build_object('player_1', m.player_1 is not null, 'player_2', m.player_2 is not null)
$$;

create or replace function public.create_match(p_state jsonb, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
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
  insert into public.matches (game_state, current_turn, player_1)
  values (p_state, coalesce(p_state->>'turn', 'player_1'), public.pb_hash(p_token))
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
  r text := null;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'Ungültige Spieler-Kennung';
  end if;
  select * into m from public.matches where id = p_id for update;
  if not found then
    return null;
  end if;
  h := public.pb_hash(p_token);
  if m.player_1 = h then
    r := 'player_1';
  elsif m.player_2 = h then
    r := 'player_2';
  elsif m.player_2 is null then
    update public.matches set player_2 = h where id = p_id returning * into m;
    r := 'player_2';
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
  h text;
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
  h := public.pb_hash(coalesce(p_token, ''));
  if m.player_1 = h then r := 'player_1';
  elsif m.player_2 = h then r := 'player_2';
  else
    raise exception 'Du bist in diesem Spiel kein Spieler';
  end if;
  if m.player_2 is null then
    raise exception 'Noch kein Mitspieler beigetreten';
  end if;
  if m.game_state->>'winner' is not null then
    raise exception 'Spiel ist bereits vorbei';
  end if;
  if m.current_turn is distinct from r then
    raise exception 'Du bist nicht am Zug';
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

revoke all on function public.create_match(jsonb, text) from public;
revoke all on function public.join_match(uuid, text) from public;
revoke all on function public.save_match(uuid, text, jsonb) from public;
grant execute on function public.create_match(jsonb, text) to anon, authenticated;
grant execute on function public.join_match(uuid, text) to anon, authenticated;
grant execute on function public.save_match(uuid, text, jsonb) to anon, authenticated;

-- Direkte Schreibzugriffe sperren; Lesen bleibt (Realtime, Zuschauer).
drop policy if exists "matches insert" on public.matches;
drop policy if exists "matches update" on public.matches;
revoke insert, update, delete, truncate, trigger, references on public.matches from anon, authenticated;

-- Bestehende Klartext-Kennungen in Hashes umwandeln.
update public.matches set player_1 = public.pb_hash(player_1)
 where player_1 is not null and player_1 not like 'sha256:%';
update public.matches set player_2 = public.pb_hash(player_2)
 where player_2 is not null and player_2 not like 'sha256:%';
update public.matches set skip_requested_by = null where skip_requested_by is not null;
