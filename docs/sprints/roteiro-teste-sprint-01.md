# Roteiro de teste — Sprint 1 (E1 + E2)

Passo a passo para validar tudo que a Sprint 1 entregou. Complementa o
[roteiro-teste-roleta.md](roteiro-teste-roleta.md), que cobre só a roleta: aqui
estão também as telas do trilho B, os tipos, o `.env` e a bateria automática.

Os comandos SQL abaixo foram **executados em 30/07/2026** contra o Postgres
local (`supabase_db_mcmqgxvtwegtptfseqvw`, pg_cron 1.6.4, migrations 0001–0014
+ seed). Os resultados citados são os medidos.

Atalho usado em todo o documento:

```bash
alias fpsql='docker exec -i supabase_db_mcmqgxvtwegtptfseqvw psql -U postgres -d postgres'
```

---

## 0. Antes de começar — três coisas que travam o teste

### 0.1 Realtime não está publicado — bloqueia S2.1, S2.3 e S2.4 ⚠️

`Leads.tsx` e `NewLeadNotifier.tsx` assinam `postgres_changes` em
`public.leads`. Nenhuma migration de 0001 a 0014 adiciona a tabela à publicação
— só as `migrations_legacy` faziam isso. Conferido no banco local:

```sql
select count(*) from pg_publication_tables where pubname = 'supabase_realtime';
-- 0
```

Sem isso o popup de lead novo nunca dispara e a lista não se atualiza sozinha
quando o cron devolve o lead. Antes de testar as telas:

```sql
alter publication supabase_realtime add table public.leads;
```

> Isso precisa virar migration `0015` (é entrega de produto, não passo de
> teste). Enquanto não virar, rodar o comando à mão em cada ambiente.

### 0.2 O `.env` aponta para produção, que ainda não tem a `0013`/`0014`

```bash
grep VITE_SUPABASE_URL .env
# https://mcmqgxvtwegtptfseqvw.supabase.co
```

Produção ainda não recebeu o `db push` (é o item pendente no fim da
[sprint-01.md](sprint-01.md)). Para testar a UI **contra um banco com os crons
funcionando**, aponte para o stack local:

```bash
npm run db:start          # sobe o stack inteiro (API 54321, auth, realtime)
```

E no `.env`:

```
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key impressa pelo supabase start>"
```

> Hoje só o container do Postgres está de pé. `npm run db:start` é obrigatório
> para a UI: sem Kong/realtime/auth o front não conecta.

### 0.3 `npx tsc --noEmit` na raiz não checa nada

`tsconfig.json` é solution-style (`"files": []` + `references`), então o comando
sai com 0 erros sem ter olhado um arquivo. O comando certo:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

---

## 1. Bateria automática (~5 min, sem UI)

Roda tudo sem banco de pé, exceto a 1.1 que sobe um Postgres descartável.

| # | Comando | Esperado |
|---|---|---|
| 1.1 | `bash scripts/validate-schema.sh --all` | `schema ok`, todas as migrations `ok`, todas as tabelas com RLS |
| 1.2 | `npx vitest run` | **27 testes passam** (2 arquivos) |
| 1.3 | `npm run build` | build sem erro |
| 1.4 | `npx tsc --noEmit -p tsconfig.app.json` | **exatamente 9 erros** (ver 1.5) |

```bash
bash scripts/validate-schema.sh --all
```

Sobe `postgres:15-alpine`, aplica os stubs + as 14 migrations + o seed, roda os
testes `01`–`04` e checa RLS. Falha no primeiro erro de SQL. Cobre:

- `02_business_rules.sql` — inclui os **5 asserts novos da S1.6** (ordenação por
  `last_turn_at`, seções 4 e 4b)
- `04_cron_scheduling.sql` — os **12 asserts da S1.5**: os três jobs existem,
  estão ativos, chamam as funções certas, a cadência é sub-minuto ou 1 min,
  reagendar não duplica job, e `cron_jobs_health()` volta vazio para não-admin

```bash
npx vitest run
```

Esperado — verificado:

```
✓ src/test/example.test.ts        (1 test)
✓ src/integrations/supabase/leads.test.ts (26 tests)
Test Files  2 passed (2)
     Tests  27 passed (27)
```

Os 26 testes de `leads.test.ts` cobrem o núcleo do trilho B: contagem regressiva
a partir de `attend_deadline`, `canClaim`, rótulos de status e de funil,
`decorateLead`, `isLeadOverdue`.

