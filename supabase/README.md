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
RLS, ou algum dos 86 asserts de comportamento quebrar.

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

58 tabelas · 123 policies · 71 funções · 86 asserts de teste.

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

1. **Frontend** — cerca de 15 telas ainda consultam a forma antiga. Não é
   reescrita: `src/integrations/supabase/newSchema.ts` já traduz o schema novo
   para o formato que as telas esperam (`broker1/2/3`, `manager1/2/3`,
   `cotista2`, …), então migrar uma tela é trocar a fonte de dados. A exceção é
   `DailyBI.tsx`, que aponta para `daily_broker_entries`/`daily_team_reports` —
   tabelas que não existem — e precisa de remapeamento real para
   `daily_entries`/`daily_reports`.
2. **Cofre de tokens** — `private.integration_credentials` está pronto e sem uso
   nas duas pontas: nenhuma tela grava (não há UI) e as 8 edge functions leem de
   `Deno.env`. Construir só a tela não entrega o requisito.
3. **Login por código no e-mail** — `Login.tsx` ainda usa
   `signInWithPassword`. O schema já não guarda senha; falta o fluxo OTP.
4. **Brevo, King Host, gestão de campanhas Meta** — previstos nas atas, sem
   investigação de viabilidade. Ver `docs/sprints/`.

## Migrations antigas

As 70 anteriores foram movidas para `supabase/migrations_legacy/`. Nada foi
apagado; ficam para consulta e não são aplicadas.
