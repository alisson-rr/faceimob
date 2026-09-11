# Handoff V — limpeza da homologação antes da carga do Bubble

Executado em 11/09/2026 no projeto `mcmqgxvtwegtptfseqvw` (homologação), como `postgres` pelo MCP.

## Resultado

O banco está limpo e congelado, o Storage está vazio e o schema está em dia (migrations até a 0114).
Está pronto para a carga. O resultado do ensaio está na seção "Ensaio da carga".

Estado em que ficou:

- **Operação congelada.** Os 10 crons `faceimob-%` estão desligados; a roleta está pausada e os dois
  avisos de lead estão desligados. Religar só pela seção 5 do COMO_RODAR, depois da carga.
- **Backup em `backup_pre_bubble`**: 53 tabelas, sem nenhum grant para `anon` nem `authenticated`.
  Não apague.
- **Nenhum gatilho foi desligado.** O passo 3 do COMO_RODAR §2 é da carga, não desta tarefa.
- **A chave de serviço usada é a `SUPABASE_SERVICE_ROLE` do `.env`.** Conferi que é a `service_role`
  deste projeto; o valor nunca foi exibido. O importador lê `SUPABASE_SERVICE_ROLE_KEY`, então no
  terminal é preciso copiar de uma para a outra (comando na seção "Ensaio da carga").

## Decisões

| Item | Decisão | Quem decidiu |
|---|---|---|
| `allowed_ips` | Saem as 3 do `seeds/020`, inclusive o `127.0.0.1` global. Ficam as 2 cadastradas pela tela. 5 → 2 | Você, no Checkpoint 1 |
| `sdr_agents` e `whatsapp_templates` | Ficam todos (3 e 2). Em `lead_sources` os 3 campos do seed voltaram a `null` mesmo assim, pela regra 3 | Você |
| Temporada "Julho 2026" | Sai. As outras 3 saíram pela regra 1 (não vêm do `seed.sql`). `game_seasons` = 0 | Você |
| Ordem do backup | Na mesma transação da limpeza, e não num passo separado: o banco estava em uso e o backup não pode ser dropado para refazer | Eu, avisado no Checkpoint 1 |
| Migrations 0097–0114 | Aplicadas | Você ("se está faltando, aplica") |
| Migrations 0115 e 0120 | Não aplicadas: estão fora do git e outra frente ainda está escrevendo (gravadas às 13h32 e 13h44). Nenhuma afeta a carga | Eu |

## Crons que estavam ativos (religar só estes)

`faceimob-assign-queued`, `faceimob-auto-checkout-expired`, `faceimob-cron-failure-alert`,
`faceimob-mark-no-response`, `faceimob-notify-dispatch`, `faceimob-public-link-expiry`,
`faceimob-purge-cron-history`, `faceimob-release-expired-leads`, `faceimob-submission-dispatch`,
`faceimob-task-due`.

`automation_settings`: antes `false | true | true` (`updated_at` 2026-09-06 13:32:44 UTC,
`updated_by` nulo). Agora `true | false | false`.

## Contagens antes → depois

A coluna "antes" é a contagem do backup, que bateu linha a linha com o banco no instante da limpeza.

**Zeradas por `TRUNCATE` (40):** leads 72 · lead_assignments 315 · lead_attachments 3 ·
lead_comments 3 · lead_events 1.074 · deals 33 · deal_clients 42 · deal_participants 102 ·
deal_documents 77 · deal_history 12 · developer_submissions 1 · cca_cases 12 · cca_case_events 3 ·
game_events 97 · game_season_results 21 · goals 25 · annual_results 4 · daily_reports 10 ·
daily_entries 30 · tasks 9 · visits 8 · checkins 10 · notifications 1.904 · remarketing_lists 1 ·
remarketing_contacts 2 · sdr_conversations 2 · sdr_messages 3 · whatsapp_inbound_messages 0 ·
closed_months 2 · month_reopenings 9 · access_provision_log 29 · role_change_log 6 · ad_campaigns 6 ·
marketing_investments 8 · developers 2 · developer_projects 4 · useful_links 3 · gold_tips 3 ·
important_notices 2 · team_members 16 → **todas 0**.

