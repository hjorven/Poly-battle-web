-- Poly Battle: Schutz der Datenbank, zweite Runde (Befunde 2, 4, 5, 13 und
-- kleinere Punkte aus der zweiten Prüfung)
--
--  * create_match und save_match prüfen die Datentypen des Spielstands
--    (Sterne, Runde, Einheiten, Städte … sind Zahlen bzw. Listen, Texte nur
--    aus erlaubten Zeichen). create_match nimmt nur einen echten Startstand an
--    (Runde 1, kein Sieger, normale Sterne).
--  * save_match prüft zusätzlich die Zugfolge: Der nächste Spieler muss laut
--    Reihenfolge stimmen (übersprungen werden dürfen nur KI-Stämme und
--    besiegte Stämme), die Runde wächst nur beim Rundenwechsel um 1, das
--    Rundenlimit bleibt, Sieg nach Punkten erst am Rundenlimit. Städte
--    verschwinden nie; Städte, Einheiten, Technologien und Sterne von
--    Stämmen, die in diesem Abschnitt nicht gezogen haben, ändern sich nur so,
--    wie es die Regeln erlauben (Eroberung, Verluste, Einkommen).
--  * Mengenbremsen: neue Partien und Bestenlisten-Einreichungen je Netz,
--    offene Partien je Spieler, offene Einreichungen je Profil, kleineres
--    Zugprotokoll.
--  * Dasselbe Zugprotokoll zählt je Herausforderung nur einmal.
--  * Bestenliste zeigt die Stufe nicht mehr (sie kam ungeprüft vom Spiel).
--  * IP-Prüfsumme mit geheimem Salz, IPv6 nach /64-Netz; Speicherfristen für
--    Bestenliste, Einreichungen und Profile.
--  * Realtime: die Klingel geht zusätzlich auf einen privaten Kanal, auf dem
--    nur die Datenbank senden darf.
--
-- Abwärtskompatibel: gleiche Funktionen, gleiche Parameter. Mehrfach
-- ausführbar (create or replace / if not exists).

-- --- Geheimes Salz für die IP-Prüfsumme ------------------------------------------

