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
\set st '{"players":["player_1","player_2"],"ai":[],"turn":"player_1","round":1,"rev":0,"mapW":4,"mapH":4,"terrain":["field","field","field","field","field","field","field","field","field","field","field","field","field","field","field","field"],"techs":{"player_1":[],"player_2":[]},"stars":{"player_1":5,"player_2":5},"units":[{"id":"a1","owner":"player_1","type":"warrior","q":0,"r":0,"hp":10},{"id":"b1","owner":"player_2","type":"warrior","q":3,"r":3,"hp":10}],"cities":[{"q":0,"r":0,"owner":"player_1"},{"q":3,"r":3,"owner":"player_2"},{"q":1,"r":2,"owner":null}]}'
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
select 'Klingeln: ' || count(*) filter (where private) || ' letzte=' || max(topic) || ', öffentlich für alte Clients: ' || count(*) filter (where not private) from realtime.sent;
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
-- Reihenfolge player_1, KI player_3, player_2: nach A ist erst die KI dran.
reset role;
select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{players}', '["player_1","player_3","player_2"]'), '{ai}', '["player_3"]'),
  '{stars,player_3}', '5'), '{techs,player_3}', '[]'), '{cities}', (:'st'::jsonb)->'cities' || '[{"q":0,"r":3,"owner":"player_3"}]') as st3 \gset
