# Domínio alvo: Leads, roleta e distribuição — restrições para import em massa

Escopo: `leads`, `lead_sources`, `lead_events`, `lead_assignments`, `lead_comments`,
`lead_attachments`, `automation_settings`, `ad_campaigns`.

Fonte: `supabase/migrations/` (86 arquivos, a **última** versão de cada objeto é a que vale),
`supabase/seed.sql`, `supabase/seeds/`, `supabase/tests/` e `src/integrations/supabase/leads.ts`.
Nada foi consultado no banco — só arquivo.

Público: quem vai carregar dezenas de milhares de linhas do export do Bubble.

---

## 0. Resumo executivo (o que morde primeiro)

| # | Risco | Efeito em massa | Mitigação |
|---|---|---|---|
| 1 | Cron `faceimob-assign-queued` roda **a cada minuto** e distribui até 50 leads `queued` por rodada | Toda a carga entra na roleta; cada atribuição gera **2 notificações** (in-app + whatsapp) e 1 `lead_events` | `automation_settings.leads_paused = true` **antes** do primeiro insert |
| 2 | Cron `faceimob-release-expired-leads` roda a cada **30 s** sobre `status='assigned' and attend_deadline < now()` | Lead importado como `assigned` com prazo passado é devolvido à fila, notifica, incrementa `roulette_misses` | Importar `attend_deadline` **NULL**, ou usar `attending` / `in_progress` |
| 3 | `overdue_lead_count()` conta lead vivo com `next_action_at < now()`; em 20 o corretor **perde o check-in** e sai da fila | Importar histórico com `next_action_at` no passado trava a operação inteira no dia seguinte | `next_action_at` NULL, ou futuro, ou status encerrado |
| 4 | Trigger `leads_keep_next_action` proíbe **limpar** `next_action_at` de lead em `assigned/attending/in_progress` | Depois de importado errado, não dá para consertar com `set next_action_at = null` | Corrigir com data futura, ou `close_lead()`, ou mudar o status no mesmo UPDATE |
| 5 | `leads_lost_consistency`: `(status='lost') = (lost_at is not null)` | `discarded` com `lost_at` preenchido **é recusado**; `lost` sem `lost_at` também | Ver §7 e a armadilha do `close_lead` |
| 6 | Não existe unique em `phone` nem em `email` | Reimportar o mesmo arquivo duplica tudo em silêncio | `external_id` (único parcial) como chave de idempotência |

---

## 1. Enums e a máquina de estados real

### 1.1 Os enums

`supabase/migrations/20260725120000_0001_foundation.sql:36-65`

```sql
create type lead_status as enum (
  'queued',      -- na roleta, ainda sem corretor
  'assigned',    -- atribuído, aguardando primeira ação
  'attending',   -- corretor clicou em atender (trava de tempo ativa)
  'in_progress', -- em relacionamento
  'converted',   -- virou negócio
  'lost',        -- perdido
  'discarded'    -- descartado (duplicado, inválido, spam)
);

create type lead_funnel_stage as enum (
  'new', 'first_contact', 'no_response', 'warm', 'hot',
  'gathering_docs', 'scheduled_visit', 'qualified'
);

create type lead_release_reason as enum (
  'timeout', 'manual', 'reassigned', 'checkout', 'sdr_handoff'
);
```

O front espelha os três primeiros literalmente
(`src/integrations/supabase/leads.ts:45-96`) — inclusive com o aviso de que
"convertido" **não é** etapa de funil, é `status`
(`src/integrations/supabase/leads.ts:85-86`).

`OPEN_LEAD_STATUSES = ['queued','assigned','attending','in_progress']`
(`src/integrations/supabase/leads.ts:125-130`) é o recorte de "lead vivo" que
as telas usam.

### 1.2 A máquina de estados: **não existe** trigger que valide transição

Não há `CHECK` de transição, nem trigger de máquina de estados. O que o banco
realmente impõe sobre `status` são **duas constraints de coerência** e **um
trigger** — mais nada:

`supabase/migrations/20260725120400_0005_leads.sql:76-79`

```sql
constraint leads_assigned_consistency
  check (status not in ('assigned','attending') or assigned_to is not null),
constraint leads_lost_consistency
  check ((status = 'lost') = (lost_at is not null))
```

`supabase/migrations/20260906740000_0074_leads_roleta.sql:437-458` — proíbe
**zerar** `next_action_at` de lead em atendimento:

```sql
if new.status in ('assigned', 'attending', 'in_progress')
   and old.next_action_at is not null
   and new.next_action_at is null then
  raise exception 'Este lead está em atendimento e não pode ficar sem próxima ação. ...'
```

Consequência para o import: **qualquer `status` pode ir direto para qualquer
outro** por UPDATE ou INSERT, desde que as duas constraints acima fechem.
`in_progress` inclusive aceita `assigned_to` nulo (a constraint só cobre
`assigned` e `attending`) — mas aí o lead aparece como "fila" para a RLS (§8).

### 1.3 As transições que o código realmente executa

