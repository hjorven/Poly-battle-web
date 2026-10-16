-- Poly Battle: Spielerprofile mit Namen und Bestenliste (Tag/Woche)
--
--  * Identität ohne Login: die geheime Spieler-Kennung des Browsers (wie bei
--    den Online-Partien). Gespeichert wird nur ihr SHA-256-Hash. Wer die
--    Kennung kennt („Profil-Code“), kann das Profil auf einem anderen Gerät
--    weiterspielen.
--  * Kein direkter Tabellenzugriff: Lesen und Schreiben nur über die
--    security-definer-Funktionen unten, die Eingaben prüfen.
--  * Punkte werden auf Plausibilität geprüft (nur der aktuelle Tag bzw. die
--    aktuelle Woche, Obergrenze je Runde), es zählt der beste Wert.

create table if not exists public.pb_profiles (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  name text not null,
  name_key text not null unique,
  data jsonb not null default '{}'::jsonb,
  level int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pb_scores (
  profile_id uuid not null references public.pb_profiles(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  period text not null,
  score int not null,
  tribe text,
  round int,
  updated_at timestamptz not null default now(),
  primary key (profile_id, kind, period)
);
create index if not exists pb_scores_board on public.pb_scores (kind, period, score desc);

alter table public.pb_profiles enable row level security;
alter table public.pb_scores enable row level security;
revoke all on public.pb_profiles from anon, authenticated;
revoke all on public.pb_scores from anon, authenticated;

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
begin
  if length(n) < 3 or length(n) > 16 then
    raise exception 'Der Name muss 3 bis 16 Zeichen lang sein';
  end if;
  if n !~ '^[A-Za-z0-9ÄÖÜäöüß _-]+$' then
    raise exception 'Erlaubt sind Buchstaben, Ziffern, Leerzeichen, _ und -';
  end if;
  k := lower(replace(replace(n, ' ', ''), '_', ''));
  if k ~ '(arsch|fick|hure|nazi|hitler|fotze|wichser|schlampe|nigg|fuck|shit|bitch|admin)' then
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
  pr public.pb_profiles;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'Ungültige Spieler-Kennung';
  end if;
  h := public.pb_hash(p_token);
  n := public.pb_check_name(p_name);
  if exists (select 1 from public.pb_profiles where name_key = lower(n) and token_hash <> h) then
    raise exception 'Dieser Name ist schon vergeben';
  end if;
  insert into public.pb_profiles (token_hash, name, name_key)
  values (h, n, lower(n))
  on conflict (token_hash) do update set name = excluded.name, name_key = excluded.name_key, updated_at = now()
  returning * into pr;
  return jsonb_build_object('name', pr.name, 'level', pr.level);
end;
$$;

-- Eigenes Profil (Name und gespeicherte Profildaten) abrufen.
create or replace function public.pb_my_profile(p_token text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object('name', name, 'level', level, 'data', data)
    from public.pb_profiles where token_hash = public.pb_hash(coalesce(p_token, ''))
$$;

-- Profildaten sichern (für ein anderes Gerät), höchstens 64 KB.
create or replace function public.pb_save_profile(p_token text, p_data jsonb, p_level int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 65536 then
    raise exception 'Ungültige Profildaten';
  end if;
  update public.pb_profiles
     set data = p_data, level = greatest(1, least(coalesce(p_level, 1), 1000)), updated_at = now()
   where token_hash = public.pb_hash(coalesce(p_token, ''));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Erst einen Namen wählen';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Punkte einreichen: nur für heute bzw. diese Woche, plausibel, bester Wert zählt.
create or replace function public.pb_submit_score(p_token text, p_kind text, p_period text, p_score int, p_tribe text, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.pb_profiles;
  d date;
  rk int;
  total int;
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
    -- Zeitzonen: gestern bis morgen (UTC) zulassen.
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
  if p_round is null or p_round < 1 or p_round > 61 then
    raise exception 'Ungültige Runde';
  end if;
  if p_score is null or p_score < 0 or p_score > 2000 + p_round * 500 then
    raise exception 'Unplausible Punktzahl';
  end if;
  insert into public.pb_scores (profile_id, kind, period, score, tribe, round)
  values (pr.id, p_kind, p_period, p_score, left(p_tribe, 24), p_round)
  on conflict (profile_id, kind, period) do update
    set score = greatest(public.pb_scores.score, excluded.score),
        tribe = case when excluded.score > public.pb_scores.score then excluded.tribe else public.pb_scores.tribe end,
        round = case when excluded.score > public.pb_scores.score then excluded.round else public.pb_scores.round end,
        updated_at = now();
  select count(*) + 1 into rk from public.pb_scores s
   where s.kind = p_kind and s.period = p_period
     and s.score > (select score from public.pb_scores where profile_id = pr.id and kind = p_kind and period = p_period);
  select count(*) into total from public.pb_scores where kind = p_kind and period = p_period;
  return jsonb_build_object('rank', rk, 'total', total);
end;
$$;

-- Bestenliste: die besten 20 plus der eigene Platz.
create or replace function public.pb_leaderboard(p_kind text, p_period text, p_token text default null)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with board as (
    select p.name, p.level, s.score, s.tribe, s.round, p.token_hash,
           rank() over (order by s.score desc) as rk
      from public.pb_scores s join public.pb_profiles p on p.id = s.profile_id
     where s.kind = p_kind and s.period = p_period
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'level', level, 'score', score, 'tribe', tribe, 'round', round) order by rk, name)
                      from (select * from board order by rk, name limit 20) t), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rk, 'name', name, 'score', score) from board
            where p_token is not null and token_hash = public.pb_hash(p_token) limit 1),
    'total', (select count(*) from board)
  )
$$;

revoke all on function public.pb_check_name(text) from public, anon, authenticated;
revoke all on function public.pb_claim_name(text, text) from public;
revoke all on function public.pb_my_profile(text) from public;
revoke all on function public.pb_save_profile(text, jsonb, int) from public;
revoke all on function public.pb_submit_score(text, text, text, int, text, int) from public;
revoke all on function public.pb_leaderboard(text, text, text) from public;
grant execute on function public.pb_claim_name(text, text) to anon, authenticated;
grant execute on function public.pb_my_profile(text) to anon, authenticated;
grant execute on function public.pb_save_profile(text, jsonb, int) to anon, authenticated;
grant execute on function public.pb_submit_score(text, text, text, int, text, int) to anon, authenticated;
grant execute on function public.pb_leaderboard(text, text, text) to anon, authenticated;