set role anon;
select public.create_match(:'st3'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m4 \gset
select 'B tritt bei: ' || (public.join_match(:'m4', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
select jsonb_set(jsonb_set(:'st3'::jsonb, '{turn}', '"player_3"'), '{rev}', '1') as s4 \gset
select 'A beendet Zug, KI dran: ' || public.save_match(:'m4', 'AAAAAAAAAAAAAAAAAAAA', :'s4'::jsonb)::text;
reset role;
select 'current_turn bleibt beim Rechner: ' || current_turn from public.matches where id = :'m4';
set role anon;
select 'B übernimmt sofort: ' || pg_temp.fails($$select public.save_match('$$ || :'m4' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set('$$ || :'s4' || $$'::jsonb, '{rev}', '2'))$$);
reset role;
update public.matches set last_move_at = now() - interval '3 minutes' where id = :'m4';
set role anon;
select 'B übernimmt nach 3 min: ' || public.save_match(:'m4', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(:'s4'::jsonb, '{rev}', '2'), '{turn}', '"player_2"'))::text;
-- Aufgeben im eigenen Zug: Mitspieler übernimmt sofort die KI
select public.create_match(:'st'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m5 \gset
select 'B tritt bei: ' || (public.join_match(:'m5', 'BBBBBBBBBBBBBBBBBBBB')->>'role');
select 'A gibt im eigenen Zug auf: ai=' || (public.pb_hand_to_ai(:'m5', 'AAAAAAAAAAAAAAAAAAAA', 'player_1')->'match'->'game_state'->>'ai');
select 'B übernimmt sofort: ' || public.save_match(:'m5', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{rev}', '2'), '{turn}', '"player_2"'), '{ai}', '["player_1"]'))::text;
-- Mitspieler gibt auf, während ein anderer am Zug ist (Code-Prüfung 3, Fund 14):
-- der Zug zählt, KI-Liste und Aufgabe bleiben.
reset role;
select jsonb_set(jsonb_set(:'st3'::jsonb, '{players}', '["player_1","player_2","player_3"]'), '{ai}', '[]') as st7 \gset
set role anon;
select public.create_match(:'st7'::jsonb, 'AAAAAAAAAAAAAAAAAAAA')->>'id' as m7 \gset
select public.join_match(:'m7', 'BBBBBBBBBBBBBBBBBBBB') is not null as h \gset
select public.join_match(:'m7', 'CCCCCCCCCCCCCCCCCCCC') is not null as h \gset
select 'A speichert eine Aktion: ' || public.save_match(:'m7', 'AAAAAAAAAAAAAAAAAAAA', jsonb_set(:'st7'::jsonb, '{rev}', '1'))::text;
select 'C gibt auf, während A zieht: ai=' || (public.pb_hand_to_ai(:'m7', 'CCCCCCCCCCCCCCCCCCCC', 'player_3')->'match'->'game_state'->>'ai');
select 'A beendet den Zug mit altem Stand: ' || public.save_match(:'m7', 'AAAAAAAAAAAAAAAAAAAA', jsonb_set(jsonb_set(:'st7'::jsonb, '{rev}', '2'), '{turn}', '"player_2"'))::text;
reset role;
select 'danach: turn=' || (game_state->>'turn') || ' ai=' || (game_state->>'ai') || ' handed=' || (game_state->>'handed') || ' rev=' || (game_state->>'rev') from public.matches where id = :'m7';
set role anon;
select 'B schickt einen Stand ohne KI-Liste: ' || public.save_match(:'m7', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(:'st7'::jsonb, '{rev}', '9'), '{turn}', '"player_2"'))::text;
reset role;
select 'C bleibt KI: ai=' || (game_state->>'ai') from public.matches where id = :'m7';
set role anon;
select 'B tauscht C gegen A in der KI-Liste: ' || pg_temp.fails($$select public.save_match('$$ || :'m7' || $$', 'BBBBBBBBBBBBBBBBBBBB', jsonb_set(jsonb_set(jsonb_set('$$ || :'st7' || $$'::jsonb, '{rev}', '9'), '{turn}', '"player_2"'), '{ai}', '["player_1"]'))$$);
-- Namensprüfung: dieselben Fälle wie im Spiel (test/names.json)
reset role;
select 'Namen erlaubt: ' || coalesce(string_agg(n, ', ') filter (where pg_temp.fails(format('select public.pb_check_name(%L)', n)) <> 'KEIN FEHLER'), 'alle ok')
  from jsonb_array_elements_text((:'names')::jsonb->'erlaubt') n;
select 'Namen verboten: ' || coalesce(string_agg(n, ', ') filter (where pg_temp.fails(format('select public.pb_check_name(%L)', n)) <> 'Dieser Name ist nicht erlaubt'), 'alle gesperrt')
  from jsonb_array_elements_text((:'names')::jsonb->'verboten') n;
-- Zweite Prüfrunde: Startstand, Zugfolge, fremde Stämme (Befunde 2 und 4)
set role anon;
select 'Start mit HTML-Sternen: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{stars,player_2}', '"<img src=x onerror=alert(1)>"'), 'DDDDDDDDDDDDDDDDDDDD')$$);
select 'Start mit fremdem Einheitentyp: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{units,0,type}', '"<b>x</b>"'), 'DDDDDDDDDDDDDDDDDDDD')$$);
select 'Start in Runde 5: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{round}', '5'), 'DDDDDDDDDDDDDDDDDDDD')$$);
select 'Start mit Sieger: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{winner}', '"player_1"'), 'DDDDDDDDDDDDDDDDDDDD')$$);
select 'Start mit 9999 Sternen: ' || pg_temp.fails($$select public.create_match(jsonb_set('$$ || :'st' || $$'::jsonb, '{stars,player_1}', '9999'), 'DDDDDDDDDDDDDDDDDDDD')$$);
select public.create_match(jsonb_set(:'st'::jsonb, '{turnLimit}', '30'), 'DDDDDDDDDDDDDDDDDDDD')->>'id' as m6 \gset
select 'E tritt bei: ' || (public.join_match(:'m6', 'EEEEEEEEEEEEEEEEEEEE')->>'role');
-- Normales Spiel: D zieht, nimmt das Dorf, besiegt Es Krieger, beendet den Zug; E ist dran, dann wieder D in Runde 2.
reset role;
select jsonb_set(jsonb_set(jsonb_set(jsonb_set(:'st'::jsonb, '{turnLimit}', '30'), '{rev}', '1'), '{units,0,q}', '1'), '{cities,2,owner}', '"player_1"') as n1 \gset
select jsonb_set(jsonb_set(jsonb_set(:'n1'::jsonb, '{rev}', '2'), '{units}', jsonb_build_array((:'n1'::jsonb)->'units'->0)), '{turn}', '"player_2"') as n2 \gset
select jsonb_set(jsonb_set(jsonb_set(jsonb_set(:'n2'::jsonb, '{rev}', '3'), '{turn}', '"player_1"'), '{round}', '2'), '{stars,player_1}', '8') as n3 \gset
set role anon;
select 'D zieht (Zug bleibt): ' || public.save_match(:'m6', 'DDDDDDDDDDDDDDDDDDDD', :'n1'::jsonb)::text;
select 'D beendet den Zug: ' || public.save_match(:'m6', 'DDDDDDDDDDDDDDDDDDDD', :'n2'::jsonb)::text;
select 'E beendet den Zug, Runde 2: ' || public.save_match(:'m6', 'EEEEEEEEEEEEEEEEEEEE', :'n3'::jsonb)::text;
-- Ab hier versucht D (am Zug), die Partie zu manipulieren.
select 'Sofortsieg mit eigenem Rundenlimit: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{round}', '3'), '{turnLimit}', '2'), '{winner}', '"player_1"'), '{endReason}', '"score"'))$$);
select 'Sofortsieg nach Punkten: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{winner}', '"player_1"'), '{endReason}', '"score"'))$$);
select 'Sieg als Mission: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{winner}', '"player_1"'), '{endReason}', '"mission"'))$$);
select 'Gegnerstadt löschen: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{cities}', jsonb_build_array(('$$ || :'n3' || $$'::jsonb)->'cities'->0, ('$$ || :'n3' || $$'::jsonb)->'cities'->2)))$$);
select 'Gegnerstadt neutral machen: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{cities,1,owner}', 'null'))$$);
select 'Einheit für den Gegner erfinden: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{units}', ('$$ || :'n3' || $$'::jsonb)->'units' || '[{"id":"x9","owner":"player_2","type":"warrior","q":2,"r":2,"hp":1}]'))$$);
select 'Gegner-Sterne auf 0: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{stars,player_2}', '0'))$$);
select 'Gegner-Technologien ändern: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{techs,player_2}', '["riding"]'))$$);
select 'turn = nobody: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{turn}', '"nobody"'))$$);
select 'Zweimal hintereinander ziehen: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{round}', '3'))$$);
select 'Runde springen: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{round}', '7'))$$);
select 'Rundenlimit ändern: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{turnLimit}', '3'))$$);
select 'Stamm tauschen: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{tribes}', '{"player_1":"aimo"}'))$$);
select 'Sterne als Text speichern: ' || pg_temp.fails($$select public.save_match('$$ || :'m6' || $$', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set('$$ || :'n3' || $$'::jsonb, '{rev}', '4'), '{stars,player_1}', '"<img>"'))$$);
select 'D erobert die letzte Stadt und gewinnt: ' || public.save_match(:'m6', 'DDDDDDDDDDDDDDDDDDDD', jsonb_set(jsonb_set(jsonb_set(jsonb_set(:'n3'::jsonb, '{rev}', '4'), '{cities,1,owner}', '"player_1"'), '{winner}', '"player_1"'), '{endReason}', '"conquest"'))::text;
-- Mengenbremse (Befund 5): je Netz 20 neue Partien pro Stunde, je Spieler 20 laufende
reset role;
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7"}', false) is not null as h \gset
set role anon;
select 'Partien vom selben Netz: ' || count(*) filter (where pg_temp.fails(format('select public.create_match(%L::jsonb, %L)', :'st', 'FFFFFFFFFFFFFFFFFFFF')) = 'KEIN FEHLER') || ' angelegt'
  from generate_series(1, 20);
