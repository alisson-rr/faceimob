#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=/opt/faceimob
SHA=${1:?Informe o SHA do commit}
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'SHA inválido' >&2; exit 1; }
exec 9>"$ROOT/deploy.lock"
flock -w 900 9
[[ -f "$ROOT/READY" ]] || { echo 'Importação/corte inicial ainda não foi validado (READY ausente).' >&2; exit 1; }
export FACEIMOB_RELEASE="$ROOT/releases/$SHA"
[[ -f "$FACEIMOB_RELEASE/dist/index.html" && -f "$FACEIMOB_RELEASE/supabase/functions/functions.json" ]]
compose() {
  docker compose --project-name faceimob --env-file "$ROOT/supabase/.env" \
    -f "$ROOT/supabase/docker-compose.yml" -f "$ROOT/config/compose.yml" "$@"
}
compose config --quiet
previous=$(readlink -f "$ROOT/current" || true)
backup="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-$SHA.dump"
compose exec -T db pg_dump -U supabase_admin -d postgres -Fc >"$backup.partial"
[[ -s "$backup.partial" ]]
mv "$backup.partial" "$backup"
# Só a senha é extraída; não carregar .env como código nem imprimi-lo.
export SUPABASE_DB_PASSWORD
SUPABASE_DB_PASSWORD=$(compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["db"]["environment"]["POSTGRES_PASSWORD"])')
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
"/usr/local/lib/faceimob/supabase-cli" db push --yes \
  --workdir "$FACEIMOB_RELEASE" --db-url 'postgresql://postgres@127.0.0.1:55432/postgres?sslmode=disable'
unset SUPABASE_DB_PASSWORD PGPASSWORD

# O schema deve ser compatível com a versão anterior; nunca desfazer dados automaticamente.
if ! { compose up -d --no-deps --wait --wait-timeout 120 functions frontend &&
  curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-all-errors http://127.0.0.1:8080/healthz >/dev/null &&
  curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-all-errors http://127.0.0.1:8080/functions/v1/_health >/dev/null; }; then
  if [[ -n "$previous" && -f "$previous/dist/index.html" ]]; then
    FACEIMOB_RELEASE="$previous" compose up -d --no-deps --wait functions frontend
  fi
  echo 'Publicação falhou após as migrations; confira logs e backup.' >&2
  exit 1
fi
ln -sfn "$FACEIMOB_RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
echo "Release $SHA publicada; backup: $backup"