**Filtradas:**

| Tabela | Antes → depois | O que ficou |
|---|---|---|
| teams | 3 → 0 | — |
| funnel_targets | 4 → 1 | a meta global do `seed.sql` |
| public_links | 4 → 0 | — (inclui o link de diretor criado pela tela antiga em 26/08: o diretor era conta de seed) |
| distribution_groups | 4 → 2 | `fila-geral` e `triagem-sdr-ia` |
| distribution_group_forms | 2 → 0 | — |
| distribution_group_members | 19 → 1 | a vaga da conta @gmail.com na `fila-geral` |
| game_seasons | 4 → 0 | — |
| allowed_ips | 5 → 2 | as 2 da tela ("Alisson" e "IP autorizado") |
| lead_sources | 6 → 6 | `meta_ads` e `portal` sem `form_id`, `sdr_agent_id` e `welcome_template_id` |
| user_roles | 28 → 6 | admin+broker (@gmail) e admin+broker+director+manager (@faceimob) |
| profiles | 24 → 2 | as 2 reais, iguais ao backup campo a campo |
| auth.users | 24 → 2 | as 2 reais, não banidas |
| auth.identities | 24 → 2 | 0 órfãs |
| auth.sessions · refresh_tokens · mfa_amr_claims | 14 · 49 · 14 → 13 · 48 · 13 | só das 2 reais |

**Storage:** deal-documents 89 → 0 · lead-attachments 3 → 0 · avatars 4 → 0. As 2 contas reais não
tinham foto. Os 96 caminhos estão em `backup_pre_bubble.storage_objects`; o arquivo em si não volta.

**Mantidas pela limpeza:** pipeline_stages 9 · document_types 9 · cca_stages 7 · work_shifts 3 ·
game_scoring_rules 5 · sdr_agents 3 · whatsapp_templates 2 · automation_settings 1 ·
import_bubble_map 0 · private.integration_credentials 4 (conteúdo igual antes e depois, conferido por
hash dentro do banco) · storage.buckets 3.
Três catálogos mudaram depois, e cada mudança vem de uma migration: permissions 33 → 34,
role_permissions 86 → 88 e stage_permissions 39 → 48. Detalhe na seção "Migrations aplicadas".

## Migrations aplicadas (0097 a 0114)

As 18 entraram em ordem pelo MCP `apply_migration`, com o conteúdo literal de cada arquivo e
`name` = `NNNN_nome`, entre 16:22 e 16:36 UTC. Nenhuma deu erro.

Cada uma foi conferida pela impressão digital: um hash do arquivo sem comentários e sem espaços,
comparado com o mesmo hash do texto que o banco gravou. Bateu nas 18. O método foi validado antes em
migrations já aplicadas (0089, 0093, 0094, 0096).

O que mudou por causa delas:

- **Catálogo.** +1 permissão, `deals.mark_off_distrato` (0101). +2 concessões, admin e sócio nessa
  permissão. +9 na matriz de etapas: o sócio entrou nas 9 etapas (0101). A 0104 tirou `menu.equipes`
  de cca, broker, manager e director.
- **Superfície anônima.** A 0103 tirou o `anon` de `public_director_checkpoint`. Agora `anon` executa
  só `public_daily_team` e `public_daily_submit`, como diz o CLAUDE.md.
- **Cofre de acesso (0105/0108).** Criaram `private.operation_credentials` (0 linhas, sem grant para
  `anon`/`authenticated`) e `public.credential_reveal_log`. O cofre de integrações continua com as
  mesmas 4 credenciais (hash igual).

Conferido depois de aplicar:
- continuam iguais os crons (0 ativos, nenhum novo), `automation_settings` (`t|f|f`), a limpeza (as
  40 tabelas em 0, 2 contas, Storage vazio), o backup (53 tabelas, sem grant) e os gatilhos (0
  desligados);
- o advisor de segurança não aponta nada crítico vindo destas 18.

## Critérios de aceite

