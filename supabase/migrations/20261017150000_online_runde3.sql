-- Dritte Code-Prüfung, Online-Teil (review/code-pruefung-3.md, Funde 14 und 15).
-- Abwärtskompatibel: ältere Clients rufen dieselben Funktionen mit denselben
-- Argumenten auf und bekommen dieselben Antworten, nur mit mehr Feldern.
--
-- 1. Gibt ein Mitspieler auf (oder wird nach 24 Stunden an die KI gegeben),
--    während ein anderer am Zug ist, scheiterte dessen nächste Speicherung mit
--    „Spielerliste darf sich nicht ändern“, und seine letzte Aktion war weg.
--    save_match übernimmt jetzt KI-Liste und Aufgabe-Markierungen aus dem
--    gespeicherten Stand und duldet die dabei hochgezählte Versionsnummer.
-- 2. Erneutes Einreichen eines schon geprüften Ergebnisses meldet den echten
--    Stand (gewertet oder abgelehnt mit Grund) statt immer „wird geprüft“.
-- 3. Kurze Zugprotokolle (unter 60 Einträgen) dürfen bei zwei Profilen gleich
--    sein: wer am selben Tag nur wenige gleiche Züge macht, ist kein Kopierer.

-- --- Speichern nach Aufgabe eines Mitspielers -------------------------------------------

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
  handed_since int;
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
  -- Die Spieler bleiben dieselben. Die KI-Liste darf auf dem Server länger
  -- sein als im gesendeten Stand: dann hat jemand während dieses Zuges
  -- aufgegeben, und das gilt weiter.
  if (p_state->'players') is distinct from (m.game_state->'players')
     or jsonb_typeof(coalesce(p_state->'ai', '[]'::jsonb)) <> 'array'
     or not (coalesce(m.game_state->'ai', '[]'::jsonb) @> coalesce(p_state->'ai', '[]'::jsonb)) then
    raise exception 'Spielerliste darf sich nicht ändern';
  end if;
  handed_since := jsonb_array_length(coalesce(m.game_state->'ai', '[]'::jsonb))
                - jsonb_array_length(coalesce(p_state->'ai', '[]'::jsonb));
  old_rev := coalesce((m.game_state->>'rev')::int, 0);
  new_rev := coalesce((p_state->>'rev')::int, 0);
  -- Jede Übergabe an die KI hat die Versionsnummer um eins erhöht.
  if new_rev <= old_rev - greatest(handed_since, 0) then
    raise exception 'Veralteter Spielstand';
  end if;
  if handed_since > 0 then
    new_rev := greatest(new_rev, old_rev + 1);
    p_state := p_state || jsonb_build_object(
      'ai', m.game_state->'ai',
      'handed', coalesce(p_state->'handed', '{}'::jsonb) || coalesce(m.game_state->'handed', '{}'::jsonb),
      'rev', new_rev);
  end if;
  if coalesce((p_state->>'admin')::boolean, false) and not coalesce((m.game_state->>'admin')::boolean, false)
     and not public.pb_admin_ok(p_admin_key) then
    raise exception 'Testpartien nur mit Admin-Schlüssel';
  end if;
  -- Datentypen gelten für alle Partien, auch Testpartien.
  bad := public.pb_check_shape(p_state);
  if bad is not null then
    raise exception 'Spielstand abgelehnt: %', bad;
  end if;
  -- Testpartien mit gültigem Schlüssel werden nicht geprüft, alle anderen schon.
  if not (coalesce((p_state->>'admin')::boolean, false) and public.pb_admin_ok(p_admin_key)) then
    bad := coalesce(public.pb_check_plausible(m.game_state, p_state),
                    public.pb_check_moves(m.game_state, p_state, r));
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
  if handed_since > 0 then
    return jsonb_build_object('rev', new_rev, 'merged', true);
  end if;
  return jsonb_build_object('rev', new_rev);
end;
$$;

-- --- Bestenliste ------------------------------------------------------------------------

-- Nur längere Protokolle müssen je Herausforderung eindeutig sein.
alter table public.pb_score_claims add column if not exists long_log boolean not null default true;
drop index if exists public.pb_score_claims_same_log;
create unique index if not exists pb_score_claims_same_long_log
  on public.pb_score_claims (kind, period, actions_hash) where long_log;

