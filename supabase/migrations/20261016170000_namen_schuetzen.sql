-- Poly Battle: Namen gegen Massenbelegung und Umgehen der Wortliste schützen
--
--  * Neue Profile: höchstens 20 je Netzwerkadresse und Stunde (Schulklassen teilen sich oft eine), höchstens 60
--    insgesamt je Minute. Die Adresse liegt nur als Hash in pb_name_log und
--    wird nach einem Tag gelöscht.
--  * Umbenennen höchstens einmal am Tag (die ersten 15 Minuten nach dem
--    ersten Namen sind frei, für Tippfehler).
--  * Wortliste greift auch bei Ziffern statt Buchstaben (f1ck), doppelten
--    Buchstaben (fiiick) und Trennzeichen (f-i-c-k).
--  * Namen, die nie benutzt wurden (Stufe 1, keine Punkte, 180 Tage nichts
--    gespeichert), werden wieder frei.

alter table public.pb_profiles add column if not exists name_changed_at timestamptz;

create table if not exists public.pb_name_log (
  ip_hash text,
  at timestamptz not null default now()
);
create index if not exists pb_name_log_at on public.pb_name_log (at);
create index if not exists pb_name_log_ip on public.pb_name_log (ip_hash, at);
alter table public.pb_name_log enable row level security;
revoke all on public.pb_name_log from anon, authenticated;

-- Netzwerkadresse der Anfrage (von der Supabase-API mitgegeben), als Hash.
create or replace function public.pb_client_ip_hash()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  ip text;
begin
  begin
    ip := split_part(coalesce(
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  exception when others then
    ip := '';
  end;
  ip := btrim(ip);
  if ip = '' then
    return null;
  end if;
  return public.pb_hash('ip:' || ip);
end;
$$;

-- Namen prüfen: 3–16 Zeichen, Buchstaben/Ziffern/Leerzeichen/_-, kein Schimpfwort.
create or replace function public.pb_check_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  k text;
  plain text;
  bad constant text := '(arsch|fick|hure|nazi|hitler|fotze|wichser|schlampe|nigg|neger|fuck|shit|bitch|penis|porno|spast|kanake|schwuchtel|missgeburt|vergewalt|admin|moderator|support)';
begin
  if length(n) < 3 or length(n) > 16 then
    raise exception 'Der Name muss 3 bis 16 Zeichen lang sein';
  end if;
  if n !~ '^[A-Za-z0-9ÄÖÜäöüß _-]+$' then
    raise exception 'Erlaubt sind Buchstaben, Ziffern, Leerzeichen, _ und -';
  end if;
  -- Ohne Trennzeichen, Ziffern als Buchstaben gelesen, Umlaute vereinfacht.
  k := translate(lower(regexp_replace(n, '[ _-]', '', 'g')), '013457890äöüß', 'oieastbgoaous');
  -- Doppelte Buchstaben zusammenziehen (fiiick → fick, nnigger → niger).
  plain := regexp_replace(k, '(.)\1+', '\1', 'g');
  if k ~ bad or plain ~ bad then
    raise exception 'Dieser Name ist nicht erlaubt';
  end if;
  return n;
end;
$$;

-- Namen wählen oder ändern (legt das Profil beim ersten Mal an).
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

  -- Nie benutzte Namen wieder freigeben.
  delete from public.pb_profiles p
   where p.level <= 1 and p.updated_at < now() - interval '180 days'
     and not exists (select 1 from public.pb_scores s where s.profile_id = p.id);
  delete from public.pb_name_log where at < now() - interval '1 day';

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
    if (select count(*) from public.pb_name_log l where l.at > now() - interval '1 minute') >= 60 then
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

revoke all on function public.pb_client_ip_hash() from public, anon, authenticated;
revoke all on function public.pb_claim_name(text, text) from public;
grant execute on function public.pb_claim_name(text, text) to anon, authenticated;