### 1.5 Os 9 erros de tipo esperados

`npm run build` é `vite build` puro e **não faz typecheck** — a esteira não
quebra com eles. Confirmar que são estes e só estes:

| Arquivo | Erros | O que é |
|---|---|---|
| `src/pages/DailyBI.tsx` | 5 | esperado — aponta para `daily_broker_entries`/`daily_team_reports`, que não existem (S8.1) |
| `src/pages/DirectorDashboard.tsx` | 3 | pré-existentes, não vieram da S1.3 |
| `src/pages/AdminDailyTeams.tsx` | 1 | **bug real:** insert em `teams` sem o `slug` obrigatório (linha 76) |

Qualquer erro fora dessa lista é regressão da S1.3.

---

## 2. E1 — Crons e roleta (SQL, banco local)

### 2.1 S1.1 / S1.2 / S1.2b — os três jobs existem e estão ativos

```sql
select jobname, schedule, active
from cron.job where jobname like 'faceimob-%' order by jobname;
```

Esperado — verificado:

| jobname | schedule | active |
|---|---|---|
| `faceimob-auto-checkout-expired` | `* * * * *` | t |
| `faceimob-purge-cron-history` | `10 3 * * *` | t |
| `faceimob-release-expired-leads` | `30 seconds` | t |

Se o `release` aparecer como `* * * * *`, o fallback de 1 minuto foi acionado —
a instância não aceitou intervalo em segundos. Não é falha, mas dobra a janela
máxima de devolução do lead (de ~5min30s para ~6min).

### 2.2 Os jobs realmente executam

```sql
select j.jobname, d.status, d.start_time, d.end_time - d.start_time as duracao
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where j.jobname like 'faceimob-%'
order by d.start_time desc limit 8;
```

Todos `succeeded`. Cadência de 30,0 s no `release` e 60,0 s no `auto-checkout`.

### 2.3 S1.2c — `cron_jobs_health()`

A função é `security definer` com `where public.is_admin()`, então **por psql
como `postgres` ela retorna vazio** — é o comportamento correto, não um bug.
Para vê-la funcionando, simule o JWT de admin **dentro de uma transação**
(`set local` fora de transação não pega):

```sql
begin;
  select set_config('request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  select job_name, schedule, active, last_status, failures_24h, runs_24h
  from public.cron_jobs_health();
commit;
```

Esperado — verificado:

```
faceimob-auto-checkout-expired | * * * * *  | t | succeeded | 0 | 111
faceimob-purge-cron-history    | 10 3 * * * | t |           | 0 |   0
faceimob-release-expired-leads | 30 seconds | t | succeeded | 0 | 220
```

`purge-cron-history` sem `last_status` é normal se ainda não deu 03:10.

**Teste negativo:** repita sem o `set_config` — tem de vir 0 linhas, não erro.

### 2.4 S1.1 + S1.6 — ciclo completo da trava de 5 minutos

O teste que importa: o lead vencido sai do corretor **pelo cron**, sem ninguém
chamar a função, e quem estourou o prazo vai para o **fim** da fila.

> **Janela de turno:** `distribution_queue` só devolve corretor cujo turno já
> começou (`distribution_start`) e ainda não terminou (`checkout_time`).
> Escolha o turno pelo horário de **São Paulo**, não pelo do banco (UTC):
> `manha` 08:30–12:00 · `tarde` 13:30–18:00 · `noite` 19:00–21:30.
> Fila vazia quase sempre é turno errado, não bug.

**Preparação** — dois corretores da Fila Geral com check-in de hoje:

```sql
delete from public.leads where full_name like 'E2E%';
delete from public.checkins where work_date = current_date
  and profile_id in ('10000000-0000-0000-0000-000000000009',
                     '10000000-0000-0000-0000-000000000010');

insert into public.checkins (profile_id, shift_id, work_date, ip_address)
select p.id, s.id, current_date, '203.0.113.10'::inet
from public.profiles p cross join public.work_shifts s
where p.id in ('10000000-0000-0000-0000-000000000009',
               '10000000-0000-0000-0000-000000000010')
  and s.code = 'manha'          -- ajuste ao turno vigente
on conflict (profile_id, work_date, shift_id) do update
  set checked_out_at = null, auto_checkout = false;

select * from public.distribution_queue(
  (select id from public.distribution_groups where name = 'Fila Geral'));
```

Esperado: `Felipe Martins` (1), `Elisa Rocha` (2).

**Atribuição:**

