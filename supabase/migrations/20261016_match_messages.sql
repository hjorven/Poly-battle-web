-- Poly Battle: kurze Nachrichten und Reaktionen in Online-Partien
--
-- Eigene Tabelle (nicht im Spielstand), damit man auch schreiben kann, wenn
-- man nicht am Zug ist. Wie überall: kein direkter Tabellenzugriff, nur über
-- die Funktionen unten. Schreiben und Lesen dürfen nur Mitspieler der Partie.
-- Schutz: höchstens 120 Zeichen, Schimpfwörter werden ersetzt, mindestens
-- 2 Sekunden zwischen zwei Nachrichten, je Partie die letzten 200.

create table if not exists public.pb_messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  role text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists pb_messages_match on public.pb_messages (match_id, id);

alter table public.pb_messages enable row level security;
revoke all on public.pb_messages from anon, authenticated;

create or replace function public.pb_send_message(p_id uuid, p_token text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  r text;
  t text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  new_id bigint;
begin
  select * into m from public.matches where id = p_id;
  if not found then
    raise exception 'Spiel nicht gefunden';
  end if;
  r := public.pb_role_of(m, public.pb_hash(coalesce(p_token, '')));
  if r is null then
    raise exception 'Nur Mitspieler können schreiben';
  end if;
  if length(t) < 1 or length(t) > 120 then
    raise exception 'Nachricht: 1 bis 120 Zeichen';
  end if;
  t := regexp_replace(t, '(arsch|fick|hure|nazi|hitler|fotze|wichser|schlampe|nigg|fuck|shit|bitch)[a-zäöüß]*', '***', 'gi');
  if exists (select 1 from public.pb_messages
              where match_id = p_id and role = r and created_at > now() - interval '2 seconds') then
    raise exception 'Bitte kurz warten';
  end if;
  insert into public.pb_messages (match_id, role, text) values (p_id, r, t) returning id into new_id;
  delete from public.pb_messages
   where match_id = p_id
     and id < (select min(id) from (select id from public.pb_messages where match_id = p_id order by id desc limit 200) x);
  return jsonb_build_object('id', new_id);
end;
$$;

create or replace function public.pb_messages_since(p_id uuid, p_token text, p_after bigint default 0)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_id;
  if not found or public.pb_role_of(m, public.pb_hash(coalesce(p_token, ''))) is null then
    raise exception 'Nur Mitspieler können lesen';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'role', role, 'text', text, 'at', created_at) order by id)
      from (select * from public.pb_messages where match_id = p_id and id > coalesce(p_after, 0) order by id desc limit 50) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.pb_send_message(uuid, text, text) from public;
revoke all on function public.pb_messages_since(uuid, text, bigint) from public;
grant execute on function public.pb_send_message(uuid, text, text) to anon, authenticated;
grant execute on function public.pb_messages_since(uuid, text, bigint) to anon, authenticated;
