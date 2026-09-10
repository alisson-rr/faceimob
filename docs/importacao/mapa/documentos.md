# Mapa de importação — Documentos, CCA e Storage (Bubble → Supabase)

Domínio: anexos documentais dos negócios, esteira de crédito (CCA) e os objetos no Storage.
Data: 09/09/2026. Este documento é a especificação de implementação: **outro agente escreve o código a partir daqui, sem reabrir CSV**.

**Fontes da origem (escopo deste mapa)**

| Arquivo | Registros | Colunas | Papel |
|---|---:|---:|---|
| `export_All-doc-clientes-modified_2026-09-08_19-37-56.csv` | 25.890 | 23 | caixa de anexos do negócio (log append-only) |
| `export_All-doc-clientes_2026-09-08_19-37-42.csv` | 25.890 | 7 | **descartar** — subconjunto do anterior |
| `export_All-historicoPipes-modified_2026-09-08_19-39-27.csv` | 10.343 | 9 | snapshots da lista de anexos (a partir de 29/04/2025) |
| `export_All-pipelines-modified--_2026-09-08_19-43-56.csv` | 7.568 | 110 | **só as colunas de documento/CCA** (Grupo 7 + `cca_externo1..4` + `cotistaCCA` + `STATUS2`/`mudou_status`/`ENVIO`) |

**Destino:** `deal_documents`, `document_types`, `cca_cases`, `cca_case_events`, `cca_stages`, `lead_attachments`, `deal_history` (trilha de snapshot) e os buckets `deal-documents` / `lead-attachments`.

**Procedência dos números.** Tudo abaixo marcado como *(medido)* saiu de scripts Python 3.12 rodados sobre os CSVs nesta sessão (`csv.DictReader` em streaming, `field_size_limit = 50 MB`, scratchpad fora do repo). O que veio dos relatórios de perfil está marcado *(perfil)*. Nenhum comando foi executado contra banco.

**Dados pessoais:** nenhum exemplo neste documento contém nome, CPF, telefone ou e-mail real; onde há exemplo de nome de arquivo, ele está mascarado.

---

## 0. Veredito curto

| Pergunta | Resposta |
|---|---|
| Quantos arquivos subir | **30.279 objetos distintos** *(medido)*, ~4,5 GB pela mediana da amostra (faixa 4,5–18,7 GB) |
| Quantas linhas de documento | **30.915** `deal_documents` *(medido)*, das quais **2.245 (7,3%) nascem `superseded`** pela regra de versionamento |
| Bucket | `deal-documents` (privado, 25 MB/arquivo, sem restrição de MIME) |
| Caminho | `<deal_id>/<bubble_file_id>-<nome_saneado>` — prefixo UUID obrigatório, id do Bubble garante unicidade e idempotência |
| Casos de CCA | **7.549** (1 por negócio com `STATUS2`), sendo 5.235 decididos (`approved`/`rejected`) |
| `lead_attachments` | **nenhuma origem** — o export de leads não tem coluna de anexo *(perfil leads)* |
| FK por id que sobrevive | só `pipelines.doc → doc-clientes.unique id`. Todo o resto é **nome de exibição** |
| Idempotência | `deal_documents` por `storage_path` (determinístico); `cca_cases` por `deal_id` (unique); demais por tabela nova `import_bubble_map` |
| Maior risco | inserir 7.549 `cca_cases` dispara notificação por analista + pontos de jogo + `UPDATE` em `deals` que esbarra em `deals_guard_closed_month` |

---

## 1. Ordem de carga

Pré-requisitos que **não** são deste mapa (precisam estar carregados antes): `profiles`, `teams`, `developers`, `pipeline_stages`, `deals`, `deal_clients`, `deal_participants`.

| # | Passo | Tabela / alvo | Idempotência | Observação |
|---|---|---|---|---|
| 1 | Catálogo de tipos | `document_types` | `on conflict (code) do nothing` | 9 do seed; +0 a 4 novos conforme decisão D3 |
| 2 | Catálogo de estágios | `cca_stages` | `where not exists (... status = ...)` | 6 do seed; +1 (`cancelled`) conforme decisão D4 |
| 3 | Tabela de-para | `import_bubble_map` | `primary key (entidade, bubble_id)` | DDL na §5.2 |
| 4 | Popular o de-para dos negócios | `import_bubble_map` | idem | `pipelines.unique id → deals.id`; sem isso nada aqui resolve |
| 5 | **Travas** | — | — | reabrir meses fechados **ou** `alter table public.deals disable trigger deals_guard_closed_month`; desabilitar `notify_cca_case_created` e `cca_award_points` (§9) |
| 6 | Baixar do CDN + subir no Storage | bucket `deal-documents` | `x-upsert: true` + `HEAD /object/info` antes | **antes** das linhas: linha sem objeto produz "Baixar" com 400 |
| 7 | Linhas de documento | `deal_documents` | `on conflict (storage_path) do nothing` | inserir em **ordem cronológica** por `(deal_id, document_type_id)` |
| 8 | Trilha de snapshot (opcional, D5) | `deal_history` | `detail->>'bubble_id'` + `kind` | 10.343 linhas, nenhum arquivo extra |
| 9 | Casos de crédito | `cca_cases` | `on conflict (deal_id) do update` | dispara `cca_cases_sync_esteira_label` → `UPDATE deals` |
| 10 | Eventos de crédito (opcional, D6) | `cca_case_events` | `import_bubble_map` | fonte é `observacaoPipelines` com prefixo `STATUS:` (mapa de observações) |
| 11 | Correções pós-carga | `deal_documents.superseded_at`, `deals.document_review_*` | — | `UPDATE` não dispara os triggers de supersessão |
| 12 | **Destravar** | — | — | reabilitar triggers, fechar meses de volta, limpar `notifications` pendentes (§9) |

Por que 6 antes de 7: nada no banco casa `deal_documents.storage_path` com `storage.objects.name` — são duas gravações independentes *(alvo cca §14.13)*. Se o upload falhar, simplesmente não se cria a linha.

---

## 2. Mapeamento coluna a coluna

### 2.1 Funções de transformação (usar exatamente estas)

