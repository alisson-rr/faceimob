# Alvo — Negócios, participantes, rateio de VGV e etapas

Escopo: `deals`, `deal_clients`, `deal_participants`, `deal_history`,
`pipeline_stages`, `stage_permissions`, `developers`, `developer_projects`,
`developer_submissions`, `visits`, `closed_months`, `month_reopenings`.

Ponto de vista: **quem vai inserir dados legados em massa**. Tudo aqui saiu de
leitura de `supabase/migrations/` (86 arquivos), `supabase/seed.sql`,
`supabase/seeds/`, `supabase/tests/` e do front em
`src/integrations/supabase/newSchema.ts`. Cada afirmação não óbvia cita
arquivo:linha.

> A numeração das migrations tem lacunas e várias corrigem as anteriores. Onde
> houver mais de uma versão do mesmo objeto, este documento descreve **a
> última**, e diz qual é.

---

## 0. Resumo executivo — as 10 coisas que quebram uma importação em massa

| # | O quê | Onde |
|---|---|---|
| 1 | `deals_guard_closed_month` recusa **INSERT** em mês fechado, e a exceção é `is_admin()`, que lê `auth.uid()` — **não** basta ser `service_role`/`postgres` | `0010_gamification.sql:29-53` |
| 2 | `deals_default_month_base` **sobrescreve** o `month_base` que você mandou, se ele for igual a `month_start(current_date)` | `0032_game_cycle_month.sql:54-84` |
| 3 | `deals_award_points` dispara em **INSERT** desde a 0060: importar venda antiga gera `game_events` na temporada **aberta hoje** | `0060_gamificacao.sql:288-345` |
| 4 | `deal_participants_award_points` dispara em cada insert de participante de negócio `won` — pontua de novo, por outro caminho | `0060_gamificacao.sql:348-376` |
| 5 | `deal_participants_autofill` **cria linhas que você não pediu** (gerente e diretor da equipe do corretor) | `0058_pipeline.sql:81-117` |
| 6 | `recalc_deal_shares` **sobrescreve** qualquer `share_pct` que você mandar: rateio é sempre 100/n entre `role='broker'` | `0058_pipeline.sql:31-79` |
| 7 | `deals_guard_esteira_label` recusa `status_detail` = `13. ESTEIRA AGIL` / `RET. ESTEIRA AGIL` **também no INSERT** (escapam só `postgres` e `service_role`) | `0037_esteira_label_guard.sql:40-70` |
| 8 | `deals.code` é `unique` com default de sequence — dá para importar código do Bubble, mas a sequence **não avança** | `0006_deals.sql:20,27` |
| 9 | `deals_guard_stage` é `before update` — INSERT direto **não** valida matriz de etapa nem documento. É como os seeds nascem em etapa final | `0006_deals.sql:435-437`, `0028:82-140`, `seeds/060_demo_showcase.sql:317-320` |
| 10 | Front lê corretor/gerente por **slot** (`ordinal`), e não há unique em `(deal_id, role, ordinal)`: ordinal duplicado volta ao bug que a 0025 consertou | `0025_deal_participant_ordinal.sql:17-35`, `newSchema.ts:309-310,441-455` |

---

## (a) `deals.code` — formato, geração e se dá para importar o do Bubble

**Formato:** `NEG-000001` (prefixo fixo + `lpad(...,6,'0')`).

```sql
-- supabase/migrations/20260725120500_0006_deals.sql:20
create sequence public.deal_code_seq;
-- :27
code text not null unique default ('NEG-' || lpad(nextval('public.deal_code_seq')::text, 6, '0')),
```

- É **DEFAULT de coluna**, não trigger. `grep -rn "deal_code_seq" supabase/ src/ scripts/`
  devolve só essas duas linhas: nenhum outro objeto mexe na sequence.
- `not null unique`, sem `check` de formato.

**Dá para importar o código do Bubble? Sim.** É o que os próprios seeds fazem —
`supabase/seeds/030_commercial_operation.sql:186-216` insere `code` explícito
(`'SEED-NEG-001'`…) e a idempotência é feita à mão:

```sql
-- seeds/030_commercial_operation.sql:212-216
where not exists (
  select 1 from public.deals existing
  where existing.id = d.id or existing.code = d.code
)
on conflict do nothing;
```

**Três consequências de importar código próprio:**

1. **A sequence não avança.** Se os códigos importados forem `NEG-000001…NEG-004000`
   e a sequence estiver em 33, o primeiro negócio criado pela tela depois da
   importação tenta `NEG-000034` e leva `23505` (unique violation) — e o usuário
   vê um erro sem explicação. **Mitigação:** ou use um prefixo que nunca colida
   (`BUB-000123`, `SEED-NEG-…` como os seeds), ou rode
   `select setval('public.deal_code_seq', <maior número importado>)` depois da carga.
   O prefixo distinto é a opção conservadora — também deixa auditável o que veio do legado.
2. `code` é o que aparece no assunto do e-mail à construtora
   (`0028_document_review.sql:334`: `format('[%s] Documentação - %s', v_deal.code, …)`)
   e no título das notificações (`0028:444,517,544`). Código feio vaza para o cliente.
3. Nada valida o formato: `code` pode ser o `unique id` do Bubble cru. Só não é
   legível para o operador.

---

## (b) Rateio de VGV — onde vive, como é calculado, o que acontece se você inserir direto

### Onde vive: **só no banco**, e nenhuma tela pode chamar

```sql
-- 0019_anon_surface_hardening.sql:53-54
revoke execute on function public.recalc_deal_shares(uuid) from authenticated;
grant  execute on function public.recalc_deal_shares(uuid) to service_role;
```

Reforçado em `0023_role_grants.sql:57`. O `0058_pipeline.sql:4-7` afirma o
contrato: *"Ele é calculado só no banco … e, desde a 0019/0023, nenhuma tela pode
chamá-lo."*

### Como é calculado (versão vigente: 0058)

