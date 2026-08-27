# Backend FACEIMOB — Supabase

Schema novo, modelado do zero a partir das atas de 14/07 e 23/07 e do que o
frontend atual exige. Nada foi importado do banco anterior.

## Como aplicar

Projeto novo e vazio (as migrations são só de criação, não há `DROP`):

```bash
supabase link --project-ref <ref-do-projeto-novo>
```

```bash
supabase db push
```

Depois o seed, que carrega o catálogo sem o qual o produto não roda (estágios,
tipos de documento, turnos, fila geral, regras de pontuação, permissões):

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

> `supabase/config.toml` já aponta para o projeto novo (`mcmqgxvtwegtptfseqvw`).
> Nada a trocar antes do `db push`.

## Como validar sem subir nada

O harness aplica tudo num Postgres descartável e roda os testes. Só precisa de
Docker — não usa a CLI do Supabase:

```bash
./scripts/validate-schema.sh --all
```

Ele falha se: alguma migration não aplicar, alguma tabela em `public` ficar sem
RLS, ou algum dos 253 asserts de comportamento quebrar.

A imagem do harness é Postgres puro, sem as extensões e schemas do Supabase.
`supabase/tests/00_supabase_stubs.sql` provê o mínimo que as migrations assumem:
roles do PostgREST, `auth.uid()/jwt()/role()`, `storage.*` e — desde a `0013` —
um stub de `cron.*` no lugar do pg_cron.

## Estrutura

