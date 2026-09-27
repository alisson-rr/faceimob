# FACEIMOB na VPS

- CRM: https://app.faceimob.com.br
- Evolution Manager: https://evo.iafaceimob.com.br/manager/
- VPS: `179.199.150.96`, Ubuntu 24.04, 8 GB de RAM.
- Credenciais: `.env` local ignorado pelo Git. A chave do Manager é
  `EVOLUTION_API_KEY`. O SSH administrativo está em `FACEIMOB_VPS_*`.

## Serviços

Supabase oficial `self-hosted/v0.8.2`, commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21`: Postgres 17, Auth, Storage,
Realtime, Studio e Edge Runtime. Frontend e APIs usam o domínio do CRM.
As 17 funções são publicadas com o aplicativo; o roteador respeita o
`verify_jwt` de cada função em `supabase/config.toml`.

Evolution API `v2.3.7` inclui o Manager e usa PostgreSQL e Redis próprios.
Caddy termina o HTTPS dos dois domínios. Somente o proxy é público;
frontend (`8080`), Evolution (`8081`), banco (`55432`) e gateway/Studio
(`58000`) escutam em loopback. Studio pode ser acessado por túnel SSH.

Arquivos privados da VPS:

- `/opt/faceimob/supabase/.env`: banco, Auth, chaves e SMTP.
- `/opt/faceimob/services/.env`: Evolution e proxy.
- `/opt/faceimob/config`: Compose e Caddy internos, pertencentes ao root.
- `/usr/local/lib/faceimob`: CLI e scripts administrativos fixos.
- `/opt/faceimob/releases` e `current`: versões da aplicação.
- `/opt/faceimob/backups`: backups do banco anteriores aos deploys.

## Push e migrations

O workflow `.github/workflows/vps.yml` valida typecheck, testes, schema SQL,
a aplicação única das migrations e os limites do pacote. Um push na `main`
publica quando `VPS_DEPLOY_ENABLED=true` e `/opt/faceimob/READY` existe:

1. Compila com `VPS_APP_URL` e `VPS_ANON_KEY`.
2. Envia frontend, funções, templates e migrations por SFTP.
3. Faz backup completo do banco.
4. Executa `supabase db push`: só migrations pendentes, sem seed ou reset.
5. Troca frontend/funções, verifica saúde e atualiza `current`.

Erro de backup ou migration interrompe o deploy. Falha de saúde tenta voltar
os containers à versão anterior; não desfaz dados automaticamente. Migrations
novas devem manter a versão anterior funcionando durante a troca. Não editar
uma migration aplicada. O GitHub e `flock` serializam publicações.

Secrets: `VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`.
A conta `faceimob-deploy` não tem grupo Docker nem shell remoto livre. A chave
aceita SFTP e `deploy SHA`; só `incoming` é gravável. O instalador recusa links,
caminhos fora da release, pacotes incompletos e arquivos de infraestrutura.
Senhas do banco e service role ficam fora do GitHub.

Compose, Caddy, CLI e instaladores exigem atualização por SSH administrativo.
A instalação desses arquivos usa `deploy/install-actions.sh`, com a CLI Linux
verificada e a chave pública exclusiva do Actions como argumentos.

## Migração de 26/09/2026

O snapshot foi restaurado em uma transação: 454.895 registros de 162 tabelas,
298 usuários e 298 perfis. A comparação final do conteúdo de 136 tabelas
confirmou os dados da origem; a única diferença adicional foi uma linha
`denied` de auditoria criada pelo teste de permissão. Mudanças intencionais:
chave/URL dos workers, migrations pendentes e URLs das três fotos de perfil.

O histórico remoto tinha 55 timestamps divergentes, uma duplicação de `0088`
e `0096` com outro nome. A comparação confirmou as funções (diferenças apenas
em comentários), colunas, índices, gatilhos, views, policies e permissões de
leitura/gravação. Preservamos os privilégios adicionais e o RLS da origem.
O constraint de metas já incluía `sales_comp`. O histórico original está em
`migration_audit.schema_migrations_original`; a versão reconciliada contém
137 arquivos, incluindo `0156`, `0157` e `0158` aplicados na VPS.

O dump padrão omitiu o gatilho `auth.on_auth_user_created` e as oito policies
de Storage: foram exportados separadamente e restaurados. Cinco blocos vazios
de recursos recentes do Auth são incompatíveis com a versão instalada;
a cópia compatível omite somente esses blocos, após confirmar zero registros.
O backup original permanece intacto. Não se descartou nenhum registro.

A API antiga está bloqueada por cota. Recuperamos **21.753 documentos** pelos
URLs originais do export Bubble: **7.478.755.533 bytes**, com tamanho e ETag
verificados, inclusive os seis ETags multipart de 16 MiB. Cada documento foi
enviado ao Storage privado e baixado novamente para conferir os bytes.
IDs, nomes, proprietários e datas foram preservados; as versões físicas são
as geradas pelo Storage local. **Três fotos de perfil não têm cópia acessível**
e precisam ser reenviadas; seus metadados foram preservados.

Dumps, manifestos, hashes, relatórios e scripts da transferência ficam em
`deploy/.source.local/`, `deploy/.server.local/` e `/opt/faceimob/import`.
Esses diretórios contêm dados pessoais e segredos, são ignorados pelo Git e
não devem virar artefatos do Actions. O snapshot original também permite
voltar à origem, cujos dados foram preservados e crons pausados no corte.

## Operação e recuperação

Para administrar os serviços Supabase:

```sh
export FACEIMOB_RELEASE=$(readlink -f /opt/faceimob/current)
docker compose --project-name faceimob \
  --env-file /opt/faceimob/supabase/.env \
  -f /opt/faceimob/supabase/docker-compose.yml \
  -f /opt/faceimob/config/compose.yml ps
```

Evolution/proxy: `cd /opt/faceimob/services && docker compose ps`.
As senhas novas estão anotadas no `.env` local. Trocar uma senha exige atualizar
o serviço correspondente e a anotação; não basta editar o arquivo local.
O SMTP do Gmail foi autenticado sem enviar mensagens. Login por senha, RLS,
permissões das funções, downloads privados e Manager foram verificados.

O backup pré-deploy inclui o banco inteiro. Para recuperação completa, guardar
também `supabase/volumes/storage`, os dois `.env` e o volume `faceimob_db-config`
fora da VPS. Não usar `docker compose down -v`, `db reset` ou restaurar por cima
da operação para resolver uma falha. Testar o restore em instância separada.

Verificação local do mecanismo de publicação:

```sh
python3 deploy/test.py
python3 deploy/accept-release.test.py
docker run --rm -v "$PWD:/work" -w /work denoland/deno:2.5.3 \
  test --no-check --no-lock --allow-env deploy/functions-main.test.ts
```
