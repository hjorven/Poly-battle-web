-- Poly Battle: Namensprüfung ausbauen
--
--  * Längere Wortliste: Beleidigungen, Rassismus, NS-Bezüge, Sexuelles und
--    Namen, die nach Spielleitung aussehen. Dieselbe Liste steht in
--    js/names.js, damit das Spiel schon beim Tippen Bescheid gibt.
--  * Die 1 zählt als i und als l, „ph“ als „f“, 1488 ist gesperrt.
--  * Harmlose Wörter mit einem verbotenen darin (Marschall, Barsch,
--    Shiitake) bleiben erlaubt.
--  * Bestehende Namen werden nicht geändert; die Prüfung greift beim
--    nächsten Wählen oder Ändern eines Namens.
--
-- Abwärtskompatibel: gleiche Funktion, gleiche Fehlermeldungen.

create or replace function public.pb_check_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  bad constant text[] := array[
    'arsch', 'fick', 'fck', 'hure', 'nutte', 'fotze', 'wichser', 'wixer', 'schlampe', 'scheis',
    'pimmel', 'titten', 'spast', 'behindert', 'missgeburt', 'schwuchtel', 'vergewalt', 'nigg',
    'neger', 'kanak', 'kanack', 'zigeuner', 'judensau', 'nazi', 'hitler', 'siegheil', 'endsieg', 'hakenkreuz',
    'auschwitz', 'holocaust', 'gaskammer', 'kkk', 'fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut',
    'faggot', 'retard', 'wanker', 'asshole', 'penis', 'vagina', 'porn', 'pussy', 'admin',
    'moderator', 'support', 'entwickler', 'offiziell', 'official'
  ];
  ok_words constant text[] := array['marsch', 'barsch', 'harsch', 'shitake', 'scunthorpe'];
  ok_re text := '(' || array_to_string(ok_words, '|') || ')';
  base text;
  one text;
  k text;
  plain text;
  w text;
begin
  if length(n) < 3 or length(n) > 16 then
    raise exception 'Der Name muss 3 bis 16 Zeichen lang sein';
  end if;
  if n !~ '^[A-Za-z0-9ÄÖÜäöüß _-]+$' then
    raise exception 'Erlaubt sind Buchstaben, Ziffern, Leerzeichen, _ und -';
  end if;
  base := regexp_replace(n, '[ _-]', '', 'g');
  if position('1488' in base) > 0 then
    raise exception 'Dieser Name ist nicht erlaubt';
  end if;
  base := replace(lower(base), 'ph', 'f');
  foreach one in array array['i', 'l'] loop
    -- Ziffern als Buchstaben gelesen, Umlaute vereinfacht, harmlose Wörter ausgeblendet.
    k := regexp_replace(translate(base, '01345789äöüß', 'o' || one || 'eastbgaous'), ok_re, '|', 'g');
    -- Doppelte Buchstaben zusammengezogen (fiiick → fick).
    plain := regexp_replace(regexp_replace(k, '(.)\1+', '\1', 'g'), ok_re, '|', 'g');
    foreach w in array bad loop
      if position(w in k) > 0 or position(w in plain) > 0 then
        raise exception 'Dieser Name ist nicht erlaubt';
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