| Migration | Conteúdo |
|---|---|
| `0001_foundation` | extensões, schema `private`, 13 enums, helpers (`slugify`, `normalize_phone`, `month_start`) |
| `0002_identity` | `profiles`, `user_roles` (N:N), `teams`, `team_members` com histórico, funções de visibilidade, permissões |
| `0003_catalog` | construtoras, empreendimentos, estágios do pipeline, tipos de documento, origens de lead |
| `0004_distribution` | turnos, IPs liberados, check-ins, grupos de distribuição, configurações da automação |
| `0005_leads` | leads com rastreio UTM/campanha, roleta, trava de atendimento, log e comentários |
| `0006_deals` | negócios, clientes (titular + conjunta), participantes com rateio de VGV, documentos versionados |
| `0007_cca` | esteira de análise de crédito e fila de envio para construtora externa |
| `0008_sdr` | agentes de IA, templates de WhatsApp, conversas, remarketing |
| `0009_daily` | diário por equipe, metas de funil, links públicos com PIN |
| `0010_gamification` | temporadas com fechamento manual, pontuação configurável, congelamento |
| `0011_marketing_workspace` | aportes, campanhas, metas, tarefas, notificações, integrações |
| `0012_crud_fixes` | correções da auditoria de CRUD, `cca_stages`, `annual_results`, buckets de storage |
| `0013_cron_scheduling` | agendamento por pg_cron da varredura de leads vencidos e do check-out de turno, poda do histórico, `cron_jobs_health()` |
| `0014_queue_turn_order` | fila ordenada pelo fim da vez: quem perde o lead no prazo vai para o fim |
| `0015_menu_permissions` | item de menu vira código no catálogo `permissions`: menu, funcionalidade e etapa passam a ser governados pelo mesmo `role_permissions` + `has_permission`, com as concessões iniciais reproduzindo o sidebar que era fixo no código |
| `0016_vault_service_reader` | `get_integration_secret()` abre a leitura do cofre para as edge functions — exclusiva de `service_role`, com dupla trava (grant e checagem de `auth.role()`) — e cria o menu `Admin · Integrações` |
| `0017_notification_dispatch` | fila de WhatsApp ganha índice parcial (`notifications_pending_whatsapp_idx`) e a tentativa de agendar `notify-dispatch` por `pg_net`, que avisa alto em vez de calar quando a extensão falta |
| `0018_notification_dispatch_job` | o agendamento que a `0017` não conseguiu fazer: `pg_net` habilitada e `dispatch_pending_notifications()` lendo URL e chave do cofre em vez de GUC, no cron a cada minuto |
| `0019_anon_surface_hardening` | superfície anônima volta a ser só as três RPCs do Diário: revoga `execute` de `anon` nas demais funções, muda o default privilege, fecha `recalc_deal_shares` (reescrevia rateio sem sessão) e pina `search_path` em 11 funções |
| `0020_core_fixes` | dez correções da auditoria de 08/08: triggers de log em `security definer`, publication do realtime, matriz de estágios aplicada por trigger, `deals.status_detail`, `cca_cases.analysis`, check-in sem IP recusado, `assign_queued_leads()`, `dispatch_pending_submissions()`, `notifications.attempts` e `add_deal_comment()` |
| `0021_close_month_rpc` | `close_month_and_season()` fecha mês e temporada numa transação só: migra as propostas abertas, grava `closed_months` e encerra o placar — antes eram três operações soltas no navegador |
| `0022_sdr_queue_guard` | a varredura da fila pula lead com conversa SDR ativa: quem está em qualificação pela IA não é puxado de volta para a roleta no minuto seguinte |
| `0023_role_grants` | `grant` de tabela, sequência e função para `anon`/`authenticated`/`service_role`, mais default privileges: sem eles um banco criado só pelas migrations nascia com "permission denied" antes de o RLS entrar em cena |
| `0024_ip_is_allowed_host` | `ip_is_allowed` troca `<<` por `<<=`: IP de loja cadastrado como host único (/32) voltou a liberar o check-in, e a faixa em CIDR continua valendo |
| `0025_deal_participant_ordinal` | `deal_participants.ordinal` guarda o slot (Corretor 1/2/3, Gerente 1/2): reconstruir a ordem por `created_at` trocava as pessoas de lugar a cada reload |
| `0026_public_daily_flows` | as RPCs públicas deixam de ser `stable` porque gravam `last_seen_at`, e `public_director_checkpoint` passa a pedir PIN (`pin_required`) e devolver metas, totais por equipe e dias sem diário |
| `0027_product_visibility` | `deal_participant_names()` e `visible_game_ranking()` liberam nome de participante e ranking da equipe sem ampliar `auth_visible_profiles()` nem a carteira de leads |
| `0028_document_review` | conferência documental entre corretor e gerente antes do CCA: `document_review_status` no negócio, trigger que impede aprovar a própria revisão por PATCH, `submit_deal_for_manager_review()` e `review_deal_documents()`, que aprova e enfileira CCA ou construtora na mesma transação |
| `0029_checkin_work_date` | `current_work_date()` põe a data do check-in no banco: com o Postgres em UTC, entre 21h e 21h30 de Brasília a presença recém-gravada sumia da tela e travava o checkout |
| `0030_cca_pipeline_access` | papel `cca` ganha `menu.pipeline`: a análise de crédito é editada na aba CCA do modal de negócio e o guard da rota barrava antes do formulário |
| `0031_sprint3_core_flows` | `lead_sources` editável também pelo SDR, `import_remarketing_list()` criando lista e contatos numa transação só (telefone inválido desfaz a lista) e `marketing_campaign_stats()` agregando campanha sem expor o lead |
| `0032_game_cycle_month` | mês-base do negócio nasce do ciclo aberto do jogo (`current_season_month()`), não do calendário; `close_game_season` deixa de travar mês; link da notificação de lead |
| `0033_public_link_hardening` | link público deixa de nascer adivinhável: slug sorteado (`gen_random_uuid()`), criação só por `create_public_link()` com PIN obrigatório, `INSERT` direto fora do contrato de `authenticated`, e lockout de 15 min após 5 PINs errados em `resolve_public_link` (`failed_attempts`/`locked_until`) |
| `0034_submit_lockout` | `public_daily_submit` recusa com `NULL` em vez de `raise`: a exceção abortava a transação do PostgREST e descartava junto o contador do lockout gravado por `resolve_public_link`, então o caminho de escrita nunca travava — 10^6 PINs varridos por `POST /rpc/public_daily_submit`. Metade de banco de uma correção que também toca `DailyReport.tsx` |