```python
# 1) Data en-US do Bubble -> timestamptz
#    America/Sao_Paulo não tem horário de verão desde 2019, então todo o intervalo
#    do export (ago/2023 a set/2026) converte por offset fixo -03:00, sem ambiguidade.
def dt(v):                                   # "Sep 18, 2024 6:24 pm" -> "2024-09-18T18:24:00-03:00"
    v = (v or "").replace("\xa0", " ").strip()
    if not v: return None
    return datetime.strptime(v, "%b %d, %Y %I:%M %p").replace(tzinfo=ZoneInfo("America/Sao_Paulo"))

# 2) URL do CDN -> chave canônica do arquivo
#    A MESMA URL aparece com e sem esquema. Sem normalizar, 60.021 strings viram
#    34.457 arquivos reais (inflação de 74%) (perfil documentos §5).
def url_norm(v):
    v = (v or "").replace("\xa0", " ").strip()
    if not v or v == "https:": return None   # 'https:' é SENTINELA DE VAZIO, 261.023 ocorrências
    if v.startswith("https://"): v = v[6:]
    if v.startswith("http://"):  v = v[5:]
    return v if v.startswith("//") else None # "//host/f<epoch>x<rand>/<nome%20percent%20encoded>"

def bubble_file_id(u):  return u.split("/")[-2]              # "f1726755891484x979659039014787500"
def original_name(u):   return urllib.parse.unquote(u.split("/")[-1])

# 3) Nome saneado para caminho e download (ASCII, sem acento, extensão preservada)
def sanitize(name):
    stem, dot, ext = name.rpartition(".")
    stem = stem or name
    s = unicodedata.normalize("NFD", stem)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()[:80] or "arquivo"
    return f"{s}.{ext.lower()}" if dot and len(ext) <= 5 else s

# 4) Normalização de nome para casar FK (pessoa, cliente)
def norm(s):
    s = unicodedata.normalize("NFD", (s or "").replace("\xa0", " "))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", s).strip()

# 5) Booleano PT do Bubble
def bool_pt(v):
    v = norm(v)
    return True if v in ("sim",) else False if v in ("nao",) else None

# 6) Lista do Bubble: separador é " , " (espaço-vírgula-espaço).
#    Seguro só para URLs e uids (nenhum contém vírgula). NÃO usar para nomes.
def split_lista(v): return [p for p in (v or "").split(" , ") if p.strip()]
```

Não há coluna monetária neste domínio — a regra de dinheiro brasileiro fica no mapa de negócios.

### 2.2 `doc-clientes-modified` (23 colunas, 25.890 registros)

| Origem | Destino | Regra de transformação | FK | Risco |
|---|---|---|---|---|
| `arquivos` | `deal_documents` (linhas) | `split_lista` → `url_norm`. **Fonte secundária**: só 8,65% preenchida e em 2.184 de 2.240 linhas é idêntica ao conjunto de `url_1..16`; usar para recuperar os **56 registros** cujos itens não cabem nos 16 slots *(perfil)* | — | teto de 16 slots trunca silenciosamente: 707 linhas têm exatamente 16 arquivos |
| `pipeline` | *(resolução de `deal_id`)* | `norm()` → casar com `pipelines.CLIENTE` (§4.1). Não vira coluna | → `deals.id` | 123 nomes ambíguos; 12 linhas com valor vazio |
| `url_1` … `url_16` | `deal_documents` (1 linha por URL) | `url_norm` (descarta a sentinela `https:`); dedup dentro da linha | — | **fonte primária**: 19.527 linhas têm `url_N` e `arquivos` vazio |
| `Creation Date` | `deal_documents.created_at` | `dt()` | — | também é o critério de "snapshot corrente" (§4.1) |
| `Modified Date` | **DESCARTAR** | usada só como desempate de ordenação; nunca gravada | — | — |
| `Slug` | **DESCARTAR** | 100% vazia | — | — |
| `Creator` | `deal_documents.uploaded_by` | `norm()` → `profiles` (§4.2). Não resolvido → `NULL` | → `profiles.id` | 15 vazios no recorte corrente; 825 registros correntes sem match *(medido)* |
| `unique id` | `import_bubble_map(entidade='doc_cliente')` | guardar cru | PK Bubble | é o alvo de `pipelines.doc` (2.857/2.857 casam) |

### 2.3 `doc-clientes` (7 colunas) — **arquivo inteiro DESCARTADO**

Justificativa medida no perfil: mesmo dataset, mesma ordem, 25.889 de 25.890 linhas idênticas nas 7 colunas comuns; a única divergência (linha 25.863) é edição concorrente durante o export e os 4 arquivos dela aparecem nas colunas `url_N` do arquivo completo. Não tem `unique id`, então nem serve de chave. **Não abrir este arquivo na importação.**

### 2.4 `historicoPipes-modified` (9 colunas, 10.343 registros)

| Origem | Destino | Regra | FK | Risco |
|---|---|---|---|---|
| `arquivos` | `deal_history.detail->'files'` (D5) **e** conjunto de upload | `split_lista` → `url_norm`. Traz **1.870 arquivos que não existem em doc-clientes** *(perfil §5)* | — | 233 linhas sem nenhum arquivo → descartar a linha |
| `ativo` | **DESCARTAR** | cardinalidade 1 (`não` em 10.343/10.343). Não carrega informação | — | se a operação disser que importava, o dado se perdeu no export |
| `nomesArquivos` | **DESCARTAR como lista** | em 653 linhas o `split(" , ")` diverge de `arquivos` porque há vírgula dentro do nome. O nome vem de `original_name(url)` — bate com `nomesArquivos` em 65.294/65.323 pares (99,96%) *(perfil §8)* | — | ambiguidade do separador |
| `pipeline` | *(resolução de `deal_id`)* | igual a 2.2 | → `deals.id` | 100% preenchida |
| `Creation Date` | `deal_history.created_at` | `dt()` | — | trilha só existe a partir de 29/04/2025 |
| `Modified Date` | **DESCARTAR** | igual a `Creation Date` em praticamente todas | — | — |
| `Slug` | **DESCARTAR** | 100% vazia | — | — |
| `Creator` | `deal_history.actor_id` | `norm()` → `profiles` (§4.2). 8.670/10.343 linhas resolvem (83,8%) *(medido)* | → `profiles.id` | 1.615 sem match → `NULL` |
| `unique id` | `deal_history.detail->>'bubble_id'` + `import_bubble_map` | guardar cru | PK Bubble | única defesa contra duplicar na reimportação |

### 2.5 `pipelines` — colunas de documento e CCA (escopo deste mapa)

