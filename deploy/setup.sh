#!/usr/bin/env bash
# Preparação única. Não inicia serviços nem importa dados.
set -euo pipefail
umask 077
APP_URL=${1:?Uso: bash deploy/setup.sh https://dominio-do-crm}
[[ "$APP_URL" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Informe a URL HTTPS sem caminho.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'A release atual exige Linux x86_64.' >&2; exit 1; }
ROOT=/opt/faceimob
UPSTREAM=564eab8ad7840b13324f68b1bfac074ef8d51c21 # self-hosted/v0.8.2
[[ ! -e "$ROOT/supabase/.env" ]] || { echo 'Instalação existente: preserve .env e volumes.' >&2; exit 1; }
for command in git docker openssl python3 flock curl; do command -v "$command" >/dev/null; done
python3 -c 'import tomllib' # Python >= 3.11
docker compose version
mkdir -p "$ROOT" "$ROOT/releases" "$ROOT/backups" "$ROOT/incoming"
# Os containers precisam ler os arquivos públicos de inicialização.
umask 022
git clone --filter=blob:none --no-checkout https://github.com/supabase/supabase.git "$ROOT/upstream"
git -C "$ROOT/upstream" sparse-checkout set docker
git -C "$ROOT/upstream" checkout --detach "$UPSTREAM"
cp -R "$ROOT/upstream/docker" "$ROOT/supabase"
cd "$ROOT/supabase"
umask 077
cp .env.example .env
sh utils/generate-keys.sh --update-env >/dev/null
export APP_URL
python3 - <<'PY'
import os
from pathlib import Path
p = Path('.env')
values = {
    'SITE_URL': os.environ['APP_URL'],
    'SUPABASE_PUBLIC_URL': os.environ['APP_URL'],
    'API_EXTERNAL_URL': os.environ['APP_URL'] + '/auth/v1',
    'ADDITIONAL_REDIRECT_URLS': os.environ['APP_URL'],
    'DISABLE_SIGNUP': 'true', 'ENABLE_PHONE_SIGNUP': 'false',
    'ENABLE_ANONYMOUS_USERS': 'false', 'FUNCTIONS_VERIFY_JWT': 'true',
    'STUDIO_DEFAULT_ORGANIZATION': 'FACEIMOB', 'STUDIO_DEFAULT_PROJECT': 'FACEIMOB',
    'OPENAI_API_KEY': '', 'POOLER_TENANT_ID': 'faceimob',
    'PGRST_DB_SCHEMAS': 'public,graphql_public',
}
text = '\n'.join(f'{line.split("=",1)[0]}={values[line.split("=",1)[0]]}'
                 if line.split('=',1)[0] in values else line for line in p.read_text().splitlines())
p.write_text(text + '\nCRON_ENABLED=off\nSMTP_CONFIGURED=false\n')
p.chmod(0o600)
PY
echo 'Preparado em /opt/faceimob. Configure SMTP, importe e confira os dados antes de criar READY.'
