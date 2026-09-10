# Refutação pela lente "schema" — mapa `Documentos, CCA e Storage`

Alvo: `docs/importacao/mapa/documentos.md` (lido inteiro).
Fonte de verdade: `supabase/migrations/` (86 arquivos, aplicados em ordem de nome) + `supabase/seed.sql`.
Data: 09/09/2026. Nenhum comando foi executado contra banco — só `grep` nas migrations e `python`/`csv` nos CSVs.

**Veredito: REFUTADO.** O mapa acerta a existência, o tipo e a nulidade de praticamente todas as colunas de destino
(a checagem coluna a coluna está na §4 e não achou divergência). O que ele erra é **efeito colateral de trigger**:
a §9 descreve `cca_cases_sync_esteira_label` como se ele só escrevesse `deals.status_detail`, manda mantê-lo
**ligado**, e o gatilho tem um segundo ramo — não citado em lugar nenhum do mapa — que reescreve a conferência
documental, o histórico e a caixa de notificações de **1.267 negócios**.

---

## 1. Achado bloqueante — o segundo ramo de `cca_cases_sync_esteira_label`

### O que o mapa diz

§1 passo 5 e §9 "Antes da carga" item 3:

> 3. Manter `cca_cases_sync_esteira_label` **ligado** — é ele que preenche `deals.status_detail`; por isso o passo 1 é obrigatório.

E §9 item 2 lista como únicos gatilhos a desabilitar `notify_cca_case_created` e `cca_award_points`.

### O que a migration diz

A definição vigente é a da 0077 (`create or replace`, a última das quatro — 0037 → 0059 → 0077).
`supabase/migrations/20260906770000_0077_cca_documentos.sql:101-130`:

```sql
  if new.status = 'pending_documents' then
    select * into v_deal from public.deals where id = new.deal_id for update;

    if found and v_deal.document_review_status = 'approved' then
      v_reason := 'Devolvido pela análise de crédito: '
                  || coalesce(nullif(btrim(new.decision_notes), ''), 'documentação pendente.');

      update public.deals
         set document_review_status   = 'returned',
             document_reviewed_at     = now(),
             document_reviewed_by     = auth.uid(),
             document_review_reason   = left(v_reason, 2000)
       where id = new.deal_id;

      insert into public.deal_history
        (deal_id, actor_id, kind, from_value, to_value, detail)
      values
        (new.deal_id, auth.uid(), 'document_review_returned', 'approved', 'returned',
         jsonb_build_object('reason', left(v_reason, 2000), 'source', 'cca'));

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct dp.profile_id,
             'document_review_returned',
             'CCA devolveu o dossiê: ' || v_deal.code,
             left(v_reason, 2000),
             '/pipeline',
             'in_app'::notification_channel
      from public.deal_participants dp
      where dp.deal_id = new.deal_id and dp.role = 'broker';
    end if;
  end if;
```

O gatilho é `after insert or update on public.cca_cases` (0077:135-137, `drop trigger if exists` + recriação),
então o ramo dispara **no INSERT** do passo 9 da carga, não só numa edição de tela.

### A pré-condição existe, e é o mapa irmão que a cria

O ramo só age se o negócio já estiver com `document_review_status = 'approved'` no momento do INSERT do caso.
`docs/importacao/mapa/negocios.md:243` e `:646` (decisão D5, opção **(a)** escolhida) mandam gravar exatamente isso:

> `deals.document_review_status` | `'approved'` para `outcome<>'open'`; `'draft'` para os 494 abertos

E `negocios.md` é pré-requisito declarado do próprio `documentos.md` (§1: "`deals` … precisam estar carregados antes").
A coluna nasce `not null default 'draft'` com check fechado
(`20260810170000_0028_document_review.sql:11,17-18`: `check (document_review_status in ('draft','pending','returned','approved'))`),
ou seja, `'returned'` é valor válido — o banco aceita calado.

### Tamanho do estrago (medido nos CSVs)

Cruzamento de `STATUS2` (família que o próprio mapa manda virar `pending_documents`) com `STATUS`
(que o `negocios.md` §4.1 converte em `outcome`), sobre `export_All-pipelines-modified--_2026-09-08_19-43-56.csv`
com `csv.DictReader` em streaming e normalização de NBSP:

