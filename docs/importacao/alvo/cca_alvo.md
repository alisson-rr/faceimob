# Domínio alvo: CCA, documentos e Storage

Restrições do schema alvo para quem vai **importar dados legados em massa** (export Bubble → Supabase).

- Fonte: `supabase/migrations/` (86 arquivos, contados com `ls supabase/migrations | wc -l`), `supabase/seed.sql`, `supabase/seeds/`, `supabase/tests/` e o código do front que consome as tabelas.
- Tabelas cobertas: `cca_cases`, `cca_case_events`, `cca_stages`, `deal_documents`, `document_types`, `lead_attachments` + os buckets de Storage.
- Regra de leitura das migrations: a numeração tem lacunas e várias corrigem as anteriores. **Vale sempre a última versão de cada objeto** — abaixo cito o arquivo:linha da versão vigente, não da original.

---

## 0. Veredito curto

| Pergunta | Resposta |
|---|---|
| Buckets | 3, todos **privados**: `avatars`, `lead-attachments`, `deal-documents` |
| Caminho do arquivo | `<deal_id>/<epoch_ms>-<stored_name>` (negócio) · `<lead_id>/<epoch_ms>-<nome_original>` (lead) |
| `document_types` | 9 linhas no seed; 3 com `required_for_conversion = true` |
| `cca_stages` | 6 linhas no seed; de-para 1:1 com `cca_status` (o enum tem 7 valores — `cancelled` não tem estágio) |
| Versionamento | Automático por trigger no INSERT. **Não escreva `version`/`superseded_at`/`superseded_by` à mão** |
| Via de carga de arquivo | `POST /storage/v1/object/<bucket>/<path>` com `service_role`, `x-upsert: true` |
| Maior risco | Cada `insert` em `cca_cases` dispara 3 triggers com efeito colateral em massa (notificações, pontos, `UPDATE` em `deals`) |

---

## (a) Buckets de Storage: nomes, visibilidade e policies

### Criação — três buckets, todos privados

`supabase/migrations/20260725121100_0012_crud_fixes.sql:365-372`:

```sql
insert into storage.buckets (id, name, public)
values
  ('avatars',          'avatars',          false),
  ('lead-attachments', 'lead-attachments', false),
  ('deal-documents',   'deal-documents',   false)
on conflict (id) do nothing;
```

Não há um quarto bucket em nenhum lugar do repo (`grep` por `storage.from(` em `src/`, `scripts/` e `supabase/functions/` só encontra esses três). Como todos são privados, **toda leitura passa por URL assinada** (`createSignedUrl`), nunca por URL pública.

### Limites por bucket (gravados em `storage.buckets`)

| Bucket | `file_size_limit` | `allowed_mime_types` | Migration |
|---|---|---|---|
| `avatars` | 5 MB (`5 * 1024 * 1024`) | `image/jpeg`, `image/png`, `image/webp` | `20260903540000_0054_entrada.sql:76-81` |
| `lead-attachments` | 8 MB (`8 * 1024 * 1024`) | **12 tipos, lista fechada** (abaixo) | `20260903560000_0056_leads_roleta.sql:536-556` |
| `deal-documents` | **25 MB** (`26214400`) | **NULL — qualquer tipo** | `20260903590000_0059_cca_documentos.sql:370-382` |

Lista fechada de `lead-attachments` (0056:539-551): `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`, `text/plain`.

`deal-documents` ficou com `allowed_mime_types` NULO **de propósito** — comentário em 0059:361-365: "o navegador manda content-type vazio para vários PDFs e ZIPs gerados por scanner, e uma lista fechada aqui recusaria o envio sem mensagem legível".

**Consequência para a importação:** um `.zip`, `.gif` ou `.rar` do CDN do Bubble é aceito em `deal-documents` e **recusado pela API do Storage** em `lead-attachments`, independentemente do papel usado — `allowed_mime_types` é verificado pelo serviço de Storage, não por RLS. Se o export legado tiver anexos de lead fora dessa lista, as opções são: (1) importá-los como `deal_documents` do negócio correspondente, (2) converter o arquivo, ou (3) ampliar `allowed_mime_types` do bucket por migration (mudança de escopo, precisa de decisão).

### Policies de `storage.objects` (versões vigentes)

Todas são `for all to authenticated` — ou seja, governam SELECT/INSERT/UPDATE/DELETE do mesmo jeito. `service_role` não passa por elas.

**`avatars_read` / `avatars_write`** — `0012:388-406`. Leitura livre para autenticado; escrita só na própria pasta (`(storage.foldername(name))[1] = auth.uid()::text`) ou admin.

**`deal_documents_storage`** — versão vigente em `20260903590000_0059_cca_documentos.sql:321-352`:

```sql
create policy deal_documents_storage on storage.objects
  for all to authenticated
  using (
    bucket_id = 'deal-documents'
    and (
      public.has_role('cca')
      or exists (select 1 from public.deal_documents d
                 where d.storage_path = storage.objects.name
                   and public.can_see_deal(d.deal_id))
      or (public.deal_id_of_object(storage.objects.name) is not null
          and public.can_see_deal(public.deal_id_of_object(storage.objects.name)))
    )
  )
  with check (
    bucket_id = 'deal-documents'
    and public.deal_id_of_object(storage.objects.name) is not null
    and (
      public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
      or exists (select 1 from public.lead_attachments a
                 where a.storage_path = storage.objects.name
                   and a.lead_id = public.deal_id_of_object(storage.objects.name))
    )
  )
```

`public.deal_id_of_object(text)` (`0059:301-310`) devolve o **primeiro segmento do caminho quando ele é um UUID**, e NULL para qualquer outro formato:

```sql
select nullif(split_part(coalesce(p_name, ''), '/', 1), '')::uuid
where split_part(coalesce(p_name, ''), '/', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

**Leia isto duas vezes antes de escolher o prefixo da importação:** o `with check` **só passa** com prefixo UUID de negócio. Um caminho tipo `bubble/2024/arquivo.pdf` é:
- **legível** por quem tem o papel `cca` (primeiro ramo) e por quem enxerga o negócio da linha correspondente (segundo ramo);
- **não gravável nem sobrescrevível** por nenhum usuário autenticado (o `with check` falha).

O próprio front já convive com isso: `deleteDealDocument` (`src/integrations/supabase/documents.ts:352-394`) detecta caminho fora do padrão e **remove o objeto antes de apagar a linha**, porque depois de a linha sumir nenhum ramo do `using` casa e o binário ficaria órfão no bucket para sempre.

**`lead_attachments_storage`** — versão vigente em `20260905710000_0071_storage_copia_anexo.sql:90-111`:

```sql
using (
  bucket_id = 'lead-attachments'
  and (
    (public.deal_id_of_object(name) is not null and public.can_see_lead(public.deal_id_of_object(name)))
    or exists (select 1 from public.lead_attachments a
               where a.storage_path = name and public.can_see_lead(a.lead_id))
  )
)
with check (
  bucket_id = 'lead-attachments'
  and public.deal_id_of_object(name) is not null
  and public.can_write_lead(public.deal_id_of_object(name))
)
```

Mesmo desenho: autorização **pelo prefixo**, não pela linha. O cabeçalho da 0071 (linhas 7-48) documenta o motivo — a policy anterior exigia a linha que só nasce depois do upload, e por isso "anexar arquivo a um lead nunca funcionou para usuário logado".

---

## (b) `deal_documents`: caminho, nomes e `naming_pattern`

### Tabela — `20260725120500_0006_deals.sql:256-273`

```sql
create table public.deal_documents (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  storage_path     text not null unique,
  original_name    text not null,
  stored_name      text not null,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  version          int not null default 1 check (version > 0),
  superseded_at    timestamptz,
  superseded_by    uuid references public.deal_documents(id) on delete set null,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index deal_documents_deal_idx on public.deal_documents (deal_id) where superseded_at is null;
```

Não há índice único por `(deal_id, document_type_id)`: a unicidade do documento vigente é **garantida por trigger**, não por constraint (ver seção d).

### `storage_path` — como é montado

`src/integrations/supabase/documents.ts:257`:

```ts
const path = `${dealId}/${Date.now()}-${storedName}`;
```

Ou seja: **`<deal_id>/<epoch_ms>-<stored_name>`**. O sufixo de tempo existe porque `storage_path` é `unique` e a versão anterior continua no bucket — dois envios do mesmo tipo colidiriam (comentário em `documents.ts:238-243`).

Anexo de lead — `src/integrations/supabase/leads.ts:1019-1020`:

```ts
const storedName = `${Date.now()}-${file.name}`;
const path = `${leadId}/${storedName}`;
```

Caminhos legados que já existem no banco de homologação e **não seguem** o padrão (documentados em `documents.ts:338-345`): `seed/deals/…`, `seed/leads/…`, `demo-showcase/…` (ver `supabase/seeds/030_commercial_operation.sql:262-268` e `060_demo_showcase.sql:478-497`). Eles funcionam para leitura e são a prova de que caminho fora do padrão é tolerado — mas com as limitações da seção (a).

**Recomendação para a importação:** gravar em `<deal_id>/<epoch_ms>-<stored_name>` (ou `<deal_id>/bubble-<unique_id_bubble>-<stored_name>`, mantendo o prefixo UUID). Assim o objeto se comporta exatamente como um upload nativo: corretor sobrescreve, exclui e baixa; CCA baixa; `submission-dispatch` assina.

### `stored_name` × `original_name`

- **`original_name`** = o nome do arquivo como o usuário mandou (`file.name`, `documents.ts:270`). É o dado bruto, para auditoria.
- **`stored_name`** = o nome **amigável e normalizado** que a tela mostra e que vai no `Content-Disposition` do download: `createSignedUrl(path, 300, { download: doc.stored_name })` (`documents.ts:288-294`). Também é o nome do anexo no e-mail para a construtora (`supabase/functions/submission-dispatch/index.ts:301`).

Os dois são `not null`. Numa importação sem nome bom, `stored_name` pode receber o mesmo valor de `original_name` — mas o resultado é um download com nome do Bubble em vez do nome do padrão da empresa.

### `naming_pattern` de `document_types`

Coluna: `naming_pattern text default '{tipo}-{cliente}-{data}'` (`0003_catalog.sql:172`). Os placeholders são resolvidos **pela aplicação**, não pelo banco (comentário em `0003:165-166`).

Resolução em `src/integrations/supabase/documents.ts:200-226`:

| Placeholder | Valor | Origem |
|---|---|---|
| `{tipo}` | `document_type.code`, slugificado | `documents.ts:253` |
| `{cliente}` | nome do cliente titular, slugificado | `documents.ts:253` |
| `{negocio}` | `deals.code`, slugificado | `documents.ts:253` |
| `{data}` | `YYYY-MM-DD` local | `documents.ts:207` |

Regras do `resolveStoredName`:
- placeholder desconhecido é **removido**, não impresso literal (`documents.ts:219`);
- `slug()` faz NFD + remove marcas de acento + troca não-alfanumérico por `-` + lowercase (`documents.ts:167-175`);
- a extensão do arquivo original é preservada (`documents.ts:225`);
- quando o tipo tem `allows_multiple`, é acrescentado um sufixo com o nome original slugificado (`options.distinguir`, `documents.ts:220`) — senão dois anexos em "Outros" ficariam com nome idêntico.

Para reproduzir isso na importação, replique a função (é pura e testada em `src/integrations/supabase/documents.test.ts`) ou aceite `stored_name = original_name`.

### Validação de fronteira que o front aplica (não é constraint de banco)

`documents.ts:20-43`: máximo **25 MB**, arquivo vazio recusado, e lista de extensões `pdf, jpg, jpeg, png, webp, heic, heif, doc, docx, xls, xlsx, csv, txt`. O comentário é explícito: "O bucket ganhou teto de servidor na migration 0059 — este limite existe para o usuário ver a recusa ANTES". Na importação, a **única** trava real é o `file_size_limit` do bucket.

---

## (c) `document_types` — catálogo completo (seed)

`supabase/seed.sql:64-76`, 9 linhas, idempotente (`on conflict do nothing`; `code` é `unique`):

| # | `code` | `label` | `category` | `required_for_conversion` | `allows_multiple` | `naming_pattern` | `sort_order` |
|---|---|---|---|---|---|---|---|
| 1 | `rg_cpf` | RG / CPF | `identificacao` | **true** | false | `{tipo}-{cliente}` | 1 |
| 2 | `comprovante_renda` | Comprovante de Renda | `renda` | **true** | **true** | `{tipo}-{cliente}-{data}` | 2 |
| 3 | `ctps` | CTPS | `renda` | false | false | `{tipo}-{cliente}` | 3 |
| 4 | `extrato_fgts` | Extrato FGTS | `renda` | false | false | `{tipo}-{cliente}-{data}` | 4 |
| 5 | `imposto_renda` | Declaração de IR | `renda` | false | false | `{tipo}-{cliente}-{data}` | 5 |
| 6 | `comprovante_resid` | Comprovante de Residência | `endereco` | **true** | false | `{tipo}-{cliente}` | 6 |
| 7 | `certidao_civil` | Certidão de Estado Civil | `identificacao` | false | false | `{tipo}-{cliente}` | 7 |
| 8 | `simulacao` | Simulação de Crédito | `credito` | false | **true** | `{tipo}-{negocio}` | 8 |
| 9 | `outros` | Outros | `geral` | false | **true** | `{tipo}-{cliente}-{data}` | 99 |

Categorias em uso: `identificacao`, `renda`, `endereco`, `credito`, `geral`. **Não há check constraint em `category`** — é texto livre com `default 'geral'` (`0003:167`).

`code = 'outros'` é o **fallback obrigatório**: `convert_lead_to_deal` usa `(select dt.id from public.document_types dt where dt.code = 'outros' limit 1)` para anexo de lead sem tipo (`20260810170000_0028_document_review.sql:203-204, 209-210`). Nunca apague nem renomeie esse código.

Os 3 obrigatórios (`rg_cpf`, `comprovante_renda`, `comprovante_resid`) travam `submit_deal_for_manager_review` (`0047:121-133`) e `submit_deal_for_analysis` (`0077:200-222`). O filtro é `dt.active and dt.required_for_conversion` **sem documento vigente** do tipo.

**Regravar/editar o catálogo:** RLS `document_types_write` desde `0059:104-108` é `public.has_permission('cca.review')` — não mais `has_any_role('admin','cca')`.

---

## (d) Versionamento: `version`, `superseded_at`, `superseded_by`

**Nada disso é escrito pelo cliente.** Dois triggers em `deal_documents` resolvem tudo no INSERT (comentário canônico em `src/integrations/supabase/documents.ts:6-10`: "O cliente não mexe em `version` nem em `superseded_at`; se mexer, briga com o trigger").

### 1. `deal_documents_enforce_single` — BEFORE INSERT (`0006:276-313`)

```sql
create trigger deal_documents_enforce_single
  before insert on public.deal_documents
  for each row execute function public.deal_documents_enforce_single();
```

Lógica: se `document_types.allows_multiple` → passa direto (`return new`, versão fica 1). Senão, procura o documento vigente do mesmo `(deal_id, document_type_id)` com `superseded_at is null`, pega a maior `version` e faz `new.version := v_version + 1`.

### 2. `deal_documents_supersede` — AFTER INSERT (`0006:316-345`)

Fecha a versão anterior: `update ... set superseded_at = now(), superseded_by = new.id where deal_id = ... and document_type_id = ... and superseded_at is null and id <> new.id`. Também sai cedo em tipo com `allows_multiple`.

### 3. `deal_documents_reopen_previous` — AFTER DELETE (`0059:415-451`)

Apagar a versão vigente **reabre a anterior** (`superseded_at = null, superseded_by = null` na maior `version` restante). Sem isso o tipo obrigatório voltava a travar o envio (motivo detalhado em `0059:402-414`).

### Como registrar documento histórico numa importação

**A forma correta é inserir na ordem cronológica e deixar os triggers agirem.** Insira v1, depois v2, depois v3 — cada INSERT incrementa `version` e marca o anterior como substituído automaticamente, e no fim sobra exatamente **um vigente** por tipo.

Se precisar carregar em lote fora de ordem, ou reproduzir versões com `superseded_at` histórico (a data real da substituição, não `now()`), há duas rotas:

1. **Inserir em ordem e depois corrigir a data**: `update deal_documents set superseded_at = <data real> where id = ...`. Os triggers de supersessão são só de INSERT/DELETE; um UPDATE posterior não os dispara. É a rota mais segura.
2. **Desabilitar os triggers durante a carga** (`alter table public.deal_documents disable trigger deal_documents_enforce_single, deal_documents_supersede`) e escrever `version`/`superseded_at`/`superseded_by` à mão, reabilitando depois. Exige que você garanta o invariante "um vigente por tipo em tipo que não é `allows_multiple`" — o banco não o cobra por índice.

**Consequência de errar:** dois documentos vigentes do mesmo tipo não quebram nada no banco, mas quebram a tela — `missingRequiredTypes` (`documents.ts:428-436`) conta só vigente, `submit_deal_for_analysis` monta `document_ids` só com `superseded_at is null` (`0077:192-194`) e o e-mail para a construtora sairia com o documento duplicado. Zero vigentes é pior: o obrigatório volta a travar o envio.

Nota sobre `superseded_by`: é FK auto-referente `on delete set null` (`0006:267`). Se você apagar a versão nova, o ponteiro da antiga zera — e é o trigger da 0059 que zera o `superseded_at` junto.

---

## (e) `cca_stages` e `cca_status`: lista completa e de-para

### Enum `cca_status` — 7 valores

Definido no domínio (`docs/importacao/SCHEMA_ALVO.md:11`), lido pelo front em `src/components/pipeline/ccaStage.ts:18-30`:

| Valor do enum | Rótulo na tela (`CCA_STATUS_OPTIONS`) | Decide o caso? |
|---|---|---|
| `pending_documents` | Aguardando documentos | não |
| `under_review` | Em análise | não |
| `sent_to_developer` | Enviado à construtora | não |
| `sent_to_agency` | Enviado à agência | não |
| `approved` | Aprovado | **sim** |
| `rejected` | Reprovado | **sim** |
| `cancelled` | Cancelado | não |

`isDecision` (`ccaStage.ts:36`) = `approved` ou `rejected` → é quando a tela grava `decided_at` (`src/components/pipeline/CcaMoveDialog.tsx:73`).

### `cca_stages` — tabela (`20260725121100_0012_crud_fixes.sql:266-286`)

```sql
create table public.cca_stages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#94a3b8',
  position   int  not null default 0,
  status     cca_status not null default 'under_review',   -- para onde mapeia no ciclo fixo
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cca_stages_position_idx on public.cca_stages (position) where active;
alter table public.cca_cases add column stage_id uuid references public.cca_stages(id) on delete set null;
```

**Não há unique em `name` nem em `status`** — nada impede dois estágios ativos com o mesmo desfecho (o backfill da 0077:390-402 assume isso e usa `distinct on (status) ... order by status, position`).

### Catálogo do seed — 6 estágios (`supabase/seed.sql:81-94`)

| `position` | `name` | `color` | `status` |
|---|---|---|---|
| 1 | Pendência de Documentos | `#f87171` | `pending_documents` |
| 2 | Em Análise | `#fbbf24` | `under_review` |
| 3 | Enviado à Construtora | `#818cf8` | `sent_to_developer` |
| 4 | Enviado à Agência | `#22d3ee` | `sent_to_agency` |
| 5 | Aprovado | `#34d399` | `approved` |
| 6 | Reprovado | `#f43f5e` | `rejected` |

O seed é idempotente por `status` (`where not exists (select 1 from cca_stages cs where cs.status = v.status)`), não por nome.

**`cancelled` não tem estágio.** Um caso importado com `status = 'cancelled'` fica com `stage_id` nulo; a tela cai no fallback `stages.find(status)` → não acha → `stages[0]` = "Pendência de Documentos" (`src/components/pipeline/ccaData.ts:97-99`). Ou seja: um caso cancelado aparece no quadro como pendente. **Decida antes de importar:** ou criar um estágio `cancelled`, ou não usar esse valor na carga.

**Armadilha da cor:** o seed grava hex (`#fbbf24`), mas o front espera **chave semântica** (`warning`, `success`, `info`, `danger`, `highlight`, `neutral`) e só sabe traduzir chave, token Tailwind (`text-warning`) ou família de paleta legada (`amber`, `emerald`…) — `src/components/pipeline/ccaStage.ts:63-76`. Hex não casa em nada e cai em `"neutral"`. Se a importação criar estágios, use a chave semântica.

### De-para `cca_status` → `deals.status_detail` (rótulo do funil)

Escrito pelo trigger `cca_cases_sync_esteira_label`, versão vigente em `20260906770000_0077_cca_documentos.sql:79-88`:

| `cca_cases.status` | `deals.status_detail` gravado |
|---|---|
| `under_review` | `13. ESTEIRA AGIL` |
| `pending_documents` | `RET. ESTEIRA AGIL` |
| `approved` | `09. APROV. TOTAL` |
| `sent_to_developer` | `ANÁLISE EXTERNA` |
| `sent_to_agency` | `ANÁLISE EXTERNA` |
| `rejected` | *(nenhum — de propósito)* |
| `cancelled` | *(nenhum — de propósito)* |

`rejected`/`cancelled` ficam de fora porque quem encerra o negócio é o diálogo de perda, que também move a etapa (justificativa em `0077:29-32` e `0059:34-40`).

O `update` só grava se `deal_status_bare(status_detail)` **não** estiver em `('DISTRATO','QUEDA','REPROVADO','OFF')` (`0077:95`) — rótulo de encerramento vence o da esteira.

### Estágio no caso (`cca_cases.stage_id`)

`submit_deal_for_analysis` escolhe o estágio pelo status (`0077:231-232` para o interno, `0077:253-254` para o externo): `select id from cca_stages where status = <alvo> and active order by position limit 1`. Numa importação, use a mesma regra — ou aceite o fallback da tela.

---

## (f) Trigger de `document_review` em `deals`

### Colunas e check (`20260810170000_0028_document_review.sql:10-18`)

```sql
alter table public.deals
  add column document_review_status text not null default 'draft',
  add column document_review_requested_at timestamptz,
  add column document_review_requested_by uuid references public.profiles(id) on delete set null,
  add column document_reviewed_at timestamptz,
  add column document_reviewed_by uuid references public.profiles(id) on delete set null,
  add column document_review_reason text,
  add constraint deals_document_review_status_check
    check (document_review_status in ('draft', 'pending', 'returned', 'approved'));
```

Máquina de estados: `draft` → `pending` → (`approved` | `returned`) → (`returned` volta a `pending`).

### O trigger que trava a escrita direta (`0028:54-77`)

```sql
create or replace function public.deals_guard_document_review()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (
    new.document_review_status is distinct from old.document_review_status
    or new.document_review_requested_at is distinct from old.document_review_requested_at
    or new.document_review_requested_by is distinct from old.document_review_requested_by
    or new.document_reviewed_at is distinct from old.document_reviewed_at
    or new.document_reviewed_by is distinct from old.document_reviewed_by
    or new.document_review_reason is distinct from old.document_review_reason
  ) and current_user not in ('postgres', 'service_role') then
    raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger deals_guard_document_review
  before update on public.deals
  for each row execute function public.deals_guard_document_review();
```

**Ponto crítico para a importação:** o escape é por `current_user in ('postgres','service_role')`. Ou seja:

- carga via **`psql` como `postgres`** → passa;
- carga via **PostgREST com a chave `service_role`** → passa (o PostgREST faz `SET LOCAL ROLE service_role`);
- carga com JWT de usuário (mesmo admin) → **42501**.

É trigger `before update` apenas — um **INSERT** de `deals` com `document_review_status = 'approved'` não passa por ele.

### Quem escreve esses campos no fluxo real

| RPC / trigger | O que grava | Onde |
|---|---|---|
| `submit_deal_for_manager_review` | `pending` + `requested_at/by`, zera o resto; notifica gerentes | `0047:137-159` |
| `review_deal_documents(p_approve=false)` | `returned` + `reviewed_at/by` + `reason` (obrigatório, máx. 2000 ch.); notifica corretores | `0028:501-524` |
| `review_deal_documents(p_approve=true)` | `approved` + `reviewed_at/by`; chama `submit_deal_for_analysis` na mesma transação | `0028:527-551` |
| `cca_cases_sync_esteira_label` (status → `pending_documents`) | volta o negócio para `returned` com motivo `'Devolvido pela análise de crédito: …'` + histórico + notificação | `0077:101-131` |

`submit_deal_for_analysis` é **interna**: `revoke ... from authenticated`, `grant ... to service_role` (`0028:557-558`). Só `review_deal_documents` e `submit_deal_for_manager_review` são chamáveis pelo app.

### Outros triggers em `deals` que a importação atravessa

| Trigger | Momento | Escape para carga? |
|---|---|---|
| `deals_guard_closed_month` (`0010:29-53`) | before insert **or** update | **NÃO.** Só isenta `public.is_admin()` = `has_role('admin')` via `auth.uid()`. Rodando como `postgres`/`service_role` **sem JWT**, `is_admin()` é falso → grava em `month_base` de mês fechado é recusado |
| `deals_guard_document_review` (`0028:75-77`) | before update | Sim: `current_user in ('postgres','service_role')` |
| `deals_guard_esteira_label` (`0059:113-165`) | before insert/update de `status_detail` | Sim: `v_priv := current_user in ('postgres','service_role')` (`0059:121, 128-130`) |
| `deals_guard_stage` (`0028:82-140`) | before update de `stage_id` | Parcial: as checagens de papel são puladas quando `auth.uid() is null`, mas a exigência "documentação aprovada antes de `under_analysis`/`approved`/`contract`/`closed`" (`0028:109-114`) e "estágio que exige documento" (`0028:116-126`) valem sempre |
| `deals_log_changes` (`0006`) | after update | Não tem escape — grava em `deal_history` a cada mudança de etapa/valor |

O `deals_guard_closed_month` é armadilha real e já mordeu o próprio projeto: a migration 0077 precisou de `alter table public.deals disable trigger deals_guard_closed_month` em volta do backfill, com a justificativa escrita em `0077:408-415`. A 0028 fez o mesmo (`0028:31, 49`).

---

## (g) Importar ~25 mil arquivos do CDN do Bubble

### A via correta: upload via `service_role` na API de Storage

O repositório já tem o exemplo canônico: `scripts/seed-documents-storage.mjs`. Ele sobe um arquivo por linha de `deal_documents` e `lead_attachments`, é idempotente e não usa nenhuma biblioteca.

Autenticação (`scripts/seed-documents-storage.mjs:153`):

```js
const cab = { apikey: service, Authorization: `Bearer ${service}` };
```

Checagem antes de subir — evita reenviar o que já está lá (`:167, :170-174`):

```js
const caminho = doc.storage_path.split("/").map(encodeURIComponent).join("/");
const info = await fetch(`${url}/storage/v1/object/info/${bucket}/${caminho}`, { headers: cab });
if (info.ok && (await info.json()).size === bytes.length) { r.existiam++; continue; }
```

Upload (`:175-180`):

```js
const res = await fetch(`${url}/storage/v1/object/${bucket}/${caminho}`, {
  method: "POST",
  headers: { ...cab, "Content-Type": tipo, "x-upsert": "true" },
  body: bytes,
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
```

Três detalhes que esse script prova e que valem para a carga de 25 mil arquivos:

1. **`encodeURIComponent` por segmento**, não no caminho inteiro (senão a `/` vira `%2F` e o objeto muda de pasta).
2. **`x-upsert: true`** para a carga ser re-executável. Sem ele, um reprocessamento falha com 409 em tudo que já subiu.
3. **`Content-Type` explícito.** Em `lead-attachments` ele é conferido contra `allowed_mime_types`; em `deal-documents` não é conferido, mas é o que o navegador vai usar ao abrir o arquivo.

### Por que `service_role` e não um usuário

- `service_role` tem **BYPASSRLS**: nenhuma policy de `storage.objects` nem de `public.*` se aplica. É o único jeito de gravar objeto num prefixo que ainda não corresponde a nenhum negócio, ou de escrever em `deals.document_review_*` (seção f).
- A alternativa (JWT de admin) esbarra no `with check` da `deal_documents_storage` — que só aceita prefixo UUID de negócio que a pessoa **edite** — e no `deals_guard_document_review`.
- `service_role` **não** é bypass de constraint nem de trigger: check constraints, FKs e todos os triggers continuam valendo. Só a RLS sai do caminho.

Segredo: `SUPABASE_SERVICE_ROLE_KEY` vem do ambiente, nunca do `.env` versionado (`seed-documents-storage.mjs:65, 70-79`). Não logue a chave, não a coloque em URL.

### Limites que valem para os 25 mil arquivos

| Limite | Valor | Onde está escrito |
|---|---|---|
| Tamanho por arquivo, `deal-documents` | 25 MB (26 214 400 bytes) | `0059:378` |
| Tamanho por arquivo, `lead-attachments` | 8 MB | `0056:539` |
| Tamanho por arquivo, `avatars` | 5 MB | `0054:78` |
| MIME, `deal-documents` | **sem restrição** (`allowed_mime_types` NULO, deliberado) | `0059:361-365` |
| MIME, `lead-attachments` | 12 tipos, lista fechada | `0056:540-551` |
| MIME, `avatars` | `image/jpeg`, `image/png`, `image/webp` | `0054:79` |
| Limite de taxa (requisições/s) | **não existe nada declarado no repositório** | — |

Sobre a taxa: procurei em `supabase/config.toml`, nas migrations e nos scripts — **não há nenhum número de rate limit versionado**. `seed-documents-storage.mjs` sobe os arquivos em laço **sequencial**, sem paralelismo e sem backoff (`:166-185`), o que funciona para dezenas de registros e é ineficiente para 25 mil. Suposições que assumo e que precisam de confirmação empírica antes da carga real:

- o teto global de upload do projeto (Storage → Settings no painel) precisa ser ≥ 25 MB, senão o `file_size_limit` do bucket não é atingível — isso **não está no repo**, é configuração do painel;
- não há garantia de que a API do Storage aceite N conexões paralelas sem `429`. **Recomendação:** paralelismo baixo (4–8 conexões), retry com backoff exponencial em `429` e `5xx`, e checkpoint por arquivo já enviado para poder retomar.

### Sequência de carga recomendada

1. **Catálogo primeiro**: `document_types` (idempotente por `code`) e `cca_stages` (idempotente por `status`, se você seguir o padrão do `seed.sql`).
2. **Negócios e leads** (fora do escopo deste relatório, mas são pré-requisito: `deal_documents.deal_id` é FK `on delete cascade` e `document_type_id` é FK `on delete restrict`).
3. **Objetos no Storage**, com o caminho definitivo `<deal_id>/…`. Antes das linhas: se o upload falhar, você simplesmente não cria a linha; a ordem inversa produz registro apontando para arquivo inexistente — que é exatamente o defeito que `missingStoragePaths` (`documents.ts:317-329`) existe para diagnosticar.
4. **Linhas de `deal_documents` / `lead_attachments`**, em ordem cronológica por `(deal_id, document_type_id)` para o versionamento sair certo (seção d).
5. **`cca_cases`** — com os triggers avaliados (seção abaixo).
6. **`cca_case_events`** — a tabela **só tem policy de SELECT** (`0007:245-253`); o INSERT vem de triggers `security definer` ou de `service_role`.
7. **Correção pós-carga** de `superseded_at` histórico e de `deals.document_review_*`, se aplicável.

---

## Invariantes que um insert em massa precisa respeitar

1. `deal_documents.storage_path` é `text not null **unique**` (`0006:260`). Duas versões do mesmo tipo precisam de caminhos diferentes — daí o `Date.now()` no padrão nativo.
2. `lead_attachments.storage_path` é `text not null **unique**` (`0005:195`) — e **sem vínculo nenhum com `lead_id`**. A policy da 0059 casa `a.lead_id = deal_id_of_object(name)` justamente porque o banco não garante isso (`0059:281-292`).
3. `deal_documents.document_type_id` é `not null` com FK `on delete **restrict**` (`0006:259`) — não dá para apagar um tipo em uso.
4. `deal_documents.version` tem `check (version > 0)` e `size_bytes` tem `check (size_bytes is null or size_bytes >= 0)` (`0006:264, 262`).
5. `cca_cases.deal_id` é **`unique`** com FK `on delete cascade` (`0007:18`): **um caso por negócio**. Reanálise reabre o mesmo caso — é o que `on conflict (deal_id) do update` explora (`0077:236-241`).
6. `cca_cases_decision_consistency`: `check (status not in ('approved','rejected') or decided_at is not null)` (`0007:30-31`). Importar um caso aprovado **sem `decided_at` falha a transação inteira**.
7. `cca_cases.pending_items` e `cca_cases.analysis` são `jsonb not null` com default (`'[]'` e `'{}'`) — `0007:26` e `0020:147`. `analysis` é dicionário de chaves livres, "a tela é a dona do vocabulário" (`0020:149-150`).
8. `document_types.code` é `unique` (`0003:165`); `naming_pattern` é nullable com default.
9. `cca_stages` **não tem** unique em `name` nem em `status` — a idempotência da sua carga é responsabilidade sua.
10. `deals.document_review_status` tem check com 4 valores (`0028:17-18`).
11. Um documento vigente por tipo (fora de `allows_multiple`) é invariante **de trigger, não de índice** — o banco aceita a inconsistência calado.

## Obrigatórios sem default

| Tabela | Colunas `not null` sem default |
|---|---|
| `deal_documents` | `deal_id`, `document_type_id`, `storage_path`, `original_name`, `stored_name` |
| `lead_attachments` | `lead_id`, `storage_path`, `original_name`, `stored_name` |
| `document_types` | `code`, `label` |
| `cca_stages` | `name` |
| `cca_cases` | `deal_id` |
| `cca_case_events` | `case_id`, `kind` |

Têm default e podem ser omitidos: `id` (`gen_random_uuid()`), `created_at`/`updated_at` (`now()`), `version` (1), `active` (true), `category` ('geral'), `naming_pattern` (`'{tipo}-{cliente}-{data}'`), `sort_order` (0), `required_for_conversion`/`allows_multiple` (false), `cca_stages.color` (`'#94a3b8'`), `cca_stages.position` (0), `cca_stages.status` (`'under_review'`), `cca_cases.status` (`'pending_documents'`), `cca_cases.pending_items` (`'[]'`), `cca_cases.analysis` (`'{}'`).

## Triggers e efeitos colaterais — o que dispara numa carga

### Ao inserir em `cca_cases` (**três triggers de INSERT, todos com efeito em massa**)

| Trigger | Efeito | Fonte |
|---|---|---|
| `notify_cca_case_created` (after insert) | **Uma notificação `cca_pending` por analista ativo**, por caso importado | `0065:282-285` |
| `cca_award_points` (after insert **or** update, desde a 0078) | `award_game_points` para **cada corretor participante** quando `status = 'under_review'` (evento `esteira`) ou `'approved'` (evento `aprovado`) | `0078:132-135, 91-121` |
| `cca_cases_sync_esteira_label` (after insert or update) | `UPDATE public.deals set status_detail = <rótulo>` — e, em `pending_documents`, mais um `UPDATE deals` + `deal_history` + notificação por corretor | `0059:244-247` (trigger), corpo vigente em `0077:64-135` |
| `cca_cases_log` (after **update**) | Insere `cca_case_events` + `deal_history` a cada mudança de status | `0007:219-221` |
| `cca_cases_set_updated_at` (before update) | `updated_at = now()` | `0007:37-39` |

**Aritmética antes de rodar:** 5 000 casos × 3 analistas = 15 000 linhas em `notifications`, mais os `game_events` e os `UPDATE` em cascata em `deals` (cada um passando por `deals_guard_closed_month`, `deals_log_changes` etc.). Se a temporada de jogo estiver fechada, `award_game_points` ainda insere uma notificação `game_paused` **não lida por pessoa** (`0078:172-201`) — uma só por corretor, mas gera `raise warning` no log a cada chamada.

### Ao inserir em `deal_documents`

| Trigger | Efeito |
|---|---|
| `deal_documents_enforce_single` (before insert) | calcula `version` |
| `deal_documents_supersede` (after insert) | marca a versão anterior como substituída |
| `deal_documents_award_points` (after insert, `0060:484-487`) | se o negócio está na etapa `incomplete`, pontua `incompleto_com_doc` para cada corretor participante (idempotente por negócio via `ref_id = deal_id`) |
| `deal_documents_reopen_previous` (after **delete**, `0059:449-451`) | reabre a versão anterior |

### RPCs que a importação **não** deve chamar

`submit_deal_for_analysis` (`0077:142-304`) e `review_deal_documents` (`0028:455-553`) fazem muito mais que gravar: criam caso, enfileiram e-mail para construtora (`developer_submissions`, que por sua vez tem `developer_submissions_advance_case` em after insert — `0077:350-353`) e movem a etapa do negócio. Numa carga histórica isso dispararia envio real de e-mail pelo cron `dispatch_pending_submissions` (`0059:456-500`). **Importe as tabelas diretamente**, não pelas RPCs de fluxo.

## RLS e permissão: como inserir em massa

**Use `service_role`** (chave `SUPABASE_SERVICE_ROLE_KEY` via PostgREST, ou `psql` como `postgres`). Motivos, em ordem de dureza:

1. `service_role` tem BYPASSRLS: nenhuma das policies abaixo se aplica.
2. `deals_guard_document_review` (`0028:67`) só isenta `current_user in ('postgres','service_role')`.
3. `deals_guard_esteira_label` (`0059:121`) usa o mesmo escape.
4. O `with check` de `deal_documents_storage` (`0059:340-351`) e de `lead_attachments_storage` (`0071:106-110`) exige prefixo UUID de negócio/lead que o usuário edite — inviável para carga histórica.

Grants de tabela já estão dados a `service_role` em bloco (`20260808160000_0023_role_grants.sql:31-33`): `select, insert, update, delete on all tables in schema public`.

### Policies que estariam no caminho de um usuário autenticado

| Objeto | Policy vigente | Expressão |
|---|---|---|
| `deal_documents` SELECT | `deal_documents_select` (`0006:637-639`) | `can_see_deal(deal_id) or has_role('cca')` |
| `deal_documents` INSERT | `deal_documents_insert` (`0077:363-380`) | `can_edit_deal(deal_id)` **e** (`is_admin()` ou `has_permission('cca.review')` ou `deals.document_review_status in ('draft','returned')`) |
| `deal_documents` DELETE | `deal_documents_delete` (`0059:387-400`) | `is_admin()` ou (`can_edit_deal` e status em `draft`/`returned`) |
| `document_types` SELECT/WRITE | `0003:243` / `0059:104-108` | leitura livre a autenticado; escrita = `has_permission('cca.review')` |
| `cca_stages` SELECT/WRITE | `0012:291` / `0059:92-96` | leitura livre; escrita = `has_permission('cca.review')` |
| `cca_cases` SELECT/WRITE | `0007:235-243` + `0044:216-220` | leitura = `has_any_role('admin','cca') or can_see_deal(deal_id)`; escrita = `has_permission('cca.review')` |
| `cca_case_events` | `cca_case_events_select` (`0007:245-253`) | **só SELECT.** Não há policy de INSERT: o INSERT vem de trigger `security definer` ou de `service_role` |
| `lead_attachments` SELECT/INSERT/DELETE | `0041:96-104` / `0005:723-725` | select = `can_see_lead(lead_id)`; insert = `uploaded_by = auth.uid() and can_see_lead(lead_id)`; delete = `uploaded_by = auth.uid() or has_any_role('admin','cca')` |

`can_edit_deal` na versão vigente (`0044:230-243`) é `has_permission('cca.review') or (participar do rateio ou gerenciar quem participa)`. `cca.review` é do papel `cca` no seed (`0044:86`) e `has_permission` curto-circuita em admin.

## Armadilhas

1. **`deals_guard_closed_month` não tem escape para `service_role`.** Só isenta `is_admin()`, que depende de `auth.uid()` — nulo na carga. Qualquer INSERT/UPDATE em `deals` cujo `month_base` esteja em `closed_months` é recusado, **inclusive o UPDATE em cascata que `cca_cases_sync_esteira_label` faz ao inserir um caso**. As migrations 0028 e 0077 resolveram desabilitando o trigger em volta do bloco (`0077:416, 425`). Faça o mesmo, ou reabra os meses antes da carga.
2. **Inserir `cca_cases` em massa dispara notificação por analista + pontuação de jogo + UPDATE em `deals`.** Avalie `alter table public.cca_cases disable trigger notify_cca_case_created, cca_award_points` durante a carga histórica; deixar `cca_cases_sync_esteira_label` ligado é o que preenche `deals.status_detail`, então provavelmente você quer esse ligado (e o mês reaberto).
3. **`cca_cases_decision_consistency`**: caso com `status in ('approved','rejected')` e `decided_at` nulo derruba a transação. Se o Bubble não tiver a data da decisão, use `submitted_at` ou a `Modified Date` do registro legado e registre a suposição.
4. **`storage_path` fora do padrão `<uuid>/…` degrada o objeto**: legível, mas não regravável nem sobrescrevível por usuário autenticado (o `with check` das duas policies exige prefixo UUID). O front já contorna na exclusão (`documents.ts:352-366`), mas é uma exceção mantida à mão. Prefira `<deal_id>/…`.
5. **Não escreva `version`/`superseded_at`/`superseded_by` no INSERT** sem desabilitar os triggers — eles vão brigar. E se desabilitar, você assume o invariante "um vigente por tipo", que **não tem índice** cobrando.
6. **`allows_multiple` muda o comportamento inteiro**: em `comprovante_renda`, `simulacao` e `outros` os triggers de versionamento **não fazem nada** — todo arquivo entra como `version = 1` e nenhum é marcado como substituído. Não tente versionar nesses três tipos.
7. **`lead-attachments` tem lista fechada de MIME.** Arquivo do Bubble com tipo fora dos 12 é recusado pela API do Storage mesmo com `service_role`.
8. **`cca_stages.color` em hex não colore nada** no front atual (`ccaStage.ts:63-76` só entende chave semântica, token ou família de paleta). Use `warning`/`success`/`info`/`danger`/`highlight`/`neutral`.
9. **`cca_status = 'cancelled'` não tem estágio no seed** — o caso cai no fallback e aparece na primeira coluna do quadro (`ccaData.ts:97-99`).
10. **`code = 'outros'` é dependência dura** de `convert_lead_to_deal` (`0028:203-210`). Não apague nem renomeie.
11. **Nunca chame `submit_deal_for_analysis` nem `review_deal_documents` na importação**: elas enfileiram `developer_submissions`, e o cron `dispatch_pending_submissions` (`0059:456-500`) manda e-mail de verdade para a construtora.
12. **`cca_case_events` não tem policy de INSERT.** Carga histórica desse audit trail só via `service_role`/`postgres`.
13. **Linha e objeto são duas gravações independentes.** Nada no banco casa `deal_documents.storage_path` com `storage.objects.name`. Registro sem arquivo produz "Baixar" que volta 400 — foi por isso que `missingStoragePaths` (`documents.ts:296-329`) e `scripts/seed-documents-storage.mjs` existem. Suba o objeto **antes** da linha e reconcilie ao final.
14. **Não há rate limit de Storage declarado no repositório.** O script de referência é sequencial. Para 25 mil arquivos, o paralelismo e o backoff são decisão sua — meça antes.

## Suposições declaradas

- **Fuso**: o export do Bubble não declara fuso; as datas devem ser interpretadas como `America/Sao_Paulo` ao converter para `timestamptz`. Isso vale para `created_at`, `submitted_at`, `decided_at` e `superseded_at`.
- **Teto global do projeto**: o `file_size_limit` de 25 MB de `deal-documents` só é atingível se o limite global de upload do projeto (painel Supabase → Storage → Settings) for ≥ 25 MB. Isso **não está versionado no repo** — confirmar no painel antes da carga.
- **`current_user` sob PostgREST**: assumo que a chave `service_role` resulta em `current_user = 'service_role'` (é o que os escapes de `0028:67` e `0059:121` pressupõem, e é como a 0060/0069 tratam o assunto). Se a carga for por outro caminho, confirme com `select current_user` antes.