select 'die 21. vom selben Spieler: ' || pg_temp.fails($$select public.create_match('$$ || :'st' || $$'::jsonb, 'FFFFFFFFFFFFFFFFFFFF')$$);
select 'die 21. vom selben Netz: ' || pg_temp.fails($$select public.create_match('$$ || :'st' || $$'::jsonb, 'GGGGGGGGGGGGGGGGGGGG')$$);
reset role;
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.9","x-forwarded-for":"203.0.113.7"}', false) is not null as h \gset
set role anon;
select 'anderes Netz (cf-connecting-ip zählt): ' || (public.create_match(:'st'::jsonb, 'GGGGGGGGGGGGGGGGGGGG') ? 'id');
reset role;
select 'IPv6 nach /64: gleiches Netz ' || (h1 = h2) || ', anderes Netz ' || (h1 = h3) || ', gesalzen ' || (h1 <> 'ip:' || encode(sha256(convert_to('2001:db8:1:2::/64', 'UTF8')), 'hex'))
  from (select set_config('request.headers', '{"x-forwarded-for":"2001:db8:1:2::1"}', false) a, public.pb_client_ip_hash() h1) x,
  lateral (select set_config('request.headers', '{"x-forwarded-for":"2001:db8:1:2:ffff::5"}', false) b, public.pb_client_ip_hash() h2) y,
  lateral (select set_config('request.headers', '{"x-forwarded-for":"2001:db8:1:3::1"}', false) c, public.pb_client_ip_hash() h3) z;
