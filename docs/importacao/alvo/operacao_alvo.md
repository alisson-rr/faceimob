# Restrições operacionais do import em massa — schema alvo

Domínio: **transversal** (não é uma tabela, é o procedimento de carga).
Fontes: `supabase/migrations/` (86 arquivos, medido com `ls supabase/migrations | wc -l`),
`supabase/tests/` (47 arquivos), `supabase/seeds/` (9 arquivos), `supabase/config.toml`,
`scripts/`, `src/integrations/supabase/`.
Snapshot do schema: `docs/importacao/SCHEMA_ALVO.md`.

Regra de leitura usada: a numeração das migrations tem lacunas e várias migrations
recriam o mesmo objeto — **vale a última definição**. Todos os inventários abaixo foram
reduzidos por "último `create` vence, `drop` sem recriação mata".

---

## 0. Veredito em uma página

O banco não é um depósito passivo: é uma máquina de estados com **85 gatilhos ativos**
(38 deles só carimbam `updated_at`; **47 têm lógica**), **10 jobs de pg_cron** e **2 saídas
externas reais** (WhatsApp Cloud API e e-mail Brevo). Uma carga ingênua de centenas de
milhares de linhas não corrompe dados — ela **dispara a operação inteira**.

O caminho mais curto de um desastre, medido:

1. `leads.status` tem `default 'queued'` (`supabase/migrations/20260725120400_0005_leads.sql:51`).
2. O job `faceimob-assign-queued` roda **a cada minuto** e distribui 50 leads `queued` por
   execução (`20260808130000_0020_core_fixes.sql:346` + `20260906740000_0074_leads_roleta.sql:482`).
3. Cada atribuição insere linha em `lead_assignments`, o que aciona `notify_lead_assigned`
   (`20260725121000_0011_marketing_workspace.sql:227`), que grava **duas** notificações — uma
   `in_app` e **uma `whatsapp`** (`20260821120000_0032_game_cycle_month.sql:237-273`).
4. `dispatch_pending_notifications()` roda a cada minuto, vê fila `whatsapp` não vazia e faz
   `net.http_post` para a edge function `notify-dispatch`
   (`20260906830000_0083_notificacoes_crons.sql:211-250`).
5. `notify-dispatch` manda WhatsApp de verdade para o corretor
   (`supabase/functions/notify-dispatch/index.ts:17-45`).

Importar 100 mil leads sem tratar isso significa 100 mil atribuições, 200 mil notificações e
uma enxurrada de WhatsApp para a equipe — a 3.000 leads/hora, por semanas.

**Sequência mínima obrigatória, nesta ordem:**

```
1. desligar os 10 jobs faceimob-* (cron.alter_job active := false)
2. ligar automation_settings.leads_paused = true          -- 2ª trava da roleta
3. carregar com status/funnel_stage EXPLÍCITOS (nunca deixar cair no default)
4. limpar as notifications e developer_submissions gerados pela carga
5. reativar os jobs
```

Passo 4 não é opcional: pausar o cron **não impede o gatilho de escrever a linha**. Ele só
adia a entrega. Religar o cron com a fila cheia entrega tudo de uma vez.

---

## 1. (a) Inventário completo dos gatilhos do schema `public`

85 gatilhos efetivos: 84 em `public` + 1 em `auth.users`. Extraídos com parser sobre todas as
migrations, aplicando `drop`/`create` na ordem cronológica.

Um gatilho foi **removido e não recriado**: `user_roles_partner_implica_admin`
(criado em `20260908930000_0093_socio_igual_admin.sql:82`, removido em
`20260909940000_0094_socio_sem_promocao_automatica.sql:46`). Não existe mais — não conte com
ele para promover sócio a admin durante a carga.

### 1.1 Legenda de risco

| Marca | Significado para a carga |
|---|---|
| **🔴 EXTERNO** | Produz efeito que sai do banco (notificação que vira WhatsApp/e-mail) |
| **🟠 CASCATA** | Escreve em outra tabela / dispara outros gatilhos / cria pontuação |
| **🟡 GUARDA** | Pode **abortar** o INSERT/UPDATE — mata o lote inteiro |
| **🔵 NORMALIZA** | Reescreve silenciosamente o valor que você mandou |
| ⚪ | `set_updated_at` — inócuo no INSERT (é `before update`) |

### 1.2 Gatilhos 🔴 EXTERNO — geram notificação que o cron entrega por WhatsApp/e-mail

| Gatilho | Tabela | Evento | Função | O que produz | Origem |
|---|---|---|---|---|---|
| `notify_lead_assigned` | `lead_assignments` | after insert | `notify_lead_assigned` | **2** linhas em `notifications`: `in_app` + **`whatsapp`**. Respeita `automation_settings.notify_on_assign` | trigger `0011:227`, fn `0032:237` |
| `notify_lead_timeout` | `lead_assignments` | after update of `released_at` (`when old.released_at is null and new.released_at is not null`) | `notify_lead_timeout` | **2** linhas: `in_app` + **`whatsapp`**. Só quando `release_reason='timeout'` | `20260907880000_0088_aviso_prazo_idempotente.sql:57` e `:170` |
| `notify_cca_case_created` | `cca_cases` | after insert | `notify_cca_case_created` | 1 `in_app` **para cada perfil ativo com papel `cca`** — N notificações por caso | `20260903650000_0065_notificacoes_crons.sql:283` e `:254` |
| `notify_whatsapp_unmatched` | `whatsapp_inbound_messages` | after insert | `notify_whatsapp_unmatched` | `in_app` para todo `sdr`+`admin` ativo, quando `outcome in ('unmatched','agent_error')`. Tem dedupe de 6 h por telefone | `20260906830000_0083_notificacoes_crons.sql:631` e `:586` |
| `notify_submission_gave_up` | `developer_submissions` | after update of `status, attempts` | `notify_submission_gave_up` | `in_app` para `requested_by` + todos os admins, quando `status='failed' and attempts>=5` | `0083:686` e `:647` |
| `public_links_notify_pin_rotation` | `public_links` | after insert or update | `public_links_notify_pin_rotation` | `in_app` para diretor/gerente da equipe **no INSERT também** (`tg_op='INSERT'`) | `20260906800000_0080_diario.sql:301` e `:239` |

> Nenhum gatilho chama `net.http_post` diretamente. Verificado: as únicas 6 ocorrências de
> `net.http_post` nas migrations estão dentro de `dispatch_pending_notifications()` e
> `dispatch_pending_submissions()`, que são chamadas **só pelo pg_cron**. Ou seja: o gatilho
> escreve a linha, o cron entrega. **Pausar o cron corta a saída externa; não corta a escrita.**

### 1.3 Gatilhos 🟠 CASCATA — escrevem em outras tabelas / pontuam