58 tabelas · 1 view · 124 policies · 89 funções · 13 enums · 253 asserts de teste.
Os cinco primeiros números são os que `./scripts/validate-schema.sh --all` imprime no bloco
`==> sanidade`; os asserts são as linhas `ok` que os 17 arquivos de `supabase/tests/` emitem
na mesma execução.

## Auditoria de CRUD

Rodada depois do schema pronto, confrontando a matriz real de policies com o que
cada tela precisa. Seis achados, todos reproduzidos em teste antes de corrigir e
com regressão em `tests/03_crud_audit.sql`:

| # | Tipo | Achado |
|---|---|---|
| 1 | segurança | Corretor alterava o próprio `bypass_ip_check` e derrubava a trava de IP do check-in inteira |
| 2 | segurança | Corretor alterava o próprio `status` — podia se reativar após suspensão |
| 3 | função | Corretor não conseguia fazer check-out do próprio turno |
| 4 | função | Negócio criado manualmente nascia sem participante: invisível e ineditável para o autor. Com `.select()` do supabase-js o INSERT nem passava |
| 5 | segurança | Corretor injetava comentário em lead de outra equipe passando o UUID direto |
| 6 | função | `deal_clients`: DELETE regido pela regra de leitura, mais permissivo que INSERT/UPDATE |

Os achados 1 e 2 vêm da mesma causa: **RLS filtra linha, não coluna**. A policy
`profiles_update_self` libera a linha inteira, então proteger campo
administrativo exige trigger. Está em `profiles_guard_admin_columns()`.

O achado 4 tem uma sutileza que vale registrar: um trigger `AFTER INSERT` não
resolve. Em `INSERT ... RETURNING` o Postgres avalia a policy de SELECT contra a
linha nova **antes** de disparar os triggers AFTER — `deal_participants` ainda
está vazio nesse instante. A visibilidade teve que passar a ler `created_by` da
própria linha.

Três superfícies que o frontend usa e não existiam foram criadas junto:
`cca_stages` (estágios do CCA configuráveis, mesmo padrão de `pipeline_stages`),
`annual_results` (consolidado anual por ano/mês, upsert) e os buckets de storage
`avatars`, `lead-attachments` e `deal-documents`.

Estado final verificado: nenhuma tabela com DELETE mais permissivo que
INSERT/UPDATE, e cinco tabelas deliberadamente sem escrita por serem log
imutável (`lead_events`, `lead_assignments`, `deal_history`, `cca_case_events`,
`sdr_messages` — todas escritas por funções `SECURITY DEFINER`).

## Decisões que valem saber

**Papel é N:N.** Diretor pode atuar também como gerente e corretor — foi
requisito explícito. O schema antigo tinha papel duplicado em dois lugares, que
é o que fez o Rafael receber notificação de CCA sem ter o papel.

**Toda visibilidade sai de uma função só.** `auth_visible_profiles()` define
quem cada usuário enxerga (corretor: só ele; gerente: a equipe; diretor: as
equipes que dirige; admin/sócio: todos). Leads, negócios, métricas e metas
filtram por ela. Mudar a regra de hierarquia é mexer num lugar.

**`broker1/2/3` e `manager1/2/3` viraram `deal_participants`.** O limite de 3
era arbitrário e impedia qualquer agregação por corretor. O rateio de VGV é
calculado no banco e sempre fecha em 100%, inclusive com 3 corretores
(33.334/33.333/33.333).

**Os 12 campos duplicados do segundo comprador viraram `deal_clients`** com
`ordinal` 1 ou 2.

**Anexo único virou `deal_documents` tipado e versionado.** Reenviar um
documento não apaga o anterior: marca como substituído, com `version`. É o
histórico de alterações que o CCA pediu.

**Nenhuma senha ou token no schema público.** Autenticação é 100% Supabase Auth.
Tokens de API vivem em `private.integration_credentials`, num schema que o
PostgREST não expõe; o admin grava por RPC e nunca recebe o valor de volta. PIN
de link público é hash bcrypt.

**A superfície anônima são três funções.** `public_daily_team`,
`public_daily_submit` e `public_director_checkpoint`. Nenhuma tabela é legível
por `anon`.

**Mês fechado trava edição.** `closed_months` impede que relatório passado mude
retroativamente — a queixa sobre discrepância nos anuais.

