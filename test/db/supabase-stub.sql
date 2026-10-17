-- Nachbau der Supabase-Umgebung, so weit die Migrationen sie brauchen (Rollen,
-- realtime.send, Publikation, Tabelle matches im Zustand vor allen Migrationen).
do $$ begin create role anon; exception when others then null; end $$; do $$ begin create role authenticated; exception when others then null; end $$;
create schema realtime;
create table realtime.sent(payload jsonb, event text, topic text, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ insert into realtime.sent values (payload, event, topic, private) $$;
create publication supabase_realtime;
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  game_state jsonb not null,
  current_turn text not null,
  player_1 text, player_2 text,
  last_move_at timestamptz not null default timezone('utc', now()),
  skip_requested_by text
);
alter table public.matches enable row level security;
create policy "matches select" on public.matches for select using (true);
create policy "matches insert" on public.matches for insert with check (true);
create policy "matches update" on public.matches for update using (true);
grant all on public.matches to anon, authenticated;
alter publication supabase_realtime add table public.matches;
-- Realtime-Nachrichten (private Kanäle) wie bei Supabase: RLS an, Rechte für anon.
create table realtime.messages(topic text, extension text, payload jsonb, event text, private boolean);
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to anon, authenticated;