| Gatilho | Tabela | Evento | Função | Efeito | Origem |
|---|---|---|---|---|---|
| `deals_add_creator_participant` | `deals` | after insert | `deals_add_creator_participant` | Insere `deal_participants` com o papel efetivo de `created_by`. **Sai cedo se `lead_id is not null`** (deixa para o `convert_lead_to_deal`) **e se `created_by`/`auth.uid()` forem nulos** — é a válvula de escape da carga | trigger `0012:170`, fn `20260902150000_0053_pipeline_e2e.sql:98` |
| `deal_participants_autofill` | `deal_participants` | after insert | `deal_participants_autofill` | Ao inserir `role='broker'`, insere automaticamente o **gerente e o diretor** da equipe ativa mais recente do corretor, com `auto_added=true` | `20260903580000_0058_pipeline.sql:81` |
| `deal_participants_resplit` | `deal_participants` | after insert or delete | `deal_participants_resplit` → `recalc_deal_shares` | **Sobrescreve `share_pct` de todos**: zera gerente/diretor e divide 100 % igualmente entre os corretores, com ajuste de arredondamento no primeiro | trigger `0006:244`, fn `0058:31` |
| `deals_award_points` | `deals` | after insert **or update** | `deals_award_points` | No INSERT com `outcome='won'` pontua `venda` para cada corretor. Em UPDATE `won→lost/cancelled` pontua `distrato` | `20260903600000_0060_gamificacao.sql:342` e `:289` |
| `deal_participants_award_points` | `deal_participants` | after insert | idem | Se o negócio já é `won`, pontua `venda` para o corretor recém-inserido | `0060:374` e `:352` |
| `deal_participants_revoke_points` | `deal_participants` | after delete | idem | **Apaga** o `game_events` de `venda` da temporada e grava `deal_history` `game_points_revoked` | `0060:442` e `:389` |
| `deal_documents_award_points` | `deal_documents` | after insert | idem | Se o estágio do negócio é `incomplete`, pontua `incompleto_com_doc` | `0060:485` e `:453` |
| `cca_award_points` | `cca_cases` | after insert **or update** | `cca_award_points` | INSERT com `status='under_review'` → pontua `esteira`; `'approved'` → pontua `aprovado` | `20260906780000_0078_gamificacao.sql:133` e `:77` |
| `cca_cases_sync_esteira_label` | `cca_cases` | after insert or update | `cca_cases_sync_esteira_label` | **UPDATE em `deals.status_detail`** (`'13. ESTEIRA AGIL'`, `'RET. ESTEIRA AGIL'`, `'09. APROV. TOTAL'`, `'ANÁLISE EXTERNA'`). Em `pending_documents` também rebaixa `deals.document_review_status` para `'returned'`, grava `deal_history` e **notifica os corretores** | trigger `20260903590000_0059_cca_documentos.sql:245`, fn `20260906770000_0077_cca_documentos.sql:64` |
| `developer_submissions_advance_case` | `developer_submissions` | after insert | `developer_submissions_advance_case` | Move `cca_cases.status` para `sent_to_developer` quando a construtora é `flow='external'` → **cascateia** para `cca_cases_sync_esteira_label` e `cca_award_points` | `20260906770000_0077_cca_documentos.sql:351` e `:309` |
| `deal_documents_enforce_single` | `deal_documents` | before insert | idem | Se o `document_type` não tem `allows_multiple`, calcula `version = anterior+1` | `0006:311` e `:276` |
| `deal_documents_supersede` | `deal_documents` | after insert | idem | Marca `superseded_at`/`superseded_by` nas versões anteriores do mesmo tipo | `0006:343` e `:316` |
| `deal_documents_reopen_previous` | `deal_documents` | after delete | idem | Se sobrou nenhum vigente, reabre a versão mais alta restante | `0059:449` e `:415` |
| `tasks_sync_lead_deadline` | `tasks` | after insert or update of `due_at, status` | idem | **UPDATE em `leads.next_action_at`** com o menor `due_at` aberto | trigger `0011:152`, fn `20260903560000_0056_leads_roleta.sql:407` |
| `sdr_messages_touch` | `sdr_messages` | after insert | idem | UPDATE em `sdr_conversations.last_message_at` — **um UPDATE por mensagem** | `0008:143` e `:131` |
| `lead_assignments_count_miss` | `lead_assignments` | after update of `release_reason` | idem | UPDATE `leads.roulette_misses = +1` quando vira `'timeout'` | `20260906740000_0074_leads_roleta.sql:80` e `:62` |
| `leads_log_changes` | `leads` | after update | idem | Grava `lead_events` (`stage_changed`, `status_changed`) — só em UPDATE | `0005:607` e `:588` |
| `deals_log_changes` | `deals` | after update | idem | Grava `deal_history` (`stage_changed`, `value_changed`) — só em UPDATE | `0006:461` e `:439` |
| `cca_cases_log` | `cca_cases` | after update | idem | Grava `cca_case_events` **e** `deal_history` | `0007:219` e `:202` |
| `closed_months_log_reopen` | `closed_months` | after delete | idem | Grava `month_reopenings` | `20260906760000_0076_pipeline.sql:122` e `:108` |
| `on_auth_user_created` | `auth.users` | after insert | `handle_new_auth_user` | **SECURITY DEFINER**: cria `public.profiles` e concede `user_roles = 'broker'`, ambos com `on conflict do nothing` | `0002:371` e `:343` |

### 1.4 Gatilhos 🟡 GUARDA — abortam a operação

| Gatilho | Tabela | Evento | Aborta quando | Escapa por | Origem |
|---|---|---|---|---|---|
| `deals_guard_closed_month` | `deals` | **before insert or update** | `month_base` está em `closed_months` | `public.is_admin()` — que depende de `auth.uid()`; **service_role sem JWT NÃO passa** | `0010:51` e `:29` |
| `deals_guard_esteira_label` | `deals` | before insert or update of `status_detail` | rótulo `ESTEIRA AGIL`/`RET. ESTEIRA AGIL` escrito à mão | `current_user in ('postgres','service_role')` — **service_role passa** | trigger `0037:63`, fn `0059:113` |
| `deals_guard_document_review` | `deals` | before update | qualquer coluna `document_review_*` mudou | `current_user not in ('postgres','service_role')` — **service_role passa** | `20260810170000_0028_document_review.sql:75` e `:54` |
| `deals_guard_value` | `deals` | before update | `vgv_gross`/`discount_pct` mudaram sem `has_permission('deals.edit_value')` | **Não escapa por `current_user`**: `has_permission` cai em `auth.uid()`. service_role sem JWT é **bloqueado** | `20260903610000_0061_equipes_permissoes.sql:246` e `:229` |
| `deals_guard_stage` | `deals` | before update | estágio exige documento e não há; ou entra em `under_analysis/approved/contract/closed` sem `document_review_status='approved'`. As checagens de papel só rodam se `auth.uid() is not null` | Papel: sim (uid nulo). **Documento e conferência: não** | `0028:75` e `:82` |
| `leads_keep_next_action` | `leads` | before update of `next_action_at, status` | lead em atendimento perderia `next_action_at` | não escapa | `0074:456` e `:437` |
| `remarketing_contacts_normalize` | `remarketing_contacts` | before insert or update of `phone` | `normalize_phone` devolve NULL → **`raise exception` P0001** | não escapa | `0008:208` e `:194` |
| `user_roles_guard_last_admin` | `user_roles` | before delete or update | retiraria o último admin | não escapa | `0061:213` e `:178` |
| `work_shifts_guard` | `work_shifts` | before insert or update or delete | horários incoerentes (sempre); **sobreposição só se `current_user='authenticated'`** | service_role pula a checagem de sobreposição | `20260906750000_0075_checkin.sql:174` e `:102` |
| `allowed_ips_guard` | `allowed_ips` | before insert or update | `masklen(ip_range) = 0` (faixa `/0`) | não escapa | `0075:236` e `:217` |
| `sdr_agents_no_handoff_cycle` | `sdr_agents` | before insert or update of `handoff_to_agent_id` | ciclo de handoff ou cadeia > 50 | não escapa | `20260903640000_0064_sdr_automacao.sql:197` e `:172` |
| `distribution_groups_protect_general` | `distribution_groups` | before delete | tentar apagar a fila geral | não escapa | `0064:221` |
| `public_links_guard_columns` | `public_links` | before insert or update | remover PIN, remover `expires_at`, trocar `slug`, PIN sem hash bcrypt | não escapa | `0080:220` e `:170` |
| `profiles_guard_admin_columns` | `profiles` | **before update** | não-admin altera `status/email/bypass_ip_check/...` | `auth.role()='service_role'` passa em tudo **menos `bypass_ip_check`** | `0012:64`, fn `0061:73` |