```sql
-- supabase/migrations/20260903580000_0058_pipeline.sql:31-79
create or replace function public.recalc_deal_shares(p_deal_id uuid) …
  -- 1. gerente e diretor SEMPRE em 0 (fica antes do return da guarda)
  update public.deal_participants set share_pct = 0
   where deal_id = p_deal_id and role in ('manager','director') and share_pct is distinct from 0;
  -- 2. conta os brokers; se 0, retorna
  -- 3. v_share := round(100.0 / v_count, 3);  aplicado a TODOS os brokers
  -- 4. o resto do arredondamento vai para o PRIMEIRO broker (order by created_at, id)
```

- Divisão **igualitária**, sempre. `share_pct numeric(6,3)`, `check (share_pct between 0 and 100)`
  (`0006_deals.sql:131`).
- 3 corretores → 33.333 ×3 = 99.999 → o primeiro recebe +0.001 e a soma fecha
  **exatamente 100** (`0006_deals.sql:169-181`, reescrito em `0058:65-77`).
- Gerente e diretor entram no negócio mas **não dividem VGV** — `share_pct = 0`.
- **Não há constraint de soma = 100.** A soma 100 é garantida pela função, não
  pelo schema. Se você desligar os triggers, ninguém confere.

Contrato coberto por asserts: `supabase/tests/58_pipeline_rateio.sql:81-107`
(*"dois corretores fecham 100% do rateio"*, *"gerente entra no negócio fora do
rateio"*, *"sem corretor, o gerente é zerado"*).

### O que acontece se eu inserir `deal_participants` direto

**Seu `share_pct` é descartado.** O gatilho recalcula na mesma transação:

```sql
-- 0006_deals.sql:229-246
create or replace function public.deal_participants_resplit() … perform public.recalc_deal_shares(coalesce(new.deal_id, old.deal_id)); …
create trigger deal_participants_resplit
  after insert or delete on public.deal_participants
  for each row execute function public.deal_participants_resplit();
```

Ele escuta **insert e delete**, não update — por isso não recursa (o recalc
emite `UPDATE`). Comentário explícito em `0006:241-243`.

**E mais três coisas acontecem que você não pediu:**

1. **Autofill de gerente e diretor** (`0058_pipeline.sql:81-117`, substitui
   `0006:191-227`). Inserir um `role='broker'` puxa `teams.manager_id` e
   `teams.director_id` da filiação **vigente mais recente** do corretor
   (`order by tm.joined_at desc nulls last, tm.created_at desc, tm.id desc limit 1`)
   e insere duas linhas com `auto_added = true`. Se o legado tinha outro gerente
   naquele negócio, o banco vai gravar o **atual**, não o histórico.
   → Para preservar o histórico: insira o `broker` primeiro, depois **corrija/apague**
   as linhas `auto_added` e insira as suas com `on conflict (deal_id, profile_id, role) do nothing`.
2. **Pontuação do game** (`0060_gamificacao.sql:348-376`): se o negócio já está
   `outcome = 'won'`, cada broker inserido ganha `venda` na temporada **aberta hoje**.
   Ver seção (g).
3. **Revogação de pontos no DELETE** (`0060_gamificacao.sql:389-444`): apagar um
   broker de negócio `won` apaga o `game_events` correspondente **e grava
   `deal_history` kind `game_points_revoked`**. Ou seja, corrigir participante
   depois da carga polui o histórico.

**Ordem de inserção segura para importação:**
`deals` → `deal_clients` → `deal_participants` (brokers primeiro, na ordem dos
slots) → corrigir/limpar linhas `auto_added` → conferir `sum(share_pct) = 100`.

---

## (c) `deal_participants.role` e `ordinal`

### `role` — três valores, check inline

```sql
-- 0006_deals.sql:130
role text not null check (role in ('broker','manager','director')),
```

É `text` com `check`, **não** o enum `app_role`. A constraint é
`deal_participants_role_check` (nome referenciado em `0053_pipeline_e2e.sql:45`).
`admin`, `cca`, `sdr`, `marketing` e `partner` **não têm linha aqui** — decisão
explícita da 0053 (`0053:120-126`): quem não tem correspondência não participa
do rateio nem dos pontos.

### `share_pct`, `auto_added`

- `share_pct numeric(6,3) not null default 0 check (share_pct between 0 and 100)` (`0006:131`)
- `auto_added boolean not null default false` (`0006:133`) — *"Marca quem entrou
  por automação, para o gestor saber o que pode reajustar"*. Na importação,
  marque `false` no que veio do legado e deixe o autofill marcar `true` no que ele criar.

### `ordinal` — o slot da tela

```sql
-- 0025_deal_participant_ordinal.sql:17-18
alter table public.deal_participants add column if not exists ordinal smallint not null default 1;
-- :31-32
add constraint deal_participants_ordinal_check check (ordinal between 1 and 3);
```

Motivo (`0025:1-15`): todas as linhas do mesmo insert têm o **mesmo `created_at`
ao microssegundo**, então a leitura por `created_at` trocava as pessoas de slot
entre reloads — e o operador "corrigia", trocando de verdade quem responde pelo
negócio.

**Armadilha da importação:** o default é `1` e **não existe unique em
`(deal_id, role, ordinal)`** (conferido: as únicas constraints de
`deal_participants` são a PK, o `unique (deal_id, profile_id, role)` de
`0006:136` e os dois `check`). Inserir três brokers sem `ordinal` deixa os três
em `ordinal = 1` e reintroduz exatamente o bug de 2025. **Sempre grave o
ordinal.**

O front confirma que o slot vem daí:

```ts
// src/integrations/supabase/newSchema.ts:309-310
allRows((from, to) => db.from("deal_participants").select("*")
  .order("ordinal").order("created_at").order("id").range(from, to)),
// :441-455  brokers[0]/[1]/[2] → broker1/2/3, managers[0..2] → manager1/2/3, directors[0..1]
```

### A ponte legada `broker1/2/3`, `manager1/2/3`, `cotista2`

`newSchema.ts:356-479` traduz o schema novo para a forma que as telas esperam:

| Campo legado | Origem no schema novo |
|---|---|
| `broker1/2/3`, `broker1_id/2_id/3_id`, `broker1_share/2_share/3_share` | `deal_participants` `role='broker'`, ordenado por `ordinal`, posições 0/1/2 (`newSchema.ts:441-449,453-455`) |
| `manager1/2/3`, `manager1_id/2_id/3_id` | idem, `role='manager'` |
| `director1_id/2_id`, `director1_name/2_name` | idem, `role='director'` — só **dois** slots |
| `client`, `cpf`, `contato`, … | `deal_clients` `ordinal = 1` (`newSchema.ts:361`) |
| `client2`, `cpf2`, `cotista2`, … | `deal_clients` `ordinal = 2` (`newSchema.ts:362`) |
| `cotista` / `cotista2` | `deal_clients.is_shareholder` boolean → `"Sim"`/`"Não"`/`undefined` (`newSchema.ts:381-387` e `398-404`) |
| `vgv_liquido` / `deal_value` | `deals.vgv_net` (coluna **gerada**) |

Os nomes dos participantes **não** vêm de `profiles` direto: vêm da RPC
`deal_participant_names()` (`newSchema.ts:311`), que é `security definer` e devolve
só id/nome dos negócios que o usuário já pode abrir (`0027_product_visibility.sql:10-32`).
Um corretor **não enxerga o nome do gerente** — por isso `saveLegacyDeal` só
apaga participantes de um papel quando o formulário trouxe alguém daquele papel
(`newSchema.ts:975-988`).

**Limite conhecido, documentado no próprio código** (`newSchema.ts:979-986`):
> *"a tela tem 3 slots por papel, então este DELETE também remove um 4º
> participante que tenha entrado por SQL ou importação"*.

→ **Não importe mais de 3 corretores nem mais de 3 gerentes por negócio.** O
quarto é apagado silenciosamente no primeiro salvamento do modal.

---

## (d) `pipeline_stages` — a lista completa que o seed cria

`pipeline_stages` **não é criada por nenhuma migration com dados**. Quem semeia é
`supabase/seed.sql:11-22`, que roda **depois** de todas as migrations — fato
explicado em `supabase/seed.sql:36-42` (foi por isso que a 0052 e a 0061 §7
viraram no-op em banco novo).

| code | label | position | outcome | color | requires_document | is_initial |
|---|---|---|---|---|---|---|
| `incomplete` | Incompleto | 1 | `open` | `#94a3b8` | false | **true** |
| `lead` | Lead | 2 | `open` | `#38bdf8` | false | false |
| `proposal` | Proposta | 3 | `open` | `#818cf8` | false | false |
| `visit_scheduled` | Visita Agendada | 4 | `open` | `#e879f9` | false | false |
| `under_analysis` | Em Análise | 5 | `open` | `#fbbf24` | **true** | false |
| `approved` | Aprovado | 6 | `open` | `#34d399` | **true** | false |
| `contract` | Contrato | 7 | `open` | `#22d3ee` | **true** | false |
| `closed` | Fechado | 8 | **`won`** | `#facc15` | **true** | false |
| `lost` | Perdido | 9 | **`lost`** | `#f87171` | false | false |

Fonte literal: `supabase/seed.sql:11-22`. Bate com o snapshot do banco remoto
(`SCHEMA_ALVO.md:93`: `pipeline_stages 9`).

**Estrutura** (`0003_catalog.sql:100-124`):
- `code text not null unique`, `label text not null`, `position int not null`
- `outcome deal_outcome not null default 'open'`
- `requires_document boolean not null default false` — bloqueia avanço sem documento
- `max_minutes int check (max_minutes is null or max_minutes > 0)` — SLA, NULL = sem limite
- `is_initial boolean not null default false`, `active boolean not null default true`

**Dois índices únicos que a importação precisa respeitar** (`0003:118-120`):
```sql
create unique index pipeline_stages_position_idx on public.pipeline_stages (position) where active;
create unique index pipeline_stages_one_initial  on public.pipeline_stages ((is_initial)) where is_initial;
```
- `position` é único **entre as ativas**: não dá para ter duas etapas ativas na mesma posição.
- **Exatamente um** `is_initial = true` em todo o banco.

`convert_lead_to_deal` depende do inicial existir (`0028:178-182`):
*"Nenhum estágio inicial configurado no pipeline."*

**Nota de cor:** `pipeline_stages.color` existe e é hex, mas o front **não usa** —
o tom vem de um mapa por `code` (`src/components/pipeline/stages.ts:11-33`),
porque hex não acompanha a troca de tema. Etapa nova cai em `neutral`.

**Nota de rótulo:** o mapeamento Bubble → etapa é seu problema. O front deriva a
etapa do "Status 2" quando ele é conclusivo:
`dealStageCodeFor` (`newSchema.ts:816-821`) manda `VENDA` → `closed`,
`isLossStatus(...)` → `lost`, senão usa `form.stage || "incomplete"`.

---

## (e) `stage_permissions` — a matriz de quem move o quê

```sql
-- 0003_catalog.sql:130-136
create table public.stage_permissions (
  stage_id  uuid not null references public.pipeline_stages(id) on delete cascade,
  role      app_role not null,
  can_enter boolean not null default true,
  can_exit  boolean not null default true,
  primary key (stage_id, role)
);
```

**Ausência de linha = ninguém além de admin entra** (`0003:128`, e
`can_enter_stage` em `0003:138-154` começa em `public.is_admin()`).
`can_exit_stage` é o par, criado em `0020_core_fixes.sql:63-82`.

### Matriz efetiva — `supabase/seed.sql:26-58` (é ela que vale num banco novo)

| etapa | admin | director | manager | broker | cca |
|---|---|---|---|---|---|
| `incomplete` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | — |
| `lead` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | — |
| `proposal` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | — |
| `visit_scheduled` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | — |
| `under_analysis` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ |
| `approved` | ✓/✓ | ✓/✓ | **✗**/✓ | — | ✓/✓ |
| `contract` | ✓/✓ | ✓/✓ | ✓/✓ | — | ✓/✓ |
| `closed` | ✓/✓ | ✓/✓ | ✓/✓ | — | ✓/✓ |
| `lost` | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ | ✓/✓ |

(`can_enter`/`can_exit`; `—` = sem linha, ou seja, negado.)

Derivação do seed: admin e director recebem tudo (`seed.sql:26-30`); manager
recebe tudo com `can_enter = (code <> 'approved')` (`seed.sql:43-46`); broker
recebe só `incomplete, lead, proposal, visit_scheduled, under_analysis, lost`
(`seed.sql:48-52`); cca recebe `under_analysis, approved, contract, closed, lost`
(`seed.sql:54-58`).

**Regra de negócio:** *"Aprovar é decisão da esteira de crédito (`cca_cases`), não
de quem vende"* (`0052_stage_matrix_approved.sql:10-14`). O gerente **pede**, não
arrasta (`0061_equipes_permissoes.sql:315-316`).

**Duas fontes históricas, hoje reconciliadas:** `0052` (update corretivo) e
`0061 §7` (`0061:291-337`, 39 linhas com `on conflict do nothing`) rodam **antes**
do seed criar as etapas — portanto viram no-op em banco novo. A 0076 explica
que não repete o seed para não ter duas fontes de verdade (`0076_pipeline.sql:151-153`),
e `seed.sql:36-42` documenta que a correção mora no seed **por isso**.

**Para a importação:** a matriz é irrelevante para INSERT (ver (g)/(i)), mas é
crítica para qualquer **UPDATE de `stage_id`** — inclusive um "backfill de etapa"
pós-carga. `deals_guard_stage` só pula a checagem quando `auth.uid() is null`
(`0028:95-104`): carga sem JWT passa; carga com JWT de corretor é recusada com
`42501`.

`stage_permissions` e `closed_months` estão na publication `supabase_realtime`
desde a 0076 (`0076:74-81`), porque são **travas lidas pela tela**.

---

## (f) `deals.month_base` e `closed_months` — importar negócio em mês fechado quebra?

### **Sim, quebra** — e a saída não é o `service_role`

```sql
-- supabase/migrations/20260725120900_0010_gamification.sql:29-53
create or replace function public.deals_guard_closed_month() … as $$
declare v_period date := coalesce(new.month_base, old.month_base);
begin
  if public.is_admin() then return new; end if;
  if exists (select 1 from public.closed_months cm where cm.period = v_period) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.', …
  end if;
  return new;
end; $$;

create trigger deals_guard_closed_month
  before insert or update on public.deals    -- ← INSERT também
  for each row execute function public.deals_guard_closed_month();
```

**`is_admin()` não é o papel do Postgres.** É
`has_role('admin')` → `exists (… where ur.profile_id = auth.uid() …)`
(`0002_identity.sql:237-245`, `211-222`). Numa carga por `psql`/`postgres` ou por
`service_role` **sem JWT**, `auth.uid()` é NULL → `is_admin()` é falso → **o
INSERT levanta exceção**. `service_role` fura RLS, mas **não fura trigger**.

Três saídas, e o próprio repositório usa duas:

| Saída | Como | Onde já é usada | Consequência |
|---|---|---|---|
| **A. Fingir sessão de admin** | `select set_config('request.jwt.claims', json_build_object('sub','<uuid do admin>','role','authenticated')::text, false);` antes da carga | `tests/02_business_rules.sql:432-434` | `is_admin()` passa; `current_user` continua `postgres`, então as travas de (g) que escapam por `current_user` **continuam abertas**. É a combinação mais confortável para importar |
| **B. Desligar o trigger** | `alter table public.deals disable trigger deals_guard_closed_month; … enable …` | a própria migration `0028_document_review.sql:31,49` | Direto, mas exige dono da tabela e uma janela em que ninguém mais escreve |
| **C. Reabrir o mês** | `delete from public.closed_months where period = …` | `tests/58_pipeline_rateio.sql:68`, `seeds/059_test_scenarios_rollback.sql:52` | **Deixa rastro em `month_reopenings`** (ver abaixo) e, se a tela estiver aberta, o realtime destrava a edição para todo mundo |

### `month_base` — o trigger sobrescreve o seu valor

```sql
-- 0032_game_cycle_month.sql:60-70
if new.month_base is null or new.month_base = public.month_start(current_date) then
  new.month_base := coalesce(public.current_season_month(), new.month_base, public.month_start(current_date));
end if;
```

Lê-se: *"Só substitui o valor que veio do default da coluna (ou nulo explícito).
Mês-base digitado — importação, correção do admin … — continua valendo"*
(`0032:61-64`). A intenção é boa, mas a condição é `= month_start(current_date)`:
**um negócio legado cujo mês-base seja o mês corrente do calendário é
indistinguível do default** e vai ser reescrito com o mês da temporada aberta
(`current_season_month()`, `0032:33-43`).

Ordem dos gatilhos `BEFORE INSERT` em `deals` é alfabética e **deliberada**
(`0032:76-78`): `deals_default_month_base` → `deals_guard_closed_month` →
`deals_guard_esteira_label`. O guard julga o mês **já reescrito**.

`month_base date not null default public.month_start(current_date)` (`0006:39`).
Comentário oficial da coluna (`0032:86-88`):
> *"Mês contábil do negócio. Nasce do ciclo aberto do jogo … Só
> `close_month_and_season()` o move."*

### `closed_months` e `month_reopenings`

```sql
-- 0010_gamification.sql:20-27
create table public.closed_months (
  period    date primary key,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  notes     text,
  constraint closed_months_is_month_start check (period = public.month_start(period))
);
```
→ `period` **tem de ser dia 1**. `'2024-05-17'` viola `closed_months_is_month_start`.

Fechar é RPC atômica, admin-only (`0021_close_month_rpc.sql:11-59`):
- recusa mês já fechado (`0021:26-29`)
- **migra todo `outcome = 'open'` daquele mês para o mês seguinte** (`0021:32-36`)
- insere em `closed_months`
- fecha a temporada do jogo junto (`0021:43-51`); "Nenhuma temporada aberta" não impede

`month_reopenings` (`0076_pipeline.sql:87-124`) é escrita **só por trigger**
`closed_months_log_reopen` (`after delete on closed_months`). Não há policy de
INSERT: *"Uma tela que pudesse inserir aqui poderia inventar reabertura que não
aconteceu"* (`0076:101-103`). Leitura só para admin/director (`0076:105-106`).

**Limite conhecido, e é armadilha de importação** (`0076:28-35`): o trigger **não
distingue reabertura de limpeza**. Todo `delete` em `closed_months` — inclusive o
que você fizer para destravar a carga — vira linha em `month_reopenings`, com
`reopened_by` nulo. Se usar a saída **C**, limpe `month_reopenings` depois.

E a reabertura **não desfaz** a migração de propostas: `close_month_and_season`
não guarda quais linhas moveu (`0076:37-40`).

---

## (g) Triggers em `deals` (e vizinhas) que geram `deal_history`, notificação e `game_events`

### Inventário completo — `deals`

| Trigger | Quando | Função | O que produz |
|---|---|---|---|
| `deals_default_month_base` | BEFORE INSERT | `0032:81-84` | reescreve `month_base` |
| `deals_guard_closed_month` | BEFORE INSERT **or** UPDATE | `0010:51-53` | **exceção** em mês fechado |
| `deals_guard_esteira_label` | BEFORE INSERT **or** UPDATE OF `status_detail` | `0037:66-68` | **exceção** no rótulo de esteira |
| `deals_guard_document_review` | BEFORE UPDATE | `0028:75-77` | **exceção** se mexer nas 6 colunas `document_review_*` |
| `deals_guard_stage` | BEFORE UPDATE | `0006:435-437`, corpo em `0028:82-140` | matriz + documento + `stage_entered_at` + `outcome` + `closed_at` |
| `deals_guard_value` | BEFORE UPDATE | `0061:245-247` | exceção sem `deals.edit_value` |
| `deals_set_updated_at` | BEFORE UPDATE | `0006:69-71` | `updated_at` |
| `deals_add_creator_participant` | AFTER INSERT | `0012:170-172`, corpo vigente em `0053:98-134` | **insere `deal_participants`** |
| `deals_award_points` | AFTER **INSERT** or UPDATE | `0060:341-343` | **insere `game_events`** |
| `deals_log_changes` | AFTER UPDATE | `0006:461-463` | **insere `deal_history`** |

### O que gera `deal_history`

- `deals_log_changes` (AFTER **UPDATE** apenas) — `kind = 'stage_changed'` e
  `kind = 'value_changed'` (`0006:439-463`). Ganhou `security definer` na
  `0020_core_fixes.sql:34`. **Não dispara em INSERT** → importação não polui o histórico por aqui.
- `convert_lead_to_deal` → `kind = 'created'` com `detail = {"from_lead": …}` (`0028:223-224`).
- `submit_deal_for_manager_review` → `'document_review_requested'` (`0028:436-439`).
- `review_deal_documents` → `'document_review_returned'` / `'document_review_approved'` (`0028:508-512, 534-537`).
- `submit_deal_for_analysis` (fluxo externo) → `'sent_to_developer'` (`0028:342-344`).
- `deal_participants_revoke_points` → `'game_points_revoked'` (`0060:426-429`).
- `add_deal_comment(uuid,text)` → `'comment'` (`0020:296-330`) — é a única escrita manual.

**Não há trigger de INSERT em `deals` que escreva `deal_history`.** Se você quiser
o histórico do Bubble, insira em `deal_history` diretamente: a tabela não tem RLS
de INSERT (só `deal_history_select`, `0006:649-651`), então `service_role`/`postgres`
grava sem cerimônia. Campos: `deal_id`, `kind` (text livre, NOT NULL), `from_value`,
`to_value`, `detail jsonb`, `created_at`.

### O que gera notificação

Nenhum trigger de `deals`. As notificações do domínio saem das **RPCs** da 0028:
- `document_review_requested` → para todos os `role='manager'` do negócio (`0028:441-449`)
- `document_review_returned` → para todos os `role='broker'` (`0028:514-522`)
- `document_review_approved` → para todos os `role='broker'` (`0028:541-549`)

→ **Importação em massa não dispara notificação nenhuma**, desde que não chame essas RPCs.

### O que gera `game_events` — a armadilha mais cara

```sql
-- 0060_gamificacao.sql:296-311 (dentro de deals_award_points)
if tg_op = 'INSERT' then
  v_venda := (new.outcome = 'won');
else
  v_venda   := (new.outcome = 'won' and old.outcome is distinct from 'won');
  v_distrato:= (old.outcome = 'won' and new.outcome in ('lost','cancelled'));
end if;
-- :341-343
create trigger deals_award_points after insert or update on public.deals …
```

Comentário oficial (`0060:336-339`): *"Venda em INSERT ou UPDATE (negócio
importado já ganho pontuava zero)"*. Ou seja, **o INSERT foi adicionado
justamente pensando em importação** — mas para o momento da importação, não para
a data legada.

