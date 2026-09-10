# Refutação — mapa "Catálogo" (`docs/importacao/mapa/catalogo.md`) pela lente **dados**

Data: 09/09/2026 · Fase somente leitura: nenhum comando tocou o banco; nenhum arquivo de código do repo foi alterado.
Parser: módulo `csv` do Python 3.12, `csv.field_size_limit(10**9)`, encoding `utf-8-sig`. Scripts temporários em
`<scratchpad>/v1.py`…`v11.py` (fora do repo).

**Veredito: REFUTADO (parcial), gravidade média.** O mapa é bom: 30 das 35 afirmações que consegui medir batem
**exatamente** com os CSVs. O que não se sustenta é a tabela de títulos "copiar verbatim" das §4.5/§4.6 — ela
**não é** a saída da heurística publicada na mesma seção. Nenhum defeito encontrado bloqueia a carga.

---

## 1. Defeito principal — as tabelas de título não saem da função publicada

**Onde:** `docs/importacao/mapa/catalogo.md` §4.5 (tabela dos 10 títulos de `gold_tips`, rotulada
"**copiar verbatim**"), §4.6 (tabela dos 18 títulos de `important_notices`), §8.2 (linhas `gold_tips.title` /
`important_notices.title`, cujo "default proposto" é "heurística §4.5 (tabela pronta com os 18)") e §9.D5
("A heurística gera títulos aceitáveis em 26 de 28").

**O que fiz:** copiei `limpa_bbcode()` e `titulo()` do próprio documento (§2 e §4.5), rodei sobre os dois CSVs
reais em ordem cronológica e comparei linha a linha com as duas tabelas publicadas (`v7.py`).

**Resultado: 10 dos 28 títulos divergem** (1 em `gold_tips`, 9 em `important_notices`):

| Tabela | # | Gerado pela função do documento | Publicado no documento |
|---|---:|---|---|
| `gold_tips` | 9 | `🏆 Dica de ouro de Maio: quem faz mais contatos agora,…` | `🏆 Dica de ouro de Maio` |
| `important_notices` | 1 | `Produtos Foco desta semana! - VASCO - TENDA - MRV` | `Produtos Foco desta semana` |
| `important_notices` | 7 | `Fevereiro Começou! 🚀🚀🚀` | `Fevereiro Começou` |
| `important_notices` | 8 | `Carnaval Começou !! 🥳🎉` | `Carnaval Começou` |
| `important_notices` | 9 | `Vamos fazer um Fevereiro Histórico!! 🥳🎉` | `Vamos fazer um Fevereiro Histórico` |
| `important_notices` | 10 | `🥳 *BATEU LEVOU* 🥳` | `🥳 BATEU LEVOU 🥳` |
| `important_notices` | 11 | `🥳 *BATEU LEVOU* 🥳` | `🥳 BATEU LEVOU 🥳` |
| `important_notices` | 12 | `Bateu Levou sendo apurados e pagos! 💰` | `Bateu Levou sendo apurados e pagos` |
| `important_notices` | 13 | `Meta não se bate por acaso — se constrói com disciplina…` | `Meta não se bate por acaso` |
| `important_notices` | 14 | `Meta não se bate por acaso — se constrói com disciplina…` | `Meta não se bate por acaso` |

As duas causas são distintas e as duas são reais:

1. **Oito casos**: `linha.strip(" -–—:!?.")` só remove os caracteres nas **pontas**. `Fevereiro Começou! 🚀🚀🚀`
   termina em emoji, então o `!` fica no meio e não é removido. A tabela publicada mostra o texto com a cauda
   cortada à mão — comportamento que a função não tem.