### 1.5 Gatilhos 🔵 NORMALIZA — reescrevem o que você mandou (silenciosos)

| Gatilho | Tabela | Evento | Reescreve | Origem |
|---|---|---|---|---|
| `leads_normalize` | `leads` | before insert or update of `phone, phone_raw, full_name` | Copia `phone`→`phone_raw` se vazio; substitui `phone` por `normalize_phone()` (E.164 com DDI 55); faz `btrim(full_name)` | `0005:118` e `:104` |
| `deals_default_month_base` | `deals` | **before insert** | Se `month_base` é nulo **ou igual ao mês corrente**, substitui por `current_season_month()`. Mês histórico explícito passa intacto — é o comportamento documentado para importação | `20260821120000_0032_game_cycle_month.sql:82` e `:54` |
| `profiles_ensure_slug` | `profiles` | before insert or update of `full_name, slug` | Gera `slug` único a partir do nome (`slugify`), com sufixo `-2`, `-3`… | `0002:94` e `:60` |
| `teams_ensure_slug` | `teams` | before insert | idem, base `'equipe'` | `0002:163` e `:133` |
| `developers_ensure_slug` | `developers` | before insert | idem, base `'construtora'` | `0003:70` e `:42` |
| `distribution_groups_ensure_slug` | `distribution_groups` | before insert | idem, base `'grupo'` | `0004:167` e `:139` |

> Custo escondido dos `ensure_slug`: cada um faz um `while exists (select …)` no **próprio
> nome do slug**. Importar 50 mil `profiles` com nomes repetidos é O(n²) — 50 mil varreduras
> que crescem. Se houver homônimos em volume, **pré-calcule o slug no script** e mande
> preenchido: o gatilho retorna imediatamente quando `new.slug` não é nulo nem vazio
> (`0002:66-68`).

### 1.6 Os 38 ⚪ `set_updated_at`

Um por tabela com `updated_at`, todos `before update on … execute function public.set_updated_at()`
(`20260725120000_0001_foundation.sql:109`). Tabelas: `ad_campaigns`, `allowed_ips`,
`annual_results`, `automation_settings`, `cca_cases`, `cca_stages`, `daily_entries`,
`daily_reports`, `deal_clients`, `deals`, `developer_projects`, `developer_submissions`,
`developers`, `distribution_groups`, `document_types`, `funnel_targets`, `game_scoring_rules`,
`game_seasons`, `goals`, `gold_tips`, `important_notices`, `lead_comments`, `lead_sources`,
`leads`, `marketing_investments`, `pipeline_stages`, `profiles`, `public_links`,
`remarketing_lists`, `role_permissions`, `sdr_agents`, `sdr_conversations`, `tasks`, `teams`,
`useful_links`, `visits`, `whatsapp_templates`, `work_shifts`.

**Consequência prática:** são `before update`, não `before insert`. Logo o INSERT **preserva**
o `created_at`/`updated_at` que você mandar — os `Creation Date`/`Modified Date` do Bubble
entram intactos. Mas **qualquer UPDATE corretivo depois destrói o `updated_at` legado.**
Carregue certo de primeira; não conte com passe de correção.

---

## 2. (b) RPCs — o que o import poderia usar em vez de INSERT direto

O schema tem **135 funções em `public`**, das quais **49 são funções de gatilho** e 86 são
candidatas a RPC. Dessas, **57 têm `grant execute` nominal** nas migrations.

### 2.1 A conclusão que economiza tempo

**Praticamente nenhuma RPC de escrita serve para uma carga em massa por service_role.** Elas
foram escritas para a tela e verificam `auth.uid()` + papel. Sem JWT de um usuário real,
`is_admin()` = falso, `has_permission()` = falso, `has_any_role()` = falso.

| RPC | Por que **não** serve para a carga | Origem |
|---|---|---|
| `convert_lead_to_deal(uuid,uuid,uuid,text,numeric)` | Exige `is_admin() or v_owner = auth.uid() or manages_profile(v_owner)` — 42501 com service_role | `0028:144` |
| `set_profile_roles(uuid, app_role[])` | `if not public.is_admin() then raise` | `20260909940000_0094_socio_sem_promocao_automatica.sql:68` |
| `import_remarketing_list(text,uuid,uuid,jsonb)` | `security invoker` + `has_any_role('admin','marketing','sdr')` | `20260810200000_0031_sprint3_core_flows.sql:14` |
| `distribute_queued_lead(uuid)` | `has_permission('leads.view_queue')` | `0056:278` |
| `existing_lead_phones(text[])` | `has_any_role(admin/director/manager/marketing/sdr)` | `0056:491` |
| `review_deal_documents`, `submit_deal_for_manager_review`, `claim_lead`, `close_lead`, `close_month_and_season`, `create_public_link`, `set_public_link_pin`, `perform_checkin`, `perform_checkout` | todas exigem `auth.uid()` | várias |

### 2.2 As exceções que **funcionam** com service_role

| RPC | Por quê | Uso na carga | Origem |
|---|---|---|---|
| `submit_deal_for_analysis(uuid)` | Aceita explicitamente: `if auth.uid() is null and auth.role() <> 'service_role' then raise` | Colocar negócios legados na esteira **respeitando** as validações (documentos obrigatórios, construtora, conferência aprovada). Cria `cca_cases` + `developer_submissions` — **e isso dispara e-mail** | `0077:142`, grant `0028:558` |
| `assign_lead(uuid, boolean)` | `grant … to service_role` | Distribuir lead a lead, com controle | grant `0056:255` |
| `recalc_deal_shares(uuid)` | `grant … to service_role` | **Recalcular o rateio no fim da carga**, se você inseriu participantes com `deal_participants_resplit` desabilitado | grant `0019:54`, fn `0058:31` |
| `award_game_points(uuid,text,text,uuid,timestamptz)` | `grant … to service_role` | Repontuar histórico depois, com `occurred_at` retroativo, sem depender dos gatilhos | grant `0010:426`, fn `0078:149` |
| `assign_queued_leads()`, `release_expired_leads()`, `auto_checkout_expired()`, `mark_no_response_leads()`, `dispatch_pending_notifications()`, `dispatch_pending_submissions()` | `grant … to service_role`, revogadas de `authenticated` (`0023:55-62`) | **São os jobs.** Chamar à mão só para forçar um ciclo controlado | `0023` |