- [x] Toda tabela "sai" com 0 e toda "fica" com a contagem do Checkpoint 1.
- [x] `auth.users` = 2, não banidas, mesmos papéis; `profiles` = 2; 0 órfã em `auth.identities`.
- [x] `private.integration_credentials` = 4; `automation_settings` = 1 com `leads_paused = true`;
      `fila-geral` existe.
- [x] `lead_sources` sem `seed-form-*` e sem apontar para agente ou template de seed. Os agentes e
      templates ficaram, e a FK impede apontar para linha apagada.
- [x] `deal-documents` = 0, `lead-attachments` = 0, `avatars` = 0 (as 2 contas não tinham foto).
- [x] `import_bubble_map` = 0; crons `faceimob-%` ativos = 0.
- [x] `backup_pre_bubble` bate com o Checkpoint 1; `has_schema_privilege` = `false` para `anon` e
      `authenticated`; 0 grant de tabela para `anon`, `authenticated` ou `PUBLIC`.
- [ ] Ensaio sem `ABORTADO`: pessoas, catálogo e negócios passaram; o histórico para por desenho com
      o de-para vazio. Ver "Ensaio da carga".

Consulta que prova (roda de novo a qualquer momento):

```sql
select
  (select count(*) from auth.users) as users,
  (select count(*) from auth.users where banned_until > now()) as banidas,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id)) as identities_orfas,
  (select count(*) from private.integration_credentials) as cofre,
  (select leads_paused from public.automation_settings where id) as leads_paused,
  (select count(*) from public.distribution_groups where slug = 'fila-geral') as fila_geral,
  (select count(*) from public.lead_sources where form_id like 'seed-form-%') as seed_forms,
  (select count(*) from public.import_bubble_map) as import_map,
  (select count(*) from cron.job where jobname like 'faceimob-%' and active) as crons_ativos,
  has_schema_privilege('anon', 'backup_pre_bubble', 'USAGE') as anon_backup,
  has_schema_privilege('authenticated', 'backup_pre_bubble', 'USAGE') as auth_backup,
  (select count(*) from storage.objects) as storage;
-- esperado: 2 | 0 | 2 | 0 | 4 | t | 1 | 0 | 0 | 0 | f | f | 0
```

## Ensaio da carga

Rodei `node scripts/import/run.mjs --dry-run` com a service role do `.env`, no Node 20.19.6 (o esboço
de WebSocket do importador resolve; sai só um aviso de depreciação). Nada foi gravado: o inventário
fechou em `+0` em todas as linhas.

- **Pessoas, catálogo e negócios passaram** e bateram com o COMO_RODAR §3: 298 pessoas, 12 equipes,
  41 construtoras, 618 empreendimentos, 3 links, 10 dicas, 18 avisos, 7.579 negócios e 7.560 casos de
  crédito. O VGV bruto fechou em R$ 465.819.613,45, igual ao esperado.
- **O histórico parou com `ABORTADO`, como previsto.** Ele precisa dos negócios já gravados no de-para,
  que num ensaio fica vazio (`03b-historico.mjs:358-365`). Por isso jogo, leads e documentos não rodaram.
- **Tentei o ensaio avulso das outras 4 cargas, sem a chave,** e a proteção automática de permissões
  desta sessão bloqueou. Não contornei. Para ensaiar antes da carga de verdade, rode num terminal novo,
  sem a chave no ambiente: `node scripts/import/03b-historico.mjs --dry-run`, o mesmo para
  `05-leads.mjs` e `06-documentos.mjs`, e `node scripts/import/04-jogo-metas.mjs --autoteste`.
  A alternativa é ir direto para a carga real (COMO_RODAR §4): cada carga confere os próprios números
  antes de gravar.

Avisos do ensaio para olhar antes da carga:
- 62 fichas de corretor sem pessoa correspondente;
- 30 fichas sem vínculo com Users (nenhuma vira participante);
- 16 negócios com rateio inflado, para revisão manual;
- 6 CPFs duplicados, gravados só no cadastro ativo;
- 22 construtoras "CCA Externo" sem e-mail de envio.

O COMO_RODAR diz que parte desses avisos é esperada e está explicada no cabeçalho de cada carga.

