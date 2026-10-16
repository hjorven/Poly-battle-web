#!/bin/sh
# Datenbank-Tests: spielt alle Migrationen in eine frische Postgres-Datenbank
# und prüft die Server-Funktionen. Braucht einen lokalen Postgres-Server.
# Aufruf: PB_PG="postgresql://postgres@localhost:5432" npm run test:db
set -e
PG="${PB_PG:-postgresql://postgres@localhost:5432}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
psql "$PG/postgres" -q -v ON_ERROR_STOP=1 -c "drop database if exists pb_test" -c "create database pb_test" >/dev/null
DB="$PG/pb_test"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$DIR/test/db/supabase-stub.sql" 2>/dev/null
for f in "$DIR"/supabase/migrations/*.sql; do psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true; done
OUT=$(psql "$DB" -q -t -A -v ON_ERROR_STOP=1 -v names="$(cat "$DIR/test/names.json")" -f "$DIR/test/db/online.sql")
echo "$OUT"
# Jede Zeile hat die Form „Name: Ergebnis“; erwartete Ergebnisse stehen in expected.txt.
echo "$OUT" | sed 's/[0-9a-f]\{8\}-[0-9a-f-]\{27\}/<id>/' > /tmp/pb-db-out.txt
diff -u "$DIR/test/db/expected.txt" /tmp/pb-db-out.txt && echo "\nDatenbank-Tests bestanden"