**Recomendação:** o import escreve por **INSERT direto** (a RLS é o único portão, e service_role
a bypassa). Use RPC apenas em duas situações: (i) `submit_deal_for_analysis` se quiser que o
banco valide a esteira em vez de você replicar a regra; (ii) `recalc_deal_shares` /
`award_game_points` no *pós-processamento*.

---

## 3. (c) pg_cron — os 10 jobs e quais reagem a dado novo

Todos os jobs têm prefixo `faceimob-` (o alerta de falha depende disso:
`jobname like 'faceimob-%'`, `0083:346`).

| Job | Cadência | Comando | Reage a dado novo? | Onde é agendado |
|---|---|---|---|---|
| `faceimob-release-expired-leads` | **30 s** (fallback 1 min) | `release_expired_leads()` | **SIM** — varre `leads` com `status='assigned'` e `attend_deadline < now()`; libera, grava `lead_events`, e **redistribui** (`assign_lead`) | `20260731120000_0013_cron_scheduling.sql:95` e `:103`; fn `0005:496` |
| `faceimob-assign-queued` | 1 min | `assign_queued_leads()` | **SIM, o mais perigoso** — pega até 50 leads `queued` por rodada e os distribui | `20260808130000_0020_core_fixes.sql:346`; fn `0074:482` |
| `faceimob-notify-dispatch` | 1 min | `dispatch_pending_notifications()` | **SIM** — se existe `notifications` com `channel='whatsapp' and sent_at is null`, faz `net.http_post` para a edge function. Antes disso roda `expire_stale_outbound_notifications()` (descarta > 2 h e **avisa o admin sobre o descarte**) | `20260802150000_0018_notification_dispatch_job.sql:94`; fn `0083:211` e `:109` |
| `faceimob-submission-dispatch` | 1 min | `dispatch_pending_submissions()` | **SIM** — se existe `developer_submissions` `queued` (ou `failed`/`sending` parado > 10 min, `attempts<5`), chama `submission-dispatch` → **e-mail para a construtora** | `0020:357`; fn `0059:460` |
| `faceimob-mark-no-response` | 5 min | `mark_no_response_leads()` | **SIM** — leads em `funnel_stage='first_contact'` e `status in ('attending','in_progress')` parados há `no_response_hours` (padrão 24) viram `no_response` **e notificam o corretor** | `20260901130500_0043_lead_automation_rules.sql:169`; fn `:93` |
| `faceimob-auto-checkout-expired` | 1 min | `auto_checkout_expired()` | **SIM** — fecha `checkins` com `checked_out_at is null` de dias anteriores. **Um import de ponto histórico sem `checked_out_at` é reescrito no minuto seguinte** | `0013:117`; fn `20260903570000_0057_checkin.sql:154` |
| `faceimob-task-due` | 07:40 e 13:40 | `notify_due_tasks()` | **SIM** — `tasks` `open` vencidas nos últimos 7 dias geram `in_app` para o responsável. Tarefa vencida há mais de 7 dias é ignorada de propósito | `0083:730`; fn `:416` |
| `faceimob-public-link-expiry` | 08:25 | `notify_expiring_public_links()` | Sim, mas só sobre `public_links` — irrelevante para carga do Bubble | `20260903620000_0062_diario.sql:993` |
| `faceimob-cron-failure-alert` | de hora em hora (min 15) | `notify_cron_failures()` | Não a dado novo. Avisa admin+diretoria quando um `faceimob-*` **falha** (`status <> 'succeeded'` nas últimas 6 h) | `0083:716`; fn `:318` |
| `faceimob-purge-cron-history` | 03:10 | `delete from cron.job_run_details …` | Não | `0013:129` |

**Job desativado não gera alerta de falha.** Verificado: `notify_cron_failures` só olha
`cron.job_run_details` com `status <> 'succeeded'` (`0083:345-349`); job inativo não produz
linha de execução. Pausar é seguro do ponto de vista de ruído.

**Armadilha do reset:** a migration `0065` **reativa** `faceimob-notify-dispatch`
incondicionalmente (`20260903650000_0065_notificacoes_crons.sql:462-479`). Se você pausar os
jobs e depois rodar `npm run db:reset` / reaplicar migrations, esse job volta ligado sozinho.

**Pausar / religar (rodar como `postgres`):**

```sql
-- pausar tudo
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';
update public.automation_settings set leads_paused = true where id;

-- conferir
select jobname, schedule, active from cron.job where jobname like 'faceimob-%' order by jobname;

-- religar (depois de limpar as filas — ver §9)
select cron.alter_job(jobid, active := true) from cron.job where jobname like 'faceimob-%';
update public.automation_settings set leads_paused = false where id;
```

> `leads_paused` é a **segunda trava**, independente do cron: `assign_lead` retorna `null`
> quando ela está ligada (`0074:105`, bloco `if coalesce(v_paused,false) then return null`).
> Ligue as duas — cinto e suspensório. Se alguém religar o cron por engano, `leads_paused`
> ainda segura a roleta.

---

## 4. (d) Edge functions — quais existem e quem as aciona

9 funções em `supabase/functions/` + `_shared/`.

| Função | Acionada por | Efeito externo | `verify_jwt` |
|---|---|---|---|
| `notify-dispatch` | **pg_cron** via `dispatch_pending_notifications()` → `net.http_post` | **Envia WhatsApp** (Cloud API). Lote de 50, máx. 5 tentativas por linha | padrão (exige JWT/service key) |
| `submission-dispatch` | **pg_cron** via `dispatch_pending_submissions()` → `net.http_post` | **Envia e-mail** ao contato da construtora (Brevo) | padrão |
| `meta-ads-webhook` | Webhook da Meta (externo) | Cria `leads` com `external_id = leadgen_id` (`supabase/functions/meta-ads-webhook/index.ts:249`) | `false` (`supabase/config.toml:43`) |
| `voice-ai-webhook` | Webhook da plataforma de voz (externo) | Cria/atualiza `leads` por `external_id` (`voice-ai-webhook/index.ts:84-146`) | `false` (`config.toml:49`) |
| `whatsapp-inbound-webhook` | Webhook da Meta (assinatura `X-Hub-Signature-256`) | Grava `whatsapp_inbound_messages` → dispara `notify_whatsapp_unmatched` | `false` (`config.toml:54`) |
| `sdr-agent-chat` | Front (`invoke("sdr-agent-chat")`) | Chama LLM | padrão |
| `sdr-whatsapp-broadcast` | Front (`invoke("sdr-whatsapp-broadcast")`) | Envia WhatsApp em massa | padrão |
| `broker-checkin` | Front (`invoke("broker-checkin")`) | — | padrão |
| `provision-broker-user` | Front, via `fetch` direto (`src/components/BrokerEditModal.tsx:88`, `src/components/equipes/NewPersonDialog.tsx:95`) | Cria usuário no Auth + envia e-mail de acesso | padrão |

**Nenhuma edge function é acionada por trigger de banco.** As duas que o banco aciona
(`notify-dispatch`, `submission-dispatch`) são chamadas **pelo cron**, não pelo gatilho. É por
isso que pausar o cron é suficiente para cortar o efeito externo durante a carga.