**Antes de religar a roleta** (COMO_RODAR §5): cadastre o IP real da unidade em Admin · IPs. Sem isso,
nenhum corretor importado faz check-in, e sem check-in a roleta não entrega lead. O lead fica
esperando, não se perde.

## Riscos que continuam (fora desta tarefa)

- **A carga 01 vai adotar a conta @faceimob.com.br**, que está no export do Bubble como ADM: sobrescreve
  o perfil e remove o papel broker. O estado atual está em `backup_pre_bubble.profiles` e `user_roles`.
- **A conta @gmail.com (admin)** continua com a trava de IP desligada e com vaga na `fila-geral`. As
  duas coisas vieram dos seeds 050 e 060, e não foram mexidas porque alterar as contas reais era
  proibido. Quando a roleta voltar, o admin recebe lead.
- **Não rode seed** (`npm run db:seed:remote`, `scripts/demo.mjs`): recria dado fictício, e o
  `seeds/020` volta a ligar `meta_ads`/`portal` ao agente e ao template do seed.
- **Não use `supabase db push` nesse banco.** As versões gravadas são o horário do apply pelo MCP, não
  as dos arquivos. O CLI não reconheceria nenhuma e tentaria reaplicar tudo. Migration nova entra pelo
  MCP, com `name` = `NNNN_nome`.
- **Sem temporada aberta até a seção 5 do COMO_RODAR, passo 4.** Enquanto isso o jogo não pontua. Com a
  operação congelada, ninguém pontua nesse intervalo.
- **COMO_RODAR §2, passo 4 (reabrir meses), agora não faz nada**: `closed_months` = 0. O §5, passo 2,
  restaura zero meses.
- **`credential_reveal_log`** (0105) dá INSERT, UPDATE, DELETE e TRUNCATE para `authenticated`, quando
  a migration pretendia só SELECT (a sobra veio dos privilégios padrão da 0023). Pela API o RLS barra a
  escrita, porque não há policy de escrita. Fechar com uma migration corretiva quando quiser.
- **0087 e 0095 no histórico diferem do arquivo atual só em texto**: um pré-teste e o comentário de uma
  coluna. O comportamento é o mesmo. Reaplicar não ganha nada e duplica a linha no histórico.
- **O advisor aponta a view `team_leader_names` como SECURITY DEFINER** (erro antigo, da 0079).
- **`deal_code_seq` não reinicia** com `TRUNCATE` (está em 1.218; o próximo negócio é NEG-001219).
  Verificar colisão com os códigos do Bubble na frente da carga.
- **Ficou de fora do escopo** o log `net._http_response` (183 linhas do pg_net; 2 respostas contêm
  e-mail).

## E2E que dependiam de seed (só a lista)

`grep -rlE "\.invalid|70000000|80000000" e2e/`:

- `e2e/anonimo/diario.anonimo.spec.ts`
- `e2e/admin/importar-planilha.spec.ts`
- `e2e/matriz/cenario.ts`
- `e2e/support/users.ts`
- `e2e/README.md`

Além desses, pela investigação do Checkpoint: no alvo remoto, `e2e/sdr/origens-e-templates.spec.ts:53`
esperava `meta_ads`/`portal` ligados a um agente. Esse vínculo foi zerado.

## SQL executado

**Congelamento (COMO_RODAR §2, passos 0 a 2)**

```sql
with ativos as (
  select jobid, jobname from cron.job where jobname like 'faceimob-%' and active
), congelados as (
  select jobname, cron.alter_job(jobid, active := false) as r from ativos
)
select jobname from congelados order by 1;

with antes as (
  select leads_paused, notify_on_assign, notify_on_timeout, updated_at, updated_by
  from public.automation_settings where id
)
update public.automation_settings
   set leads_paused = true, notify_on_assign = false, notify_on_timeout = false
 where id
returning leads_paused, notify_on_assign, notify_on_timeout, (select row_to_json(antes) from antes) as antes;
```

**Backup e limpeza: um único bloco, portanto uma transação.** Qualquer `raise` desfaz tudo, o
backup inclusive. Passou na primeira tentativa.