2. **Dois casos (#10 e #11)**: o corpus mistura BBCode do editor do Bubble com **markdown do WhatsApp**.
   `limpa_bbcode` só conhece BBCode. Medido (`v11.py`): **2 das 18 mensagens** ficam com `*negrito*` residual
   **no `body`**, não só no título — `*BATEU LEVOU*`, `*TENDA*`, `*VASCO*` nas mensagens
   `1773166808474x365797…` e `1773166964714x841883…`. A tabela §4.6 mostra os asteriscos já removidos.

**Por que importa:** quem seguir o texto ("copiar verbatim") grava 28 títulos; quem implementar a função grava
outros 10. Os dois estão no mesmo documento e são a mesma coluna `NOT NULL`. Além disso, a decisão **D5**
("heurística aceitável em 26 de 28, revisão humana opcional, ~15 min") foi dimensionada contra a lista limpa:
com a saída real da função são **12 títulos ruins de 28**, não 2 — o que muda o custo/benefício de D5.

**Não é bloqueante:** `title` é `NOT NULL` e sai preenchido nos dois caminhos; nenhuma FK, CHECK ou unique é
violada. É defeito de conteúdo em 28 linhas de mural, corrigível depois pela tela.

**Correção mínima (3 passos, sem inventar dado):**

1. Acrescentar `_WA = re.compile(r"\*([^\*\n]{1,80})\*")` e aplicar `t = _WA.sub(r"\1", t)` dentro de
   `limpa_bbcode`, **depois** do strip de BBCode. Resolve `body` e título de #10/#11 de uma vez (é o ponto
   compartilhado; corrigir só o título deixaria o `body` sujo).
2. Trocar `linha.strip(" -–—:!?.")` por remoção de pontuação/emoji de cauda, ou aceitar que o título traz a
   pontuação e regravar a tabela §4.6 com a saída real da função.
3. Republicar as tabelas §4.5/§4.6 a partir da execução da função corrigida e reescrever D5 com o número real de
   títulos que precisam de revisão humana.

---

## 2. Defeito secundário — a tripwire da §11 conta 32 onde há 33

**Onde:** §11, "Verificação cruzada antes da carga de negócios": *"todo valor distinto de
`COALESCE(CONSTRUTORA2, construtora)` em `pipelines` tem que achar linha em `developers` por `norm2`.
Medido agora: **32 valores distintos, 32 casam, 0 órfãos**."*

**Medido (`v3.py`, `v4.py`):**

```
distinct CONSTRUTORA2 ................................ 32
distinct construtora ................................. 33
distinct COALESCE(CONSTRUTORA2, construtora) ......... 33   <-- o número certo para essa frase
casam por norm2 ...................................... 33   |  órfãos: 0
```

O 33º valor é exatamente **`MAISLAR`** (5 linhas em que `CONSTRUTORA2` está vazia) — o único valor que motiva o
uso de `norm2` em vez de `norm` em todo o domínio, e justamente o que a contagem publicada deixa de fora. Só em
`construtora` e ausentes de `CONSTRUTORA2`: `MAISLAR` e `HARMONIA`.

**Consequência:** a conclusão ("0 órfãos") permanece verdadeira e verificada. Mas quem implementar a tripwire
esperando `32` vai ver `33` e tratar como regressão. Trocar o número por **33**.

---

## 3. Defeito terciário — deriva de ±1 linha nas citações de código

Todas as constraints citadas **existem e dizem o que o mapa afirma**; só o número da linha escorregou:

| Citação no mapa | Linha real | Conteúdo (confirmado) |
|---|---|---|
| `0003_catalog.sql:33-34` | **34-35** | `constraint developers_external_needs_email check (flow <> 'external' or submission_email is not null)` |
| `0003:88` (unique de projeto) | **87** | `unique (developer_id, name)` |
| `0003:192-193` (CHECK de canal) | **193-194** | `check (channel in ('meta','whatsapp','organic','indication','import','portal','other'))` |
| `Links.tsx:41` (`normalizeUrl`) | **42** | `value.trim().replace(/\/+$/, "").toLowerCase()` — equivale ao `lower(rtrim(url,'/'))` do mapa |

Corretas como publicadas: `0003:201` (`lead_sources_form_idx`), `0063:93-97` (`useful_links_url_absolute`),
`0084:41-43` (`ad_campaigns_status_maiusculo`), `0067` (unique global de `external_id`),
`GamificationAdmin.tsx:39-40` (desativa todas antes de inserir), `PipelineTopRanking.tsx:64-65`
(`active=true … order created_at desc … limit 1`), `DealForm.tsx:30` (`ORIGENS` com 5 opções fixas),
`seed.sql:120-128` (os 6 códigos de `lead_sources`).

Detalhe sem impacto, mas registrado: `PipelineTopRanking.tsx:64` faz `select("body")` em `gold_tips` — o
**título** de dica nunca é renderizado no banner do pipeline. O investimento da heurística de título de
`gold_tips` só aparece em `/admin` (`GamificationAdmin.tsx:27`).

---

## 4. O que foi verificado e **se sustenta** (não refutado)