**Os três webhooks com `verify_jwt = false` continuam abertos durante a carga.** Se a Meta
mandar um lead novo enquanto você importa, ele entra `queued` e fica na fila. Não é problema —
mas conte com isso ao auditar o delta pós-carga.

---

## 5. (e) RLS — a estratégia da carga

### 5.1 O modelo

- **62 tabelas em `public`, todas com RLS ligada** (contado por parser sobre
  `alter table … enable row level security`). Confere com o `CLAUDE.md`.
- **Não existe `force row level security` em lugar nenhum** — verificado por grep em todas as
  86 migrations, zero ocorrências.
- Os GRANTs de tabela existem e são explícitos:
  `grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role`
  (`20260808160000_0023_role_grants.sql:30-32`), com `alter default privileges` para objetos
  futuros (`:66-72`).
- O modelo declarado é: **"o GRANT abre a porta da tabela e o RLS é o porteiro"**
  (`0023:19-21`).

### 5.2 `service_role` bypassa RLS? Sim.

O papel `service_role` do Supabase tem o atributo `BYPASSRLS`. O próprio harness do projeto o
recria assim: `create role service_role nologin noinherit bypassrls`
(`supabase/tests/00_supabase_stubs.sql:20`). Como **não há `force row level security`**, o
bypass vale integralmente — inclusive para o dono das tabelas.

### 5.3 Mas o bypass **não** te livra dos gatilhos

Esta é a parte que morde. Os gatilhos são `SECURITY DEFINER` na maioria e rodam sempre.
Três comportamentos distintos:

| Padrão de checagem | Quem escapa | Gatilhos que usam |
|---|---|---|
| `current_user in ('postgres','service_role')` | **service_role e psql-como-postgres escapam** | `deals_guard_esteira_label` (`0059:121`), `deals_guard_document_review` (`0028:67`) |
| `auth.role() = 'service_role'` | **service_role escapa** (parcialmente) | `profiles_guard_admin_columns` (`0061:85` — escapa em tudo menos `bypass_ip_check`), `submit_deal_for_analysis` (`0077:164`) |
| `is_admin()` / `has_permission()` / `has_any_role()` | **service_role NÃO escapa** (dependem de `auth.uid()`, que é nulo) | `deals_guard_closed_month` (`0010:33`), `deals_guard_value` (`0061:233`) |

Detalhe fino documentado no repo: `deals_guard_esteira_label` **não é `security definer` de
propósito**, exatamente para que `current_user` continue sendo o chamador — a migration
`20260902130000_0051_deal_status_bare_grant.sql:22-25` explica que torná-la definer faria o
escape liberar para todo mundo.

### 5.4 Papel necessário para a carga

**Duas opções, ambas legítimas neste projeto:**

| Papel | Como | RLS | `current_user`-guards | `is_admin()`-guards |
|---|---|---|---|---|
| `service_role` (PostgREST, chave de serviço) | `SUPABASE_SERVICE_ROLE_KEY` no `process.env` — o padrão do repo (`.env.example`, seção "Variáveis de servidor") | bypassa | escapa | **bloqueado** |
| `postgres` (psql direto via pooler) | `scripts/seed-database.ps1` já faz isso | bypassa | escapa | **bloqueado** (mesmo motivo: `auth.uid()` nulo) |

Nenhum dos dois é "admin" para os gatilhos que consultam `user_roles`. Consequência concreta:

- **`deals_guard_closed_month` bloqueia INSERT de negócio cujo `month_base` esteja em
  `closed_months`.** Se você importar histórico depois de fechar meses, cada linha falha com
  `P0001 "O mês MM/YYYY está fechado"`. Solução: **importe antes de fechar mês**, ou esvazie
  `closed_months` durante a carga e repopule depois.
- **`deals_guard_value` bloqueia UPDATE de `vgv_gross`/`discount_pct`.** É `before update`
  apenas — o INSERT passa. Não faça passe corretivo de valor por service_role.

**Se precisar mesmo de contexto de admin**, dá para injetar o JWT de um usuário admin no
cliente supabase-js (`Authorization: Bearer <jwt do admin>`) — aí `auth.uid()` resolve e
`is_admin()` retorna verdadeiro. Mas então você **perde o bypass de RLS** e passa a depender
das policies. Consequência: mais lento, mais frágil, e as policies de escrita nem sempre
permitem o que a carga precisa. **Não recomendo.** Prefira ajustar o dado (não fechar mês
antes de importar) a ajustar o papel.

---

## 6. (f) Caminho técnico recomendado para volume

### 6.1 O que o repo já tem

O projeto **já resolveu isto uma vez**, para a importação de planilha de leads:

```ts
// src/integrations/supabase/leads.ts:505
export const IMPORT_CHUNK_SIZE = 200;

// src/integrations/supabase/leads.ts:528-553
export async function createLeads(inputs, onProgress) {
  for (let start = 0; start < inputs.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = inputs.slice(start, start + IMPORT_CHUNK_SIZE);
    const { data, error } = await db.from("leads").insert(chunk.map(leadInsertRow)).select("id");
    if (error) throw dbError(/* diz quantos entraram e a partir de qual linha falhou */);
    saved += (data || []).length;
    onProgress?.(saved, inputs.length);
  }
}
```

O comentário em `leads.ts:520-527` documenta exatamente por que não é um INSERT único: 5.000
linhas numa requisição travavam a aba e um único CHECK derrubava tudo sem dizer onde.

E o projeto **também já tem psql**, ao contrário do que o briefing supôs: `scripts/seed-database.ps1`
roda `psql` dentro de um contêiner `postgres:15-alpine` com bind-mount do workspace, contra o
pooler do Supabase (`scripts/seed-database.ps1:28-45`). `scripts/validate-schema.sh:60-64` faz o
mesmo padrão contra um Postgres descartável. **Não é preciso instalar nada** — só Docker, que
já é pré-requisito do `validate-schema.sh`.

### 6.2 Recomendação

**Para centenas de milhares de linhas: `COPY … FROM STDIN` via Docker + psql, com staging.**
Reaproveita o padrão de `seed-database.ps1`, e é a única opção que não vira dezenas de milhares
de round-trips HTTP.

Desenho mínimo:

```
1. Python (parser csv real, streaming) → arquivo TSV/CSV limpo por tabela
2. docker run --rm -i postgres:15-alpine psql … -c "\copy stg_leads from stdin csv"
3. INSERT … SELECT de stg_* para public.*, com ON CONFLICT DO NOTHING
```

Por que staging e não `\copy` direto na tabela final: `COPY` **dispara gatilhos de linha
normalmente** (só `COPY … FREEZE` e `TRUNCATE` fogem). Com staging você faz um `insert … select`
único por tabela, dentro de uma transação, e controla a ordem — e pode conferir a contagem antes
de promover.

**Alternativa aceitável (mais simples, mais lenta): supabase-js em lote de 200.** Reaproveite
literalmente o formato do `createLeads`: chunk de 200, `.select("id")` para contar, e erro que
diz a partir de qual linha o lote falhou. A 200 linhas/requisição, 300 mil linhas = 1.500
requisições. É viável, leva minutos, e o feedback de erro é muito melhor. **Use esta se o
volume real ficar abaixo de ~100 mil linhas por tabela.**

