#!/usr/bin/env bash
# Executar por SSH administrativo. O Actions não pode alterar estes arquivos.
set -euo pipefail
[[ $(id -u) == 0 ]]
CLI=${1:?Caminho da CLI Supabase Linux verificada}
PUBKEY=${2:?Caminho da chave pública exclusiva do Actions}
HERE=$(cd "$(dirname "$0")" && pwd)
getent passwd faceimob-deploy >/dev/null || useradd --create-home --shell /bin/bash faceimob-deploy
install -d -m 755 /usr/local/lib/faceimob /opt/faceimob/config
install -m 755 "$HERE/accept-release.py" "$HERE/ssh-dispatch.sh" "$HERE/release.sh" /usr/local/lib/faceimob/
install -m 700 "$CLI" /usr/local/lib/faceimob/supabase-cli
install -m 644 "$HERE/compose.yml" "$HERE/Caddyfile" /opt/faceimob/config/
chown root:root /home/faceimob-deploy
chmod 755 /home/faceimob-deploy
install -d -o root -g root -m 755 /home/faceimob-deploy/.ssh
printf 'restrict,command="/usr/local/lib/faceimob/ssh-dispatch.sh" %s\n' "$(cat "$PUBKEY")" > /home/faceimob-deploy/.ssh/authorized_keys
chown root:root /home/faceimob-deploy/.ssh/authorized_keys
chmod 644 /home/faceimob-deploy/.ssh/authorized_keys
# Só a pasta de entrada é gravável; sem grupo Docker nem shell remoto livre.
chmod 711 /opt/faceimob
chown faceimob-deploy:faceimob-deploy /opt/faceimob/incoming
chmod 700 /opt/faceimob/incoming
printf 'faceimob-deploy ALL=(root) NOPASSWD: /usr/local/lib/faceimob/accept-release.py *\n' > /etc/sudoers.d/faceimob-deploy
chmod 440 /etc/sudoers.d/faceimob-deploy
visudo -cf /etc/sudoers.d/faceimob-deploy