Cada linha abaixo saiu de um comando executado sobre o CSV real.

### 4.1 `Construtoras` (`v1.py`, `v2.py`)

| Afirmação do mapa | Medido | OK |
|---|---|---|
| snapshot `19-37-19`: 41 registros, 13 colunas | 41 / 13, colunas idênticas à lista da §4.1 | sim |
| `19-36-44` é o mesmo snapshot, difere só em `agil_qtd` de TENDA/VASCO e `Modified Date` de 18 linhas | mesmos 41 `unique id`; diffs: `agil_qtd` 2 (TENDA 38→36, VASCO 30→27), `Modified Date` 18, nenhuma outra coluna | sim |
| `CCA`: 16 `CCA Faceimob`, 22 `CCA Externo`, 3 vazios (RPM, SOLV, VIVER) | 16 / 22 / 3, e os 3 vazios são exatamente RPM, SOLV, VIVER | sim |
| lista nominal das 22 `CCA Externo` (§5.1) | idêntica, as 22 | sim |
| `cor`: 39 `#rrggbb` + 2 `rgba(...)` em LOTUS e MAIS LAR | 39 hex / 2 rgba, e são LOTUS e MAIS LAR | sim |
| `meta` 5/41 · `metas` 0/41 · `Slug` 0/41 | 5 / 0 / 0 | sim |
| `vendas_qtd`: 2 valores no universo (`0` em 39, `1` em 2) | `Counter({'0': 39, '1': 2})` | sim |
| `Creator`: `Douglas Gomes` 40, `(App admin)` 1 | 40 / 1 | sim |
| `nome`: 40 em caixa alta, 1 Title Case (`Harmonia`) | único fora de caixa alta = `Harmonia`; 41 nomes distintos | sim |
| janela de `Creation Date`: 11/05/2024 18:30 → 14/05/2026 22:52 | idem, e **0 falhas** do regex `_RX_DATA` nas 41 | sim |
| 41 slugs distintos, 0 colisões | 41 distintos, 0 colisões | sim |
| `norm2` sobre os 41 nomes → 41 chaves distintas, 0 colisão | 41 / 41 | sim |

### 4.2 `pipelines` → `developer_projects` (`v3.py`, `v4.py`, `v8.py`, `v10.py`)

| Afirmação | Medido | OK |
|---|---|---|
| 7.568 registros | 7.568 | sim |
| `CONSTRUTORA2` 7.546 preenchidos, 100% casam no catálogo | 7.546 · 0 órfãos | sim |
| `construtora` cobre 5 linhas com `CONSTRUTORA2` vazia; 6 linhas `MAISLAR` | 7.551 − 7.546 = 5 · `MAISLAR` em 6 linhas (5 com `CONSTRUTORA2` vazia + 1 com `CONSTRUTORA2='MAIS LAR'`) | sim |
| 7.551 de 7.568 resolvem (99,78%); 17 sem construtora; **0 órfãos** | 7.551 / 17 / 0 | sim |
| 39 sem empreendimento · 2 com empreendimento e sem construtora | 39 / 2 | sim |
| **633** pares `(construtora, norm(EMPREENDIMENTO))` distintos | 633 | sim |
| **686** variantes brutas → normalização funde **53** | 686 valores brutos distintos entre as linhas com construtora resolvida; 686 − 633 = 53 | sim |
| 90 pares com mais de uma grafia | 90 | sim |
| 8 pares placeholder, lista nominal | os 8 exatos: `('TENDA','?')`, `('TENDA','0')`, `('TENDA','.')`, `('AVULSO','?')`, `('AVULSO','.')`, `('AVULSO','AVULSO')`, `('VASCO','AVULSO')`, `('CYRELA','AVULSO')` | sim |
| 330 pares com 1 ocorrência · 158 com ≥5 | 330 / 158 | sim |
| 54 nomes sob mais de uma construtora | 54 | sim |
| **volume final 625** = 633 − 8 | confere | sim |
| `Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta` 100% vazias em `pipelines` | 0 preenchidos nas 5 | sim |

> Nota sobre a §4.2: a regra escrita para placeholder ("só dígito/pontuação ou rótulo vazio") **não descreve** os
> 4 pares cujo nome é `AVULSO`. A lista nominal está certa; o critério em prosa é mais estreito que a lista. Quem
> implementar a partir do critério, e não da lista, descarta 4 e não 8 (`developer_projects` = 629, não 625).
> Custo: 4 empreendimentos-lixo no seletor. Correção: usar a lista nominal como fonte.