**Não use RPC para volume.** Nenhuma RPC do projeto aceita array de linhas, e as de escrita
exigem `auth.uid()` (§2).

### 6.3 Desligar os gatilhos durante o `insert … select`?

`alter table … disable trigger user` existe e resolveria o custo dos gatilhos de cascata.
**Não recomendo em geral**, por dois motivos:

- Desligar `leads_normalize` deixa `phone` **fora do formato E.164 que o resto do sistema
  assume** — `existing_lead_phones` compara com `normalize_phone()` (`0056:491`), a dedupe
  quebra, e o WhatsApp não acha o número. Normalize no script, ou deixe o gatilho.
- Desligar `deal_participants_resplit` é a exceção **defensável**: se você já traz `share_pct`
  do legado, o gatilho sobrescreve tudo por divisão igual. Desligue-o, carregue, e rode
  `recalc_deal_shares` só nos negócios que deviam mesmo ser igualitários — ou nenhum.

Se desligar, **religue na mesma transação** e prove que religou:

```sql
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public.deal_participants'::regclass and not tgisinternal;
-- tgenabled = 'O' (origin) é o estado normal; 'D' é desabilitado
```

---

## 7. (g) Idempotência — como o repo faz e qual chave usar

### 7.1 O padrão do projeto

Os 9 seeds usam **107 `on conflict`**, sendo **102 `on conflict do nothing`** (contado por
grep em `supabase/seeds/`). O padrão completo tem três partes:

1. **UUID determinístico escrito à mão**, não `gen_random_uuid()`. Ex.: os 14 usuários de seed
   são `10000000-0000-0000-0000-00000000000N` (`supabase/seeds/010_identity_and_teams.sql:11-24`).
2. **`where not exists`** para tabelas sem constraint única útil
   (`010_identity_and_teams.sql:62`).
3. **`on conflict … do nothing`** onde há chave natural.

Reproduza isso: **derive o UUID do `unique id` do Bubble** (ex.: `uuid5` de um namespace fixo +
o id do Bubble). Assim reimportar o mesmo CSV é uma no-op, e você mantém a rastreabilidade
sem coluna nova.

### 7.2 Chave natural por tabela (o que pôr no `on conflict`)

Levantado dos `create unique index` e das constraints inline.

| Tabela | Chave natural para `on conflict` | Origem |
|---|---|---|
| `profiles` | `(id)` (= `auth.users.id`); alternativas: `email` unique, `cpf` unique parcial | `0002:28-33`; `0046:70` |
| `user_roles` | `(profile_id, role)` — PK | `0002:101` |
| `teams` | `(slug)` unique | `0002:115` |
| `team_members` | `(profile_id) where left_at is null` — **só uma equipe ativa por pessoa** | `0002:183` |
| `developers` | `(name)` e `(slug)`, ambas unique | `0003:20` |
| `developer_projects` | `(developer_id, name)` | `0003:77` |
| `pipeline_stages` | `(code)` | `0003:100` |
| `document_types` | `(code)` | `0003:163` |
| `lead_sources` | `(code)`; também `(form_id) where form_id is not null` | `0003:189`, `:201` |
| `work_shifts` | `(code)` | `0004:17` |
| `distribution_groups` | `(slug)` | `0004:122` |
| `distribution_group_members` | `(group_id, profile_id)` — PK | `0004:171` |
| `distribution_group_forms` | `(group_id, form_id)` PK; **e `(form_id)` unique global** | `0004:184`, `:194` |
| `checkins` | `(profile_id, work_date, shift_id)` | `0004:94` |
| **`leads`** | **`(external_id) where external_id is not null`** — a única. Não há unique em telefone nem e-mail | `0005:83` |
| `lead_assignments` | `(lead_id) where released_at is null` — só uma atribuição aberta | `0005:145` |
| `lead_attachments` | `(storage_path)` unique | `0005:191` |
| `deals` | `(code)` unique | `0006:27` |
| `deal_clients` | `(deal_id, ordinal)`, com `ordinal in (1,2)` | `0006:83`, check `:86` |
| `deal_participants` | `(deal_id, profile_id, role)` | `0006:126` |
| `deal_documents` | `(storage_path)` unique | `0006:256` |
| `cca_cases` | `(deal_id)` unique — **um caso por negócio** | `0007:16` |
| `whatsapp_templates` | `(name)` | `0008:53` |
| `remarketing_contacts` | `(list_id, phone)` | `0008:170` |
| `sdr_messages` | `(provider_message_id) where not null` | `0008:127` |
| `daily_reports` | `(team_id, report_date)` | `0009:16` |
| `daily_entries` | `(report_id, profile_id)` | `0009:40` |
| `funnel_targets` | 3 índices parciais por `scope`: `(effective_from)`, `(team_id, effective_from)`, `(director_id, effective_from)` | `0009:89-93` |
| `public_links` | `(slug)` | `0009:107` |
| `closed_months` | `(period)` — PK | `0010:20` |
| `game_events` | `(season_id, profile_id, event_code, ref_id) where ref_id is not null` | `0010:121` |
| `game_scoring_rules` | `(event_code) where season_id is null` / `(season_id, event_code)` | `0010:96-98` |
| `game_season_results` | `(season_id, profile_id)` — PK | `0010:131` |
| `marketing_investments` | `(developer_id, period)` | `0011:20` |
| `ad_campaigns` | `(platform, external_id)` **e `(external_id)` unique global** desde a 0067 | `0011:45`; `20260904631500_0067:27` |
| `goals` | 3 índices parciais por `scope` | `0011:87-91` |
| `annual_results` | `(year, month)` | `0012:306` |
| `allowed_ips` | `(ip_range, coalesce(team_id, '0000…'))` | `0075:210` |
| `whatsapp_inbound_messages` | `(provider_message_id)` | `0083:507` |
| `role_permissions` | `(role, permission)` — PK | `0002:388` |
| `stage_permissions` | `(stage_id, role)` — PK | `0003:130` |
| `permissions` | `(code)` — PK | `0002:381` |
| **Sem chave natural** (só o PK): `lead_events`, `lead_comments`, `deal_history`, `cca_case_events`, `visits`, `tasks`, `notifications`, `developer_submissions`, `sdr_conversations`, `month_reopenings`, `role_change_log`, `access_provision_log` | **Use UUID determinístico derivado do id do Bubble.** Sem isso, reimportar duplica tudo | — |

### 7.3 O gancho de rastreabilidade: `leads.external_id`

`leads.external_id` é a **única chave natural de `leads`** e já é usada por dois webhooks: o
`meta-ads-webhook` grava o `leadgen_id` (`meta-ads-webhook/index.ts:249`) e o `voice-ai-webhook`
faz idempotência por ele (`voice-ai-webhook/index.ts:27-28`).

**Prefixe o id do Bubble** — `bubble:1715462324608x711409717943992300` — para que uma colisão
teórica com um `leadgen_id` numérico da Meta seja impossível. Custa nada e o índice é único
global.

**Não existe unique em `leads.phone`.** A dedupe é feita **fora do banco**, pela RPC
`existing_lead_phones` chamada pela tela antes de importar (`leads.ts:563-573`). Um import por
service_role **não pode usar essa RPC** (§2.1) — replique a lógica no script:
`normalize_phone` é `10/11 dígitos → '55'+d; 12/13 começando com 55 → d; senão d`
(`0001:125`).

