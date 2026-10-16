-- Datenbank-Tests für Online-Partien (scripts/test-db.sh). Jede Zeile gibt
-- „Name: Ergebnis“ aus; test/db/expected.txt enthält die erwartete Ausgabe.
\set ON_ERROR_STOP 1
create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return 'KEIN FEHLER'; exception when others then return sqlerrm; end $$;
-- Testschlüssel statt des echten Admin-Passworts
create or replace function public.pb_admin_check() returns text language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex') $$;
grant execute on function pg_temp.fails(text) to anon;

set role anon;
select 'direkt lesen: ' || pg_temp.fails('select * from public.matches');
\set st '{"players":["player_1","player_2"],"ai":[],"turn":"player_1","round":1,"rev":0,"techs":{"player_1":[],"player_2":[]},"stars":{"player_1":5,"player_2":5},"units":[],"cities":[{"owner":"player_1"},{"owner":"player_2"}]}'
select public.create_match(:'st'::jsonb, 'AAAAAAAAAAAAAAAAAAAA') as c \gset
select (:'c'::jsonb)->>'id' as mid \gset
select 'anlegen: role=' || ((:'c'::jsonb)->>'role') || ' state=' || (((:'c'::jsonb)->'game_state') is not null);
select 'fremd lesen: ' || (public.pb_get_match(:'mid', 'CCCCCCCCCCCCCCCCCCCC')->'match'->>'hidden') || ' state=' || coalesce(public.pb_get_match(:'mid', 'CCCCCCCCCCCCCCCCCCCC')->'match'->>'game_state', 'null');
select 'speichern vor Beitritt: ' || pg_temp.fails($$select public.save_match('$$ || :'mid' || $$', 'AAAAAAAAAAAAAAAAAAAA', '{"players":["player_1","player_2"],"ai":[],"turn":"player_2","rev":1}')$$);
select 'B tritt bei: ' || (public.join_match(:'mid', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
select 'C tritt bei: ' || coalesce(public.join_match(:'mid', 'CCCCCCCCCCCCCCCCCCCC')->>'role', 'Zuschauer') || ' hidden=' || (public.join_match(:'mid', 'CCCCCCCCCCCCCCCCCCCC')->'match'->>'hidden');
select 'B nicht am Zug: ' || pg_temp.fails($$select public.save_match('$$ || :'mid' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set('$$ || :'st' || $$'::jsonb, '{rev}', '1'))$$);
select 'A zieht: ' || public.save_match(:'mid', 'AAAAAAAAAAAAAAAAAAAA', jsonb_set(jsonb_set(:'st'::jsonb, '{rev}', '1'), '{turn}', '"player_2"'))::text;
select 'Testpartie ohne Schlüssel: ' || pg_temp.fails($$select public.save_match('$$ || :'mid' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set('$$ || :'st' || $$'::jsonb, '{rev}', '2'), '{admin}', 'true'))$$);
select 'Testpartie falscher Schlüssel: ' || pg_temp.fails($$select public.save_match('$$ || :'mid' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set('$$ || :'st' || $$'::jsonb, '{rev}', '2'), '{admin}', 'true'), repeat('b', 64))$$);
select 'unplausibel: ' || pg_temp.fails($$select public.save_match('$$ || :'mid' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set('$$ || :'st' || $$'::jsonb, '{rev}', '2'), '{stars,player_2}', '99999'))$$);
select 'unplausibel mit Schlüssel: ' || public.save_match(:'mid', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{rev}', '2'), '{stars,player_2}', '99999'), '{admin}', 'true'), repeat('a', 64))::text;
select 'Admin-Anlegen ohne Schlüssel: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{admin}', 'true'), 'AAAAAAAAAAAAAAAAAAAA')$$);
reset role;
select 'Klingeln: ' || count(*) || ' letzte=' || max(topic) from realtime.sent;
-- Zweite Partie für Zugzeit und Aufgeben
set role anon;
select public.create_match(:'st'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m2 \gset
select 'freien Platz mit KI füllen: ' || (public.pb_hand_to_ai(:'m2', 'AAAAAAAAAAAAAAAAAAAA', 'player_2')->'match'->'game_state'->>'ai');
select 'Partie 2 ist A allein: abandoned=' || coalesce(public.pb_get_match(:'m2', 'AAAAAAAAAAAAAAAAAAAA')->'match'->'game_state'->>'abandoned', 'nein');
select public.create_match(:'st'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m3 \gset
select 'B tritt bei: ' || (public.join_match(:'m3', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
select 'B übergibt A zu früh: ' || pg_temp.fails($$select public.pb_hand_to_ai('$$ || :'m3' || $$', 'BBBBBBBBBBBBBBBBBBBB', 'player_1')$$);
reset role;
update public.matches set last_move_at = now() - interval '25 hours' where id = :'m3';
set role anon;
select 'B übergibt A nach 25 h: ai=' || (public.pb_hand_to_ai(:'m3', 'BBBBBBBBBBBBBBBBBBBB', 'player_1')->'match'->'game_state'->>'ai');
reset role;
select 'current_turn jetzt: ' || current_turn from public.matches where id = :'m3';
set role anon;
select 'A (jetzt KI) speichert: ' || pg_temp.fails($$select public.save_match('$$ || :'m3' || $$', 'AAAAAAAAAAAAAAAAAAAA', jsonb_set('$$ || :'st' || $$'::jsonb, '{rev}', '5'))$$);
select 'B rechnet KI und speichert: ' || public.save_match(:'m3', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{rev}', '2'), '{turn}', '"player_2"'), '{ai}', '["player_1"]'))::text;
select 'A sieht noch (mit Rolle): role=' || (public.pb_get_match(:'m3', 'AAAAAAAAAAAAAAAAAAAA')->>'role') || ' hidden=' || (public.pb_get_match(:'m3', 'AAAAAAAAAAAAAAAAAAAA')->'match'->>'hidden');
select 'B gibt auf: abandoned=' || (public.pb_hand_to_ai(:'m3', 'BBBBBBBBBBBBBBBBBBBB', 'player_2')->'match'->'game_state'->>'abandoned');
select 'Meine Partien A: ' || jsonb_array_length(public.pb_my_matches('AAAAAAAAAAAAAAAAAAAA')) || ', C: ' || jsonb_array_length(public.pb_my_matches('CCCCCCCCCCCCCCCCCCCC'));
-- KI hängt
select public.create_match(jsonb_set(jsonb_set(:'st'::jsonb, '{players}', '["player_1","player_2","player_3"]'), '{ai}', '["player_3"]'), 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m4 \gset
select 'B tritt bei: ' || (public.join_match(:'m4', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
\set s4 '{"players":["player_1","player_2","player_3"],"ai":["player_3"],"turn":"player_3","round":1,"rev":1,"techs":{},"stars":{},"units":[],"cities":[]}'
select 'A beendet Zug, KI dran: ' || public.save_match(:'m4', 'AAAAAAAAAAAAAAAAAAAA', :'s4'::jsonb)::text;
reset role;
select 'current_turn bleibt beim Rechner: ' || current_turn from public.matches where id = :'m4';
set role anon;
select 'B übernimmt sofort: ' || pg_temp.fails($$select public.save_match('$$ || :'m4' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set('$$ || :'s4' || $$'::jsonb, '{rev}', '2'))$$);
reset role;
update public.matches set last_move_at = now() - interval '3 minutes' where id = :'m4';
set role anon;
select 'B übernimmt nach 3 min: ' || public.save_match(:'m4', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(:'s4'::jsonb, '{rev}', '2'), '{turn}', '"player_1"'))::text;
-- Aufgeben im eigenen Zug: Mitspieler übernimmt sofort die KI
select public.create_match(:'st'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m5 \gset
select 'B tritt bei: ' || (public.join_match(:'m5', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
select 'A gibt im eigenen Zug auf: ai=' || (public.pb_hand_to_ai(:'m5', 'AAAAAAAAAAAAAAAAAAAA', 'player_1')->'match'->'game_state'->>'ai');
select 'B übernimmt sofort: ' || public.save_match(:'m5', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{rev}', '2'), '{turn}', '"player_2"'), '{ai}', '["player_1"]'))::text;