### 4.3 `OrigemLead` (§4.7 / §5.3) — `v3.py`

Distribuição medida em 7.568 negócios, com `repr()` para expor o NBSP:

| Valor bruto | Medido | Publicado | OK |
|---|---:|---:|---|
| `''` | 3.601 | 3.601 | sim |
| `'Lead Próprio'` | 2.832 | 2.832 | sim |
| `'Leadfy'` | 576 | 576 | sim |
| `'Lead\xa0Indicação'` (**NBSP confirmado**) | 359 | 359 | sim |
| `'Lead Loja'` | 166 | 166 | sim |
| `'Lead Feirão'` | 34 | 34 | sim |

O NBSP é real e está só nesse valor. O alerta do mapa procede.

### 4.4 `leadfies.Fonte` e `leadfies.Imóvel` (§4.3, §4.8, §5.2) — `v5.py`

102.799 registros, 42 colunas. **Os 14 valores de `Fonte` e as 14 contagens do de-para §5.2 batem um a um:**

`Facebook Leads` 94.421 · `Chatbot Leadfy` 3.703 · `WhatsApp` 1.792 · `Importados da planilha` 813 ·
`TecImob 2` 742 · `BotConversa` 464 · `Instagram` 409 · `Facebook` 267 · `Facebot` 68 · `Não definido` 51 ·
*(vazio)* 43 · `Site Faceimob` 22 · `Indicação` 2 · `VivaReal` 1 · `Integracao Leadfy` 1. Soma = 102.799.

`Imóvel`: **335 distintos não vazios**, **94.455** com valor, **8.344** vazios — os três números da §4.8.

Os 6 códigos que o mapa diz já existirem estão em `supabase/seed.sql:120-128`, exatamente
`meta_ads`, `whatsapp`, `organico`, `indicacao`, `importacao`, `portal`. O CHECK de `channel` aceita os 7 valores
usados no de-para. Logo "**+6 novos, 12 no total**" se sustenta.

### 4.5 `links`, `dicadeouros`, `mensagemdodias` (`v1.py`, `v6.py`, `v9.py`)

| Afirmação | Medido | OK |
|---|---|---|
| `links`: 3 registros, 6 colunas, **sem** `unique id` | 3 / 6 / colunas `link,nome,Creation Date,Modified Date,Slug,Creator` — não há `unique id` | sim |
| as 3 URLs, rótulos e datas da tabela §4.4 | idênticas, inclusive `?usp=drive_link` no Drive e `2025-07-25 10:34 / 12:07 / 12:08` | sim |
| `dicadeouros`: 10 registros, 28 linhas físicas | 10 / 28 | sim |
| `mensagemdodias`: 18 registros, 170 linhas físicas | 18 / 170 | sim |
| `Modified Date` == `Creation Date` nas 10 dicas e nas 18 mensagens | igual em 28/28 | sim |
| `Creator` = `Douglas Gomes` em 28/28 | 28/28 | sim |
| `Slug` 0% preenchido nos 3 arquivos | 0% | sim |
| os 10 `unique id` e as 10 datas da tabela §4.5 | conferem um a um | sim |
| as 18 datas e prefixos de `unique id` da tabela §4.6 | conferem um a um | sim |
| a #15 é o embed sozinho, 30 caracteres, 1 min depois da #14 | `len=30`, `[youtube]XEsKqh-2e3U[/youtube]`, 12:24 → 12:25 | sim |
| o regex de BBCode precisa aceitar `[li indent=0 align=left]` (presente em `1778867813543x…`) | a tag existe, 5 ocorrências, nessa mensagem | sim |
| `limpa_bbcode` não deixa resíduo de BBCode | **0 resíduo** nas 28 (tags encontradas: `[b] [i] [h2] [h3] [u] [ml] [ul] [li …] [quote] [color=…] [highlight=…] [youtube]`) | sim |
| `[youtube]` em 2 mensagens | 2 | sim |

### 4.6 Tabela `active` da §4.1 — as colunas de contagem (`v3.py`, `v8.py`)