---

## 8. (h) Ambiente de ensaio

### 8.1 O que existe

| Ambiente | Como | pg_cron | pg_net | `auth.users` real | Storage | Serve para |
|---|---|---|---|---|---|---|
| **`./scripts/validate-schema.sh --all`** | Docker `postgres:15-alpine`, aplica as 86 migrations + seeds + 47 asserts. Sem CLI do Supabase | **stub** (`tests/00_supabase_stubs.sql:105-152`) — jobs registram, **nunca executam** | ausente | tabela stub com 4 colunas (`stubs:57-63`) | ausente | **Provar constraints, checks, FKs e gatilhos de guarda.** Não prova cron nem entrega |
| **`npm run db:start` + `npm run db:reset`** | Stack local completa da CLI do Supabase | **real** — os jobs rodam | disponível | real | real | Ensaio de ponta a ponta, incluindo o comportamento do cron |
| **Remoto (`mcmqgxvtwegtptfseqvw`)** | `npm run db:seed:remote` via Docker+psql no pooler | real | real | real | real | Só a carga final |

**Não há branch de preview do Supabase em uso.** Verificado: `supabase/config.toml` tem apenas
`project_id`, `[auth]`, `[db.seed]` e três blocos `[functions.*]` — nenhuma seção de branching,
e nenhuma menção a branch em `docs/`, `scripts/` ou `README.md`.

### 8.2 Ambiente de ensaio proposto

**Ensaio em duas camadas, nesta ordem.**

**Camada 1 — `validate-schema.sh --keep` (rápida, barata, sem Docker Compose).**

```bash
./scripts/validate-schema.sh --seed --keep
# container fica de pé: docker exec -i faceimob-schema-check psql -U postgres
# carregue um recorte de 5-10 mil linhas por tabela e conte os erros
```

Por que primeiro: é onde os **guardas** aparecem (`deals_guard_closed_month`,
`remarketing_contacts_normalize`, os CHECKs de `deal_clients.ordinal`, `funnel_targets_scope_*`).
É a camada que responde *"meu CSV mapeado cabe no schema?"* em minutos, sem risco nenhum. E o
`service_role` do harness já nasce com `bypassrls`, então o teste de papel é fiel.

Limite honesto: **não prova nada sobre cron nem sobre entrega**. O stub registra o job e não o
executa (`stubs:128-145`). Nenhum WhatsApp sairá — o que é bom para o ensaio e péssimo como
prova de segurança.

**Camada 2 — stack local (`npm run db:start` / `db:reset`), com os jobs pausados.**

```bash
npm run db:reset          # migrations + seeds
# imediatamente depois, PAUSAR (a 0065 religa notify-dispatch ao aplicar migrations!)
psql "$LOCAL_DB_URL" -c "select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';"
psql "$LOCAL_DB_URL" -c "update public.automation_settings set leads_paused = true where id;"
# carga do recorte completo
# medir: select count(*) from notifications where sent_at is null;
```

Por que segundo: é o único lugar onde você mede **o volume de efeito colateral** — quantas
`notifications`, quantos `game_events`, quantos `deal_participants` auto-adicionados sua carga
produz. Esse número é o que decide se o passo de limpeza (§9) é uma query ou um problema.

**Não use o remoto como ensaio.** O remoto tem `functions_url` e `service_role_key` cadastrados
no cofre (`private.integration_credentials`) — é a configuração exata que faz
`dispatch_pending_notifications` sair do `return` antecipado e chamar a edge function
(`0083:222-227`). Um ensaio lá com o cron ligado manda WhatsApp de verdade.

---

## 9. Armadilhas — a lista que custa caro esquecer

**Colunas e defaults**

1. **`deals.vgv_net` é `generated always as (…) stored`** (`0006:45-46`). Incluí-la no INSERT
   dá erro `428C9`. O snapshot em `SCHEMA_ALVO.md:43` a lista como coluna normal — mapear
   1:1 pelo snapshot **quebra**. Mande só `vgv_gross` e `discount_pct`.
2. **`deals.code` tem `default nextval('deal_code_seq')`** (`0006:20`, `:27`). Se você
   importar códigos legados explícitos, a sequence **não avança** e o primeiro negócio criado
   pela tela colide com `NEG-000001`. Ou deixe o default gerar (guardando o código legado em
   `notes`/`status_detail`), ou rode
   `select setval('public.deal_code_seq', (select max(…)));` no fim.
3. **`leads.status` default `'queued'`** (`0005:51`) e **`funnel_stage` default `'new'`**
   (`0005:52`). Omitir = entrar na roleta. **Mande sempre explícito.**
4. **`deals.month_base` default `month_start(current_date)`** + gatilho que o substitui por
   `current_season_month()` quando é igual ao mês corrente (`0032:64-70`). Mês histórico
   explícito passa intacto; mês corrente é reescrito.
5. **`deal_clients.ordinal` só aceita 1 ou 2** (`0006:86`). Negócio legado com 3+ compradores
   **perde dados**. Decida antes: truncar, ou concatenar no `full_name` do ordinal 2.
6. **`deal_participants.ordinal` só aceita 1 a 3** (`0025:32`). E o front lê **no máximo 3
   corretores e 3 gerentes** por negócio (`src/integrations/supabase/newSchema.ts:443-457`).
   O 4º participante entra no banco e some da tela.

**Ordem de carga (FK)**

7. Ordem topológica calculada a partir das FKs (`references public.*`):
   ```
   nível -1  auth.users                        (profiles.id → auth.users(id) on delete cascade)
   nível 0   cca_stages, developers, distribution_groups, document_types, lead_sources,
             permissions, pipeline_stages, profiles, useful_links, whatsapp_templates, work_shifts
   nível 1   ad_campaigns, annual_results, automation_settings, checkins, closed_months,
             developer_projects, distribution_group_forms, distribution_group_members,
             game_seasons, gold_tips, important_notices, leads, marketing_investments,
             month_reopenings, notifications, role_change_log, role_permissions, sdr_agents,
             stage_permissions, tasks, teams, user_roles, access_provision_log
   nível 2   allowed_ips, daily_reports, deals, funnel_targets, game_events, game_scoring_rules,
             game_season_results, goals, lead_assignments, lead_attachments, lead_comments,
             lead_events, public_links, remarketing_lists, sdr_conversations, team_members
   nível 3   cca_cases, daily_entries, deal_clients, deal_documents, deal_history,
             deal_participants, developer_submissions, remarketing_contacts, sdr_messages,
             visits, whatsapp_inbound_messages
   nível 4   cca_case_events
   ```
   Grafo **sem ciclos** — não precisa de constraint deferrable.
8. **`profiles.id` referencia `auth.users(id)`** (`0002:28`). Importar pessoa **exige criar o
   usuário no Auth primeiro**. O caminho da aplicação é `provision-broker-user` (uma pessoa por
   vez, com e-mail); o caminho do seed é INSERT direto em `auth.users` com
   `banned_until` no futuro (`010_identity_and_teams.sql:26-61`). Para volume, use o padrão do
   seed — e note que `on_auth_user_created` (`0002:371`) **já cria o `profiles` e o papel
   `broker`**, com `on conflict do nothing`. Contar com ele ou não: decida uma vez.