| Origem | Destino | Regra | FK | Risco |
|---|---|---|---|---|
| `doc` | *(resolução)* | `unique id` de `doc-clientes`. **Ponte por id, 2.857/2.857 íntegra** — usar antes do nome | → registro de anexos | cobre só 37,7% dos negócios |
| `documentos` | `deal_documents` (linhas) | `split_lista` → `url_norm`. Lista corrente denormalizada, 29.447 URLs. **União com o snapshot corrente de doc-clientes** | — | 2.167 negócios só têm esta coluna |
| `financeiro` | **DESCARTAR aqui** | 7 linhas, lista de uid de `financeiros` — domínio de metas/financeiro | — | — |
| `RefCCHcca` | `cca_cases.analysis->>'ref_cch_cca'` | texto do mês (`JANEIRO`…), sem ano. `deal_clients.cch_reference` já vem de `ref_cch` (mapa de negócios) | — | 249 linhas; concorda com `ref_cch` em 88% |
| `cotistaCCA` | **DESCARTAR** | redundante com `cotista` (concordância 386/443 = 87%); `cotista` cobre 10× mais linhas | — | — |
| `cca_externo1` | `cca_cases.analyst_id` | e-mail → `profiles.email` (§4.3). Não resolvido → `analyst_id = NULL` e valor cru em `analysis->>'cca_externo_email'` | → `profiles.id` | 376 de 646 resolvem *(medido)*; há lixo (`a@a.com`, domínios com typo) |
| `cca_externo2` | `cca_cases.analysis->'analistas_extras'` | array de e-mails normalizados (minúsculas) | — | 296 linhas |
| `cca_externo3` | **DESCARTAR** | 8 linhas, 0/8 resolvem em `Users` | — | — |
| `cca_externo4` | **DESCARTAR** | cópia literal de `cca_externo3` | — | — |
| `STATUS2` | `cca_cases.status` + `cca_cases.stage_id` | de-para da §3.1 (normalizar NBSP antes, 262 linhas dependem disso) | → `cca_stages.id` | reescreve `deals.status_detail` por trigger |
| `mudou_status` | `cca_cases.decided_at` (quando decidido) | `dt()` | — | **1.450 dos 5.235 casos decididos (27,7%) carregam o carimbo de migração `Sep 18, 2024`** *(medido)* — não é a data real |
| `ENVIO` | `cca_cases.submitted_at` | `dt()`. Também é o `fallback` de `decided_at` | — | preenchida em 7.567/7.568 |
| `declaraImpostoRenda` | **DESCARTAR** | 4.174 `não` × 1 `sim` — constante na prática (destino seria `deal_clients.declares_income_tax`) | — | — |
| `emiteNota` | **DESCARTAR** | 100% `não` (4.175 linhas) | — | — |
| `rendaInformal` | `deal_clients.has_informal_income` *(mapa de negócios)* | `bool_pt`; coluna é `not null` → default `false` | — | 483 linhas |
| `ObsRenda` | `deal_clients.income_notes` *(mapa de negócios)* | texto cru | — | 162 linhas |
| `formaAtuacao` | `deal_clients.activity_form` *(mapa de negócios)* | `upper(trim())`; 169 variantes para poucos conceitos | — | sujo |
| `formaDivulgacao` | `deal_clients.disclosure_form` *(mapa de negócios)* | enum limpo (`Indicação`/`Mídias Sociais`/`Panfletagem`) | — | — |
| `segmentoAtividade` | `deal_clients.activity_segment` *(mapa de negócios)* | texto livre | — | 242 variantes |
| `dataInicioAtividade ` (**espaço no fim do nome**) | `deal_clients.activity_duration` *(mapa de negócios)* | **texto, não data** — 0/306 parseiam. Gravar cru | — | acesso por nome literal quebra sem o espaço |
| `gameEsteiraAgilPontuada` | *(mapa de gamificação)* | — | — | — |

> As linhas marcadas *(mapa de negócios)* aparecem aqui porque estão no Grupo 7 do CSV, mas **quem escreve `deal_clients` é o mapa de negócios**. Repetidas aqui só para nenhuma coluna da origem ficar sem destino declarado.

### 2.6 Contrato da linha de `deal_documents`

Uma linha por par (negócio, arquivo). Campos, e de onde cada um sai:

| Coluna destino | Origem / regra |
|---|---|
| `deal_id` | §4.1 |
| `document_type_id` | classificador da §3.2 sobre `original_name(url)` |
| `storage_path` | `f"{deal_id}/{bubble_file_id(url)}-{sanitize(original_name(url))}"` — **unique**, determinístico, prefixo UUID |
| `original_name` | `original_name(url)` (nome do Bubble, cru) |
| `stored_name` | `sanitize(original_name(url))` — é o nome do `Content-Disposition` no download e o do anexo no e-mail à construtora |
| `mime_type` | `Content-Type` da resposta HTTP do CDN (**não** deduzir da extensão: 3 arquivos não têm extensão) |
| `size_bytes` | `Content-Length` da resposta HTTP |
| `version` / `superseded_at` / `superseded_by` | **NÃO ESCREVER** — trigger calcula no INSERT. Correção de data histórica só por `UPDATE` posterior (§9) |
| `uploaded_by` | `Creator` do registro de origem → §4.2; `NULL` quando não resolve |
| `created_at` | `Creation Date` do registro de origem (`dt()`) |

`original_name` guarda CPF em **1.127 arquivos** (formatado) e 11 dígitos isolados em **590** *(medido)*. Isso vaza CPF em qualquer tela ou log que imprima o nome original — ver decisão D7.

### 2.7 Contrato da linha de `cca_cases`

| Coluna destino | Origem / regra |
|---|---|
| `deal_id` | `import_bubble_map` a partir de `pipelines.unique id` — **unique**, um caso por negócio |
| `status` | de-para da §3.1 sobre `STATUS2` normalizado |
| `stage_id` | `select id from cca_stages where status = <alvo> and active order by position limit 1` (mesma regra de `submit_deal_for_analysis`) |
| `analyst_id` | `cca_externo1` → §4.3; `NULL` quando não resolve |
| `agency_name` | domínio do e-mail de `cca_externo1` quando ele **não** é `@faceimob.com.br` e não resolve em `profiles`; senão `NULL` |
| `submitted_at` | `ENVIO` (`dt()`) |
| `decided_at` | `mudou_status` (`dt()`) quando `status in ('approved','rejected')`; fallback `ENVIO`; **nunca NULL nesses dois status** — `cca_cases_decision_consistency` derruba a transação inteira |
| `decision_notes` | `NULL` (a origem só tem a observação livre, que é do mapa de observações) |
| `pending_items` | `'[]'::jsonb` (default) |
| `analysis` | `jsonb` com o que não tem coluna: `{"bubble_status2": <valor original>, "ref_cch_cca": …, "cca_externo_email": …, "analistas_extras": […], "statusNumero": …}` |
| `created_at` / `updated_at` | `pipelines.Creation Date` / `Modified Date` |

---

## 3. De-para de valores

### 3.1 `STATUS2` → `cca_status` (+ `cca_stages` + `deals.status_detail`)

Normalizar **NBSP (`\xa0`) → espaço** antes de comparar: 3 rótulos o contêm e 262 linhas dependem disso. Contagens *(medidas)* sobre 7.568 linhas.