| RPC / rotina | de → para | efeitos colaterais | arquivo:linha |
|---|---|---|---|
| `assign_lead(uuid, boolean)` | `queued` → `assigned` | insere `lead_assignments`, `lead_events('assigned')`, `checkins.leads_received += 1`; o insert em assignments dispara 2 notificações | `…0074_leads_roleta.sql:105-256` |
| `claim_lead(uuid)` | `assigned` → `attending` | zera `attend_deadline`, carimba `first_contact_at`, `funnel_stage new→first_contact` se `auto_first_contact`, **nasce `next_action_at = now() + no_response_hours`**, `lead_events('claimed')` | `…0056_leads_roleta.sql:330-388` |
| `release_expired_leads()` | `assigned` → `queued` | fecha assignment com `release_reason='timeout'`, `lead_events('released')`, reatribui na hora | `…0005_leads.sql:496-536` |
| `reassign_lead(uuid,uuid)` | qualquer → `assigned` | exige `leads.reassign`; fecha assignment com `'reassigned'`, abre outro | `…0044_feature_permissions_enforced.sql:129-186` |
| `sdr_handoff(uuid,text)` | `attending`/qualquer → `queued` | zera dono, `sdr_qualified_at`, `funnel_stage='qualified'`, `lead_events('sdr_qualified')`, chama `assign_lead` | `…0064_sdr_automacao.sql:81-160` |
| `convert_lead_to_deal(...)` | qualquer → `converted` | cria `deals` + `deal_clients` + `deal_participants`, promove `lead_attachments` → `deal_documents`, seta `converted_deal_id`/`converted_at`, `lead_events('converted')` | `…0028_document_review.sql:144-228` |
| `close_lead(uuid,status,text)` | vivo → `lost` \| `discarded` | motivo obrigatório, fecha assignment com `'manual'`, zera `attend_deadline` e `next_action_at`, `lead_events('closed')` | `…0074_leads_roleta.sql:341-424` |
| `mark_no_response_leads()` (cron 5 min) | `funnel_stage first_contact → no_response` quando parado > `no_response_hours` e status em `('attending','in_progress')` | notifica o corretor | `…0043_lead_automation_rules.sql:93-143` |

O front só escreve `funnel_stage` livremente — `LeadPatch`
(`src/integrations/supabase/leads.ts:589-599`) permite `full_name, phone, email,
document, notes, funnel_stage, next_action_at, first_contact_at, source_id`. O
`status` **nunca** é escrito pela tela: sai de RPC.

---

## 2. Triggers em INSERT/UPDATE — o que dispara e o que não dispara

### 2.1 Inventário completo (última versão de cada um)

| Trigger | Tabela | Evento | O que faz | arquivo:linha |
|---|---|---|---|---|
| `leads_normalize` | `leads` | **BEFORE INSERT OR UPDATE OF** `phone, phone_raw, full_name` | copia `phone`→`phone_raw` se vazio, aplica `normalize_phone()`, `btrim(full_name)` | `…0005_leads.sql:104-120` |
| `leads_set_updated_at` | `leads` | BEFORE UPDATE | `updated_at = now()` | `…0005_leads.sql:98-100` |
| `leads_log_changes` | `leads` | **AFTER UPDATE** | grava `lead_events('stage_changed')` e/ou `('status_changed')` | `…0005_leads.sql:588-609` (virou SECURITY DEFINER em `…0020_core_fixes.sql:33`) |
| `leads_keep_next_action` | `leads` | BEFORE UPDATE OF `next_action_at, status` | recusa limpar próxima ação de lead em atendimento | `…0074_leads_roleta.sql:437-458` |
| `notify_lead_assigned` | `lead_assignments` | **AFTER INSERT** | **2 linhas em `notifications`** (in_app + whatsapp), se `notify_on_assign` | `…0011_marketing_workspace.sql:182-229` |
| `notify_lead_timeout` | `lead_assignments` | AFTER UPDATE OF `released_at` **WHEN (old.released_at is null and new.released_at is not null)** | 2 linhas em `notifications`, só se `release_reason='timeout'` e `notify_on_timeout` | `…0088_aviso_prazo_idempotente.sql:56-61` + `170-208` |
| `lead_assignments_count_miss` | `lead_assignments` | AFTER UPDATE OF `release_reason` | `leads.roulette_misses += 1` quando vira `'timeout'` | `…0074_leads_roleta.sql:62-82` |
| `lead_comments_set_updated_at` | `lead_comments` | BEFORE UPDATE | `updated_at` | `…0005_leads.sql:183-185` |
| `lead_sources_set_updated_at` | `lead_sources` | BEFORE UPDATE | `updated_at` | `…0003_catalog.sql:203-204` |
| `automation_settings_set_updated_at` | `automation_settings` | BEFORE UPDATE | `updated_at` | `…0004_distribution.sql:220-221` |
| `ad_campaigns_set_updated_at` | `ad_campaigns` | BEFORE UPDATE | `updated_at` | `…0011_marketing_workspace.sql:61-63` |
| `tasks_sync_lead_deadline` | `tasks` (**escreve em `leads`**) | AFTER INSERT OR UPDATE OF `due_at, status` | seta `leads.next_action_at = min(due_at)` das tarefas abertas; **não apaga mais** quando não há tarefa | `…0011:132-154`, corrigido em `…0056_leads_roleta.sql:407-430` |

