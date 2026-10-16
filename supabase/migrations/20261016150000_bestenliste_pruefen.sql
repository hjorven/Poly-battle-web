-- Poly Battle: Bestenliste nur mit nachgeprüften Punkten
--
-- Vorher nahm pb_submit_score jede Punktzahl unter 2000 + 500 je Runde an,
-- ein Aufruf aus der Browser-Konsole reichte für Platz 1.
--
-- Jetzt schickt das Spiel das Zugprotokoll der Herausforderung mit (siehe
-- js/actionlog.js). Die Einreichung landet als „wartet auf Prüfung“ in
-- pb_score_claims. scripts/verify-scores.mjs (GitHub Actions, alle paar
-- Minuten, mit dem service_role-Schlüssel) spielt die Partie mit denselben
-- Regeln nach und trägt nur die nachgerechnete Punktzahl in pb_scores ein.

create table if not exists public.pb_score_claims (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.pb_profiles(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  period text not null,
  score int not null,
  round int,
  actions jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'ok', 'rejected')),
  reason text,
  checked_score int,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index if not exists pb_score_claims_pending on public.pb_score_claims (created_at) where status = 'pending';
create index if not exists pb_score_claims_profile on public.pb_score_claims (profile_id, kind, period);

alter table public.pb_score_claims enable row level security;
revoke all on public.pb_score_claims from anon, authenticated;

-- Punkte einreichen: nur heute bzw. diese Woche, mit Protokoll; zählt erst
-- nach der Prüfung.
drop function if exists public.pb_submit_score(text, text, text, int, text, int);
create or replace function public.pb_submit_score(p_token text, p_kind text, p_period text, p_score int, p_tribe text, p_round int, p_actions jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.pb_profiles;
  d date;
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
  if pg_column_size(p_actions) > 524288 or jsonb_array_length(p_actions) > 20000 then
    raise exception 'Zugprotokoll zu groß';
  end if;
  if p_round is null or p_round < 1 or p_round > 61 or p_score is null or p_score < 0 then
    raise exception 'Ungültige Punktzahl';
  end if;
  -- Nicht fluten: höchstens 10 offene oder geprüfte Versuche je Wertung.
  if (select count(*) from public.pb_score_claims
       where profile_id = pr.id and kind = p_kind and period = p_period) >= 10 then
    raise exception 'Für diese Herausforderung hast du schon 10 Ergebnisse eingereicht';
  end if;
  insert into public.pb_score_claims (profile_id, kind, period, score, round, actions)
  values (pr.id, p_kind, p_period, p_score, p_round, p_actions);
  return jsonb_build_object('pending', true);
end;
$$;

-- Bestenliste: wie bisher die besten 20 plus der eigene Platz, dazu, ob noch
-- ein eigenes Ergebnis auf die Prüfung wartet.
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

-- Für den Prüfer (nur service_role): offene Einreichungen abholen …
create or replace function public.pb_pending_claims(p_limit int default 20)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'period', period, 'score', score, 'round', round, 'actions', actions) order by id), '[]'::jsonb)
    from (select * from public.pb_score_claims where status = 'pending' order by id limit greatest(1, least(coalesce(p_limit, 20), 100))) c
$$;

-- … und das Ergebnis eintragen. Es zählt die nachgerechnete Punktzahl.
create or replace function public.pb_settle_claim(p_id bigint, p_ok boolean, p_score int, p_round int, p_tribe text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.pb_score_claims;
begin
  select * into c from public.pb_score_claims where id = p_id and status = 'pending' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nicht offen');
  end if;
  update public.pb_score_claims
     set status = case when p_ok then 'ok' else 'rejected' end,
         reason = left(p_reason, 300), checked_score = p_score, checked_at = now(),
         actions = '[]'::jsonb
   where id = p_id;
  if p_ok then
    insert into public.pb_scores (profile_id, kind, period, score, tribe, round)
    values (c.profile_id, c.kind, c.period, p_score, left(p_tribe, 24), p_round)
    on conflict (profile_id, kind, period) do update
      set score = greatest(public.pb_scores.score, excluded.score),
          tribe = case when excluded.score > public.pb_scores.score then excluded.tribe else public.pb_scores.tribe end,
          round = case when excluded.score > public.pb_scores.score then excluded.round else public.pb_scores.round end,
          updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pb_submit_score(text, text, text, int, text, int, jsonb) from public;
revoke all on function public.pb_leaderboard(text, text, text) from public;
revoke all on function public.pb_pending_claims(int) from public, anon, authenticated;
revoke all on function public.pb_settle_claim(bigint, boolean, int, int, text, text) from public, anon, authenticated;
grant execute on function public.pb_submit_score(text, text, text, int, text, int, jsonb) to anon, authenticated;
grant execute on function public.pb_leaderboard(text, text, text) to anon, authenticated;
grant execute on function public.pb_pending_claims(int) to service_role;
grant execute on function public.pb_settle_claim(bigint, boolean, int, int, text, text) to service_role;