Somado a `deal_participants_award_points` (AFTER INSERT em `deal_participants`,
`0060:348-376`), toda venda histórica importada gera `venda` (**600 pontos**, por
`seed.sql:155`) para cada corretor, **na temporada aberta hoje**
(`award_game_points` usa `current_game_season()`, `0010:190`). O parâmetro
`p_occurred` existe, mas o trigger passa `now()` (`0060:317, 366`).

Também: `deal_documents_award_points` (AFTER INSERT em `deal_documents`,
`0060:484-486`) dá `incompleto_com_doc` (10 pts) se o negócio está em `incomplete`.
E `cca_award_points` (AFTER UPDATE em `cca_cases`, `0010:341-343`) dá `esteira`
(140) e `aprovado` (250).

**Mitigações, do mais conservador ao mais rápido:**

| Opção | Como | Consequência |
|---|---|---|
| **1. Fechar a temporada antes da carga** | `award_game_points` retorna NULL sem temporada aberta (`0010:194-196`) | Nenhum evento nasce. Mas `close_game_season` **congela `game_season_results`** e abre a próxima (`0010:291-296`) — mexe no jogo de verdade. Só faz sentido se a carga for antes do go-live |
| **2. Desligar os 4 triggers de pontuação durante a carga** | `alter table … disable trigger deals_award_points;` (idem `deal_participants_award_points`, `deal_documents_award_points`) | Cirúrgico e reversível. É o que eu faria |
| **3. Deixar pontuar e limpar depois** | `delete from public.game_events where ref_type='deal' and ref_id in (…importados…)` | Funciona (`game_events` não tem trigger), mas você precisa da lista exata dos deals importados |