## O que já foi fechado

1. **Edge functions** — as 8 foram reescritas contra o schema novo em `587aa7d`.
   Nenhuma referencia mais tabela inexistente. `meta-ads-webhook` chama
   `assign_lead`, então o lead do formulário entra na roleta.
2. **Cron da roleta** — `0013` agenda `release_expired_leads()` a cada 30s. Era
   o bug de maior impacto: sem agendamento a trava de 5 minutos nunca liberava o
   lead e a roleta parava na primeira atribuição.
3. **Checkout automático** — `0013` agenda `auto_checkout_expired()` a cada
   minuto. A função é dirigida por `work_shifts.checkout_time`, então mudar o
   turno pelo admin não exige mexer no cron.
4. **Tipos TypeScript** — regenerados contra o schema aplicado. Para refazer:
   `supabase gen types typescript --linked > src/integrations/supabase/types.ts`
   (ou `--db-url` apontando para o banco local, que dá o mesmo resultado sem
   depender de `supabase link`).

5. **Fila ordenada pelo fim da vez** — `0014`. Quem perde o lead por timeout vai
   para o fim da fila e só recebe de novo depois de a fila inteira ter tido a vez
   (regra confirmada com o cliente em 30/07). `distribution_queue` passou a
   ordenar por `last_turn_at`; `last_assigned_at` continua no retorno com o
   significado original, para a tela do corretor.

Verificação do agendamento em produção depois do `db push`, como admin:

```sql
select * from public.cron_jobs_health();
```

Espera-se três linhas `faceimob-*` com `active = true`, `last_status =
'succeeded'` e `failures_24h = 0`. Roteiro completo de validação da roleta em
`docs/sprints/roteiro-teste-roleta.md`.

## O que ainda falta

*Revisado em 26/08/2026 (Tarefa J). Os três primeiros itens desta lista já não
eram verdade e foram corrigidos; o que sobrou está abaixo.*

1. ~~**Frontend** — cerca de 15 telas consultando a forma antiga~~ — resolvido.
   Todas passam por `src/integrations/supabase/newSchema.ts`, e as cinco do
   caminho da demonstração (Dashboard, Check-in, Leads, Pipeline, CCA) foram
   decompostas e migradas para `useQuery` nas Tarefas F, G e H. `DailyBI.tsx`
   não foi remapeada: foi apagada, e `/admin/daily-bi` redireciona para
   `/checkpoint`.
2. ~~**Cofre de tokens** sem uso nas duas pontas~~ — resolvido.
   **Admin · Integrações** grava por `set_integration_secret()` e as edge
   functions leem por `functions/_shared/secrets.ts`, com `Deno.env` como
   retaguarda. O que falta é **cadastrar as chaves reais**: o cofre da
   homologação está vazio.
3. ~~**Login por código no e-mail**~~ — entregue. `Login.tsx` usa
   `signInWithOtp` (6 dígitos) e mantém `signInWithPassword` como alternativa,
   por decisão de 25/08 — a demonstração não podia depender de SMTP. Nenhuma
   senha é gravada em `public.profiles`; o hash vive no GoTrue.
4. **Brevo, King Host, gestão de campanhas Meta** — previstos nas atas, sem
   investigação de viabilidade. Ver `docs/sprints/`.
5. **Ajustes que só o dono do projeto faz no painel do Supabase:** desligar o
   auto-cadastro (Authentication → Sign In / Providers) e configurar o SMTP.
   O `config.toml` só vale para o stack local.
6. **Dois links públicos de diretoria sem PIN** (`seed-diretoria-daniela`,
   `diretor-ricardo-sampaio`): a `0034` não protege link sem PIN, porque não há
   segredo a adivinhar. Fechar em Admin · Diário → *Gerar PIN*.
7. **`handle_new_auth_user` concede `broker` a toda conta nova** (`0002`).
   Inofensivo com o auto-cadastro desligado; volta a ser buraco se religarem.

## Migrations antigas

As 70 anteriores foram movidas para `supabase/migrations_legacy/`. Nada foi
apagado; ficam para consulta e não são aplicadas.