```sql
insert into public.leads (id, full_name, phone)
values ('e2e00000-0000-0000-0000-0000000000e2', 'E2E Cron Teste', '11999990001');

select public.assign_lead('e2e00000-0000-0000-0000-0000000000e2');

select l.status, p.full_name, l.attend_deadline - now() as falta
from public.leads l left join public.profiles p on p.id = l.assigned_to
where l.id = 'e2e00000-0000-0000-0000-0000000000e2';
```

Esperado — verificado: vai para **Felipe** (posição 1), `falta ≈ 00:04:59`.
Os 5 minutos vêm do dado (`timeout_seconds: 300` no evento), não da doc.

**Expiração — e nada mais:**

```sql
update public.leads set attend_deadline = now() - interval '10 seconds'
where id = 'e2e00000-0000-0000-0000-0000000000e2';
update public.lead_assignments set deadline = now() - interval '10 seconds'
where lead_id = 'e2e00000-0000-0000-0000-0000000000e2' and released_at is null;
```

Espere **45 segundos**. Nenhuma chamada manual à função.

**Resultado:**

```sql
select a.sequence, p.full_name, a.release_reason, a.assigned_at, a.released_at
from public.lead_assignments a join public.profiles p on p.id = a.profile_id
where a.lead_id = 'e2e00000-0000-0000-0000-0000000000e2' order by a.sequence;

select d.start_time from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where j.jobname = 'faceimob-release-expired-leads' order by d.start_time desc limit 1;

select * from public.distribution_queue(
  (select id from public.distribution_groups where name = 'Fila Geral'));
```

Esperado — verificado na execução de 30/07:

| sequence | corretor | release_reason | released_at |
|---|---|---|---|
| 1 | Felipe Martins | `timeout` | 14:12:12.332709 |
| 2 | **Elisa Rocha** | — | — |

Execução do cron: **14:12:12.332695** — 14 µs antes da liberação, ou seja,
**mesma transação**. E a fila depois:

| posição | corretor |
|---|---|
| 1 | Elisa Rocha |
| 2 | **Felipe Martins** |

Felipe, que ignorou o lead, foi para o fim. **É a S1.6 funcionando** — antes da
`0014` ele continuaria em 1º e receberia o mesmo lead de volta.

Confira também a trilha em `lead_events` (S2.2 depende dela):

```sql
select event_type, from_value, to_value, payload, created_at
from public.lead_events where lead_id = 'e2e00000-0000-0000-0000-0000000000e2'
order by created_at;
```

Ordem esperada: `status_changed queued→assigned`, `assigned→Felipe`,
`released {"reason":"timeout"}`, `status_changed assigned→queued`,
`status_changed queued→assigned`, `assigned→Elisa`.

**Empate conhecido:** logo após a liberação, Elisa e Felipe ficam com o mesmo
`last_turn_at` (`now()` é constante na transação) e o desempate cai no
`profile_id`. Desvio de no máximo um lead, que se corrige na atribuição
seguinte. Não é regressão.

**Limpeza:**

```sql
delete from public.leads where full_name like 'E2E%';
delete from public.checkins where work_date = current_date
  and profile_id in ('10000000-0000-0000-0000-000000000009',
                     '10000000-0000-0000-0000-000000000010');
```

### 2.5 S1.2 — check-out automático

```sql
-- check-in "esquecido" de ontem
insert into public.checkins (profile_id, shift_id, work_date, ip_address)
select '10000000-0000-0000-0000-000000000009', s.id, current_date - 1, '203.0.113.10'::inet
from public.work_shifts s where s.code = 'manha'
on conflict (profile_id, work_date, shift_id) do update
  set checked_out_at = null, auto_checkout = false;
```

Espere até 60 s e confira:

```sql
select work_date, checked_out_at, auto_checkout from public.checkins
where profile_id = '10000000-0000-0000-0000-000000000009'
  and work_date = current_date - 1;
```

Esperado: `checked_out_at` preenchido e `auto_checkout = true`. Depois:
`delete from public.checkins where work_date = current_date - 1;`

### 2.6 S1.2b — poda do histórico

Não dá para esperar as 03:10. Verifique que o job existe e que a função de poda
faz o que promete:

```sql
select command from cron.job where jobname = 'faceimob-purge-cron-history';
```

Deve apagar `cron.job_run_details` com mais de 7 dias.

---

## 3. E2 — Telas de operação de leads (UI)

**Pré-requisitos:** seções 0.1 (publicar realtime) e 0.2 (`.env` local +
`npm run db:start`) feitas. Depois `npm run dev`.