**Não existe nenhum trigger `AFTER INSERT ON public.leads`.** Verificado por
`grep -n "on public.leads" supabase/migrations/*.sql` — os únicos triggers na
tabela são os quatro acima, e só `leads_normalize` dispara em INSERT.

### 2.2 Um import de dezenas de milhares de leads dispara efeito colateral em massa?

**Pelo INSERT em `leads`, não.** Um `INSERT INTO public.leads (...)` dispara
apenas `leads_normalize` (BEFORE, por linha, barato). Não gera `lead_events`,
não gera `notifications`, não chama a roleta.

**Pelo cron, sim, em cheio.** Dois jobs varrem a tabela:

- `faceimob-assign-queued` — `* * * * *`, chama `assign_queued_leads()`
  (`…0020_core_fixes.sql:346-351`). A função pega **50 leads `queued` por
  rodada, ordenados por `created_at`**, ignora quem tem conversa SDR ativa e
  quem já bateu o teto de voltas (`…0074_leads_roleta.sql:482-513`). Cada
  atribuição bem-sucedida = 1 linha em `lead_assignments` + 1 `lead_events` +
  **2 linhas em `notifications`** + 1 UPDATE em `checkins`.
- `faceimob-release-expired-leads` — a cada **30 s** (fallback 1 min),
  `release_expired_leads()` (`…0013_cron_scheduling.sql:95-105`). Pega todo
  lead `status='assigned' and attend_deadline < now()`, fecha o assignment com
  `'timeout'` (→ `notify_lead_timeout` + `lead_assignments_count_miss`), grava
  `lead_events('released')`, devolve para `queued` e **reatribui na hora**.
- `faceimob-mark-no-response` — `*/5 * * * *`
  (`…0043_lead_automation_rules.sql:169-173`). Move `first_contact` →
  `no_response` e notifica o corretor.
- `faceimob-notify-dispatch` — `…0018_notification_dispatch_job.sql:94` — drena
  a fila de notificações para fora (WhatsApp), então o estrago não fica só no banco.

Ordem de grandeza: 30.000 leads importados como `queued` ⇒ 30.000 assignments,
30.000 `lead_events`, **60.000 notificações** e 30.000 incrementos em
`checkins.leads_received`, entregues a 50 por minuto (≈ 10 horas de enxurrada),
com o sino de cada corretor inutilizável.

### 2.3 Como desligar com segurança, e religar

O interruptor é o singleton `automation_settings`
(`…0004_distribution.sql:201-221`, linha única inserida em `:218`).

**Antes do primeiro insert** (como `service_role` ou admin — a policy de escrita
é `is_admin()`, `…0004_distribution.sql:296-298`):

```sql
-- 1. Guardar o estado atual (não presuma os defaults)
select leads_paused, notify_on_assign, notify_on_timeout, auto_first_contact,
       roulette_max_rounds, attend_timeout_seconds, no_response_hours
  from public.automation_settings where id;

-- 2. Desligar
update public.automation_settings
   set leads_paused      = true,   -- assign_lead() retorna null sem fazer nada
       notify_on_assign  = false,  -- notify_lead_assigned() sai antes de escrever
       notify_on_timeout = false   -- notify_lead_timeout() idem
 where id;
```

Por que isso basta e onde não basta:

- `leads_paused` é lido **na entrada** de `assign_lead()`
  (`…0074_leads_roleta.sql:128-134`): pausado, ela retorna `null` antes de
  qualquer escrita. `distribute_queued_lead()` também recusa com frase própria
  (`…0056_leads_roleta.sql:300-304`).
- `notify_on_assign` / `notify_on_timeout` são lidos no **começo** das duas
  funções de notificação (`…0011:189-192` e `…0088:186-189`): elas dão
  `return null` sem inserir.
- **O que a pausa NÃO desliga:** `release_expired_leads()` continua rodando a
  cada 30 s. Com `leads_paused=true` ela ainda **libera** o lead vencido
  (fecha assignment, grava `lead_events('released')`, incrementa
  `roulette_misses`, volta para `queued`) — só a reatribuição é que não
  acontece. Por isso: **não importe lead com `status='assigned'` e
  `attend_deadline` no passado.** Ver §4.
- `mark_no_response_leads()` também segue rodando e não olha `leads_paused`;
  ele só toca `funnel_stage='first_contact'` com status `attending`/`in_progress`.

**Alternativa mais forte** (se o volume justificar parar os jobs): desagendar
por `cron.unschedule('faceimob-assign-queued')` etc. Consequência: é preciso
reagendar exatamente com a mesma expressão das migrations
(`…0013:95-105`, `…0020:346-351`, `…0043:169-173`) — e um `db reset` recria tudo.
A pausa por `automation_settings` é reversível com um UPDATE e é a válvula que
o produto já expõe em Admin · Automação de Leads; prefira ela.

**Religar** (depois de conferir a carga):

```sql
update public.automation_settings
   set leads_paused = false, notify_on_assign = true, notify_on_timeout = true
 where id;
```

Antes de religar, decida o que fazer com os `queued` importados: eles vão
começar a sair a 50/minuto. Se o histórico legado **não** deve entrar na roleta,
importe-o com `status` de encerramento (`converted`/`lost`/`discarded`) ou já
atribuído (§4) — `assign_queued_leads()` só olha `status='queued'`.