| `STATUS2` (Bubble) | Linhas | `cca_cases.status` | `cca_stages.name` | `deals.status_detail` gravado pelo trigger |
|---|---:|---|---|---|
| `APROV. TOTAL` | 1.172 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ASSINADO` | 718 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ASS. BANCO` | 699 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `PENDENTE` | 668 | `pending_documents` | Pendência de Documentos | `RET. ESTEIRA AGIL` |
| `APROV. COND.` | 663 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `REPROVADO` | 590 | `rejected` | Reprovado | *(nenhum, de propósito)* |
| `INCOMPLETO` | 551 | `pending_documents` | Pendência de Documentos | `RET. ESTEIRA AGIL` |
| `BACEN` | 465 | `rejected` ⚠️ | Reprovado | *(nenhum)* |
| `EM CONTRATO` | 423 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ESTEIRA AGIL` | 361 | `under_review` | Em Análise | `13. ESTEIRA AGIL` |
| `RESTRIÇÃO` | 201 | `rejected` ⚠️ | Reprovado | *(nenhum)* |
| `PENDENTE C/ RESTRIÇÃO` (NBSP) | 186 | `pending_documents` | Pendência de Documentos | `RET. ESTEIRA AGIL` |
| `DISTRATO` | 170 | `cancelled` ⚠️ | *(sem estágio)* | *(nenhum)* |
| `QUEDA` | 120 | `cancelled` ⚠️ | *(sem estágio)* | *(nenhum)* |
| `APROVADO POTENCIAL` | 96 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ANÁLISE EXTERNA` | 86 | `sent_to_agency` ⚠️ | Enviado à Agência | `ANÁLISE EXTERNA` |
| `VIROU NEGÓCIO` | 81 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `APROV. TOT. RESTRIÇÃO` | 69 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ANÁLISE P/ VIRAR NEGÓCIO` (NBSP) | 68 | `under_review` | Em Análise | `13. ESTEIRA AGIL` |
| `INTERNALIZADO` | 44 | `under_review` | Em Análise | `13. ESTEIRA AGIL` |
| `PENDENTE P/ VIRAR NEGÓCIO` | 36 | `pending_documents` | Pendência de Documentos | `RET. ESTEIRA AGIL` |
| `APROV. COND. RESTRIÇÃO` | 36 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `APROV. AG. CONT.` | 20 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `RET. ESTEIRA AGIL` | 13 | `pending_documents` | Pendência de Documentos | `RET. ESTEIRA AGIL` |
| `AG. RET. AGENCIA` (NBSP) | 8 | `sent_to_agency` | Enviado à Agência | `ANÁLISE EXTERNA` |
| `EM PROCESSAMENTO` | 2 | `under_review` | Em Análise | `13. ESTEIRA AGIL` |
| `RP APROVADO` | 1 | `approved` | Aprovado | `09. APROV. TOTAL` |
| `ENVIO DE RP` | 1 | `under_review` | Em Análise | `13. ESTEIRA AGIL` |
| `RC EMITIDA` | 1 | `approved` | Aprovado | `09. APROV. TOTAL` |
| *(vazio)* | 19 | **não criar caso** | — | — |

**Totais por destino** *(medidos)*: `approved` 3.979 · `pending_documents` 1.454 · `rejected` 1.256 · `under_review` 476 · `cancelled` 290 · `sent_to_agency` 94 · sem caso 19. **Soma 7.568.** Nenhum valor de `STATUS2` fica fora do de-para.

**Valor desconhecido (rótulo novo que apareça num re-export):** não inventar status. Gravar o caso com `status = 'under_review'`, `stage_id` do estágio "Em Análise", `analysis->>'bubble_status2'` com o valor cru e **registrar a linha no log de importação** para revisão. Nunca cair em `approved`/`rejected` por default: esses dois exigem `decided_at` e mexem no rótulo do funil.

⚠️ **Quatro escolhas que são suposição e não dedução** (viram decisões D1/D2/D4):
- `BACEN` (465) e `RESTRIÇÃO` (201) → `rejected`: o Bubble usa esses rótulos para "barrado por restrição no Bacen". A alternativa é `pending_documents` (o cliente ainda pode limpar o nome). 666 casos mudam de lado conforme a resposta.
- `ANÁLISE EXTERNA` (86) → `sent_to_agency` e não `sent_to_developer`: os dois geram o mesmo `status_detail` (`ANÁLISE EXTERNA`), então a diferença é só de coluna no quadro do CCA. `sent_to_developer` fica **sem nenhuma origem**.
- `DISTRATO`/`QUEDA` (290) → `cancelled`: **`cancelled` não tem estágio no seed**; o caso fica com `stage_id` nulo e a tela cai no fallback, mostrando esses 290 na primeira coluna ("Pendência de Documentos"). Ver D4.
- `ASSINADO`/`ASS. BANCO`/`EM CONTRATO`/`VIROU NEGÓCIO`/`RC EMITIDA` (1.922) → `approved`: são etapas **posteriores** à aprovação do crédito; assumi que chegar lá implica crédito aprovado.

### 3.2 Nome do arquivo → `document_types.code`

Classificador por regex sobre `norm(original_name)` (minúsculas, sem acento, `_` e `-` → espaço), **avaliado na ordem da tabela; a primeira regra que casa vence**. Cobertura medida sobre os 30.279 arquivos do conjunto de upload.

| Ordem | `code` destino | Regex (Python, `re.search`) | Arquivos | % |
|---:|---|---|---:|---:|
| 1 | `ctps` | `ctps\|carteira de trabalho\|ct digital\|contratosdigitais\|outrosvinculos` | 2.775 | 9,16% |
| 2 | `extrato_fgts` | `fgts\|historico creditos` | 965 | 3,19% |
| 3 | `imposto_renda` | `irpf\|imposto de renda\|declaracao de ajuste\|\bdirf\b` | 454 | 1,50% |
| 4 | `comprovante_resid` | `comprovante de resid\|residencia\|\bendereco\b\|\bfatura\b\|conta de (luz\|agua\|energia)\|\brge\b\|\bceee\b\|corsan` | 2.922 | 9,65% |
| 5 | `certidao_civil` | `certidao\|casamento\|nascimento\|estado civil\|averbacao` | 1.632 | 5,39% |
| 6 | `rg_cpf` | `\brg\b\|identidade\|cnh\|\bcin\b\|\bcpf\b\|\brne\b` | 4.312 | 14,24% |
| 7 | `simulacao` | `simula\|proposta\|\bmo\b\|porta de entrada\|caixa aqui\|avaliacao de risco\|portal de negocios\|\bscr\b\|bacen\|cch\|carta de credito\|fator social` | 3.488 | 11,52% |
| 8 | `comprovante_renda` | `holerite\|contracheque\|recibo de pag\|esocial\|demonstrativo\|extrato\|renda\|salario\|\bpis\b\|inss\|cnis\|declaracao\|\bnu \b\|nubank\|banco\|conta de pagamentos` | 4.854 | 16,03% |
| 9 | `outros` | *(fallback, sem regra)* | **8.877** | **29,32%** |

Composição do fallback `outros` *(medido)*: 4.330 sem nenhuma pista no nome (14,3%) · 3.562 print/scan sem nome útil — `whatsapp image…`, `photo …`, `camscanner…`, `img …-wa…` (11,8%) · **763 "carta de cancelamento"** (2,5%) · 222 "dependente" (0,7%).

Ressalvas herdadas do perfil e que valem aqui: é heurística de **nome**, não de conteúdo; acerto alto em RG/CNH/CTPS/FGTS/CCH (nomes padronizados) e baixo em "extrato bancário" × "comprovante de renda" (os nomes se sobrepõem, e por isso os dois caem no mesmo `comprovante_renda`); `MO` é sigla da Caixa não resolvida com a operação e foi jogada em `simulacao`.

**Ordem importa**: `ctps` vem antes de tudo porque `CTPS_CONTRATO_DE_TRABALHO_…` casaria em "contrato"; `comprovante_renda` vem por último porque a palavra `extrato`/`declaracao` aparece dentro de nomes de FGTS e IR.

**Consequência dura do `allows_multiple`** — em `rg_cpf`, `ctps`, `extrato_fgts`, `imposto_renda`, `comprovante_resid` e `certidao_civil` o trigger versiona: quando o mesmo negócio tem 2+ arquivos do mesmo tipo, só o último fica vigente. Medido: **2.245 documentos (7,3% de 30.915) nascem `superseded` e somem da tela** — 961 `rg_cpf`, 389 `ctps`, 316 `certidao_civil`, 197 `imposto_renda`, 195 `comprovante_resid`, 187 `extrato_fgts`. Isso é esperado no fluxo real (versão nova substitui a antiga), mas aqui muitos são **documentos de pessoas diferentes** (titular e cônjuge) ou frente/verso. Ver decisão D3.

### 3.3 Extensão / `Content-Type` → `mime_type` e triagem

Distribuição do conjunto de upload *(medida, 30.279 arquivos)*: `pdf` 24.791 (81,9%) · `jpeg` 3.653 · `jpg` 1.303 · `xlsx` 188 · `png` 148 · `xls` 101 · `jfif` 41 · `docx` 12 · `htm` 8 · `mht` 8 · `txt` 7 · `rar` 5 · `zip` 4 · `html` 4 · sem extensão 3 · `ods` 2 · `heic` 1.

- **`mime_type` sai do header HTTP**, não da extensão. O bucket `deal-documents` tem `allowed_mime_types` NULO de propósito — aceita qualquer coisa, inclusive `.zip`/`.rar`/`.jfif`.
- **Nenhum `.exe` no conjunto de upload** *(medido)* — os 3 executáveis citados no perfil só existem em snapshots antigos de `historicoPipes`, fora do recorte corrente. Se D5 trouxer o histórico inteiro, filtrar `\.(exe|bat|cmd|scr|js)$` antes de subir.
- 20 arquivos `htm`/`html`/`mht` são anexos de e-mail salvos pelo Outlook, sem valor documental: descartar (não é perda de dado, é ruído).
- `heic`/`jfif` (42) não são exibíveis por todo navegador; sobem sem problema em `deal-documents` (seriam recusados em `lead-attachments`, que tem lista fechada de 12 MIMEs).
- Teto de 25 MB por arquivo: **não medido** — o perfil só fez HEAD em 39 URLs (máximo 12,7 MB). O passo de HEAD prévio (§9) deve registrar e pular o que passar de 26.214.400 bytes.

### 3.4 Booleanos e demais valores

| Origem | Valores observados | Destino |
|---|---|---|
| `historicoPipes.ativo` | `não` (100%) | **DESCARTAR** |
| `rendaInformal` | `sim` 340 / `não` 143 | `bool_pt` → `deal_clients.has_informal_income` (`not null`, default `false`) |
| `declaraImpostoRenda` | `não` 4.174 / `sim` 1 | **DESCARTAR** (constante) |
| `emiteNota` | `não` 4.175 | **DESCARTAR** (constante) |
| `cotistaCCA` | `SIM`/`NÃO` | **DESCARTAR** (redundante) |
| `url_N` = `https:` | 261.023 ocorrências | **NULL** (sentinela de vazio) |

### 3.5 De-paras de outros domínios

`Funcao → app_role`, `Status de lead → lead_status/lead_funnel_stage` e `STATUS → deals.outcome` **não são deste mapa** — vivem em `docs/importacao/mapa/identidade.md`, `.../leads.md` e `.../negocios.md`. Aqui eles entram só como pré-requisito: `deals.outcome` já resolvido, `profiles` já criados com papel `cca` para quem for `analyst_id`.

---

## 4. Resolução de FK

Normalização única para todo casamento por nome (função `norm` da §2.1): NFD → remove marcas de acento → minúsculas → `\xa0` vira espaço → espaços colapsados → `strip`.

### 4.1 Arquivo → `deals.id` (a resolução crítica)

Algoritmo, em ordem. Pare no primeiro que resolver:

1. **Por id (confiança máxima).** `pipelines.doc` → `doc-clientes.unique id`. Integridade 2.857/2.857 *(perfil)*. É a única FK por id que sobreviveu ao export `-modified`.
2. **Por nome, único.** `norm(doc-clientes.pipeline)` ou `norm(historicoPipes.pipeline)` = `norm(pipelines.CLIENTE)`, quando o nome pertence a **um só** negócio. Todos os 4.425 nomes de pipeline vindos das duas tabelas existem em `pipelines.CLIENTE` — **zero órfãos por nome** *(perfil §10)*.
3. **Por nome, ambíguo.** 123 nomes de `CLIENTE` pertencem a 2 ou 3 negócios (249 linhas de `pipelines`); **171 negócios com arquivo caem nesse grupo** *(medido)*. Desempate, nesta ordem:
   a. janela de data — `doc-clientes.Creation Date` dentro de `[pipelines.Creation Date, pipelines.Modified Date + 30 dias]`; se sobrar um candidato, aceita;
   b. interseção de arquivos com `pipelines.documentos` do candidato (a lista corrente denormalizada) — maior interseção vence;
   c. ainda empatado: **anexar o pacote aos dois negócios** e marcar `deal_documents` correspondentes com o motivo no log. Custo medido dessa escolha: **636 linhas duplicadas** em `deal_documents` (30.915 linhas para 30.279 arquivos distintos). A alternativa (deixar de fora) perde documento de negócio real.
4. **Sem pipeline.** 12 linhas de `doc-clientes` com `pipeline` vazio → descartar, sem download.

**Cobertura medida do conjunto final**: 4.520 negócios recebem ao menos um arquivo (59,7% dos 7.568) — 2.242 tinham ponteiro `doc`, 2.242 resolveram só por nome, 36 vieram apenas da coluna `pipelines.documentos`. 3.048 negócios ficam sem nenhum documento.

### 4.2 `Creator` → `profiles.id` (`uploaded_by`, `actor_id`)

Regra de casamento em três tentativas (a mesma usada no perfil de observações, para o resultado ser comparável):

1. `norm(Creator)` = `norm(Users.Nome_completo)` → **exato**;
2. senão `primeiro + último` nome batem → **parcial**;
3. senão `primeiro + segundo` nome batem → **parcial**;
4. mais de um candidato em qualquer etapa → **ambíguo, trata como não resolvido**;
5. não resolvido → `uploaded_by = NULL` (a coluna é nullable, FK `on delete set null`).

Cobertura *(medida)*:

| Fonte | Exato | Parcial | Ambíguo | Sem match | Vazio |
|---|---:|---:|---:|---:|---:|
| `doc-clientes` (25.890 linhas) | 11.273 | 9.736 | 63 | 4.698 | 120 |
| `doc-clientes` — recorte corrente (4.398 registros) | 1.880 | 1.677 | 1 | 825 | 15 |
| `historicoPipes` (10.343 linhas) | 3.768 | 4.902 | 58 | 1.615 | 0 |

No recorte que vira `deal_documents`: **25.153 de 29.871 arquivos (84,2%) ganham `uploaded_by`**; 4.613 ficam com `NULL`.

Valores que **não são pessoa** e devem ir direto para `NULL` sem tentativa: `(App admin)`, `(deleted thing)`, `Parceiro Externo`, `Gerente Interino`, `Zona Sul`, `Faceimob`, `INTEGRACAO LEADFY`.

### 4.3 `cca_externo1/2` → `cca_cases.analyst_id`

1. `lower(strip(email))` = `profiles.email` (`citext`, comparação já é case-insensitive). **376 de 646 negócios resolvem** *(medido)*.
2. Não resolveu e o domínio é `faceimob.com.br` com typo conhecido (`facimob`, `fcaeimob`) → corrigir o domínio e tentar de novo; se ainda falhar, `NULL`.
3. Não resolveu e o domínio é externo (ex.: construtora) → `analyst_id = NULL` e `agency_name = <domínio>`.
4. Lixo evidente (`a@a.com`, `a@aaa.com`, `a@arrombado.com`, `a@gmal.com`) → `NULL` e nada em `agency_name`.
5. Em todos os casos, o valor cru vai para `analysis->>'cca_externo_email'` — sem isso a informação some.

**Pré-condição:** o analista precisa existir em `profiles` com papel `cca` para conseguir ler o caso pela tela (`cca_cases_select` = `has_any_role('admin','cca') or can_see_deal`). Se o mapa de identidade não criar esses perfis, `analyst_id` fica nulo em 100%.

---

## 5. Idempotência (reimportar sem duplicar)

### 5.1 Chave natural por tabela destino

| Tabela | Chave natural | Como se aplica | Precisa de tabela nova? |
|---|---|---|---|
| `deal_documents` | `storage_path` (**unique** no banco) | `<deal_id>/<bubble_file_id>-<nome_saneado>` é 100% determinístico a partir da URL do Bubble → `on conflict (storage_path) do nothing` | **Não** |
| `storage.objects` (bucket) | o próprio caminho | `POST` com `x-upsert: true` + `HEAD /object/info` comparando `size` antes de subir | Não |
| `cca_cases` | `deal_id` (**unique**) | `on conflict (deal_id) do update set status=…, stage_id=…, decided_at=…` | Não |
| `cca_stages` | `status` | `where not exists (select 1 from cca_stages where status = …)` — igual ao `seed.sql`. Não há unique de banco | Não |
| `document_types` | `code` (**unique**) | `on conflict (code) do nothing` | Não |
| `deal_history` (snapshots) | `(kind, detail->>'bubble_id')` | não há unique → `delete from deal_history where kind='bubble_docs_snapshot' and deal_id = …` antes de reinserir, **ou** consultar `import_bubble_map` | **Sim** (recomendado) |
| `cca_case_events` | `(case_id, kind, created_at)` | não há unique → mesma estratégia | **Sim** |

O achado que simplifica tudo: **o id do arquivo no Bubble (`f<epoch_ms>x<rand>`) já está dentro da URL e é estável**, então ele cabe no `storage_path`, que o banco já obriga a ser único. Não é preciso campo novo em `deal_documents` nem tabela de-para para o caso mais volumoso (30.915 linhas).

### 5.2 `import_bubble_map` — tabela de rastreio proposta

Não existe hoje: `grep -rn "import_bubble_map" docs/ supabase/` não devolve nada *(medido)*. Nenhuma tabela do schema alvo tem campo livre tipo `external_id` para documentos (`leads.external_id` é do domínio de leads e já está ocupado pelo id do lead no Meta).

```sql
-- migration nova, fora do escopo deste mapa mas pré-requisito do passo 3
create table if not exists public.import_bubble_map (
  entidade   text not null,          -- 'pipeline' | 'doc_cliente' | 'historico_pipe' | 'user' | 'observacao'
  bubble_id  text not null,          -- '1726694698451x711409717943992300'
  tabela     text not null,          -- 'deals' | 'deal_documents' | 'deal_history' | 'cca_cases' | 'profiles'
  registro_id uuid not null,
  detalhe    jsonb not null default '{}'::jsonb,
  criado_em  timestamptz not null default now(),
  primary key (entidade, bubble_id, tabela)
);
alter table public.import_bubble_map enable row level security;
create policy import_bubble_map_admin on public.import_bubble_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