Os usuários do seed estão **bloqueados no Auth** e não servem para login. Crie o
seu:

```bash
npm run user:create
```

Para os testes de dois corretores, crie **duas** contas, ponha as duas na Fila
Geral (`distribution_group_members`) e faça check-in de ambas — mesmo SQL da 2.4,
trocando os `profile_id`.

### 3.1 S2.1 — `Leads.tsx` (rota `/leads`)

A rota deixou de redirecionar para `/pipeline` (mudança em `App.tsx`).

- [ ] `/leads` abre a tela nova, não o pipeline
- [ ] a lista carrega e mostra **Origem** e **Corretor** por lead
- [ ] busca por nome, e-mail, telefone **e campanha**
- [ ] filtro de **Status** lista os valores do enum (`LEAD_STATUSES`)
- [ ] filtro de **Origem** lista as fontes + "Sem origem"
- [ ] botão **Métricas por origem** abre o painel
- [ ] **Novo lead** cria com status `queued` e o toast diz "Entrou na fila de
      distribuição. A roleta atribui o corretor." — a tela **não** escolhe
      corretor (`assign_lead` é `service_role`)
- [ ] importação por arquivo (botão de upload) cria vários
- [ ] ícones de WhatsApp e e-mail abrem com a mensagem pronta
- [ ] **Realocar corretor** (só gestor) reinicia a trava — toast "A trava de
      atendimento reiniciou."
- [ ] **Converter em negócio** some depois de convertido
- [ ] lead atrasado fica destacado

**Realtime (depende da 0.1):** com a tela aberta, force o cenário da 2.4 no
psql. A lista tem de se atualizar sozinha, sem F5, quando o cron devolver o
lead.

**Por papel** (RLS esconde dado em silêncio — testar os três):

| papel | esperado |
|---|---|
| corretor | só os leads dele; sem botão de realocar |
| gerente | leads da equipe; realocar disponível |
| diretor | tudo |

### 3.2 S2.4 — botão "Atender" e a trava de 5 minutos

- [ ] **Atender** só aparece quando o lead é seu e está `assigned` (`canClaim`)
- [ ] o card mostra a contagem regressiva enquanto o prazo corre
- [ ] clicar em Atender → toast "Lead em atendimento … está travado com você"
- [ ] **depois de atender o cronômetro para** — o banco zera `attend_deadline`
      no `claim_lead`
- [ ] **dois corretores, o mesmo lead:** com dois navegadores, o segundo a
      clicar recebe toast vermelho "Não foi possível atender" com a mensagem do
      banco. É a recusa do `claim_lead` que garante a exclusividade — não a UI
- [ ] deixar o prazo estourar sem atender: o lead sai da tela do corretor (com
      realtime publicado, sozinho)

### 3.3 S2.2 — `LeadFunnel.tsx` + `LeadDetailModal.tsx`

- [ ] as colunas do funil são as de `funnel_stage`, e **não existe coluna
      "Convertido"** — convertido é `status`, não etapa (regressão conhecida,
      corrigida nesta story)
- [ ] o card mostra o badge da etapa e o cronômetro da trava
- [ ] abrir o lead → 6 abas: **Dados · Formulário · Comentar · Anexos ·
      Histórico · Rastreio**
- [ ] **Dados** salva alterações → toast "Dados salvos"
- [ ] **Rastreio** mostra UTM/campanha (o `listLegacyLeads` antigo perdia isso)
- [ ] **Comentar** grava e o comentário aparece no histórico com autor e hora
      *(requisito da ata 23/07: log de toda movimentação)*
- [ ] **Histórico** mostra os eventos automáticos em português — atribuição,
      liberação por timeout, mudança de etapa — misturados aos comentários em
      ordem cronológica
- [ ] **Anexos** sobe arquivo (bucket `lead-attachments`) e o download abre por
      URL assinada
- [ ] mover de etapa pelos botões → toast "Movido para <etapa>"
- [ ] **Converter em negócio** sem anexo → erro do banco repassado tal e qual
      (o banco exige ao menos um anexo)
- [ ] **Atender** dentro do modal também chama `claim_lead`

### 3.4 S2.3 — `NewLeadNotifier.tsx`

**Depende da 0.1.** Com o front aberto em qualquer rota (Dashboard, Equipes,
Marketing — não só `/leads`), no psql:

```sql
insert into public.leads (full_name, phone) values ('Popup Teste', '11999990002');
select public.assign_lead((select id from public.leads where full_name='Popup Teste'));
```