---

## 3. `roulette_misses` e o teto de voltas

`leads.roulette_misses int not null default 0`
(`…0074_leads_roleta.sql:50-56`). É mantido **só** pelo trigger
`lead_assignments_count_miss`, que dispara em **UPDATE** de
`release_reason` para `'timeout'` (`…0074:62-82`).

Para o import isso significa:

- Inserir `lead_assignments` **já fechadas** (`released_at` e
  `release_reason='timeout'` no próprio INSERT) **não incrementa**
  `roulette_misses` e **não** dispara `notify_lead_timeout` (o trigger é
  `AFTER UPDATE OF released_at` com `WHEN old.released_at is null`,
  `…0088:56-61`). Isso é bom: importa histórico sem barulho.
- Mas então o contador fica zerado e é preciso fazer o mesmo backfill que a
  própria 0074 faz (`…0074_leads_roleta.sql:86-95`):

```sql
update public.leads l
   set roulette_misses = c.total
  from (select la.lead_id, count(*)::int as total
          from public.lead_assignments la
         where la.release_reason = 'timeout'
         group by la.lead_id) c
 where c.lead_id = l.id and l.roulette_misses is distinct from c.total;
```

- Lead com `status='queued'` e `roulette_misses >= automation_settings.roulette_max_rounds`
  (default 5, `…0074:43-44`) fica na **bandeja "sem atendimento"**: sai de
  `assign_queued_leads()` (`…0074:496-505`) e `assign_lead` o recusa gravando
  `lead_events('unattended')` + notificação para **todo** manager/director/admin
  ativo (`…0074:154-182`). Um import que deixe milhares de leads nesse estado
  vira uma enxurrada de avisos por gestor — mais um motivo para importar
  histórico já encerrado.

---

## 4. Importar lead já atribuído sem passar pela roleta

**Sim, dá — e é o padrão que o próprio projeto usa.** O seed de demonstração
insere 60 leads com dono direto, sem RPC nenhuma:
`supabase/seeds/060_demo_showcase.sql:218-273` grava
`status, funnel_stage, assigned_to, assigned_at, attend_deadline, first_contact_at,
next_action_at, lost_at, lost_reason` num único INSERT.

`leads.assigned_to` é só `uuid references public.profiles(id) on delete set null`
(`…0005_leads.sql:53`). Não há trigger que exija passagem por `assign_lead`.

### Regras que o import precisa respeitar

1. **`leads_assigned_consistency`**: `status in ('assigned','attending')` exige
   `assigned_to is not null` (`…0005:76-77`).
2. **`attend_deadline`**: preencha **NULL** salvo se você quer o cronômetro
   correndo. Com `status='assigned'` e `attend_deadline` no passado, o cron de
   30 s devolve o lead à fila em segundos (`…0005:496-536`).
   O estado "travado com o corretor, sem cronômetro" é `status='attending'` +
   `attend_deadline = null` — exatamente o que `claim_lead` produz
   (`…0056:362-364`).
3. **`assigned_at`**: livre, sem constraint. Só alimenta a UI.
4. **`next_action_at`**: **o campo mais perigoso do import.**
   `overdue_lead_count()` conta lead com `status in ('assigned','attending','in_progress')`
   e `next_action_at < now()` (`…0005:228-241`); em
   `automation_settings.overdue_block_threshold` (default **20**) o corretor
   **não faz check-in** (`checkin_eligibility`, `…0005:246-277`) e **some da
   fila** (`distribution_queue`, `…0074:316-317`). Importar 30k leads legados
   com prazo vencido paralisa a operação inteira no primeiro turno.
   Escolha uma: `next_action_at` NULL, data futura, ou status encerrado.
5. **Não crie `lead_assignments` "aberta" duplicada.** Índice único parcial:
   `lead_assignments_one_open on (lead_id) where released_at is null`
   (`…0005:145-146`). Uma linha aberta por lead, no máximo.
6. **Se criar `lead_assignments`, `notify_lead_assigned` dispara** (AFTER
   INSERT, sem `WHEN`). Com `notify_on_assign=false` ele sai antes de escrever.
7. `checkins.leads_received` **não** é atualizado quando você insere direto —
   só `assign_lead` mexe nele (`…0074:243-247`). Se o número importa para a
   demo, ajuste à mão.

### Receita mínima para "lead legado já do corretor X"

```sql
insert into public.leads (
  full_name, phone, email, source_id, status, funnel_stage,
  assigned_to, assigned_at, attend_deadline, first_contact_at,
  next_action_at, external_id, created_at, last_activity_at
)
values (
  'Fulano de Tal', '51999998888', null,
  (select id from public.lead_sources where code = 'importacao'),
  'in_progress', 'warm',
  '<profile_id>', '2024-05-11 18:18-03', null, '2024-05-11 18:20-03',
  null,                                   -- não crie atraso artificial
  'bubble:1715462324608x711409717943992300',
  '2024-05-11 18:18-03', '2024-05-11 18:20-03'
);
```

