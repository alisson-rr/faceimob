#!/usr/bin/env bash
set -euo pipefail
command=${SSH_ORIGINAL_COMMAND:-}
if [[ "$command" =~ ^(/usr/lib/openssh/sftp-server|internal-sftp)[[:space:]]*$ ]]; then
  exec /usr/lib/openssh/sftp-server -d /opt/faceimob/incoming
elif [[ "$command" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
  exec /usr/bin/sudo -n /usr/local/lib/faceimob/accept-release.py "${BASH_REMATCH[1]}"
else
  echo 'Esta chave permite somente SFTP e deploy de um SHA.' >&2
  exit 126
fi
