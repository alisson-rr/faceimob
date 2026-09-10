#!/usr/bin/env bash
# =============================================================================
# Valida supabase/migrations/*.sql aplicando tudo, em ordem, num Postgres
# descartável. Falha no primeiro erro de SQL (ON_ERROR_STOP).
#
#   ./scripts/validate-schema.sh            # aplica migrations
#   ./scripts/validate-schema.sh --seed     # aplica migrations + seed.sql
#   ./scripts/validate-schema.sh --keep     # mantém o container de pé no fim
#
# Requer apenas Docker. Não usa a CLI do Supabase.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="faceimob-schema-check"
PGPASS="postgres"
IMAGE="postgres:15-alpine"

WITH_SEED=0
WITH_TESTS=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --seed)  WITH_SEED=1 ;;
    --tests) WITH_TESTS=1 ;;
    --keep)  KEEP=1 ;;
    --all)   WITH_SEED=1; WITH_TESTS=1 ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  else
    echo "container mantido: docker exec -it $CONTAINER psql -U postgres"
  fi
}
trap cleanup EXIT

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> subindo $IMAGE"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASS" \
  -e POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

# Espera o Postgres aceitar conexões. pg_isready sobe antes do initdb terminar
# de recriar o cluster, então checamos com uma query real.
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -q -c 'select 1' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

run_sql() {
  local file="$1"
  docker exec -i "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < "$file"
}

echo "==> stubs do ambiente Supabase"
run_sql "$ROOT/supabase/tests/00_supabase_stubs.sql"

echo "==> migrations"
shopt -s nullglob
migrations=("$ROOT"/supabase/migrations/*.sql)
if [ ${#migrations[@]} -eq 0 ]; then
  echo "nenhuma migration encontrada em supabase/migrations/" >&2
  exit 1
fi
for f in "${migrations[@]}"; do
  printf '    %s ... ' "$(basename "$f")"
  run_sql "$f"
  echo 'ok'
done

if [ "$WITH_SEED" -eq 1 ] && [ -f "$ROOT/supabase/seed.sql" ]; then
  echo "==> seed"
  run_sql "$ROOT/supabase/seed.sql"
fi

if [ "$WITH_TESTS" -eq 1 ]; then
  echo "==> testes"
  for t in "$ROOT"/supabase/tests/[0-9][0-9]_*.sql; do
    [[ "$(basename "$t")" == 00_* ]] && continue
    [ -e "$t" ] || continue
    echo "  -- $(basename "$t")"
    run_sql "$t"
  done
fi

echo "==> sanidade"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q <<'SQL'
\pset footer off
select
  (select count(*) from pg_tables where schemaname = 'public')                  as tabelas,
  (select count(*) from pg_views  where schemaname = 'public')                  as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public')                                                as funcoes,
  (select count(*) from pg_policies where schemaname = 'public')                as policies,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e')                            as enums;
SQL

# Toda tabela em public precisa de RLS ligada. Sem isso, um bug de policy vira
# vazamento silencioso de dados entre corretores.
echo "==> RLS em todas as tabelas de public"
missing=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAq <<'SQL'
select string_agg(c.relname, ', ' order by c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
SQL
)
if [ -n "$missing" ]; then
  echo "FALHA: tabelas sem RLS -> $missing" >&2
  exit 1
fi
echo "    todas com RLS"

# Uma tabela com RLS ligada e zero policies é invisível para o client: bloqueia
# tudo silenciosamente. Quase sempre é policy esquecida, não intenção.
echo "==> tabelas com RLS mas sem policy"
nopolicy=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAq <<'SQL'
select string_agg(c.relname, ', ' order by c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  );
SQL
)
if [ -n "$nopolicy" ]; then
  echo "AVISO: RLS sem policy (ninguém enxerga) -> $nopolicy" >&2
fi

echo
echo "schema ok"