`in_progress` foi escolhido de propósito: não é varrido por
`release_expired_leads` (que só olha `assigned`) nem por `assign_queued_leads`
(que só olha `queued`).

---

## 5. Constraints únicas e índices

### `leads` (`…0005_leads.sql:83-96`, `…0006_deals.sql:77-78`)

| Objeto | Tipo | Definição |
|---|---|---|
| PK | unique | `id` (`default gen_random_uuid()`) |
| `leads_external_id_idx` | **UNIQUE parcial** | `(external_id) where external_id is not null` |
| `leads_assigned_idx` | índice | `(assigned_to, status)` |
| `leads_status_idx` | índice | `(status)` |
| `leads_phone_idx` | índice **não único** | `(phone) where phone is not null` |
| `leads_created_idx` | índice | `(created_at desc)` |
| `leads_campaign_idx` | índice | `(campaign_id) where campaign_id is not null` |
| `leads_deadline_idx` | índice | `(attend_deadline) where attend_deadline is not null` |
| `leads_overdue_idx` | índice | `(assigned_to, next_action_at) where status in ('assigned','attending','in_progress')` |
| `leads_converted_idx` | índice | `(converted_deal_id) where converted_deal_id is not null` |

**Não existe unique em `phone`. Não existe unique em `email`.** É decisão
explícita, documentada em `…0056_leads_roleta.sql:479-485`:

> "Não é índice único de propósito: 'perdi e voltou' acontece de verdade, e o
> mesmo telefone pode virar lead novo meses depois."

O dedupe é **de aplicação**, por `existing_lead_phones(text[])`
(`…0056:491-524`), que compara `leads.phone = normalize_phone(informado)` e é
consumida por `src/integrations/supabase/leads.ts:563-576`.

**Para um import idempotente use `external_id`** — é o único unique disponível.
Ele foi criado para o `leadgen_id` da Meta (`…0005:34-35`), mas é `text` livre:
prefixe o `unique id` do Bubble (ex.: `bubble:1715462324608x711409717943992300`)
para não colidir com o namespace da Meta. Aí `on conflict (external_id) do nothing`
torna a reimportação segura.

`normalize_phone` (`…0001_foundation.sql:125-141`) reduz a dígitos e prefixa DDI
`55` para 10/11 dígitos. Como o trigger `leads_normalize` reescreve `phone` em
todo INSERT, o telefone gravado nunca é o que você mandou — `phone_raw` guarda o
original (e é preenchido automaticamente se você mandar só `phone`).

### Demais tabelas

| Tabela | Unique | Índices |
|---|---|---|
| `lead_sources` | `code` (unique de coluna), `lead_sources_form_idx` **unique parcial** em `(form_id) where form_id is not null` | — (`…0003_catalog.sql:189-201`) |
| `lead_assignments` | `lead_assignments_one_open` **unique parcial** em `(lead_id) where released_at is null` | `(lead_id, sequence desc)`, `(profile_id, assigned_at desc)` (`…0005:142-146`) |
| `lead_events` | só a PK | `(lead_id, created_at desc)` (`…0005:162`) |
| `lead_comments` | só a PK | `(lead_id, created_at desc)` (`…0005:181`) |
| `lead_attachments` | **`storage_path` UNIQUE** (coluna) | `(lead_id)` (`…0005:195, 204`) |
| `automation_settings` | PK `id boolean check (id)` → **singleton**, a linha já existe | — (`…0004:201-218`) |
| `ad_campaigns` | `(platform, external_id)` (`…0011:57`) **e** `ad_campaigns_external_id_key` unique em `(external_id)` sozinho (`…0067:27-28`) | — |

### CHECK constraints relevantes

```
leads.full_name           check (length(btrim(full_name)) > 0)      -- 0005:22
leads_assigned_consistency, leads_lost_consistency                   -- 0005:76-79
lead_assignments_release_consistency
   check ((released_at is null) = (release_reason is null))          -- 0005:138-139
lead_attachments.size_bytes  check (null or >= 0)                    -- 0005:199
lead_comments.body           check (length(btrim(body)) > 0)         -- 0005:176
lead_sources.channel         check in ('meta','whatsapp','organic','indication',
                                       'import','portal','other')    -- 0003:192-193
automation_settings.attend_timeout_seconds  > 0                      -- 0004:205
automation_settings.overdue_block_threshold > 0                      -- 0004:207
ad_campaigns.platform     check in ('meta','google','tiktok','other') -- 0011:47
ad_campaigns_status_maiusculo  check (status is null or status = upper(status)) -- 0084:41-43
ad_campaigns_spend_not_negative check (total_spend >= 0 and (daily_budget is null or >= 0)) -- 0063:67-70
ad_campaigns_lifetime_budget_not_negative                            -- 0089:37-41
ad_campaigns_periodo_coerente  check (ends_on >= starts_on)          -- 0089:45-49
```

---

## 6. `lead_sources`: catálogo atual e como cadastrar novos

O catálogo real está em **`supabase/seed.sql:120-128`** (não em migration —
é o seed de configuração, idempotente):

| `code` | `label` | `channel` |
|---|---|---|
| `meta_ads` | Meta Ads | `meta` |
| `whatsapp` | WhatsApp | `whatsapp` |
| `organico` | Orgânico | `organic` |
| `indicacao` | Indicação | `indication` |
| `importacao` | **Importação** | `import` |
| `portal` | Portal | `portal` |