```sql
do $$
declare
  v_lote text[] := array[
    'leads','lead_assignments','lead_attachments','lead_comments','lead_events',
    'deals','deal_clients','deal_participants','deal_documents','deal_history','developer_submissions',
    'cca_cases','cca_case_events','game_events','game_season_results','goals','annual_results',
    'daily_reports','daily_entries','tasks','visits','checkins','notifications',
    'remarketing_lists','remarketing_contacts','sdr_conversations','sdr_messages','whatsapp_inbound_messages',
    'closed_months','month_reopenings','access_provision_log','role_change_log',
    'ad_campaigns','marketing_investments','developers','developer_projects',
    'useful_links','gold_tips','important_notices','team_members'];
  v_parcial text[] := array[
    'teams','funnel_targets','public_links','distribution_groups','distribution_group_forms',
    'distribution_group_members','game_seasons','allowed_ips','user_roles','profiles','lead_sources'];
  v_reais uuid[] := array['5ae99515-f7b0-4490-a9c4-65d435783d97','10000000-0000-0000-0000-0000000000c1']::uuid[];
  v_fora uuid[];
  v_cofre text;
  v_config text;
  t text;
  n bigint;
begin
  set local lock_timeout = '5s';

  -- pré-condições
  select array_agg(id) into v_fora from auth.users where email like '%.invalid';
  if coalesce(cardinality(v_fora), 0) <> 22 then raise exception 'esperava 22 contas .invalid, achei %', cardinality(v_fora); end if;
  if (select count(*) from auth.users where id = any(v_reais)) <> 2 then raise exception 'as 2 contas reais não estão lá'; end if;
  if exists (select 1 from auth.users where id <> all(v_fora) and id <> all(v_reais)) then raise exception 'há conta fora das 24 do Checkpoint'; end if;
  if (select count(*) from public.import_bubble_map) <> 0 then raise exception 'import_bubble_map não está vazio'; end if;
  select md5(coalesce(string_agg(c::text, '|' order by c::text), '')) into v_cofre from private.integration_credentials c;
  select md5(coalesce(string_agg(a::text, '|' order by a::text), '')) into v_config from public.automation_settings a;

  -- backup (passo 4)
  create schema backup_pre_bubble;
  revoke all on schema backup_pre_bubble from public, anon, authenticated;
  foreach t in array v_lote || v_parcial loop
    execute format('create table backup_pre_bubble.%I as table public.%I', t, t);
    execute format('select (select count(*) from public.%I) - (select count(*) from backup_pre_bubble.%I)', t, t) into n;
    if n <> 0 then raise exception 'backup de % divergiu', t; end if;
  end loop;
  create table backup_pre_bubble.auth_users as
    select id, email, created_at from auth.users where id = any(v_fora);
  create table backup_pre_bubble.storage_objects as
    select id, bucket_id, name, owner, created_at, metadata from storage.objects;
  revoke all on all tables in schema backup_pre_bubble from public, anon, authenticated;

  -- operacional (regra 1)
  truncate table
    public.leads, public.lead_assignments, public.lead_attachments, public.lead_comments, public.lead_events,
    public.deals, public.deal_clients, public.deal_participants, public.deal_documents, public.deal_history,
    public.developer_submissions, public.cca_cases, public.cca_case_events,
    public.game_events, public.game_season_results, public.goals, public.annual_results,
    public.daily_reports, public.daily_entries, public.tasks, public.visits, public.checkins, public.notifications,
    public.remarketing_lists, public.remarketing_contacts, public.sdr_conversations, public.sdr_messages,
    public.whatsapp_inbound_messages, public.closed_months, public.month_reopenings,
    public.access_provision_log, public.role_change_log, public.ad_campaigns, public.marketing_investments,
    public.developers, public.developer_projects, public.useful_links, public.gold_tips,
    public.important_notices, public.team_members;

  -- catálogo e configuração (regra 3)
  update public.lead_sources set form_id = null
   where (code = 'meta_ads' and form_id = 'seed-form-parque-flores') or (code = 'portal' and form_id = 'seed-form-regiao-sul');
  get diagnostics n = row_count; if n <> 2 then raise exception 'lead_sources.form_id: esperava 2, mudou %', n; end if;
  update public.lead_sources set sdr_agent_id = null
   where code in ('meta_ads','portal') and sdr_agent_id = '36000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count; if n <> 2 then raise exception 'lead_sources.sdr_agent_id: esperava 2, mudou %', n; end if;
  update public.lead_sources set welcome_template_id = null
   where code in ('meta_ads','portal') and welcome_template_id = '35000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count; if n <> 2 then raise exception 'lead_sources.welcome_template_id: esperava 2, mudou %', n; end if;

  delete from public.allowed_ips where id in ('32000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000003');
  get diagnostics n = row_count; if n <> 3 then raise exception 'allowed_ips: esperava 3, apagou %', n; end if;
  delete from public.funnel_targets where scope <> 'global';
  get diagnostics n = row_count; if n <> 3 then raise exception 'funnel_targets: esperava 3, apagou %', n; end if;
  delete from public.public_links;
  get diagnostics n = row_count; if n <> 4 then raise exception 'public_links: esperava 4, apagou %', n; end if;
  delete from public.distribution_group_members where profile_id = any(v_fora);
  get diagnostics n = row_count; if n <> 18 then raise exception 'distribution_group_members: esperava 18, apagou %', n; end if;
  delete from public.distribution_group_forms where group_id in ('33000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002');
  get diagnostics n = row_count; if n <> 2 then raise exception 'distribution_group_forms: esperava 2, apagou %', n; end if;
  delete from public.distribution_groups where id in ('33000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002');
  get diagnostics n = row_count; if n <> 2 then raise exception 'distribution_groups: esperava 2, apagou %', n; end if;
  delete from public.game_seasons;
  get diagnostics n = row_count; if n <> 4 then raise exception 'game_seasons: esperava 4, apagou %', n; end if;
  delete from public.teams;
  get diagnostics n = row_count; if n <> 3 then raise exception 'teams: esperava 3, apagou %', n; end if;

  -- pessoas (regra 2), por e-mail
  delete from public.user_roles where profile_id = any(v_fora);
  get diagnostics n = row_count; if n <> 22 then raise exception 'user_roles: esperava 22, apagou %', n; end if;
  delete from public.profiles where id = any(v_fora);
  get diagnostics n = row_count; if n <> 22 then raise exception 'profiles: esperava 22, apagou %', n; end if;
  delete from auth.identities where user_id = any(v_fora);
  get diagnostics n = row_count; if n <> 22 then raise exception 'auth.identities: esperava 22, apagou %', n; end if;
  delete from auth.refresh_tokens where user_id = any(array(select x::text from unnest(v_fora) x));
  delete from auth.sessions where user_id = any(v_fora);
  delete from auth.users where id = any(v_fora);
  get diagnostics n = row_count; if n <> 22 then raise exception 'auth.users: esperava 22, apagou %', n; end if;

  -- conferência final: qualquer divergência desfaz tudo
  foreach t in array v_lote loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'lote: % ficou com % linhas', t, n; end if;
  end loop;
  if (select count(*) from auth.users) <> 2 or exists (select 1 from auth.users where id <> all(v_reais)) then raise exception 'auth.users <> 2 reais'; end if;
  if exists (select 1 from auth.users where banned_until > now()) then raise exception 'conta real banida'; end if;
  if (select count(*) from public.profiles) <> 2 or exists (select 1 from public.profiles where id <> all(v_reais)) then raise exception 'profiles <> 2 reais'; end if;
  if exists ((select * from backup_pre_bubble.profiles where id = any(v_reais)) except (select * from public.profiles)) then raise exception 'perfil real mudou'; end if;
  if (select count(*) from public.user_roles) <> 6
     or exists ((select * from backup_pre_bubble.user_roles where profile_id = any(v_reais)) except (select * from public.user_roles))
     then raise exception 'papéis das contas reais mudaram'; end if;
  if (select count(*) from auth.identities) <> 2 or exists (select 1 from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id)) then raise exception 'auth.identities inconsistente'; end if;
  if exists (select 1 from auth.sessions s where not exists (select 1 from auth.users u where u.id = s.user_id)) then raise exception 'sessão órfã'; end if;
  if exists (select 1 from auth.refresh_tokens r where r.user_id is not null and not exists (select 1 from auth.users u where u.id::text = r.user_id)) then raise exception 'refresh token órfão'; end if;
  if (select md5(coalesce(string_agg(c::text, '|' order by c::text), '')) from private.integration_credentials c) <> v_cofre
     or (select count(*) from private.integration_credentials) <> 4 then raise exception 'cofre mudou'; end if;
  if (select md5(coalesce(string_agg(a::text, '|' order by a::text), '')) from public.automation_settings a) <> v_config
     or (select count(*) from public.automation_settings where leads_paused) <> 1 then raise exception 'automation_settings mudou'; end if;
  if not exists (select 1 from public.distribution_groups where slug = 'fila-geral' and kind = 'general' and active)
     or (select count(*) from public.distribution_groups) <> 2 then raise exception 'distribution_groups'; end if;
  if (select count(*) from public.distribution_group_members) <> 1
     or exists ((select * from backup_pre_bubble.distribution_group_members where profile_id = any(v_reais)) except (select * from public.distribution_group_members))
     then raise exception 'distribution_group_members'; end if;
  if (select count(*) from public.distribution_group_forms) <> 0 then raise exception 'distribution_group_forms'; end if;
  if (select count(*) from public.funnel_targets) <> 1 or not exists (select 1 from public.funnel_targets where scope = 'global') then raise exception 'funnel_targets'; end if;
  if (select count(*) from public.public_links) <> 0 or (select count(*) from public.teams) <> 0 or (select count(*) from public.game_seasons) <> 0 then raise exception 'links/equipes/temporadas'; end if;
  if (select count(*) from public.allowed_ips) <> 2 then raise exception 'allowed_ips <> 2'; end if;
  if (select count(*) from public.sdr_agents) <> 3 or (select count(*) from public.whatsapp_templates) <> 2 then raise exception 'sdr/templates mudaram'; end if;
  if (select count(*) from public.lead_sources) <> 6
     or exists (select 1 from public.lead_sources where form_id like 'seed-form-%'
                or sdr_agent_id = '36000000-0000-0000-0000-000000000001'
                or welcome_template_id = '35000000-0000-0000-0000-000000000001') then raise exception 'lead_sources'; end if;
  if (select count(*) from public.pipeline_stages) <> 9 or (select count(*) from public.stage_permissions) <> 39
     or (select count(*) from public.document_types) <> 9 or (select count(*) from public.cca_stages) <> 7
     or (select count(*) from public.work_shifts) <> 3 or (select count(*) from public.permissions) <> 33
     or (select count(*) from public.role_permissions) <> 86 or (select count(*) from public.game_scoring_rules) <> 5
     then raise exception 'catálogo mudou'; end if;
  if (select count(*) from public.import_bubble_map) <> 0 then raise exception 'import_bubble_map'; end if;
  if (select count(*) from cron.job where jobname like 'faceimob-%' and active) <> 0 then raise exception 'cron ativo'; end if;
  if has_schema_privilege('anon', 'backup_pre_bubble', 'USAGE') or has_schema_privilege('authenticated', 'backup_pre_bubble', 'USAGE')
     then raise exception 'backup exposto'; end if;
end $$;
```

**Migrations:** as 18 da seção "Migrations aplicadas", pelo MCP `apply_migration`, com o conteúdo literal
de `supabase/migrations/20260910970000_0097_…` até `20260911140000_0114_…`.

**Storage:** `esvaziar-storage.mjs`, script descartável fora do repositório. Ele usa o `supa()` de
`scripts/import/lib/bubble.mjs`, com a chave vinda da `SUPABASE_SERVICE_ROLE` do `.env`. Percorre as
pastas de cada bucket (listagem paginada), apaga em lotes de 100 pela Storage API e confere o que
sobrou. Em `avatars`, pula as pastas das 2 contas reais.