Reconstruí as colunas **negócios**, **empreend.** e **metas** para as 41 construtoras a partir de
`pipelines` e `meta-constutoras` (402 registros, coluna `construtora`).
**41 de 41 batem nas três colunas — 0 divergências.** Inclui os casos difíceis: `MAIS LAR` = 25 negócios
(20 via `CONSTRUTORA2` + 5 via `MAISLAR`), TENDA 3.434/162/95, VASCO 2.107/141/93, MRV 435/85/66.
A soma das colunas de empreendimento = 633, coerente com a §4.2.
As 8 marcadas `false` (ADITAR, CNT, DALLASANTA, ELIOWINTER, LOTTICCI, PARADIS, RPM, SOLV) têm de fato
0 negócios, 0 empreendimentos e 0 metas.

### 4.7 Schema alvo (`0011_marketing_workspace.sql`)

Todas as colunas que o mapa manda preencher existem com o tipo e o default declarados:
`useful_links(label,url,icon,category default 'geral',sort_order int default 0,active,created_at,updated_at)`;
`important_notices(title,body,severity default 'info' check in ('info','warning','critical'),starts_at not null
default now(),ends_at,active,created_by → profiles on delete set null,…)`;
`gold_tips(title,body,author_id → profiles on delete set null,sort_order,active,…)`.
A policy `important_notices_select` filtra `active and starts_at <= now() and (ends_at is null or ends_at > now())`
— a §4.6 descreve certo. Nenhuma das 3 tabelas tem `external_id`, o que sustenta a necessidade da §7.

---

## 5. O que **não** consegui verificar nesta passada

Registro para não passar por provado:

- A resolução `leadfies.Imóvel → developers` da §6.3 (104 campanhas / 34.333 leads / 18 construtoras, e o falso
  positivo `Viverdes Zona Sul` → `VIVER`). Confirmei os insumos (335 nomes, 94.455 leads) e que os 18 nomes de
  construtora da §6.3 são exatamente os 18 com `leads > 0` na tabela da §4.1 — consistência interna, não prova
  independente do algoritmo de duas passadas.
- A coluna **leads** da tabela `active` (§4.1) depende dessa mesma resolução; herda a mesma pendência.
- `Douglas Gomes` único em `Users` (§6.2). Não abri o CSV de `Users` — ele contém `senha_temporaria` em texto
  claro e a afirmação não é o alvo desta lente.
- Fuso horário. O mapa assume `America/Sao_Paulo` e diz não haver fuso declarado no arquivo. Confirmei o formato
  (`Mon D, YYYY H:MM am/pm`, 0 falhas de parse em 41+3+10+18 = 72 datas de criação) mas **não há como provar o
  fuso a partir do export** — a suposição continua sendo suposição.

---

## 6. Comandos executados

```
ls -la DOCUMENTOS/DADOS_BUBBLE/
grep -n external_needs_email|channel|unique   supabase/migrations/*0003_catalog.sql
grep -n url_absolute                          supabase/migrations/*0063*.sql
grep -n external_id                           supabase/migrations/*0067*.sql
grep -n status_maiusculo                      supabase/migrations/*0084*.sql
sed  -n 271,320p / 495,510p                   supabase/migrations/*0011_marketing_workspace.sql
grep -n lead_sources -A14                     supabase/seed.sql
grep -rn gold_tips                            src/pages/ src/components/
grep -n ORIGENS -A2                           src/components/pipeline/DealForm.tsx
sed  -n 38,45p                                src/pages/Links.tsx

python v1.py    # header/ncols/nrows dos 5 CSVs pequenos
python v2.py    # perfil coluna a coluna de Construtoras + diff dos 2 snapshots + slugs + datas
python v3.py    # pipelines: 7.568, CONSTRUTORA2/construtora, pares, placeholders, OrigemLead com repr
python v4.py    # distinct de CONSTRUTORA2 vs construtora vs COALESCE; EMPREENDIMENTO bruto/norm
python v5.py    # streaming de leadfies (102.799): Fonte e Imóvel
python v6.py    # dicas/mensagens/links: datas, unique id, Creator, linhas físicas
python v7.py    # RODA a heurística publicada e compara com as tabelas 4.5/4.6  <-- defeito principal
python v8.py    # reconstrói as colunas empreend./metas da tabela `active` (41/41)
python v9.py    # inventário de tags BBCode e resíduo de limpa_bbcode
python v10.py   # as 4 leituras possíveis de "686 variantes brutas" (a do mapa é a correta)
python v11.py   # resíduo de markdown WhatsApp (*negrito*) no body após limpa_bbcode
```