Seis códigos, `on conflict do nothing`. O seed de catálogo
`supabase/seeds/020_catalog_distribution_sdr.sql:148-160` só **atualiza**
`form_id`, `sdr_agent_id` e `welcome_template_id` de `meta_ads` e `portal` —
não cria origens novas.

`importacao` existe exatamente para este caso de uso. Use-o como `source_id`
padrão da carga do Bubble, e crie códigos derivados se precisar rastrear a
origem legada.

### Cadastrar uma origem nova (padrão de idempotência da casa)

```sql
insert into public.lead_sources (code, label, channel)
values ('bubble_legado', 'Bubble (legado)', 'import')
on conflict (code) do nothing;
```

Restrições:
- `code` e `label` são `not null` sem default; `channel` tem default `'meta'`
  e **CHECK** na lista de 7 valores (`…0003:192-193`).
- `form_id` é opcional, mas **unique parcial**: dois `lead_sources` não podem
  apontar para o mesmo formulário (`…0003:201`). Isso importa porque
  `distribution_group_forms.form_id` é a ponte para a roleta
  (`lead_distribution_group()`, `…0056:102-116`).
- `sdr_agent_id` preenchido faz a origem **desviar da roleta**: o webhook inicia
  conversa de SDR em vez de chamar `assign_lead`
  (`supabase/functions/meta-ads-webhook/index.ts:307-313`). Deixe **nulo** na
  origem de importação.
- RLS de escrita: `admin`, `marketing`, `sdr`
  (`…0031_sprint3_core_flows.sql:6-10`). Leitura: qualquer autenticado
  (`…0003:249-250`).

---

## 7. `converted_deal_id` e o elo lead → deal

`leads.converted_deal_id uuid references public.deals(id) on delete set null`
— adicionada em `…0006_deals.sql:74-78`, depois que `deals` existe.

**É opcional (nullable) e o elo é bidirecional, mas os dois lados são frouxos:**

| Lado | Coluna | Nulável? | FK |
|---|---|---|---|
| lead → deal | `leads.converted_deal_id` | sim | `deals(id) on delete set null` |
| deal → lead | `deals.lead_id` | sim | `leads(id)` (`SCHEMA_ALVO.md:43`; índice `deals_lead_idx`, `…0006:66`) |

Nada no banco garante que os dois apontem um para o outro. Quem sincroniza é
`convert_lead_to_deal()` (`…0028_document_review.sql:144-228`), que na mesma
transação insere `deals(lead_id = p_lead_id)` e faz
`update public.leads set status='converted', converted_deal_id = v_deal.id, converted_at = now()`
(`…0028:213-218`).

Também **não há unique em `converted_deal_id`** — decisão explícita e
documentada em `…0081_marketing_dados.sql:29`: "ele fecharia a porta" para dois
leads do mesmo cliente apontando ao mesmo negócio. Os relatórios de marketing
contornam com `distinct on (l.converted_deal_id)` (`…0081:79-84`).

Consequências para o import:

- Você **pode** importar leads sem nenhum negócio: `converted_deal_id` nulo é o
  caso normal.
- Se importar um lead com `status='converted'`, **preencha `converted_deal_id` e
  `converted_at`** e o `deals.lead_id` do outro lado — nenhuma constraint cobra,
  mas `close_lead` recusa mexer em lead com `converted_deal_id` preenchido
  (`…0074:375-378`) e as telas de marketing contam conversão por esse campo
  (`…0081:70`).
- `status='converted'` **não** exige `converted_deal_id` (não há constraint
  ligando os dois). Um lead `converted` órfão é aceito pelo banco e vira
  inconsistência silenciosa nos relatórios.

---

## 8. Campos NOT NULL sem default que o import precisa preencher

`!` = NOT NULL. Só listo o que **não tem default** — o resto o banco preenche.

| Tabela | Obrigatório sem default | Observação |
|---|---|---|
| **`leads`** | **`full_name`** (só ele) | `check (length(btrim(full_name)) > 0)`. Todo o resto é nulável ou tem default: `id`=`gen_random_uuid()`, `status`=`'queued'`, `funnel_stage`=`'new'`, `last_activity_at`/`created_at`/`updated_at`=`now()`, `roulette_misses`=`0` |
| **`lead_sources`** | `code`, `label` | `channel` default `'meta'`, `active` default `true` |
| **`lead_events`** | `lead_id`, `kind` | `kind` é **texto livre**, sem CHECK nem enum. Vocabulário em uso: `assigned`, `claimed`, `released`, `reassigned`, `converted`, `closed`, `unattended`, `stage_changed`, `status_changed`, `sdr_qualified` |
| **`lead_assignments`** | `lead_id`, `profile_id`, **`deadline`** | `sequence` default 1, `assigned_at` default `now()`. `deadline` não tem default e é o campo esquecido com mais frequência |
| **`lead_comments`** | `lead_id`, `body` | `body` com `check (length(btrim(body)) > 0)`; `author_id` é nulável |
| **`lead_attachments`** | `lead_id`, `storage_path` (**unique**), `original_name`, `stored_name` | `document_type_id` e `uploaded_by` nuláveis |
| **`automation_settings`** | nenhum — **a linha já existe** (`…0004:218`). Não insira, faça UPDATE | |
| **`ad_campaigns`** | `external_id`, `name` | `platform` default `'meta'`, `total_spend` default `0` |