Uso: o passo 4 popula `('pipeline', <unique id>, 'deals', <deal_id>)` e é ele que torna todo o resto resolvível. É também o único lugar onde o `unique id` de `doc-clientes` e de `historicoPipes` sobrevive.

**Alternativa mais barata, se criar tabela for indesejado:** gravar o `bubble_id` dentro de `deal_history.detail` (jsonb, já existe) e reconciliar por ele, aceitando um `delete … where kind = 'bubble_docs_snapshot'` antes de cada reimportação. Perde a rastreabilidade dos negócios e dos documentos, que passam a depender só de `deals.code` e `storage_path`.

---

## 6. Lacunas

### 6.1 Dado da origem sem destino no schema novo

| Origem | Volume | Destino possível | Recomendação |
|---|---:|---|---|
| Histórico de snapshots (`historicoPipes`) | 10.343 registros | `deal_history` com `kind='bubble_docs_snapshot'` | importar (custo: 10.343 linhas, **zero arquivo extra**) ou descartar — D5 |
| Versões anteriores dos anexos (`doc-clientes` não-corrente) | ~21,5 mil registros / 2.308 arquivos além do recorte corrente | `deal_documents` versionado | **não importar**: o fator de duplicação seria 6,5× e a tela de documentos fica inutilizável |
| `ativo` (`historicoPipes`) | 10.343 | — | descartar: cardinalidade 1, sem informação |
| `cca_externo3` / `cca_externo4` | 8 + 8 | — | descartar: cópias literais, 0% resolvem |
| `RefCCHcca` | 249 | `cca_cases.analysis` | jsonb livre, não há coluna |
| "Carta de cancelamento" como tipo | 763 arquivos | `document_types` novo | D3 |
| `sent_to_developer` | — | — | **nenhum valor de `STATUS2` mapeia para cá**; o status fica sem uso na carga |
| Assinatura/decisão do CCA com autor | — | `cca_case_events` | só reconstruível a partir de `observacaoPipelines` (mapa de observações) — D6 |

