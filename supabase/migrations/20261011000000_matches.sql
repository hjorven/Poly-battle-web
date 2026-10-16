-- Poly Battle: Tabelle für Online-Partien (Ausgangsstand)
--
-- Die Tabelle wurde ursprünglich im Supabase-Dashboard angelegt und stand in
-- keiner Migration. Diese Datei hält den damaligen Stand fest, damit sich ein
-- neues Projekt allein aus supabase/migrations aufsetzen lässt. Auf dem
-- bestehenden Projekt ändert sie nichts (alles nur „falls noch nicht da“).
-- Die offenen Regeln hier werden von den folgenden Migrationen ersetzt.

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  game_state jsonb not null,
  current_turn text not null,
  player_1 text,
  player_2 text,
  last_move_at timestamptz not null default timezone('utc', now()),
  skip_requested_by text
);

alter table public.matches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'matches' and policyname = 'matches select')
     and not exists (select 1 from pg_proc where proname = 'save_match' and pronamespace = 'public'::regnamespace) then
    create policy "matches select" on public.matches for select using (true);
    create policy "matches insert" on public.matches for insert with check (true);
    create policy "matches update" on public.matches for update using (true);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches')
     and not exists (select 1 from pg_proc where proname = 'save_match' and pronamespace = 'public'::regnamespace) then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;