create table if not exists public.pb_secret (
  name text primary key,
  value text not null
);
alter table public.pb_secret enable row level security;
revoke all on public.pb_secret from public, anon, authenticated;
insert into public.pb_secret (name, value)
values ('ip_salt', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
on conflict (name) do nothing;

-- Netzwerkadresse der Anfrage als gesalzene Prüfsumme. IPv6 zählt nach
-- /64-Netz (ein Anschluss bekommt meist ein ganzes /64). Läuft nur innerhalb
-- der security-definer-Funktionen (liest das Salz).
create or replace function public.pb_client_ip_hash()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  hdr json;
  ip text;
  net inet;
  salt text;
begin
  begin
    hdr := current_setting('request.headers', true)::json;
  exception when others then
    hdr := null;
  end;
  -- Cloudflare setzt cf-connecting-ip selbst; x-forwarded-for nur als Ersatz.
  ip := btrim(split_part(coalesce(hdr->>'cf-connecting-ip', hdr->>'x-forwarded-for', ''), ',', 1));
  if ip = '' then
    return null;
  end if;
  begin
    net := ip::inet;
    if family(net) = 6 then
      ip := network(set_masklen(net, 64))::text;
    else
      ip := host(net);
    end if;
  exception when others then
    null; -- keine gültige Adresse: so nehmen, wie sie kam
  end;
  select value into salt from public.pb_secret where name = 'ip_salt';
  return 'ip:' || encode(sha256(convert_to(coalesce(salt, '') || '|' || ip, 'UTF8')), 'hex');
end;
$$;

-- --- Mengenbremse je Netz ----------------------------------------------------------

create table if not exists public.pb_rate_log (
  kind text not null,
  ip_hash text,
  at timestamptz not null default now()
);
create index if not exists pb_rate_log_at on public.pb_rate_log (at);
create index if not exists pb_rate_log_kind on public.pb_rate_log (kind, ip_hash, at);
alter table public.pb_rate_log enable row level security;
revoke all on public.pb_rate_log from public, anon, authenticated;

-- Zählt einen Aufruf. Zu viele in der Zeitspanne: Fehler mit p_msg. Ohne
-- IP-Angabe (sollte über die Supabase-API nie vorkommen) teilen sich alle
-- einen gemeinsamen, größeren Topf. Bricht der Aufruf später ab, zählt er
-- nicht (die Zeile verschwindet mit dem Rollback).
create or replace function public.pb_rate_hit(p_kind text, p_max int, p_max_noip int, p_window interval, p_msg text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  ip text := public.pb_client_ip_hash();
begin
  if (select count(*) from public.pb_rate_log l
       where l.kind = p_kind and l.ip_hash is not distinct from ip and l.at > now() - p_window)
     >= (case when ip is null then p_max_noip else p_max end) then
    raise exception '%', p_msg;
  end if;
  insert into public.pb_rate_log (kind, ip_hash) values (p_kind, ip);
end;
$$;

-- --- Aufräumen (Speicherfristen) -----------------------------------------------------
--
--  * IP-Prüfsummen (Namen, Mengenbremse): 1 Tag
--  * Einreichungen für die Bestenliste (mit Zugprotokoll): 30 Tage
--  * Bestenlisten-Einträge: 90 Tage
--  * Profile ohne Fortschritt: 180 Tage ohne Änderung (wie bisher),
--    alle anderen: 365 Tage ohne Änderung (jede beendete Partie mit Namen
--    sichert das Profil und zählt als Änderung)
-- Läuft bei jedem Anlegen einer Partie, jeder Einreichung und jeder
-- Namenswahl. Wer es zusätzlich nach Zeitplan will: mit pg_cron
--   select cron.schedule('pb-aufraeumen', '17 3 * * *', 'select public.pb_cleanup()');
create or replace function public.pb_cleanup()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  delete from public.pb_name_log where at < now() - interval '1 day';
  delete from public.pb_rate_log where at < now() - interval '1 day';
  delete from public.pb_score_claims where created_at < now() - interval '30 days';
  delete from public.pb_scores where updated_at < now() - interval '90 days';
  delete from public.pb_profiles p
   where (p.updated_at < now() - interval '365 days')
      or (p.level <= 1 and p.updated_at < now() - interval '180 days'
          and not exists (select 1 from public.pb_scores s where s.profile_id = p.id));
end;
$$;

-- --- Datentypen des Spielstands --------------------------------------------------

create or replace function public.pb_is_int(v jsonb, lo numeric, hi numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(v) = 'number'
    and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
    and (v #>> '{}')::numeric between lo and hi, false)
$$;

-- Fehlt der Wert oder ist er JSON-null?
create or replace function public.pb_is_none(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is null or jsonb_typeof(v) = 'null'
$$;

-- Liefert null, wenn der Stand die erwarteten Datentypen hat, sonst den Grund.
-- Texte, die das Spiel anzeigt (Stamm, Einheitentyp, Aussehen …), dürfen nur
-- aus Buchstaben, Ziffern, _ und - bestehen.
create or replace function public.pb_check_shape(s jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  pl jsonb := s->'players';
  w int;
  h int;
  word constant text := '^[A-Za-z0-9_-]{1,40}$';
begin
  if s is null or jsonb_typeof(s) <> 'object' then
    return 'Spielstand ist kein Objekt';
  end if;
  if coalesce(jsonb_typeof(pl), '') <> 'array' or jsonb_array_length(pl) not between 2 and 8
     or exists (select 1 from jsonb_array_elements(pl) p where jsonb_typeof(p) <> 'string' or (p #>> '{}') !~ '^player_[1-8]$')
     or (select count(distinct p) from jsonb_array_elements_text(pl) p) <> jsonb_array_length(pl) then
    return 'Ungültige Spielerliste';
  end if;
  if coalesce(jsonb_typeof(s->'turn'), '') <> 'string' or not pl ? (s->>'turn') then
    return 'Ungültiger Spieler am Zug';
  end if;
  if not public.pb_is_int(s->'round', 1, 10000) then
    return 'Ungültige Runde';
  end if;
  if not (public.pb_is_none(s->'rev') or public.pb_is_int(s->'rev', 0, 1000000000)) then
    return 'Ungültige Version';
  end if;
  if not (public.pb_is_none(s->'turnLimit') or public.pb_is_int(s->'turnLimit', 1, 10000)) then
    return 'Ungültiges Rundenlimit';
  end if;
  if not (public.pb_is_none(s->'winner') or (jsonb_typeof(s->'winner') = 'string' and pl ? (s->>'winner'))) then
    return 'Ungültiger Sieger';
  end if;
  if not (public.pb_is_none(s->'endReason') or (jsonb_typeof(s->'endReason') = 'string' and s->>'endReason' in ('conquest', 'score', 'mission'))) then
    return 'Ungültiges Spielende';
  end if;
  if not (public.pb_is_none(s->'admin') or jsonb_typeof(s->'admin') = 'boolean') then
    return 'Ungültige Markierung';
  end if;
  if not public.pb_is_none(s->'ai') and (jsonb_typeof(s->'ai') <> 'array'
     or exists (select 1 from jsonb_array_elements(s->'ai') a where jsonb_typeof(a) <> 'string' or not pl ? (a #>> '{}'))) then
    return 'Ungültige KI-Liste';
  end if;
  if not public.pb_is_none(s->'tribes') and (jsonb_typeof(s->'tribes') <> 'object'
     or exists (select 1 from jsonb_each(s->'tribes') t where jsonb_typeof(t.value) <> 'string' or (t.value #>> '{}') !~ word)) then
    return 'Ungültige Stämme';
  end if;
  if coalesce(jsonb_typeof(s->'stars'), '') <> 'object'
     or exists (select 1 from jsonb_each(s->'stars') t where not public.pb_is_int(t.value, -100000, 100000000)) then
    return 'Sterne müssen ganze Zahlen sein';
  end if;
  if coalesce(jsonb_typeof(s->'techs'), '') <> 'object'
     or exists (select 1 from jsonb_each(s->'techs') t where jsonb_typeof(t.value) <> 'array')
     or exists (select 1 from jsonb_each(s->'techs') t, jsonb_array_elements(t.value) x
                 where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ word) then
    return 'Ungültige Technologien';
  end if;
  if coalesce(jsonb_typeof(s->'units'), '') <> 'array' or jsonb_array_length(s->'units') > 5000
     or exists (select 1 from jsonb_array_elements(s->'units') u
                 where jsonb_typeof(u) <> 'object'
                    or not (public.pb_is_none(u->'owner') or (jsonb_typeof(u->'owner') = 'string' and pl ? (u->>'owner')))
                    or coalesce(jsonb_typeof(u->'type'), '') <> 'string' or (u->>'type') !~ word
                    or not public.pb_is_int(u->'q', 0, 1000) or not public.pb_is_int(u->'r', 0, 1000)
                    or not (public.pb_is_none(u->'hp') or jsonb_typeof(u->'hp') = 'number')
                    or not (public.pb_is_none(u->'mp') or jsonb_typeof(u->'mp') = 'number')
                    or not (public.pb_is_none(u->'cargo') or (jsonb_typeof(u->'cargo') = 'object'
                            and coalesce(jsonb_typeof(u->'cargo'->'type'), '') = 'string' and (u->'cargo'->>'type') ~ word))) then
    return 'Ungültige Einheiten';
  end if;
  if coalesce(jsonb_typeof(s->'cities'), '') <> 'array' or jsonb_array_length(s->'cities') > 2000
     or exists (select 1 from jsonb_array_elements(s->'cities') c
                 where jsonb_typeof(c) <> 'object'
                    or not (public.pb_is_none(c->'owner') or (jsonb_typeof(c->'owner') = 'string' and pl ? (c->>'owner')))
                    or not public.pb_is_int(c->'q', 0, 1000) or not public.pb_is_int(c->'r', 0, 1000)
                    or not (public.pb_is_none(c->'pop') or jsonb_typeof(c->'pop') = 'number')) then
    return 'Ungültige Städte';
  end if;
  if not (public.pb_is_none(s->'mapW') or public.pb_is_int(s->'mapW', 4, 200))
     or not (public.pb_is_none(s->'mapH') or public.pb_is_int(s->'mapH', 4, 200)) then
    return 'Ungültige Kartengröße';
  end if;
  w := coalesce((s->>'mapW')::int, 26);
  h := coalesce((s->>'mapH')::int, 18);
  if coalesce(jsonb_typeof(s->'terrain'), '') <> 'array' or jsonb_array_length(s->'terrain') <> w * h
     or exists (select 1 from jsonb_array_elements(s->'terrain') t where jsonb_typeof(t) <> 'string' or (t #>> '{}') !~ word) then
    return 'Ungültige Karte';
  end if;
  if not public.pb_is_none(s->'looks') and (jsonb_typeof(s->'looks') <> 'object'
     or exists (select 1 from jsonb_each(s->'looks') l where jsonb_typeof(l.value) <> 'object')
     or exists (select 1 from jsonb_each(s->'looks') l, jsonb_each(l.value) x
                 where jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ word)) then
    return 'Ungültiges Aussehen';
  end if;
  return null;
end;
$$;

-- Startstand einer neuen Partie: Runde 1, niemand hat gewonnen, Sterne,
-- Städte, Einheiten und Technologien wie bei einem frisch erzeugten Spiel.
create or replace function public.pb_check_start(s jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  p text;
begin
  if (s->>'round')::int <> 1 or not public.pb_is_none(s->'winner') or not public.pb_is_none(s->'endReason') then
    return 'Neue Partien beginnen in Runde 1 ohne Sieger';
  end if;
  if coalesce((s->>'rev')::int, 0) > 1 then
    return 'Neue Partien beginnen bei Version 0';
  end if;
  if s->>'turn' <> s->'players'->>0 then
    return 'Der erste Spieler beginnt';
  end if;
  if not (public.pb_is_none(s->'turnLimit') or public.pb_is_int(s->'turnLimit', 5, 500)) then
    return 'Ungültiges Rundenlimit';
  end if;
  for p in select jsonb_array_elements_text(s->'players') loop
    if not public.pb_is_int(s->'stars'->p, 0, 100) then
      return 'Unmögliche Startsterne';
    end if;
    if (select count(*) from jsonb_array_elements(s->'cities') c where c->>'owner' = p) > 2
       or (select count(*) from jsonb_array_elements(s->'units') u where u->>'owner' = p) > 12
       or jsonb_array_length(coalesce(s->'techs'->p, '[]'::jsonb)) > 6 then
      return 'Unmöglicher Startstand';
    end if;
  end loop;
  return null;
end;
$$;

-- --- Zugfolge und fremde Stämme ------------------------------------------------------
--
-- Vergleicht den gespeicherten Stand (old_s) mit dem neuen (new_s) des
-- Speichernden (saver). Der Client speichert nach jeder Aktion (Zug bleibt
-- beim Speichernden), nach dem Zugende und nach jedem KI-Zug, den er für
-- KI-Stämme rechnet. „Gezogen“ haben in einem Abschnitt: der Speichernde,
-- ein KI-Stamm, der am Zug war, und alle KI-Stämme, über die der Zug
-- weitergegangen ist. Alle anderen Stämme haben nicht gezogen; bei ihnen
-- darf sich nur ändern, was andere ihnen antun können.
--
-- Nicht prüfbar ohne Nachspielen (bekannte Grenze): was die ziehenden Stämme
-- mit ihren eigenen Einheiten tun (Wege, Reichweite, Kämpfe) und welche
-- fremden Städte sie dabei erobern.
create or replace function public.pb_check_moves(old_s jsonb, new_s jsonb, saver text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  pl text[];
  n int;
  ai jsonb := coalesce(new_s->'ai', '[]'::jsonb);
  ot text := old_s->>'turn';
  nt text := new_s->>'turn';
  i int;
  j int;
  k int := 0;
  step int;
  p text;
  wraps int := 0;
  actors text[] := array[saver];
  old_round int := coalesce((old_s->>'round')::int, 1);
  new_round int := coalesce((new_s->>'round')::int, 1);
  lim int := (old_s->>'turnLimit')::int;
  w text := new_s->>'winner';
  score_end boolean := new_s->>'winner' is not null and new_s->>'endReason' = 'score';
  alive_new text[];
begin
  pl := array(select jsonb_array_elements_text(coalesce(old_s->'players', '["player_1","player_2"]'::jsonb)));
  n := cardinality(pl);
  if (new_s->'turnLimit') is distinct from (old_s->'turnLimit') then
    return 'Rundenlimit darf sich nicht ändern';
  end if;
  if (new_s->'tribes') is distinct from (old_s->'tribes') then
    return 'Stämme dürfen sich nicht ändern';
  end if;
  if w is not null and coalesce(new_s->>'endReason', '') not in ('conquest', 'score') then
    return 'Unmögliches Spielende';
  end if;
  j := array_position(pl, nt);
  if j is null then
    return 'Unbekannter Spieler am Zug';
  end if;
  i := array_position(pl, ot);
  alive_new := array(select distinct c->>'owner' from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c
                      where c->>'owner' is not null);

  if i is null or not exists (select 1 from jsonb_array_elements(coalesce(old_s->'cities', '[]'::jsonb)) c
                               where c->>'owner' = any(pl) and not ai ? (c->>'owner')) then
    -- Kein Mensch hat mehr Städte: die KI-Stämme spielen unter sich zu Ende,
    -- auch mehrere Runden zwischen zwei Speicherungen.
    actors := actors || array(select jsonb_array_elements_text(ai));
    if new_round < old_round then
      return 'Unmögliche Runde';
    end if;
    if score_end and (lim is null or new_round <> lim) then
      return 'Sieg nach Punkten erst am Rundenlimit';
    end if;
  else
    k := ((j - i) % n + n) % n;
    -- Gleicher Spieler, aber neue Runde (oder Spielende am Limit): einmal reihum.
    if k = 0 and (new_round <> old_round or score_end) then
      k := n;
    end if;
    if ai ? ot then
      actors := actors || ot;
    end if;
    if k = 0 then
      if ot <> saver and not ai ? ot then
        return 'Du bist nicht am Zug';
      end if;
    else
      -- Dazwischen nur KI-Stämme und besiegte Stämme.
      for step in 1 .. k - 1 loop
        p := pl[((i - 1 + step) % n) + 1];
        if ai ? p then
          actors := actors || p;
        elsif p = any(alive_new) then
          return 'Falsche Reihenfolge: ein Mitspieler wurde übersprungen';
        end if;
      end loop;
      if w is null and not (nt = any(alive_new)) then
        return 'Ein besiegter Stamm ist am Zug';
      end if;
      if i + k > n then
        wraps := 1;
      end if;
    end if;
    if score_end then
      -- endTurn zählt die Runde über das Limit, finishByScore setzt sie zurück.
      if lim is null or wraps = 0 or old_round <> lim or new_round <> lim then
        return 'Sieg nach Punkten erst am Rundenlimit';
      end if;
    elsif new_round <> old_round + wraps then
      return 'Unmögliche Runde';
    end if;
  end if;

  -- Städte verschwinden nie (sie wechseln höchstens den Besitzer).
  if exists (select 1 from jsonb_array_elements(coalesce(old_s->'cities', '[]'::jsonb)) o
              where not exists (select 1 from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c
                                 where c->'q' = o->'q' and c->'r' = o->'r')) then
    return 'Städte dürfen nicht verschwinden';
  end if;
  -- Neue Städte und Besitzerwechsel nur zugunsten eines ziehenden Stammes.
  if exists (select 1 from jsonb_array_elements(coalesce(new_s->'cities', '[]'::jsonb)) c
              left join lateral (select o from jsonb_array_elements(coalesce(old_s->'cities', '[]'::jsonb)) o
                                  where o->'q' = c->'q' and o->'r' = c->'r' limit 1) prev on true
              where (prev.o is null or (c->>'owner') is distinct from (prev.o->>'owner'))
                and not coalesce(c->>'owner' = any(actors), false)) then
    return 'Fremde Städte dürfen nur durch Eroberung den Besitzer wechseln';
  end if;
  -- Einheiten nicht ziehender Stämme: können verloren gehen (oder bekehrt
  -- werden), aber nicht neu entstehen oder jemand anderem gehören.
  if exists (select 1 from jsonb_array_elements(coalesce(new_s->'units', '[]'::jsonb)) u
              where not coalesce(u->>'owner' = any(actors), false)
                and not exists (select 1 from jsonb_array_elements(coalesce(old_s->'units', '[]'::jsonb)) o
                                 where o->'id' = u->'id' and (o->>'owner') is not distinct from (u->>'owner'))) then
    return 'Fremde Einheiten dürfen nicht entstehen';
  end if;
  foreach p in array pl loop
    continue when p = any(actors);
    if coalesce(new_s->'techs'->p, '[]'::jsonb) is distinct from coalesce(old_s->'techs'->p, '[]'::jsonb) then
      return 'Fremde Technologien dürfen sich nicht ändern';
    end if;
    if coalesce((new_s->'stars'->>p)::numeric, 0) < coalesce((old_s->'stars'->>p)::numeric, 0) then
      return 'Fremde Sterne dürfen nicht sinken';
    end if;
  end loop;
  return null;
end;
$$;

-- --- Partie anlegen ----------------------------------------------------------------

create or replace function public.create_match(p_state jsonb, p_token text, p_admin_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  h text;
  bad text;
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
  bad := coalesce(public.pb_check_shape(p_state), public.pb_check_start(p_state));
  if bad is not null then
    raise exception 'Spielstand abgelehnt: %', bad;
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
  perform public.pb_cleanup();
  h := public.pb_hash(p_token);
  if (select count(*) from public.matches x
       where x.game_state->>'winner' is null and not coalesce((x.game_state->>'abandoned')::boolean, false)
         and exists (select 1 from jsonb_each_text(x.seats) e where e.value = h)) >= 20 then
    raise exception 'Du hast schon 20 laufende Online-Partien. Beende oder gib erst eine davon auf';
  end if;
  perform public.pb_rate_hit('match', 20, 300, interval '1 hour',
    'Von deinem Netz wurden gerade sehr viele Partien angelegt. Versuch es in einer Stunde noch einmal');
  insert into public.matches (game_state, current_turn, player_1, seats)
  values (p_state, coalesce(p_state->>'turn', 'player_1'), h, jsonb_build_object('player_1', h))
  returning * into m;
  return public.pb_match_view(m, 'player_1');
end;
$$;

-- --- Speichern -------------------------------------------------------------------

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
  return jsonb_build_object('rev', new_rev);
end;
$$;

-- --- Klingel: zusätzlich privat -------------------------------------------------------
--
-- Auf dem öffentlichen Kanal match-<id> kann jeder senden, der die ID kennt
-- (und so alle Mitspieler ständig neu laden lassen). Auf dem privaten Kanal
-- darf nur lesen, wer den öffentlichen Schlüssel hat, und senden niemand
-- außer der Datenbank (keine insert-Regel auf realtime.messages). Neue
-- Clients hören privat; der öffentliche Kanal bleibt für ältere Clients, bis
-- alle neu geladen haben.
create or replace function public.pb_match_ring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg jsonb := jsonb_build_object('rev', coalesce((new.game_state->>'rev')::int, 0),
                                  'joined', (select count(*) from jsonb_object_keys(new.seats)));
begin
  begin
    perform realtime.send(msg, 'moved', 'match-' || new.id::text, false);
  exception when others then
    null; -- Ohne Klingel geht nichts verloren: der Client fragt ohnehin regelmäßig nach.
  end;
  begin
    perform realtime.send(msg, 'moved', 'match-' || new.id::text, true);
  exception when others then
    null;
  end;
  return null;
end;
$$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "pb Klingel lesen" on realtime.messages';
    execute $p$create policy "pb Klingel lesen" on realtime.messages for select to anon, authenticated
              using (realtime.topic() like 'match-%' and extension = 'broadcast')$p$;
  end if;
end $$;

-- --- Namen ---------------------------------------------------------------------------

-- Wie bisher; die Grenze je Minute gilt nur noch für Anfragen ohne
-- IP-Angabe (sonst ließe sie sich mit vielen Adressen für alle ausreizen).
create or replace function public.pb_claim_name(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text;
  n text;
  ip text;
  pr public.pb_profiles;
  wait interval;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'Ungültige Spieler-Kennung';
  end if;
  h := public.pb_hash(p_token);
  n := public.pb_check_name(p_name);

  perform public.pb_cleanup();

  select * into pr from public.pb_profiles where token_hash = h;
  if found then
    if pr.name = n then
      return jsonb_build_object('name', pr.name, 'level', pr.level);
    end if;
    -- Umbenennen: einmal am Tag, kurz nach dem ersten Namen frei.
    if pr.name_changed_at is not null and pr.name_changed_at > now() - interval '1 day' then
      wait := pr.name_changed_at + interval '1 day' - now();
      raise exception 'Du kannst deinen Namen erst in % Stunden wieder ändern', greatest(1, ceil(extract(epoch from wait) / 3600)::int);
    end if;
  else
    -- Neues Profil: nicht in Massen.
    ip := public.pb_client_ip_hash();
    if ip is not null and (select count(*) from public.pb_name_log l
                            where l.ip_hash = ip and l.at > now() - interval '1 hour') >= 20 then
      raise exception 'Von deinem Netz wurden gerade viele Namen angelegt. Versuch es in einer Stunde noch einmal';
    end if;
    if ip is null and (select count(*) from public.pb_name_log l
                        where l.ip_hash is null and l.at > now() - interval '1 minute') >= 60 then
      raise exception 'Gerade melden sich sehr viele an. Versuch es gleich noch einmal';
    end if;
  end if;

  if exists (select 1 from public.pb_profiles where name_key = lower(n) and token_hash <> h) then
    raise exception 'Dieser Name ist schon vergeben';
  end if;

  if pr.id is null then
    insert into public.pb_profiles (token_hash, name, name_key)
    values (h, n, lower(n))
    returning * into pr;
    insert into public.pb_name_log (ip_hash) values (ip);
  else
    update public.pb_profiles
       set name = n, name_key = lower(n), updated_at = now(),
           -- Die ersten 15 Minuten zählen nicht als Umbenennen (Tippfehler).
           name_changed_at = case when created_at > now() - interval '15 minutes' then name_changed_at else now() end
     where id = pr.id
    returning * into pr;
  end if;
  return jsonb_build_object('name', pr.name, 'level', pr.level);
end;
$$;

-- --- Bestenliste ---------------------------------------------------------------------

alter table public.pb_score_claims add column if not exists actions_hash text;
create unique index if not exists pb_score_claims_same_log on public.pb_score_claims (kind, period, actions_hash);

-- Prüfsumme eines Zugprotokolls, unabhängig von Schreibweisen, die beim
-- Nachspielen nichts ändern: Einträge „mon“ (prüft nur Denkmäler), fremde
-- Felder, 3.0 statt 3, Wahrheitswerte als 1/"ja".
create or replace function public.pb_action_norm(v jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  case coalesce(jsonb_typeof(v), 'null')
    when 'null' then return '';
    when 'number' then return trim_scale((v #>> '{}')::numeric)::text;
    when 'array' then
      return (select string_agg(public.pb_action_norm(x), ',' order by n)
                from jsonb_array_elements(v) with ordinality as t(x, n) where n <= 2);
    when 'object' then return '{}';
    else return v #>> '{}';
  end case;
end;
$$;

create or replace function public.pb_actions_hash(a jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(string_agg(
      concat_ws('|', e->>'k',
        public.pb_action_norm(e->'u'), public.pb_action_norm(e->'to'), public.pb_action_norm(e->'d'),
        public.pb_action_norm(e->'c'), public.pb_action_norm(e->'t'), public.pb_action_norm(e->'at'),
        public.pb_action_norm(e->'w'), public.pb_action_norm(e->'dir'), public.pb_action_norm(e->'ch'),
        public.pb_action_norm(e->'from'),
        case when e ? 'yes' then (coalesce(jsonb_typeof(e->'yes'), 'null') not in ('null')
                                  and e->'yes' not in ('false'::jsonb, '0'::jsonb, '""'::jsonb))::text end),
      ';' order by n), ''), 'UTF8')), 'hex')
    from jsonb_array_elements(a) with ordinality as x(e, n)
   where jsonb_typeof(e) <> 'object' or coalesce(e->>'k', '') <> 'mon'
$$;

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
  -- gutes Protokoll mit Zweitkonten die ganze Liste).
  h := public.pb_actions_hash(p_actions);
  select c.profile_id into other from public.pb_score_claims c
   where c.kind = p_kind and c.period = p_period and c.actions_hash = h limit 1;
  if found then
    if other = pr.id then
      return jsonb_build_object('pending', true, 'duplicate', true);
    end if;
    raise exception 'Dieses Spiel wurde schon von einem anderen Profil eingereicht';
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
    insert into public.pb_score_claims (profile_id, kind, period, score, round, actions, actions_hash)
    values (pr.id, p_kind, p_period, p_score, p_round, p_actions, h);
  exception when unique_violation then
    raise exception 'Dieses Spiel wurde schon von einem anderen Profil eingereicht';
  end;
  return jsonb_build_object('pending', true);
end;
$$;

-- Bestenliste ohne Stufe: die Stufe meldet das Spiel selbst, sie lässt sich
-- nicht prüfen.
create or replace function public.pb_leaderboard(p_kind text, p_period text, p_token text default null)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with board as (
    select p.name, s.score, s.tribe, s.round, p.token_hash,
           rank() over (order by s.score desc) as rk
      from public.pb_scores s join public.pb_profiles p on p.id = s.profile_id
     where s.kind = p_kind and s.period = p_period
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'score', score, 'tribe', tribe, 'round', round) order by rk, name)
                      from (select * from board order by rk, name limit 20) t), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rk, 'name', name, 'score', score) from board
            where p_token is not null and token_hash = public.pb_hash(p_token) limit 1),
    'pending', (select count(*) from public.pb_score_claims c join public.pb_profiles p on p.id = c.profile_id
                 where p_token is not null and p.token_hash = public.pb_hash(p_token)
                   and c.kind = p_kind and c.period = p_period and c.status = 'pending'),
    'rejected', (select c.reason from public.pb_score_claims c join public.pb_profiles p on p.id = c.profile_id
                  where p_token is not null and p.token_hash = public.pb_hash(p_token)
                    and c.kind = p_kind and c.period = p_period and c.status = 'rejected'
                    and c.checked_at > now() - interval '1 day'
                  order by c.checked_at desc limit 1),
    'total', (select count(*) from board)
  )
$$;

-- --- Rechte ----------------------------------------------------------------------
-- Supabase gibt neuen Funktionen Rechte an anon/authenticated: interne
-- Hilfsfunktionen ausdrücklich sperren.

revoke all on function public.pb_client_ip_hash() from public, anon, authenticated;
revoke all on function public.pb_rate_hit(text, int, int, interval, text) from public, anon, authenticated;
revoke all on function public.pb_cleanup() from public, anon, authenticated;
revoke all on function public.pb_is_int(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.pb_is_none(jsonb) from public, anon, authenticated;
revoke all on function public.pb_check_shape(jsonb) from public, anon, authenticated;
revoke all on function public.pb_check_start(jsonb) from public, anon, authenticated;
revoke all on function public.pb_check_moves(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.pb_match_ring() from public, anon, authenticated;
revoke all on function public.pb_action_norm(jsonb) from public, anon, authenticated;
revoke all on function public.pb_actions_hash(jsonb) from public, anon, authenticated;
revoke all on function public.create_match(jsonb, text, text) from public;
revoke all on function public.save_match(uuid, text, jsonb, text) from public;
revoke all on function public.pb_claim_name(text, text) from public;
revoke all on function public.pb_submit_score(text, text, text, int, text, int, jsonb) from public;
revoke all on function public.pb_leaderboard(text, text, text) from public;
grant execute on function public.create_match(jsonb, text, text) to anon, authenticated;
grant execute on function public.save_match(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.pb_claim_name(text, text) to anon, authenticated;
grant execute on function public.pb_submit_score(text, text, text, int, text, int, jsonb) to anon, authenticated;
grant execute on function public.pb_leaderboard(text, text, text) to anon, authenticated;