### 6.2 Coluna obrigatória do destino sem origem

| Tabela.coluna | `not null`? | Origem | Default proposto |
|---|---|---|---|
| `deal_documents.stored_name` | sim | não existe nome "da empresa" no Bubble | `sanitize(original_name)` — download sai com o nome do Bubble saneado, não com o padrão `{tipo}-{cliente}-{data}` |
| `deal_documents.document_type_id` | sim, FK `restrict` | inferido do nome | classificador da §3.2; fallback `outros` (29,3%) |
| `deal_documents.mime_type` | não | — | `Content-Type` do HTTP; `application/octet-stream` se ausente |
| `deal_documents.size_bytes` | não | — | `Content-Length`; `NULL` se ausente |
| `deal_documents.uploaded_by` | não | `Creator` | `NULL` em 15,8% dos arquivos |
| `cca_cases.decided_at` | condicional (`cca_cases_decision_consistency`) | `mudou_status` | `ENVIO` como fallback; **nunca NULL** em `approved`/`rejected` |
| `cca_cases.pending_items` | sim (default `'[]'`) | — | `'[]'::jsonb` |
| `cca_cases.analysis` | sim (default `'{}'`) | — | jsonb da §2.7 |
| `cca_case_events.kind` | sim | — | `'status_changed'` para eventos derivados de `STATUS:` |
| `deal_history.kind` | sim | — | `'bubble_docs_snapshot'` |
| `lead_attachments.*` | — | **nenhuma** | tabela fica vazia: o export de leads não tem coluna de arquivo |
| `document_types.label/category` | sim | — | só se D3 criar tipos novos |