select 'Salz für Clients lesbar: ' || pg_temp.fails('set role anon; select * from public.pb_secret');
reset role;
-- Namen: die Grenze je Minute gilt nur ohne IP-Angabe
insert into public.pb_name_log (ip_hash) select null from generate_series(1, 60);
select set_config('request.headers', '{"x-forwarded-for":"192.0.2.44"}', false) is not null as h \gset
set role anon;
select 'Name mit IP trotz voller Minute: ' || (public.pb_claim_name('HHHHHHHHHHHHHHHHHHHH', 'Hilde') ->> 'name');
reset role;
select set_config('request.headers', '', false) is not null as h \gset
set role anon;
select 'Name ohne IP bei voller Minute: ' || pg_temp.fails($$select public.pb_claim_name('IIIIIIIIIIIIIIIIIIII', 'Ingo')$$);
-- Bestenliste (Befunde 5 und 13)
reset role;
select set_config('request.headers', '{"x-forwarded-for":"192.0.2.45"}', false) is not null as h \gset
set role anon;
select public.pb_claim_name('IIIIIIIIIIIIIIIIIIII', 'Ingo') is not null as h \gset
-- Nur Protokolle ab 60 Einträgen müssen eindeutig sein (Code-Prüfung 3, Fund 15).
select (select jsonb_agg(jsonb_build_object('k', 'move', 'u', jsonb_build_array(3, i), 'to', jsonb_build_array(4, i))) from generate_series(1, 60) i)
       || '[{"k":"research","t":"riding"},{"k":"end"}]'::jsonb as log \gset
select '[{"k":"mon"}]'::jsonb || (select jsonb_agg(case when e->>'k' = 'move' then e || '{"x":1}' || jsonb_build_object('u', jsonb_build_array(3.0, (e->'u'->>1)::int))
       else e end order by n) from jsonb_array_elements(:'log'::jsonb) with ordinality t(e, n)) as log2 \gset