Não confie no `game_events_dedupe_idx` (`0010:121-123`) para salvar: ele é único em
`(season_id, profile_id, event_code, ref_id)` e só impede **duplicar o mesmo
negócio**, não impede pontuar 4.000 negócios de uma vez.

### As travas por `current_user` (as duas que escapam para `postgres`/`service_role`)

```sql
-- 0028_document_review.sql:60-70 — deals_guard_document_review
… and current_user not in ('postgres', 'service_role') then raise exception … 42501
-- 0037_esteira_label_guard.sql:52-58 — deals_guard_esteira_label
… and coalesce(new.document_review_status,'draft') <> 'approved'
  and current_user not in ('postgres','service_role') then raise exception … 42501
```

- `deals_guard_document_review` é **BEFORE UPDATE apenas** → você pode **inserir**
  `document_review_status = 'approved'` livremente, mas não pode **alterar** depois
  a não ser como `postgres`/`service_role` (ou pelas RPCs `security definer`).
- `deals_guard_esteira_label` cobre **INSERT também** (`0037:34-37`, explícito:
  *"Cobre INSERT também: o formulário de criação e a importação gravam
  `status_detail` no nascimento"*). Se o Bubble trouxer `13. ESTEIRA AGIL` num
  negócio com `document_review_status` ≠ `'approved'`, o INSERT é recusado com
  `42501` — **a menos que** você seja `postgres`/`service_role`.
  A normalização é `deal_status_bare` (`0037:21-28`), espelho de `bareStatus` em
  `src/lib/dealStatus.ts:26`: tira prefixo numerado, apara, caixa alta. `"esteira agil"`
  minúsculo **não** escapa.
  ⚠ Não torne esse trigger `security definer` para contornar: `0051:22-27` explica
  que isso mata a própria trava (dentro dele `current_user` viraria `postgres`).

### Trigger vizinho que muda `deals` sem você pedir

`cca_cases_sync_esteira_label` (AFTER INSERT OR UPDATE OF `status` em `cca_cases`,
`0037:119-121`) **faz UPDATE em `deals.status_detail`**. Se a importação criar
`cca_cases` com `status='under_review'`, o negócio recebe `13. ESTEIRA AGIL` — e
esse UPDATE passa por `deals_guard_closed_month` (limite registrado em `0037:82-86`).

`developer_submissions_advance_case` (AFTER INSERT em `developer_submissions`,
`0077_cca_documentos.sql:350-352`) **faz UPDATE em `cca_cases`** — mas só para
construtora `flow='external'` e caso em `under_review`/`pending_documents`
(`0077:334-343`).

---

## (h) `developers` e `developer_projects` — chave natural e como o front resolve

### `developers` (`0003_catalog.sql:20-72`)

```sql
name text not null unique,
slug text not null unique,
flow developer_flow not null default 'internal',
submission_email extensions.citext,
active boolean not null default true,
constraint developers_external_needs_email check (flow <> 'external' or submission_email is not null)
```

**Duas chaves naturais: `name` e `slug`, as duas `unique`.** `name` unique é o que
mais dói numa importação — dois registros do Bubble com o mesmo nome de
construtora colidem em `23505`.

**`slug` é preenchido por trigger** (`0003:42-72`):
```sql
create trigger developers_ensure_slug before insert on public.developers for each row …
```
Se `slug` vier nulo ou vazio, a função gera de `slugify(name)` e resolve colisão
com sufixo numérico (`horizonte-urbanismo`, `horizonte-urbanismo-2`, …).
`slugify` (`0001_foundation.sql:171-182`) usa `unaccent_fallback` próprio — sem
dependência de extensão. **Só INSERT**: renomear a construtora depois **não**
regenera o slug.

**Constraint que morde:** `flow='external'` **exige** `submission_email`. Se o
legado só tiver o nome, importe como `internal` (o default) e ajuste depois.

`deals.developer_id` é `on delete restrict` (`0006:30`) — construtora com negócio
não é apagável.

### `developer_projects` (`0003:77-92`)

```sql
developer_id uuid not null references public.developers(id) on delete cascade,
name text not null,
city text, state char(2),
active boolean not null default true,
unique (developer_id, name)
```

Chave natural: **`(developer_id, name)`**. Não tem slug. `state` é `char(2)` — "RS",
não "Rio Grande do Sul" (o padrão está em `seeds/020:15-21`).

`deals.project_id` é `on delete set null` (`0006:31`).

### Como o front resolve construtora

```ts
// src/integrations/supabase/newSchema.ts:877-891
let developerId = form.developer_id ?? null;
if (!developerId && form.developer) {
  const { data } = await db.from("developers").select("id").ilike("name", form.developer).maybeSingle();
  developerId = data?.id ?? null;
}
let projectId = form.project_id ?? null;
if (!projectId && form.project && developerId) {
  const { data } = await db.from("developer_projects").select("id")
    .eq("developer_id", developerId).ilike("name", form.project).maybeSingle();
  projectId = data?.id ?? null;
}
```

- Prefere o **id**; só cai no nome quando não tem id.
- Busca por **`ilike` exato no nome** (sem `%`), `maybeSingle()`.
- Empreendimento é sempre **escopado pela construtora**.
- Se não achar, grava **NULL** — silenciosamente, sem erro.

Na leitura o front monta mapas `id → name` (`newSchema.ts:330-338`) e devolve
`developer: developerById.get(deal.developer_id) || ""` (`:424`).

**Consequência para a importação:** o nome da construtora no CSV precisa bater
**caractere a caractere** (case-insensitive) com `developers.name` para o modal
resolver. Acento, ponto, "LTDA", espaço duplo — tudo conta. Normalize **antes**
da carga, do lado do CSV; não é seguro renomear `developers.name` depois (o slug
não acompanha).

RLS: leitura para todo autenticado (`0003:219-220, 225-226`), escrita para
`admin`/`cca` (`0003:221-223, 227-229`).

---

## (i) NOT NULL sem default — o mínimo obrigatório por tabela

Lista derivada das migrations. "gerado" = tem trigger que preenche antes.

| Tabela | NOT NULL **sem** default | NOT NULL **com** default (não precisa mandar) |
|---|---|---|
| **`deals`** | **`stage_id`** — e só ele | `id`, `code` (sequence), `outcome`='open', `month_base`=`month_start(current_date)`, `discount_pct`=0, `stage_entered_at`=now(), `created_at`, `updated_at`, `document_review_status`='draft' (`0028:11`). `created_by` é *nullable* mas ganhou default `auth.uid()` em `0012:176-177` |
| **`deal_clients`** | `deal_id`, `full_name` | `id`, `ordinal`=1, `has_informal_income`=false, `created_at`, `updated_at` |
| **`deal_participants`** | `deal_id`, `profile_id`, `role` | `id`, `share_pct`=0 (sobrescrito), `auto_added`=false, `created_at`, `ordinal`=1 (**mande sempre**) |
| **`deal_history`** | `deal_id`, `kind` | `id`, `created_at` |
| **`pipeline_stages`** | `code`, `label`, `position` | `id`, `outcome`='open', `requires_document`=false, `is_initial`=false, `active`=true, `created_at`, `updated_at` |
| **`stage_permissions`** | `stage_id`, `role` (são a PK) | `can_enter`=true, `can_exit`=true |
| **`developers`** | `name` · `slug` é NOT NULL mas **gerado por trigger** (`0003:70-72`) | `id`, `flow`='internal', `active`=true, `created_at`, `updated_at` |
| **`developer_projects`** | `developer_id`, `name` | `id`, `active`=true, `created_at`, `updated_at` |
| **`developer_submissions`** | `deal_id`, `developer_id`, `to_email`, `subject` | `id`, `document_ids`='{}', `status`='queued', `attempts`=0, `created_at`, `updated_at` |
| **`visits`** | `scheduled_at` | `id`, `result`='scheduled', `created_at`, `updated_at`. **Mais** `check (deal_id is not null or lead_id is not null)` (`0006:378`) |
| **`closed_months`** | `period` (PK) — e `check (period = month_start(period))` | `closed_at`=now() |
| **`month_reopenings`** | `period` | `id`, `reopened_at`=now(). **Sem policy de INSERT** — só o trigger escreve (`0076:101-106`) |

### Outros checks e uniques que um insert em massa precisa respeitar

**`deals`**
- `code` **unique**
- `vgv_gross check (vgv_gross is null or vgv_gross >= 0)` (`0006:41`)
- `discount_pct check (between 0 and 100)` (`0006:42`)
- `vgv_net` é **GENERATED ALWAYS AS STORED** = `round(coalesce(vgv_gross,0) * (1 - discount_pct/100), 2)` (`0006:45-46`) → **não pode ser inserido**; qualquer valor no INSERT dá erro
- `deals_closed_consistency check (outcome = 'open' or closed_at is not null)` (`0006:59-60`) → **negócio `won`/`lost`/`cancelled` sem `closed_at` é rejeitado**
- `deals_document_review_status_check in ('draft','pending','returned','approved')` (`0028:17-18`)
- FKs: `lead_id`→`leads` (set null), `developer_id`→`developers` (**restrict**), `project_id`→`developer_projects` (set null), `stage_id`→`pipeline_stages` (**restrict**), `created_by`/`document_review_*_by`→`profiles` (set null)

**`deal_clients`**
- `check (ordinal in (1,2))` (`0006:86`) — **só titular e compra conjunta**
- `unique (deal_id, ordinal)` (`0006:114`)
- `deal_id` **on delete cascade**
- `email` é `citext`; `monthly_income numeric(12,2)`

**`deal_participants`**
- `unique (deal_id, profile_id, role)` (`0006:136`) — a mesma pessoa **pode** ser broker e manager do mesmo negócio (duas linhas)
- `profile_id` **on delete restrict** (`0006:129`) — perfil com participação não é apagável
- `check role in ('broker','manager','director')`, `check ordinal between 1 and 3`, `check share_pct between 0 and 100`

**`developer_submissions`**
- `status check in ('queued','sending','sent','failed','cancelled')` (`0007:76-77`)
- `document_ids uuid[] not null default '{}'` — snapshot, **não** é FK
- `to_email` é `citext`
- ⚠ o INSERT dispara `developer_submissions_advance_case` (ver (g))

**`cca_cases`** (fora do escopo, mas amarra `deals`)
- `deal_id` é **`unique`** (`0007:17`) — **um caso por negócio**
- `check (status not in ('approved','rejected') or decided_at is not null)` (`0007:29-30`)

---

## Apêndice A — RLS e permissão para inserir em massa

**Recomendação: importe como `postgres` (psql/migration) ou `service_role`.** Os
dois furam RLS. Nenhum dos dois fura trigger.

### Se ainda assim quiser saber o que a API permite

| Tabela | INSERT exige |
|---|---|
| `deals` | `auth_effective_role(auth.uid()) in ('admin','director','manager','broker','cca')` — policy `deals_insert` reescrita em `0053_pipeline_e2e.sql:90-94`. **`auth_effective_role` é o papel de MAIOR precedência** (`0053:64-79`), não "tem o papel": SDR, marketing e sócio ficam de fora mesmo carregando o `broker` que `handle_new_auth_user` dá a todo cadastro |
| `deal_clients` | `can_edit_deal(deal_id)` (`0012:235-237`) |
| `deal_participants` | `can_edit_deal(deal_id)` (`0006:633-635`) |
| `deal_history` | **nenhuma policy de INSERT** — só `deal_history_select` (`0006:649-651`). Pela API é impossível; por `service_role`/`postgres`, livre |
| `pipeline_stages`, `stage_permissions` | `is_admin()` (`0003:233-241`) |
| `developers`, `developer_projects` | `has_any_role('admin','cca')` (`0003:221-229`) |
| `closed_months` | `is_admin()` (`0010:391-393`) |
| `month_reopenings` | **nenhuma** (`0076:101-106`) |
| `visits` | `broker_id = auth.uid() or is_admin() or manages_profile(broker_id)` (`0006:660-663`) |

`can_edit_deal` vigente (`0044_feature_permissions_enforced.sql:230-243`):
```sql
select public.has_permission('cca.review')
    or exists (select 1 from public.deal_participants dp
               where dp.deal_id = p_deal_id
                 and (dp.profile_id = auth.uid() or public.manages_profile(dp.profile_id)));
```
→ **ovo e galinha:** para inserir o primeiro participante você já precisa ser
participante. Pela API isso só se resolve com `deals_add_creator_participant`
(AFTER INSERT, `0053:98-134`), que cria a linha do autor com o papel efetivo dele.
Mais uma razão para importar por `service_role`.

`can_see_deal` (`0006:578-591`): `can_read_all()` **ou** participante dentro de
`auth_visible_profiles()`. **Negócio importado sem nenhum `deal_participants` é
invisível para todo mundo que não seja admin/diretor/sócio/CCA.**

### Receita de carga sugerida (conservadora)

```sql
begin;

-- 1. contexto de admin: destrava deals_guard_closed_month sem desligar trigger
select set_config('request.jwt.claims',
  json_build_object('sub','<uuid do perfil admin>','role','authenticated')::text, false);
-- (current_user continua postgres: as travas de current_user seguem abertas)

-- 2. silenciar a gamificação durante a carga
alter table public.deals              disable trigger deals_award_points;
alter table public.deal_participants  disable trigger deal_participants_award_points;
alter table public.deal_documents     disable trigger deal_documents_award_points;

-- 3. carga: developers → developer_projects → deals → deal_clients
--           → deal_participants (brokers na ordem dos slots, com ordinal)
--           → deal_history → visits

-- 4. reativar
alter table public.deal_documents     enable trigger deal_documents_award_points;
alter table public.deal_participants  enable trigger deal_participants_award_points;
alter table public.deals              enable trigger deals_award_points;

-- 5. conferências
select deal_id, sum(share_pct) from public.deal_participants
 where role='broker' group by 1 having sum(share_pct) <> 100;
select count(*) from public.deals d
 where not exists (select 1 from public.deal_participants p where p.deal_id = d.id);
select deal_id, role, ordinal, count(*) from public.deal_participants
 group by 1,2,3 having count(*) > 1;

commit;
```

`disable trigger` exige ser dono da tabela — funciona em migration/psql como
`postgres`, **não** via PostgREST com `service_role`. Se a carga for por API,
a saída é a opção 3 de (g): limpar `game_events` depois.

---

## Apêndice B — Padrão de idempotência do projeto

Os seeds do repositório usam três formas, todas reaproveitáveis na importação:

1. **UUID determinístico + `where not exists` por chave natural**
   (`seeds/030_commercial_operation.sql:212-216`): checa `id` **e** `code`.
2. **`on conflict do nothing`** em quase tudo (`seed.sql:22,30,46,52,58`).
3. **`values … join catálogo on code`** — nunca UUID de catálogo hardcoded
   (`seeds/030:211`: `join public.pipeline_stages s on s.code = d.stage_code`;
   `0061:336`: `join public.pipeline_stages s on s.code = m.stage_code`).

Cada seed tem rollback próprio (`059_test_scenarios_rollback.sql`,
`069_demo_showcase_rollback.sql`). **Vale escrever o rollback da importação junto
com ela** — e, se ele apagar `closed_months`, limpar `month_reopenings` também
(`0076:28-35`).

Para negócios em etapa final, o padrão vencedor é o do seed de demonstração
(`seeds/060_demo_showcase.sql:317-320`):
> *"Os negócios nascem JÁ na etapa final: `deals_guard_stage` é `before update`,
> então INSERT direto não passa pela matriz de permissão nem pela exigência de
> documento."*

E ele preenche na mão o que o trigger de UPDATE preencheria
(`060:333-346`): `outcome` lido de `pipeline_stages` pelo `code`, `closed_at`
só quando a etapa é `closed`/`lost`, `document_review_status` coerente com a
etapa. **Copie esse padrão** — é o que satisfaz `deals_closed_consistency` e
mantém `outcome` alinhado com `stage_id`.

---

## Apêndice C — Suposições e o que não foi verificado

- **Não executei nada contra o banco.** Tudo é leitura de arquivo. Onde cito
  número de linhas do banco remoto, a fonte é `docs/importacao/SCHEMA_ALVO.md:92-93`
  (snapshot de 09/09/2026) ou o comentário da migration que mediu.
- **Fuso:** nenhuma migration declara timezone. As colunas são `timestamptz`;
  quem inserir precisa dizer o offset. Datas do Bubble sem fuso devem ser
  interpretadas como **America/Sao_Paulo** — suposição, não fato apurado aqui.
- **`month_base` é `date`**, não `timestamptz`: não sofre conversão de fuso, mas
  sofre o trigger de (f).
- Não verifiquei o conteúdo dos CSVs do Bubble — este relatório é sobre o alvo.
- `deals_guard_stage` na versão vigente é a da `0028:82-140` (a `0020:86` foi
  substituída, e a `0006:394` antes dela). A diferença que importa: a 0028 exige
  `document_review_status = 'approved'` para entrar em
  `under_analysis`/`approved`/`contract`/`closed` (`0028:109-114`).
- `supabase/migrations/` tem **86 arquivos** (`ls supabase/migrations | wc -l`).