create or replace function public.pb_submit_score(p_token text, p_kind text, p_period text, p_score int, p_tribe text, p_round int, p_actions jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.pb_profiles;
  d date;
  h text;
  other uuid;
  mine public.pb_score_claims;
  long boolean;
begin
  select * into pr from public.pb_profiles where token_hash = public.pb_hash(coalesce(p_token, ''));
  if not found then
    raise exception 'Erst einen Namen wählen';
  end if;
  if p_kind = 'daily' then
    begin
      d := p_period::date;
    exception when others then
      raise exception 'Ungültiger Tag';
    end;
    if d < current_date - 1 or d > current_date + 1 then
      raise exception 'Nur die heutige Tagesherausforderung zählt';
    end if;
  elsif p_kind = 'weekly' then
    if p_period not in (to_char(now(), 'IYYY-"W"IW'), to_char(now() - interval '1 day', 'IYYY-"W"IW'), to_char(now() + interval '1 day', 'IYYY-"W"IW')) then
      raise exception 'Nur die aktuelle Wochen-Herausforderung zählt';
    end if;
  else
    raise exception 'Unbekannte Wertung';
  end if;
  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Bitte die Seite neu laden: diese Version kann keine Punkte einreichen';
  end if;
  -- Das längste gemessene Protokoll (30 Runden, viele Einheiten) hat rund
  -- 1000 Einträge und 37 KB; 96 KB lassen reichlich Luft.
  if octet_length(p_actions::text) > 98304 or jsonb_array_length(p_actions) > 5000 then
    raise exception 'Zugprotokoll zu groß';
  end if;
  if p_round is null or p_round < 1 or p_round > 61 or p_score is null or p_score < 0 then
    raise exception 'Ungültige Punktzahl';
  end if;
  perform public.pb_cleanup();
  -- Dasselbe Spiel zählt je Herausforderung nur einmal (sonst füllt ein
  -- gutes Protokoll mit Zweitkonten die ganze Liste). Kurze Protokolle
  -- können zufällig gleich sein und sind nichts wert, die dürfen doppelt.
  h := public.pb_actions_hash(p_actions);
  long := jsonb_array_length(p_actions) >= 60;
  select * into mine from public.pb_score_claims c
   where c.profile_id = pr.id and c.kind = p_kind and c.period = p_period and c.actions_hash = h
   order by c.created_at desc limit 1;
  if found then
    return jsonb_build_object('pending', mine.status = 'pending', 'duplicate', true,
                              'status', mine.status, 'reason', mine.reason, 'score', mine.score);
  end if;
  if long then
    select c.profile_id into other from public.pb_score_claims c
     where c.kind = p_kind and c.period = p_period and c.actions_hash = h and c.long_log limit 1;
    if found then
      raise exception 'Dieses Spiel wurde schon von einem anderen Profil eingereicht';
    end if;
  end if;
  -- Nicht fluten: höchstens 10 Versuche je Wertung, 3 gleichzeitig in Prüfung.
  if (select count(*) from public.pb_score_claims
       where profile_id = pr.id and kind = p_kind and period = p_period) >= 10 then
    raise exception 'Für diese Herausforderung hast du schon 10 Ergebnisse eingereicht';
  end if;
  if (select count(*) from public.pb_score_claims
       where profile_id = pr.id and status = 'pending') >= 3 then
    raise exception 'Drei deiner Ergebnisse warten noch auf die Prüfung. Versuch es in ein paar Minuten noch einmal';
  end if;
  perform public.pb_rate_hit('score', 60, 300, interval '1 hour',
    'Von deinem Netz wurden gerade sehr viele Ergebnisse eingereicht. Versuch es später noch einmal');
  begin
    insert into public.pb_score_claims (profile_id, kind, period, score, round, actions, actions_hash, long_log)
    values (pr.id, p_kind, p_period, p_score, p_round, p_actions, h, long);
  exception when unique_violation then
    raise exception 'Dieses Spiel wurde schon von einem anderen Profil eingereicht';
  end;
  return jsonb_build_object('pending', true);
end;
$$;

-- --- Rechte -----------------------------------------------------------------------------

revoke all on function public.save_match(uuid, text, jsonb, text) from public;
revoke all on function public.pb_submit_score(text, text, text, int, text, int, jsonb) from public;
grant execute on function public.save_match(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.pb_submit_score(text, text, text, int, text, int, jsonb) to anon, authenticated;