9. **`enable_signup = false`** (`supabase/config.toml:11`) — nenhum caminho da aplicação cria
   conta. A carga é a única fonte.

**Segurança e segredos**

10. **A coluna `senha_temporaria` do CSV de Users do Bubble contém senha em texto claro.**
    Não existe coluna de senha em `public.profiles` — nem deve existir. **Não a importe, não
    a registre em log, não a escreva em arquivo intermediário.** Se ela chegar num arquivo de
    staging no disco, apague o arquivo. As contas nascem no Auth com senha aleatória
    (`extensions.crypt(gen_random_uuid()::text, …)`, `010:49`) e o acesso vem por
    `provision-broker-user` ou magic link.
11. **CPF, PIS, telefone, e-mail e endereço** entram em `profiles` e `deal_clients`. Ambas com
    RLS. `profiles.cpf` tem unique parcial (`0046:70`) — CPF duplicado no legado **derruba o
    lote**. Deduplique antes.
12. Fuso: os CSVs do Bubble não declaram fuso. Assumir `America/Sao_Paulo` é a suposição
    conservadora e é o fuso que o banco usa em todo lugar (`at time zone 'America/Sao_Paulo'`
    aparece em `auto_checkout_expired` `0057:167`, `notify_due_tasks` `0083:424`,
    `notify_lead_assigned` `0032:258`). **Converta para UTC no script** — as colunas são
    `timestamptz`. Registre a suposição no relatório da carga.

**Efeitos colaterais que sobrevivem ao cron pausado**

13. Pausar o cron **não impede o gatilho de escrever**. Depois da carga, **antes de religar**,
    limpe:
    ```sql
    -- 1. quanto foi produzido?
    select channel, count(*) from public.notifications
     where sent_at is null and created_at >= :inicio_da_carga group by channel;
    select status, count(*) from public.developer_submissions
     where created_at >= :inicio_da_carga group by status;

    -- 2. neutralizar a fila de saída SEM apagar histórico
    update public.notifications
       set sent_at = now(), last_error = 'descartada: carga de dados legados'
     where channel <> 'in_app' and sent_at is null and created_at >= :inicio_da_carga;

    -- 3. cancelar envios de dossiê gerados pela carga
    update public.developer_submissions
       set status = 'cancelled'
     where status = 'queued' and created_at >= :inicio_da_carga;
    ```
    O `status='cancelled'` é valor válido do CHECK (`0007:66`). E marcar `sent_at` é
    exatamente o que `expire_stale_outbound_notifications` faria sozinho depois de 2 h
    (`0083:109-140`) — **mas ela avisa o admin sobre o descarte**, e você não quer esse aviso
    multiplicado pela carga. Marcar antes evita o aviso.
14. **`game_events`** produzidos pelos gatilhos de pontuação usam `current_game_season()`, que é
    a temporada **aberta hoje** (`0010:148`) — não a temporada do mês do negócio legado.
    Importar vendas históricas com `outcome='won'` **infla o placar da temporada corrente**.
    Duas saídas: (i) carregar com a temporada fechada (`award_game_points` descarta e emite um
    `raise warning`, mas **grava uma notificação `game_paused` por pessoa**, `0078:158-190`);
    ou (ii) desabilitar os 4 gatilhos `*_award_points` durante a carga e repontuar depois com
    `award_game_points(..., p_occurred := <data legada>)`. **A segunda é a correta.**
15. **`deal_participants_resplit` sobrescreve `share_pct`.** Se o rateio legado não for
    igualitário, ele se perde silenciosamente (`0058:31`). Desabilite o gatilho durante a
    carga de `deal_participants`, ou aceite a divisão igual.
16. **`deal_participants_autofill` insere gerente e diretor sozinho** ao ver um corretor
    (`0058:81`). Se o legado já traz esses participantes, você ganha duplicatas — evitadas pelo
    `on conflict (deal_id, profile_id, role) do nothing`, mas **com `auto_added=true`** ou
    `false` dependendo de quem chegou primeiro. Carregue os corretores por último, ou desabilite.
17. **`checkins` sem `checked_out_at`** são fechados por `auto_checkout_expired()` no minuto
    seguinte, com `auto_checkout=true` (`0057:154`). Ponto histórico importado precisa vir com
    `checked_out_at` preenchido.

**Ambiente**

18. **`npm run db:reset` religa `faceimob-notify-dispatch`** (`0065:462-479`). Toda reaplicação
    de migration desfaz a pausa. Reponha a pausa **imediatamente** após qualquer reset.
19. `npx tsc --noEmit` na raiz não checa nada (`tsconfig.json` com `"files": []`). Se o import
    for um script TS, valide com `npm run typecheck`.

---

## 10. Checklist executável da carga

```
[ ] 1. Ensaio camada 1: ./scripts/validate-schema.sh --seed --keep + recorte de 5k linhas
[ ] 2. Ensaio camada 2: npm run db:reset, pausar jobs, carga do recorte completo, medir
       select channel, count(*) from notifications where sent_at is null group by channel
[ ] 3. PRODUÇÃO — pausar:
       select cron.alter_job(jobid, active := false) from cron.job where jobname like 'faceimob-%';
       update public.automation_settings set leads_paused = true where id;
[ ] 4. Conferir: select jobname, active from cron.job where jobname like 'faceimob-%';
       (esperado: 10 linhas, todas active = false)
[ ] 5. Esvaziar closed_months (guardar o conteúdo) se for importar meses fechados
[ ] 6. Desabilitar os gatilhos de pontuação e de rateio:
       alter table public.deals             disable trigger deals_award_points;
       alter table public.cca_cases         disable trigger cca_award_points;
       alter table public.deal_participants disable trigger deal_participants_award_points;
       alter table public.deal_documents    disable trigger deal_documents_award_points;
       alter table public.deal_participants disable trigger deal_participants_resplit;
       alter table public.deal_participants disable trigger deal_participants_autofill;
[ ] 7. Carga na ordem topológica (§9.7), com UUID determinístico + on conflict do nothing
[ ] 8. Reabilitar os 6 gatilhos (alter table … ENABLE trigger …) e PROVAR:
       select tgname, tgenabled from pg_trigger where not tgisinternal and tgenabled <> 'O';
       (esperado: zero linhas)
[ ] 9. Pós-processar: recalc_deal_shares onde couber; award_game_points com occurred_at legado
[ ] 10. Limpar as filas (§9.13) ANTES de religar
[ ] 11. Repopular closed_months
[ ] 12. Religar cron + leads_paused = false
[ ] 13. Observar 15 min: notification_queue_health() e cron_jobs_health()
```

---

## Anexo — comandos usados para produzir este relatório

```bash
ls supabase/migrations | wc -l                       # 86
# 85 gatilhos efetivos, 38 set_updated_at, 47 com lógica — parser Python aplicando
#   drop/create em ordem cronológica sobre todas as migrations
# 62 tabelas com RLS — parser sobre "alter table … enable row level security"
# 135 funções em public, 49 de gatilho, 57 com grant execute nominal
# 0 ocorrências de "force row level security"
# 6 ocorrências de net.http_post, todas em dispatch_pending_{notifications,submissions}
grep -c 'on conflict' supabase/seeds/*.sql           # 107 no total, 102 do nothing
```
