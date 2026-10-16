-- Poly Battle: Nachtrag zu more_players (lief auf Supabase, fehlte hier als Datei)
--
-- Interne Hilfsfunktionen nur über die security-definer-Funktionen nutzbar.

revoke execute on function public.pb_human_roles(jsonb) from anon, authenticated;
revoke execute on function public.pb_role_of(public.matches, text) from anon, authenticated;
revoke execute on function public.pb_public_match(public.matches) from anon, authenticated;