```
linhas pending_documents: 1454
  STATUS=OFF          1267      -> outcome='lost'  -> document_review_status='approved'
  STATUS=PROPOSTA      187      -> outcome='open'  -> document_review_status='draft'  (ramo não dispara)
=> negócios afetados: 1267
   corretores distintos por negócio: {0: 20, 1: 1123, 2: 123, 3: 1}
   notificações in_app geradas: 1372
```

O total de 1.454 `pending_documents` reproduz exatamente a §3.1 do mapa — o de-para dele está certo;
o que falta é o que o banco faz com esses 1.454.

| Efeito não previsto | Volume | Por que dói |
|---|---:|---|
| `deals.document_review_status` `approved` → `returned` | **1.267** | Desfaz a decisão D5(a) do `negocios.md`. `deals_guard_stage` (`0028:109-114`) recusa entrar em `under_analysis`/`approved`/`contract`/`closed` sem `= 'approved'` — é o travamento que a D5(a) existia para evitar |
| `document_reviewed_by = auth.uid()` | 1.267 | `auth.uid()` é **NULL** sob `service_role`/`psql`: auditoria com autor vazio |
| `document_reviewed_at = now()` | 1.267 | Carimbo da data da importação num evento de 2024/2025 |
| Linhas em `deal_history` `kind='document_review_returned'` | **1.267** | Evento falso ("de approved para returned") num log declarado imutável |
| Linhas em `notifications`, `channel='in_app'` | **1.372** | Todo corretor abre o CRM num mural de "CCA devolveu o dossiê: BUB-…" de negócios mortos |

### E a limpeza da §9 não pega

§9 "Depois da carga", item 4:

```sql
update notifications set sent_at = now(), last_error = 'descartada: carga de dados legados'
 where channel <> 'in_app' and sent_at is null and created_at >= :inicio;
```

O `where channel <> 'in_app'` **exclui justamente as 1.372**. A §8 do mapa também só faz a aritmética de
`notify_cca_case_created` ("~22,6 mil linhas com 3 analistas") e ignora estas.

### Correção proposta

O mapa não pode "só desligar" o gatilho: é ele que escreve `deals.status_detail`, que a §3.1 inteira promete.
Duas saídas, ambas baratas:

- **(a) Carregar `cca_cases` em duas fases.** Inserir os 1.454 `pending_documents` com `status='under_review'`
  (o ramo não dispara) e depois `update … set status='pending_documents'` **com o gatilho desabilitado**,
  corrigindo `deals.status_detail = 'RET. ESTEIRA AGIL'` no mesmo bloco.
  *Consequência:* mais um passo no roteiro; o `status_detail` desses 1.454 passa a ser do script.
- **(b) Desabilitar `cca_cases_sync_esteira_label` na carga inteira** e gravar `deals.status_detail`
  pelo script, a partir da coluna que a §3.1 já tabelou
  (`13. ESTEIRA AGIL` / `RET. ESTEIRA AGIL` / `09. APROV. TOTAL` / `ANÁLISE EXTERNA`).
  `deals_guard_esteira_label` deixa passar `current_user in ('postgres','service_role')` (`0077:113-118`, `v_priv`),
  então o script consegue escrever os rótulos travados.
  *Consequência:* uma segunda fonte de verdade do rótulo, a manter em sincronia com a 0077.

Nas duas, a limpeza pós-carga vira `where sent_at is null and created_at >= :inicio` (sem filtro de canal)
ou um `delete` por `kind`.

---

## 2. Demais problemas encontrados (ordem de gravidade)

### 2.1 `deal_documents_award_points` não está na lista de travas — **média**

`supabase/migrations/20260903600000_0060_gamificacao.sql:485-487`:

```sql
drop trigger if exists deal_documents_award_points on public.deal_documents;
create trigger deal_documents_award_points
  after insert on public.deal_documents
  for each row execute function public.deal_documents_award_points();
```

O corpo (`0060:451-479`) pontua todo corretor participante quando o negócio está na etapa `incomplete`:
`perform public.award_game_points(v_broker, 'incompleto_com_doc', 'deal', new.deal_id, now())`.
Os dois pré-requisitos existem no seed: a etapa (`seed.sql:13`) e a regra
(`seed.sql:152` — `(null,'incompleto_com_doc','Incompleto com documento',10)`).

Volume medido: **99 negócios** caem na etapa `incomplete` pela regra 3 da `negocios.md` §4.2
(`STATUS='PROPOSTA'` e `STATUS2 in ('INCOMPLETO', vazio)`). É pequeno, e `award_game_points` é idempotente
por `ref_id = deal_id` (`on conflict do nothing`, `0060:276-279`), mas o evento entra com `occurred_at = now()`
na **temporada aberta hoje** e distorce o ranking vivo — exatamente o motivo pelo qual o mapa manda desligar
`cca_award_points`. Acrescentar à §9:

```sql
alter table public.deal_documents disable trigger deal_documents_award_points;
```

Na mesma linha, a §11 ("Correções pós-carga") não menciona `deal_documents_reopen_previous`
(`0059:449-451`, `after delete on public.deal_documents`): qualquer `delete` de reconciliação da §9-item-3
reabre a versão anterior do mesmo tipo, mexendo em `superseded_at` de linhas que o operador não tocou.

### 2.2 O comando de desabilitar gatilho da §9 não roda — **média**

§9 "Antes da carga", item 2, literal:

```sql
alter table public.cca_cases disable trigger notify_cca_case_created, cca_award_points;
```

`ALTER TABLE` aceita lista de **ações** separadas por vírgula, mas `DISABLE TRIGGER` recebe **um** nome
(`trigger_name | ALL | USER`); `cca_award_points` depois da vírgula não é ação válida → erro de sintaxe.
O próprio repositório sempre escreve um statement por gatilho:
`0028:31,49` · `0077:416,425` · `tests/77_cca_documentos.sql:348,357` · `tests/65_notificacoes_crons.sql:223,226`.

Segundo ponto no mesmo item: `ALTER TABLE … DISABLE TRIGGER` exige ser **dono da tabela**.
`service_role` tem `BYPASSRLS`, não é dono, e o PostgREST não executa DDL — então o caminho
"`service_role` (via PostgREST)" que a §9 abre como alternativa **não consegue** aplicar nenhuma das travas.
A §9 precisa dizer que os passos 5 e 12 são obrigatoriamente `postgres` via `psql`.

### 2.3 Duas DDLs incompatíveis para `import_bubble_map` — **média**

§5.2 afirma:

> Não existe hoje: `grep -rn "import_bubble_map" docs/ supabase/` não devolve nada *(medido)*.

Rodado agora, o grep devolve `docs/importacao/mapa/catalogo.md` (mapa irmão, mesma sessão), que propõe a
**mesma tabela com outro contrato**:

| | `documentos.md:385-393` | `catalogo.md:725-733` |
|---|---|---|
| colunas | `entidade, bubble_id, tabela, registro_id, detalhe jsonb, criado_em` | `bubble_table, bubble_id, target_table, target_id, imported_at, notes text` |
| PK | `(entidade, bubble_id, tabela)` | `(bubble_table, bubble_id)` |

`create table if not exists` faz a segunda migration virar no-op silencioso: quem rodar depois quebra no
`insert` com `42703 column … does not exist`. E as PKs discordam em aridade — a de `catalogo.md` proíbe o
mesmo `bubble_id` apontar para duas tabelas destino, que é exatamente o que `documentos.md` §1 passo 3 usa
(`'pipeline' → deals` e `'doc_cliente' → deal_documents`). Como o §1 passo 4 declara essa tabela pré-requisito
de tudo ("sem isso nada aqui resolve"), a carga não começa até alguém escolher um dos dois contratos.

### 2.4 `updated_at` de `cca_cases` não sobrevive à reimportação — **baixa**

§2.7 manda gravar `created_at`/`updated_at` a partir de `pipelines.Creation Date`/`Modified Date`.
No INSERT funciona. Mas a idempotência da §5.1 é `on conflict (deal_id) do update`, e
`cca_cases_set_updated_at` é `before update` (`0007:37-39`): na segunda rodada o `updated_at` histórico é
sobrescrito por `now()` nos 7.549. Se a data importada importa, o `update` precisa rodar com o gatilho
desligado — ou a perda precisa ser declarada.

---

## 3. Efeito colateral que o mapa acerta (checado, não é achado)

Registro para o próximo revisor não refazer o trabalho:

- **`deals_guard_closed_month` não tem escape para `service_role`.** Verdadeiro: `0010:29-53` só retorna cedo em
  `public.is_admin()`, e o gatilho é `before insert or update on public.deals`. A cascata do
  `cca_cases_sync_esteira_label` passa por ele. ✔
