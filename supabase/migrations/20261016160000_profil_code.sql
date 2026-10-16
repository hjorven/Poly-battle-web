-- Poly Battle: Profil-Code erneuern
--
-- Der Profil-Code ist die geheime Spieler-Kennung selbst. Wer ihn gesehen
-- hat, konnte bisher für immer als dieser Spieler spielen. pb_rotate_token
-- tauscht die Kennung überall aus, wo ihr Hash steht: im Profil und auf den
-- Plätzen aller Online-Partien. Der alte Code gilt danach nirgends mehr.

create or replace function public.pb_rotate_token(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ho text;
  hn text;
  np int;
  nm int;
begin
  if p_old is null or length(p_old) < 16 then
    raise exception 'Ungültiger alter Code';
  end if;
  if p_new is null or length(p_new) < 16 or length(p_new) > 64 or p_new !~ '^[A-Za-z0-9-]+$' then
    raise exception 'Ungültiger neuer Code';
  end if;
  ho := public.pb_hash(p_old);
  hn := public.pb_hash(p_new);
  if ho = hn then
    raise exception 'Der neue Code ist der alte';
  end if;
  if exists (select 1 from public.pb_profiles where token_hash = hn)
     or exists (select 1 from public.matches m where m.player_1 = hn or m.player_2 = hn
                   or exists (select 1 from jsonb_each_text(m.seats) e where e.value = hn)) then
    raise exception 'Dieser Code ist schon vergeben';
  end if;

  update public.pb_profiles set token_hash = hn, updated_at = now() where token_hash = ho;
  get diagnostics np = row_count;

  update public.matches m
     set seats = (select coalesce(jsonb_object_agg(e.key, case when e.value = to_jsonb(ho) then to_jsonb(hn) else e.value end), '{}'::jsonb)
                    from jsonb_each(m.seats) e),
         player_1 = case when m.player_1 = ho then hn else m.player_1 end,
         player_2 = case when m.player_2 = ho then hn else m.player_2 end
   where m.player_1 = ho or m.player_2 = ho
      or exists (select 1 from jsonb_each_text(m.seats) e where e.value = ho);
  get diagnostics nm = row_count;

  if np = 0 and nm = 0 then
    raise exception 'Zu diesem Code gibt es weder Profil noch Partien';
  end if;
  return jsonb_build_object('profile', np > 0, 'matches', nm);
end;
$$;

revoke all on function public.pb_rotate_token(text, text) from public;
grant execute on function public.pb_rotate_token(text, text) to anon, authenticated;