---

## 7. Decisões que só o dono do negócio toma

| # | Decisão | Opções e consequências |
|---|---|---|
| **D1** | `BACEN` (465) e `RESTRIÇÃO` (201) são **reprovação** ou **pendência**? | `rejected`: 666 negócios aparecem como reprovados no quadro do CCA e não geram rótulo de funil. `pending_documents`: viram fila de pendência ativa e o negócio recebe `RET. ESTEIRA AGIL` em `status_detail` — parece trabalho a fazer num negócio antigo |
| **D2** | `ANÁLISE EXTERNA` (86) foi para a **construtora** ou para a **agência**? | Muda só a coluna do quadro; o rótulo do funil é o mesmo. Sem resposta, fica `sent_to_agency` e `sent_to_developer` nunca é usado |
| **D3** | O catálogo de `document_types` cresce? | Manter 9: **29,3% dos arquivos caem em `outros`** e a busca por tipo fica fraca; além disso 2.245 documentos nascem escondidos por versionamento. Criar 3 tipos com `allows_multiple = true` (`carta_cancelamento` 763, `identificacao_extra`, `renda_extra`) reduz o `outros` e o escondimento. Criar tipo novo mexe no seed e na tela do CCA |
| **D4** | Como tratar `DISTRATO`/`QUEDA` (290 casos)? | (a) criar `cca_stages` com `status='cancelled'` — 1 linha de seed, resolve o fallback; (b) não criar caso de CCA para esses negócios — perde-se o registro de que passaram pela esteira; (c) importar como está — os 290 aparecem na coluna "Pendência de Documentos" do quadro, sugerindo trabalho pendente que não existe |
| **D5** | Importar a trilha de `historicoPipes` (10.343 snapshots)? | Sim: auditoria de quem anexou o quê e quando, a custo de 10.343 linhas em `deal_history` e **nenhum** arquivo extra (os arquivos já estão no recorte corrente, menos 1.870). Não: o histórico anterior a 08/09/2026 desaparece |
| **D6** | Importar `cca_case_events` a partir das observações com prefixo `STATUS:` (4.561 linhas)? | Depende do mapa de observações. Sim: o caso de crédito ganha linha do tempo real com autor e data. Não: `cca_case_events` nasce vazio e o histórico da esteira fica só no comentário livre |
| **D7** | O nome original com CPF pode aparecer na tela? | 1.127 arquivos têm CPF formatado no nome e 590 têm 11 dígitos isolados *(medido)*. `stored_name` (o que a tela mostra e o e-mail anexa) pode mascarar; `original_name` é o dado de auditoria. Mascarar nos dois perde a rastreabilidade; não mascarar em nenhum expõe CPF em log e em anexo de e-mail para a construtora |
| **D8** | Reexportar do Bubble sem o sufixo `-modified`? | Um export cru de `doc-clientes` e `historicoPipes` traria a FK como `unique id` e eliminaria a ambiguidade de 171 negócios e as 636 linhas duplicadas. Custo: uma rodada de export; ganho: a resolução da §4.1 vira trivial |
| **D9** | Baixar do CDN antes ou depois de encerrar o Bubble? | As URLs são públicas **sem autenticação** — qualquer pessoa com o link lê CPF, holerite e extrato. Enquanto o Bubble estiver de pé, o vazamento continua ativo; migrar para bucket privado só encerra a exposição quando os links antigos deixarem de existir |

---

## 8. Volume estimado por tabela destino