- **`deals_guard_document_review` isenta `current_user in ('postgres','service_role')`.** Verdadeiro, `0028:67`. ✔
- **A tabela §3.1 de `deals.status_detail`.** Bate com a versão vigente do `case` em `0077:82-91`, incluindo
  `sent_to_agency → 'ANÁLISE EXTERNA'` (que **não** existia na 0059 e só passou a valer na 0077) e
  `rejected`/`cancelled` sem rótulo. ✔
- **`deals_award_points` (`0060:343-345`) não precisa ser desligado.** O corpo (`0060:299-310`) só age em
  transição de `outcome`; a cascata do `status_detail` não mexe em `outcome`. ✔
- **Bucket `deal-documents`:** `file_size_limit = 26214400` (`0059:378`) e `allowed_mime_types` nulo de propósito
  (comentário `ponytail:` em `0059:362-365`). `lead-attachments` com lista fechada de **12** MIMEs (`0056:542-552`). ✔
- **`document_types` do seed:** 9 códigos, exatamente os da §3.2, com `allows_multiple = true` só em
  `comprovante_renda`, `simulacao` e `outros` (`seed.sql:67-75`) — sustenta a lista de 6 tipos que versionam. ✔
- **`cca_stages` do seed:** 6 linhas, sem `cancelled`, sem unique de banco em `status`
  (`seed.sql:81-94` + `0012:266-278`) — a decisão D4 é real. ✔
- **`cca_status`:** os 7 valores usados pelo de-para existem no enum (`0001:74-83`). ✔
- **Citações de código:** `missingStoragePaths` está em `src/integrations/supabase/documents.ts:317-329`
  e `scripts/seed-documents-storage.mjs` existe. ✔

---

## 4. Conferência coluna a coluna (o que a lente "schema" pedia)

Nenhuma divergência de nome, tipo ou nulidade. Registro do que foi conferido:

**`deal_documents`** (`0006:256-270`) — `deal_id` NN FK cascade · `document_type_id` NN FK **restrict**
· `storage_path` NN **unique** · `original_name` NN · `stored_name` NN · `mime_type` nullable
· `size_bytes` bigint `check (>= 0 or null)` · `version` NN default 1 `check (> 0)`
· `superseded_at`/`superseded_by` nullable · `uploaded_by` nullable FK `set null` · `created_at` NN default `now()`.
O contrato da §2.6 cabe inteiro, e o "não escrever `version`/`superseded_*`" está certo:
`deal_documents_enforce_single` é `before insert` (`0006:311-313`) e `deal_documents_supersede` é `after insert`
marcando as linhas **anteriores** (`0006:343-345`) — daí a exigência de inserir em ordem cronológica.

**`cca_cases`** (`0007:16-31` + `0012:284-285` + `0020:147`) — `deal_id` NN **unique** · `status` `cca_status` NN
· `stage_id` nullable FK `set null` · `analyst_id` nullable · `agency_name` text · `submitted_at`/`decided_at`
· `decision_notes` · `pending_items` NN default `'[]'` · `analysis` jsonb NN default `'{}'`
· constraint `cca_cases_decision_consistency check (status not in ('approved','rejected') or decided_at is not null)`.
A §2.7 e a §6.2 tratam a constraint corretamente, inclusive o fallback de `decided_at` para `ENVIO`.

**`cca_case_events`** (`0007:44-55`), **`cca_stages`** (`0012:266-276`), **`document_types`** (`0003:163-175`) e
**`deal_history`** (`0006:347-358`) — todas as colunas citadas existem com o tipo declarado; os `not null`
listados na §6.2 conferem. `deal_history` tem RLS com **só** política de `select` (`0006:649-651`):
escrever exige `service_role`, como a §9 já assume.

**`lead_attachments`** existe (`0005:191`) e a §6.1 está certa em deixá-la vazia.

---

## 5. Como reproduzir

```bash
# de-para de STATUS2 (reproduz a §3.1 do mapa e o recorte do achado 1)
python <scratchpad>/status2.py   # 7568 -> approved 3979 | pending_documents 1454 | ... | sem caso 19
python <scratchpad>/cross.py     # 1454 pending -> 1267 com STATUS=OFF, 187 com STATUS=PROPOSTA

# gatilhos reais das tabelas de destino
grep -rn "create trigger" -A 2 supabase/migrations/*.sql | grep -E "on public\.(deal_documents|deals|cca_cases)"

# o ramo ignorado
sed -n '97,140p' supabase/migrations/20260906770000_0077_cca_documentos.sql

# a pré-condição, no mapa irmão
grep -n "document_review_status" docs/importacao/mapa/negocios.md
```