Nota sobre datas do Bubble: `created_at`/`updated_at`/`last_activity_at` **têm**
default `now()`. Se você quer preservar a data de criação legada, precisa passá-la
explicitamente — o default vai silenciosamente carimbar a data do import e o
`leads_created_idx`/ordenação de `assign_queued_leads` (que ordena por
`created_at`) vão ler tudo como "lead de hoje".

---

## 9. RLS e permissão: como inserir em massa

### O caminho recomendado: `service_role`

`service_role` **ignora RLS** e já tem `select, insert, update, delete` em todas
as tabelas de `public` (`…0023_role_grants.sql:29-35`). É o que o webhook da
Meta usa (`supabase/functions/meta-ads-webhook/index.ts:297`) e o único caminho
que consegue escrever em `lead_events` e `lead_assignments`.

### Se for por usuário autenticado

| Tabela | INSERT permitido a | policy |
|---|---|---|
| `leads` | `admin, director, manager, marketing, sdr` (papel cru, não matriz) | `leads_insert`, `…0005:648-650` — **nunca redefinida** |
| `lead_comments` | quem já pode **escrever** no lead (`can_write_lead`) e `author_id = auth.uid()` | `…0056:468-471` |
| `lead_attachments` | idem, com `uploaded_by = auth.uid()` | `…0056:473-476` |
| `lead_events` | **ninguém** — não existe policy de INSERT/UPDATE/DELETE | `…0005:677-678`: "Log automático é imutável… Só as funções SECURITY DEFINER escrevem aqui" |
| `lead_assignments` | **ninguém** — só policy de SELECT | `…0005:657-662` |
| `lead_sources` | `admin, marketing, sdr` | `…0031:6-10` |
| `automation_settings` | `is_admin()` | `…0004:296-298` |
| `ad_campaigns` | `admin, marketing` (write); SELECT exige a permissão `reports.view_finance` | `…0011:443-447` + `…0045:47-50` |

Ou seja: **um import de histórico completo (leads + eventos + atribuições) só é
possível via `service_role`.** Um import só de `leads` cabe num usuário
`admin`/`marketing`, e é o que a tela de importação de planilha faz
(`createLeads`, `src/integrations/supabase/leads.ts:528-548`, em lotes de
`IMPORT_CHUNK_SIZE = 200`).

### Visibilidade depois de importado (o que o usuário vai enxergar)

`leads_select` (última versão, `…0044_feature_permissions_enforced.sql:106-112`):

```sql
using (
  assigned_to in (select public.auth_visible_profiles())
  or (assigned_to is null and public.has_permission('leads.view_queue'))
)
```

Mais `leads_select_sdr` (`…0064:251-257`): `admin/sdr/marketing` veem lead que
tenha conversa de SDR.