select 'H reicht ein: ' || public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'daily', current_date::text, 100, 'aimo', 30, :'log'::jsonb)::text;
select 'H reicht dasselbe nochmal ein: ' || public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'daily', current_date::text, 100, 'aimo', 30, :'log'::jsonb)::text;
select 'I reicht Hs Protokoll ein: ' || pg_temp.fails($$select public.pb_submit_score('IIIIIIIIIIIIIIIIIIII', 'daily', current_date::text, 100, 'aimo', 30, '$$ || :'log' || $$'::jsonb)$$);
select 'I mit umgeschriebenem Protokoll: ' || pg_temp.fails($$select public.pb_submit_score('IIIIIIIIIIIIIIIIIIII', 'daily', current_date::text, 100, 'aimo', 30, '$$ || :'log2' || $$'::jsonb)$$);
select 'gleiches Protokoll in der Woche: ' || public.pb_submit_score('IIIIIIIIIIIIIIIIIIII', 'weekly', to_char(now(), 'IYYY-"W"IW'), 100, 'aimo', 30, :'log'::jsonb)::text;
select 'H zweites Ergebnis: ' || public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'daily', current_date::text, 90, 'aimo', 30, '[{"k":"end"}]'::jsonb)::text;
select 'H drittes Ergebnis: ' || public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'weekly', to_char(now(), 'IYYY-"W"IW'), 90, 'aimo', 30, '[{"k":"end"},{"k":"end"}]'::jsonb)::text;
select 'I mit gleichem kurzen Protokoll wie H: ' || public.pb_submit_score('IIIIIIIIIIIIIIIIIIII', 'daily', current_date::text, 90, 'aimo', 30, '[{"k":"end"}]'::jsonb)::text;
select 'H viertes offenes Ergebnis: ' || pg_temp.fails($$select public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'daily', current_date::text, 80, 'aimo', 30, '[{"k":"end"},{"k":"end"},{"k":"end"}]'::jsonb)$$);
select 'Protokoll über 96 KB: ' || pg_temp.fails($$select public.pb_submit_score('IIIIIIIIIIIIIIIIIIII', 'daily', current_date::text, 80, 'aimo', 30, (select jsonb_agg('{"k":"move","u":[10,10],"to":[11,10]}'::jsonb) from generate_series(1, 3000)))$$);
reset role;
select public.pb_settle_claim(min(id), true, 100, 30, 'aimo') is not null as h from public.pb_score_claims \gset
set role anon;
select 'H reicht gewertetes Ergebnis nochmal ein: ' || public.pb_submit_score('HHHHHHHHHHHHHHHHHHHH', 'daily', current_date::text, 100, 'aimo', 30, :'log'::jsonb)::text;
select 'Bestenliste ohne Stufe: ' || (public.pb_leaderboard('daily', current_date::text)->'top'->0)::text;
-- Speicherfristen: Einreichungen 30 Tage, Bestenliste 90 Tage, Profile 365 Tage
reset role;
update public.pb_score_claims set created_at = now() - interval '31 days' where kind = 'weekly';
insert into public.pb_profiles (token_hash, name, name_key, level, updated_at) values ('alt', 'Altvorder', 'altvorder', 7, now() - interval '400 days');
insert into public.pb_scores (profile_id, kind, period, score, updated_at)
  select id, 'daily', '2026-01-01', 5, now() - interval '91 days' from public.pb_profiles where name = 'Hilde';
set role anon;
select public.pb_claim_name('JJJJJJJJJJJJJJJJJJJJ', 'Jule') is not null as h \gset
reset role;
select 'aufgeräumt: Einreichungen ' || (select count(*) from public.pb_score_claims) || ', alte Bestenliste ' || (select count(*) from public.pb_scores where period = '2026-01-01')
  || ', altes Profil ' || (select count(*) from public.pb_profiles where name = 'Altvorder');
-- Realtime: auf dem privaten Kanal darf nur die Datenbank klingeln
set role anon;
select 'Klingel fälschen: ' || pg_temp.fails($$insert into realtime.messages (topic, extension, payload, event, private) values ('match-x', 'broadcast', '{}', 'moved', true)$$);
reset role;
insert into realtime.messages (topic, extension, payload, event, private) values ('match-x', 'broadcast', '{}', 'moved', true);
set role anon;
select set_config('realtime.topic', 'match-x', false) is not null as h \gset
select 'Klingel auf match-x lesen: ' || (select count(*) from realtime.messages);
select set_config('realtime.topic', 'chat-x', false) is not null as h \gset
select 'Kanal chat-x lesen: ' || (select count(*) from realtime.messages);