- [ ] popup aparece **em qualquer rota**, não só na tela de leads
      *(requisito da ata 23/07)*
- [ ] o beep toca (WebAudio — exige uma interação prévia na página; navegador
      bloqueia áudio antes disso)
- [ ] toast "🔔 Lead atribuído a você!" com nome e campanha/origem
- [ ] a contagem regressiva no popup bate com `attend_deadline`
- [ ] **Atender** no popup → trava o lead e navega para `/pipeline`
- [ ] **não repete** o mesmo aviso quando o lead sofre outros UPDATEs
- [ ] logado como **gestor**: um lead criado **sem** corretor dispara
      "🔔 Novo lead na fila"; um lead que já tem dono **não** dispara (o aviso
      é do corretor)
- [ ] lead antigo (`assigned_at` fora da janela de frescor) não dispara nada

Limpe: `delete from public.leads where full_name = 'Popup Teste';`

### 3.5 Definition of Done do trilho B — zero tabela legada

```bash
grep -n "from(" src/pages/Leads.tsx src/components/LeadFunnel.tsx \
  src/components/LeadDetailModal.tsx src/components/NewLeadNotifier.tsx
```

Esperado: **nenhuma linha**. A regra da casa está no cabeçalho de
`src/integrations/supabase/leads.ts` — nenhuma tela chama `.from("leads")`
direto; toda leitura e escrita passa por lá.

---

## 4. S1.3, S1.4 e S1.7 — tipos, README e `.env`

### S1.3 — tipos regenerados

```bash
grep -c "" src/integrations/supabase/types.ts       # ~3.665 (era 2.022)
grep -n "daily_broker_entries\|daily_team_reports" src/integrations/supabase/types.ts
grep -n "cron_jobs_health" src/integrations/supabase/types.ts
```

- [ ] zero ocorrências das duas tabelas legadas (eram 5)
- [ ] `cron_jobs_health` presente
- [ ] `RoleSwitcher.tsx` tem `sdr` e `marketing` nos dois `Record<AppRole, …>` —
      antes `roleColors[role]` devolvia `undefined` para esses usuários

### S1.4 — `supabase/README.md`

- [ ] `0013` na tabela de estrutura
- [ ] seção de verificação pós-deploy com `cron_jobs_health()`
- [ ] contagem de asserts atualizada
- [ ] item 5 descreve a regra da `0014`

### S1.7 — `.env` fora do git

```bash
git check-ignore -v .env      # deve casar com .gitignore:32
git ls-files --error-unmatch .env   # deve FALHAR (não rastreado)
ls -la .env .env.example      # os dois existem no disco
```

- [ ] `.env.example` versionado, documentando que todo `VITE_` vai para o bundle
- [ ] `.env` preservado no disco e ignorado pelo git

---

## 5. Fechamento da sprint — o que falta em produção

Nada disso foi feito ainda; é o item pendente da [sprint-01.md](sprint-01.md).

1. **Aplicar a `0013` e a `0014`:** `supabase db push`
2. **Publicar o realtime** (seção 0.1) — hoje não existe migration para isso
3. **Conferir como admin, pela aplicação:**
   ```sql
   select * from public.cron_jobs_health();
   ```
   Três linhas `faceimob-*`, `active = true`, `last_status = 'succeeded'`,
   `failures_24h = 0`
4. **Reexecutar a seção 2.4 em staging** antes do push em produção
5. **Fechar a `AdminDailyTeams.tsx:76`** — insert em `teams` sem `slug` é bug
   real, não ruído de tipo (seção 1.5)

---

## Resumo — o que cada story exige

| Story | Como testar |
|---|---|
| S1.1 release a cada 30s | 2.1, 2.2, 2.4 |
| S1.2 auto-checkout | 2.1, 2.5 |
| S1.2b poda do histórico | 2.6 |
| S1.2c `cron_jobs_health()` | 2.3 |
| S1.3 tipos | 1.4, 1.5, 4 |
| S1.4 README | 4 |
| S1.5 E2E + harness | 1.1, 2.4 |
| S1.6 fim da fila | 1.1 (5 asserts), 2.4 (fila invertida) |
| S1.7 `.env` | 4 |
| S2.1 `Leads.tsx` | 3.1, 3.5 |
| S2.2 funil + modal | 3.3, 3.5 |
| S2.3 notificador | 3.4, 3.5 |
| S2.4 Atender + trava | 3.2 |