Consequência prática: **lead importado sem `assigned_to` só aparece para quem
tem `leads.view_queue`** — director, manager, marketing e admin
(`…0044:87-88`). O corretor **não vê a fila**, de propósito ("deixar o corretor
ver a fila inteira abriria espaço para escolher lead", `…0005:623-624`).
Se o objetivo é que cada corretor veja o próprio histórico legado, o import
**precisa** preencher `assigned_to`.

`leads_update` repete o mesmo predicado (`…0044:114-127`) e `lead_events`,
`lead_comments` e `lead_attachments` seguem a visibilidade do lead via
`can_see_lead()` (`…0041_leads_queue_rls.sql:42-50, 82-99`).

Escrita em lead alheio exige `can_write_lead()`: dono, admin, gestor do dono, ou
fila para quem tem `leads.view_queue` (`…0056:440-457`).

---

## 10. Armadilhas específicas do import

1. **`close_lead(..., 'discarded', ...)` viola a própria constraint da tabela.**
   A RPC seta `lost_at = now()` para `lost` **e** `discarded`
   (`…0074:392-402`), mas `leads_lost_consistency` exige
   `(status='lost') = (lost_at is not null)` (`…0005:78-79`) — que nunca foi
   alterada (`grep leads_lost_consistency` só acha a definição original). O
   teste `supabase/tests/74_leads_roleta.sql` só exercita `'lost'` (linhas 234,
   245, 253). **Para o import: lead `discarded` deve ter `lost_at` NULL**, e o
   motivo vai em `lost_reason` (que não tem constraint). Não use a RPC para
   descartar.

2. **`leads_normalize` reescreve o telefone em todo INSERT.** O valor gravado em
   `phone` nunca é o do CSV: passa por `normalize_phone` (dígitos + DDI 55).
   Se você importar `phone` já normalizado, `phone_raw` recebe uma cópia dele e
   você **perde o formato original do Bubble**. Mande o formato original em
   `phone_raw` explicitamente se quiser auditoria (`…0005:104-120`).

3. **`wc -l` não é contagem de registro** e, no lado do banco, `count(*)` logo
   após o insert também não é o total final: o cron pode já ter mexido em
   `status` de parte das linhas. Meça com o `external_id` do lote.

4. **Fuso.** Nada no domínio de leads guarda fuso: todas as colunas são
   `timestamptz` e o banco roda em UTC, enquanto a operação é
   `America/Sao_Paulo` — `current_shift`, `distribution_queue` e
   `current_work_date()` convertem explicitamente
   (`…0005:221-222`, `…0074:315`, `…0056:230-236`). Ao converter
   `"May 11, 2024 6:18 pm"` do Bubble, **anexe o offset de São Paulo**
   (`2024-05-11 18:18-03`); enviar sem offset faz o Postgres interpretar como
   UTC e o lead nasce 3 h no futuro.

5. **`campaign_id` não é FK.** `leads.campaign_id text` liga a `ad_campaigns` só
   por `external_id`, via join de texto (`…0063:213`). Não há integridade
   referencial: valor errado não é recusado, só some do relatório
   (`…0063:208`). E `ad_campaigns.external_id` é **globalmente único** desde a
   0067 — o mesmo id não pode existir em duas plataformas.

6. **`ad_campaigns.status` precisa ser MAIÚSCULO.** CHECK
   `status = upper(status)` (`…0084:41-43`). O front só conhece `ACTIVE` e
   `PAUSED` (`CampaignPerformancePanel.tsx`), mas o banco aceita qualquer
   maiúscula — de propósito, para a Graph API (`ARCHIVED`, `IN_PROCESS`,
   `WITH_ISSUES`) não ser recusada (`…0089:18-24`).

7. **`lead_attachments.storage_path` é UNIQUE e o arquivo precisa existir no
   bucket `lead-attachments`**, que desde a 0056 tem teto de **8 MB** e lista
   fechada de MIME types (`…0056:533-556`). Registrar a linha sem subir o
   arquivo cria anexo fantasma.

8. **`sequence` em `lead_assignments` não é gerado.** Default é `1`;
   `assign_lead` calcula `max(sequence)+1` por lead (`…0074:226-227`). Import de
   histórico precisa numerar por conta própria, ou o "quantas voltas o lead deu"
   fica errado.

9. **Notificação legada não deve ser importada.** `notifications` não faz parte
   deste domínio, mas os triggers desta área são os maiores produtores dela
   (2 linhas por atribuição). Um import que gere assignments com
   `notify_on_assign=true` enche a caixa de todo mundo — e o cron
   `faceimob-notify-dispatch` tenta **entregar por WhatsApp**.

10. **A tela nunca chama `.from("leads")` direto** — regra da casa em
    `src/integrations/supabase/leads.ts:11-12`. O import por script não passa por
    esse arquivo, então nenhuma das validações de front (dedupe por
    `existingLeadPhones`, chunk de 200, mensagem de erro por lote) se aplica:
    replique a lógica de dedupe você mesmo, ou aceite duplicatas.

11. **`assign_queued_leads` ordena por `created_at`.** Se você importar
    histórico antigo como `queued` sem pausar a roleta, os leads **mais velhos**
    (de 2024) ocupam a janela de 50 por minuto e os leads **novos de verdade**
    param de ser distribuídos — o mesmo defeito que a 0074 corrigiu para a
    bandeja "sem atendimento" (`…0074:464-480`).

---

## 11. Checklist operacional do import

1. `select * from public.automation_settings;` → **anote os valores**.
2. `update public.automation_settings set leads_paused = true, notify_on_assign = false, notify_on_timeout = false where id;`
3. Garanta `lead_sources` de origem: `insert ... on conflict (code) do nothing`.
4. Carregue `leads` como `service_role`, em lotes, com:
   - `full_name` sempre preenchido e não vazio;
   - `external_id = 'bubble:' || <unique id>` para idempotência
     (`on conflict (external_id) do nothing`);
   - `created_at` / `last_activity_at` com o timestamp legado **e offset -03**;
   - `status` de encerramento (`converted`/`lost`/`discarded`) ou já atribuído
     (`in_progress`) para histórico morto — **evite `queued` em massa**;
   - `attend_deadline = null` e `next_action_at = null` (ou futuro).
5. Carregue `lead_events`, `lead_comments`, `lead_attachments` (todos por
   `service_role`; só `lead_comments` tem policy de insert para usuário).
6. Se importar `lead_assignments`: linhas **já fechadas**
   (`released_at` + `release_reason` juntos, nunca só um — CHECK
   `lead_assignments_release_consistency`), no máximo uma aberta por lead, com
   `deadline` preenchido.
7. Rode o backfill de `roulette_misses` (§3).
8. Confira: `select status, count(*) from public.leads group by 1;` e
   `select assigned_to, count(*) from public.leads where status in ('assigned','attending','in_progress') and next_action_at < now() group by 1 order by 2 desc;`
   — **nenhum corretor pode aparecer com 20 ou mais** (`overdue_block_threshold`).
9. Religue: `update public.automation_settings set leads_paused = false, notify_on_assign = true, notify_on_timeout = true where id;`
10. Espere 1 minuto e confira `select count(*) from public.notifications where created_at > now() - interval '5 minutes';` — se explodir, pause de novo.