| Tabela / alvo | Linhas | Como foi obtido |
|---|---:|---|
| `storage.objects` em `deal-documents` | **30.279** | união (snapshot corrente de `doc-clientes` por negócio) ∪ (`pipelines.documentos`), URLs normalizadas *(medido)* |
| Bytes a baixar e subir | **≈ 4,5 GB** (faixa 4,5–18,7 GB) | 30.279 × mediana 149.559 B da amostra HEAD n=39 *(perfil §7.3)*; a cauda é longa, medir com HEAD em todas antes |
| `deal_documents` | **30.915** | pares (negócio, arquivo) *(medido)* — 636 a mais que os arquivos distintos, por causa dos nomes ambíguos |
| — dos quais nascem `superseded` | 2.245 | trigger de versionamento em tipos sem `allows_multiple` *(medido)* |
| `cca_cases` | **7.549** | 1 por negócio com `STATUS2` preenchido *(medido)*; 19 negócios sem `STATUS2` não geram caso |
| `cca_case_events` | 0 ou ~4.561 | D6 (fonte é `observacaoPipelines` com prefixo `STATUS:`) |
| `deal_history` (`bubble_docs_snapshot`) | 0 ou **10.343** | D5 |
| `document_types` | 9 existentes + 0 a 3 | D3 |
| `cca_stages` | 6 existentes + 0 ou 1 | D4 |
| `lead_attachments` | **0** | sem origem |
| `import_bubble_map` | ~44.000 | 7.568 negócios + 25.890 doc-clientes + 10.343 historicoPipes (se D5) |

**Efeito colateral se as travas da §9 não forem aplicadas** (aritmética, não medição): 7.549 casos × (nº de analistas ativos) notificações `cca_pending` + `game_events` por corretor participante + 7.549 `UPDATE` em `deals`. Com 3 analistas, são ~22,6 mil linhas em `notifications`.

---

## 9. Procedimento de carga — travas e efeitos colaterais

**Papel:** `service_role` (via PostgREST) ou `postgres` (via `psql`). Nenhum outro passa: o `with check` de `deal_documents_storage` exige prefixo UUID de negócio que o usuário **edite**, e `deals_guard_document_review` só isenta `current_user in ('postgres','service_role')`. `service_role` tem BYPASSRLS, mas **não** é bypass de trigger nem de constraint.

**Antes da carga**

1. `deals_guard_closed_month` **não tem escape para `service_role`** — só isenta `is_admin()`, que depende de `auth.uid()` (nulo). Ele barra até o `UPDATE` em cascata que `cca_cases_sync_esteira_label` dispara ao inserir um caso. Duas saídas: reabrir os meses em `closed_months`, ou `alter table public.deals disable trigger deals_guard_closed_month` em volta do bloco — foi o que as próprias migrations 0028 e 0077 fizeram nos backfills.
2. `alter table public.cca_cases disable trigger notify_cca_case_created, cca_award_points;` — a primeira gera uma notificação por analista ativo **por caso**; a segunda pontua o jogo na temporada aberta hoje.
3. Manter `cca_cases_sync_esteira_label` **ligado** — é ele que preenche `deals.status_detail`; por isso o passo 1 é obrigatório.
4. Fila de leads/notificações: seguir o `operacao_alvo.md` (pausar os 10 jobs `faceimob-*` e `automation_settings.leads_paused = true`). Um `npm run db:reset` religa `faceimob-notify-dispatch` incondicionalmente — repor a pausa depois de qualquer reset.

**Upload dos objetos** — o padrão está em `scripts/seed-documents-storage.mjs` e vale reproduzir:

```
HEAD  {url}/storage/v1/object/info/deal-documents/{caminho}   -> se size bate, pula
POST  {url}/storage/v1/object/deal-documents/{caminho}
      headers: apikey + Authorization: Bearer <service_role>, Content-Type: <do CDN>, x-upsert: true
```

- `encodeURIComponent` **por segmento** do caminho, nunca no caminho inteiro (senão a `/` vira `%2F` e o objeto muda de pasta).
- O script de referência é **sequencial**; para 30 mil arquivos use paralelismo baixo (4–8), retry com backoff em `429`/`5xx` e checkpoint por arquivo. **Não há rate limit declarado no repositório** — medir.
- Fazer `HEAD` no CDN antes de baixar, para registrar `Content-Length`/`Content-Type` e pular o que passar de 26.214.400 bytes.
- Confirmar no painel do Supabase que o limite global de upload do projeto é ≥ 25 MB (não está versionado).

**Depois da carga**

1. Reabilitar os triggers e fechar de volta os meses reabertos.
2. Corrigir `superseded_at` histórico por `UPDATE` (os triggers de supersessão são só de INSERT/DELETE).
3. Reconciliar linha × objeto: para todo `deal_documents.storage_path` sem objeto correspondente, ou sobe o arquivo ou apaga a linha — é exatamente o que `missingStoragePaths` (`src/integrations/supabase/documents.ts:296-329`) diagnostica.
4. Limpar a fila que os gatilhos escreveram apesar do cron pausado:
   `update notifications set sent_at = now(), last_error = 'descartada: carga de dados legados' where channel <> 'in_app' and sent_at is null and created_at >= :inicio;`
5. **Nunca** chamar `submit_deal_for_analysis` nem `review_deal_documents` na importação: elas enfileiram `developer_submissions` e o cron `dispatch_pending_submissions` manda **e-mail de verdade** para a construtora.

---

## 10. Suposições declaradas e riscos residuais

1. **Fuso.** O export não declara fuso; assumi `America/Sao_Paulo` em `Creation Date`, `Modified Date`, `ENVIO` e `mudou_status`. Como o Brasil não tem horário de verão desde 2019 e todo o intervalo é ago/2023 → set/2026, a conversão é de offset fixo `-03:00`, sem ambiguidade — mas se o Bubble exportou em UTC, tudo desloca 3 h e ~4% dos registros mudam de dia.
2. **`decided_at` de 1.450 casos é carimbo de migração** (`Sep 18, 2024`), não a data real da decisão *(medido)*. A constraint exige uma data; a que existe é essa.
3. **O classificador de tipo é heurística de nome**, não leitura de conteúdo. 29,3% cai em `outros`. Não foi validado contra os PDFs.
4. **A união "snapshot corrente + `pipelines.documentos`"** é a definição de "documento vigente" que adotei. Ela dá 30.279 arquivos; o perfil, com um recorte ligeiramente diferente (só `url_N`, sem a coluna `arquivos`), chegou a 29.263. A diferença são os arquivos que só existem na coluna `arquivos` e os que só existem em `pipelines.documentos`.
5. **171 negócios têm nome de cliente ambíguo** e, sem D8, recebem o pacote de documentos de um homônimo — 636 linhas a mais em `deal_documents`.
6. **Nenhum arquivo foi baixado.** Tamanho, `Content-Type` e existência atual de cada objeto no CDN são desconhecidos linha a linha; o perfil confirmou 39/39 respondendo `200` numa amostra aleatória.
7. **`lead_attachments` fica vazia** — se aparecer origem de anexo de lead depois, atenção: aquele bucket tem **lista fechada de 12 MIMEs** e recusa `.zip`, `.rar`, `.jfif` mesmo com `service_role`.
