# Mapa de importação — domínio "Catálogo": construtoras, empreendimentos, fontes e conteúdo

Data: 09/09/2026 · Fase somente leitura (nenhum comando tocou o banco; nenhum arquivo do repo foi alterado além deste).
Origem: `DOCUMENTOS/DADOS_BUBBLE/` · Destino: schema `public` do Supabase (`docs/importacao/SCHEMA_ALVO.md`).
Parser usado em toda medição: módulo `csv` do Python 3.12, `csv.field_size_limit(1e9)`, encoding `utf-8-sig`.
Todos os números deste documento saem dos comandos listados na §12.

## 0. Escopo e resumo executivo

**7 tabelas destino, 775 linhas para inserir** (sem `ad_campaigns`, que é decisão do dono — §9.D4).

| # | Tabela destino | Origem Bubble | Linhas a inserir |
|---|---|---|---:|
| 1 | `developers` | `Construtoras` (snapshot 19-37-19) | **41** (33 `active=true`, 8 `false`) |
| 2 | `developer_projects` | **derivado** de `pipelines(CONSTRUTORA2/construtora, EMPREENDIMENTO)` | **625** (633 pares − 8 placeholders) |
| 3 | `lead_sources` | `leadfies.Fonte` | **6 novos** (6 códigos do seed já existem) |
| 4 | `useful_links` | `links` | **3** |
| 5 | `gold_tips` | `dicadeouros` | **10** |
| 6 | `important_notices` | `mensagemdodias` | **18** |
| 7 | `import_bubble_map` (**tabela nova, proposta** — §7) | os 4 arquivos com `unique id` + `links` | **72** |
| — | `ad_campaigns` (opcional, §9.D4) | `leadfies.Imóvel` | 335 se aprovado |

Fora do escopo, mas alimentado por este domínio: `deals.developer_id`, `deals.project_id`, `deals.lead_origin`
(agente de negócios) e `leads.source_id`, `leads.campaign_name` (agente de leads). Este documento entrega os
mapas de resolução que aqueles dois agentes vão consumir.

**Duas coisas que precisam ser lidas antes de escrever código:**

1. **`developers_external_needs_email`** (`0003_catalog.sql:33-34`) recusa `flow='external'` sem `submission_email`.
   As 22 construtoras `CCA Externo` do Bubble **não têm e-mail em lugar nenhum do export**. A carga entra com
   `flow='internal'` para as 41 e deixa uma lista de 22 para o negócio preencher (§5.1, §9.D1).
2. **`important_notices` e `gold_tips` são lidos por `created_at desc limit 1`** (`PipelineTopRanking.tsx:64-65`).
   Se `created_at` ficar no default `now()`, a ordem cronológica de 6 meses de mural vira empate e o banner
   mostra um recado aleatório. `created_at` **tem que ser mandado explícito**.

**Suposição de fuso** (vale para todas as datas deste domínio): os carimbos do Bubble vêm em en-US sem fuso
declarado (`May 11, 2024 6:30 pm`). Trato como `America/Sao_Paulo`. Se o Bubble exportou em UTC, tudo fica 3h
adiantado — impacto cosmético neste domínio (catálogo), material em leads/negócios. Registrar a suposição no
`import_bubble_map.notes` da primeira carga.

---

## 1. Ordem de carga

```
(pré-requisito, outro agente)  profiles          ← author_id / created_by de gold_tips e important_notices
                                                    (só "Douglas Gomes" é necessário)
─────────────────────────────────────────────────────────────────────────────
 1. import_bubble_map                    (DDL nova; sem dependência)
 2. developers                           (sem dependência)
 3. developer_projects                   (FK developer_id → developers)
 4. lead_sources                         (sem dependência; on conflict (code) do nothing)
 5. useful_links                         (sem dependência)
 6. gold_tips                            (FK author_id → profiles, nullable)
 7. important_notices                    (FK created_by → profiles, nullable)
 8. [opcional] ad_campaigns              (FK developer_id → developers, lead_source_id → lead_sources)
─────────────────────────────────────────────────────────────────────────────
(depois, outros agentes)       leads → deals → cca_cases …
```

`developer_projects` **precisa** vir antes de `deals` (FK `project_id`), e `developers` antes de tudo que
referencia construtora — inclusive `marketing_investments` e `ad_campaigns`.

Passos 2–8 são independentes entre si exceto pelas FKs marcadas; podem ir numa transação só. O domínio inteiro
tem 775 linhas: **uma transação única é o certo** — se qualquer coisa quebrar, nada fica pela metade.

### Travas de operação antes de começar

Este domínio **não dispara** nenhum gatilho de notificação, de gamificação ou de roleta (verificado: as 7 tabelas
só têm `set_updated_at` e `developers_ensure_slug`). As travas descritas em `docs/importacao/alvo/operacao_alvo.md`
(pausar os 10 crons `faceimob-*` e `automation_settings.leads_paused = true`) **não são necessárias para o
catálogo** — mas se a carga de catálogo for a primeira etapa de uma janela que segue para leads/negócios, ligue
as travas agora e não no meio.

---

## 2. Funções canônicas de normalização

Todo o resto do documento chama estas cinco funções pelo nome. Implemente-as uma vez.

```python
import csv, re, unicodedata, datetime, zoneinfo
csv.field_size_limit(10**9)
TZ = zoneinfo.ZoneInfo("America/Sao_Paulo")

_MES = {m: i + 1 for i, m in enumerate(
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])}
_RX_DATA = re.compile(r"^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (am|pm)$")

def parse_dt(s):
    """'May 11, 2024 6:30 pm' -> datetime aware em America/Sao_Paulo. None se vazio.
    NÃO use strptime('%b'): depende do locale do processo e falha em máquina pt-BR."""
    m = _RX_DATA.match((s or "").strip())
    if not m:
        return None
    mo, d, y, h, mi, ap = m.groups()
    h = int(h) % 12 + (12 if ap == "pm" else 0)
    return datetime.datetime(int(y), _MES[mo], int(d), h, int(mi), tzinfo=TZ)

def norm(s):
    """Chave de comparação legível: sem acento, NBSP->espaço, espaços colapsados, MAIÚSCULA."""
    s = unicodedata.normalize("NFKD", (s or "").replace("\xa0", " "))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()

def norm2(s):
    """Chave agressiva: norm() sem nada que não seja A-Z0-9. Resolve 'MAIS LAR' == 'MAISLAR'."""
    return re.sub(r"[^A-Z0-9]", "", norm(s))

def slugify(t):
    """Réplica exata de public.slugify (0001_foundation.sql:171-182)."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")

_BB  = re.compile(r"\[/?[a-zA-Z][a-zA-Z0-9]*(?:[ =][^\]]*)?\]")   # [b] [/b] [color=rgb(..)] [li indent=0 align=left]
_YT  = re.compile(r"\[youtube\]([\w-]{6,})\[/youtube\]")

def limpa_bbcode(t):
    """Remove o markup do editor do Bubble e preserva o vídeo como link.
    A ordem importa: o embed vira URL ANTES de o strip genérico comer a tag."""
    t = (t or "").replace("\xa0", " ")
    t = _YT.sub(lambda m: "\nhttps://youtu.be/" + m.group(1) + "\n", t)
    t = _BB.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()
```

> ⚠️ O regex de BBCode **precisa** aceitar atributos com espaço (`[li indent=0 align=left]`, presente na
> mensagem `1778867813543x…`). Um `\[/?[a-z0-9]+\]` simples deixa essa tag no texto.

> ⚠️ `limpa_bbcode` **remove** negrito/itálico em vez de converter para HTML. É a opção segura: `gold_tips.body`
> e `important_notices.body` são renderizados como texto pelo front; converter para HTML abriria superfície de
> XSS sem sanitizador no caminho.

**Telefone / CPF / dinheiro:** nenhuma coluna deste domínio contém telefone, CPF, e-mail, endereço ou valor
monetário estruturado. As regras de E.164, só-dígitos e `numeric` **não se aplicam aqui** — valem para os
domínios de identidade, leads e negócios. Os valores em reais que aparecem dentro do texto de `mensagemdodias`
(`R$ 200,00 CORRETOR`) são prosa de campanha, não dado (§8.L4).

---

## 3. Chave de idempotência — resumo

| Tabela destino | Chave natural para reimportar sem duplicar | Onde guardar o `unique id` do Bubble |
|---|---|---|
| `developers` | `name` (unique) e `slug` (unique) — os dois já existem no schema | `import_bubble_map` |
| `developer_projects` | `(developer_id, name)` — unique de tabela (`0003:88`) | **não precisa**: o Bubble não tem entidade de empreendimento, o par já é a chave |
| `lead_sources` | `code` (unique) | não precisa |
| `useful_links` | **nenhuma no schema** → usar `lower(rtrim(url,'/'))`, a mesma regra do front (`Links.tsx:41`) | `import_bubble_map` (o CSV `links` **não tem** `unique id`; a chave é a URL) |
| `gold_tips` | **nenhuma** | `import_bubble_map` — obrigatório |
| `important_notices` | **nenhuma** | `import_bubble_map` — obrigatório |
| `ad_campaigns` | `external_id` (unique global desde `0067`) | o próprio `external_id` sintético (§4.8) |

Não existe coluna livre tipo `external_id` em `developers`, `gold_tips`, `important_notices` ou `useful_links`.
`developers.notes` **não serve**: é campo de negócio editável na tela (`AdminDevelopers.tsx:365,403`) — o usuário
apaga o texto e a idempotência morre junto. Daí a tabela de-para (§7).

---

## 4. Mapeamento coluna a coluna

### 4.1 `Construtoras` → `developers`

Arquivo: **`export_All-Construtoras-modified_2026-09-08_19-37-19.csv`** — 41 registros, 13 colunas.
O arquivo irmão `…19-36-44.csv` é o **mesmo snapshot 25 min mais velho**: mesmos 41 `unique id`, diferindo só em
`agil_qtd` de TENDA (38→36) e VASCO (30→27) e no `Modified Date` de 18 linhas. **Não importar os dois.**

| # | Origem (`Construtoras.<col>`) | Destino | Regra de transformação | Risco |
|---|---|---|---|---|
| 0 | `agil_qtd` | **DESCARTAR** | Contador vivo de workflow do Bubble. Provado: mudou em 2 construtoras em 25 min entre os dois snapshots, sem nenhum outro dado mudar. No alvo o número sai de `deals`. | Importar = segunda fonte de verdade nascendo errada |
| 1 | `CCA` | `developers.flow` | De-para de 2 valores + vazio (§5.1). **Mas ver §5.1: a recomendação é entrar tudo `internal`** por causa da constraint de e-mail | Alto — constraint `developers_external_needs_email` |
| 2 | `cor` | **DESCARTAR** | `developers` não tem coluna de cor e `AdminDevelopers.tsx` não tem campo de cor (`COLUNAS = "id,name,flow,submission_email,contact_name,contact_phone,notes,active"`, linha 37). 39 valores `#rrggbb`, 2 `rgba(114,28,29,1)` (LOTUS e MAIS LAR) | Perda cosmética consciente. Se o negócio quiser preservar: gravar em `notes` como `cor=#rrggbb` (feio) ou pedir coluna nova |
| 3 | `meta` | **DESCARTAR** | Só 5 de 41 preenchidas. A fonte correta de meta por construtora é `export_All-meta-constutoras-modified` (402 linhas, construtora × equipe × mês) — domínio de metas | Importar cria duas fontes de meta |
| 4 | `metas` | **DESCARTAR** | 0 de 41 preenchidas (campo morto) | nenhum |
| 5 | `nome` | `developers.name` | `re.sub(r'\s+',' ', v.replace('\xa0',' ')).strip()` — **preserva a caixa original**. 40 nomes em CAIXA ALTA, 1 em Title Case (`Harmonia`) | O front resolve por `ilike` exato (`newSchema.ts:880`); mexer na caixa depois quebra a resolução. Ver §6.1 |
| 6 | `vendas_qtd` | **DESCARTAR** | Derivado. 2 valores no universo inteiro (`0` em 39, `1` em 2) | idem col. 0 |
| 7 | `vgv_qtd` | **DESCARTAR** | Derivado (placar do mês corrente) | idem col. 0 |
| 8 | `Creation Date` | `developers.created_at` | `parse_dt()` → timestamptz. Janela: 11/05/2024 18:30 a 14/05/2026 22:52 | baixo |
| 9 | `Modified Date` | `developers.updated_at` | `parse_dt()`. **Sobrevive ao INSERT** (o trigger `developers_set_updated_at` é `before update`, não `before insert`). Poluída por workflows de contador — valor tem pouca informação | baixo |
| 10 | `Slug` | **DESCARTAR** | 0 de 41 preenchidas (campo nativo do Bubble nunca usado) | nenhum |
| 11 | `Creator` | **DESCARTAR** (usar só para auditoria) | `developers` não tem `created_by`/`author_id`. Valores: `Douglas Gomes` 40, `(App admin)` 1 (é a LOTTICCI) | nenhum |
| 12 | `unique id` | `import_bubble_map.bubble_id` | Chave de idempotência (§7) | nenhum |

**Colunas do destino sem origem** (todas preenchidas na carga):

| Coluna | Valor a gravar | Por quê |
|---|---|---|
| `slug` | `slugify(nome)` **explícito** | Os 41 slugs são distintos (verificado, 0 colisões) — mandar explícito torna o insert idempotente por `slug` e evita depender do sufixo numérico do trigger `developers_ensure_slug` |
| `flow` | `'internal'` (default) nas 41 | §5.1 e §9.D1 |
| `submission_email` | `NULL` | não existe no legado |
| `contact_name`, `contact_phone` | `NULL` | não existem no legado |
| `notes` | `NULL` | deixar livre para o usuário |
| `active` | `true` em 33, `false` em 8 | ver tabela abaixo |
| `id` | `gen_random_uuid()` (default) | — |

**`active` — as 8 construtoras que entram desativadas.** Critério: zero uso em `pipelines` **e** zero lead
atribuído em `leadfies.Imóvel` **e** zero meta em `meta-constutoras`. Medido, por construtora:

| nome | slug | negócios | empreend. | leads | metas | `active` |
|---|---|---:|---:|---:|---:|---|
| ABACO | `abaco` | 44 | 7 | 2.594 | 0 | true |
| **ADITAR** | `aditar` | 0 | 0 | 0 | 0 | **false** |
| APICE | `apice` | 133 | 19 | 433 | 10 | true |
| AVULSO | `avulso` | 56 | 36 | 0 | 0 | true |
| BALIZA | `baliza` | 17 | 9 | 1 | 0 | true |
| BELMAIS | `belmais` | 3 | 2 | 0 | 0 | true |
| BELMONTE | `belmonte` | 0 | 0 | 4 | 0 | true |
| BOLOGNESI | `bolognesi` | 25 | 7 | 0 | 0 | true |
| CELSUL | `celsul` | 13 | 2 | 125 | 0 | true |
| **CNT** | `cnt` | 0 | 0 | 0 | 0 | **false** |
| CONCORDIA | `concordia` | 1 | 1 | 0 | 0 | true |
| COUTO | `couto` | 8 | 2 | 16 | 0 | true |
| CYRELA | `cyrela` | 42 | 9 | 0 | 0 | true |
| **DALLASANTA** | `dallasanta` | 0 | 0 | 0 | 0 | **false** |
| **ELIOWINTER** | `eliowinter` | 0 | 0 | 0 | 0 | **false** |
| ENGEPP | `engepp` | 1 | 1 | 0 | 0 | true |
| Harmonia | `harmonia` | 1 | 1 | 13 | 0 | true |
| **LOTTICCI** | `lotticci` | 0 | 0 | 0 | 0 | **false** |
| LOTTICI | `lottici` | 7 | 4 | 0 | 0 | true |
| LOTUS | `lotus` | 42 | 13 | 1 | 0 | true |
| LYX | `lyx` | 351 | 40 | 506 | 53 | true |
| MAIS LAR | `mais-lar` | 25 | 8 | 0 | 0 | true |
| MC3 | `mc3` | 397 | 14 | 3.826 | 44 | true |
| MELNICK | `melnick` | 51 | 7 | 0 | 6 | true |
| MGF | `mgf` | 4 | 2 | 23 | 0 | true |
| MMR | `mmr` | 14 | 3 | 0 | 0 | true |
| MNB | `mnb` | 33 | 9 | 1.108 | 0 | true |
| MORANA | `morana` | 193 | 24 | 671 | 34 | true |
| MRV | `mrv` | 435 | 85 | 360 | 66 | true |
| **PARADIS** | `paradis` | 0 | 0 | 0 | 0 | **false** |
| PAVEI | `pavei` | 1 | 1 | 0 | 0 | true |
| RNI | `rni` | 15 | 8 | 3 | 0 | true |
| RODOBENS | `rodobens` | 2 | 1 | 0 | 0 | true |
| **RPM** | `rpm` | 0 | 0 | 0 | 0 | **false** |
| SALIS | `salis` | 6 | 5 | 0 | 0 | true |
| **SOLV** | `solv` | 0 | 0 | 0 | 0 | **false** |
| SOUTH | `south` | 87 | 7 | 428 | 1 | true |
| TENDA | `tenda` | **3.434** | 162 | 2.059 | 95 | true |
| VASCO | `vasco` | **2.107** | 141 | **22.162** | 93 | true |
| VIEZZER | `viezzer` | 2 | 2 | 0 | 0 | true |
| VIVER | `viver` | 1 | 1 | 0 | 0 | true |

> Importar as 41 (e não só as 33) é deliberado: `deals.developer_id` é `on delete restrict` e a carga de
> negócios precisa achar **todas** as construtoras referenciadas. As 8 inativas custam 8 linhas inertes e somem
> dos seletores da UI.

> `LOTTICI` (7 negócios) e `LOTTICCI` (0, criada pelo `(App admin)`, cor `#FFFFFF`) são a mesma incorporadora
> grafada de dois jeitos — mas `norm2()` **não** as junta (`LOTTICI` ≠ `LOTTICCI`). Entram como duas linhas;
> a fusão é decisão de negócio (§9.D2).

---

### 4.2 `pipelines` → `developer_projects` (derivado)

**Não existe CSV de empreendimentos.** O catálogo é derivado por `distinct` sobre `pipelines`, que é o único
lugar do export onde empreendimento aparece.

Fonte: `export_All-pipelines-modified--_2026-09-08_19-43-56.csv`, 7.568 registros.

| Origem | Destino | Regra |
|---|---|---|
| `COALESCE(NULLIF(trim(CONSTRUTORA2),''), NULLIF(trim(construtora),''))` | `developer_projects.developer_id` | Resolver contra `developers` por `norm2` (§6.1). `CONSTRUTORA2` é a coluna canônica (7.546 preenchidos, **100% casam** com o catálogo); `construtora` cobre 5 linhas em que `CONSTRUTORA2` está vazia mas tem 6 linhas `MAISLAR` fora do catálogo, que o `norm2` resolve para `MAIS LAR`. Com o coalesce e o `norm2`: **0 órfãos** (medido) |
| `EMPREENDIMENTO` | `developer_projects.name` | Agrupar por `(developer, norm(EMPREENDIMENTO))`; **gravar como `name` a variante bruta mais frequente do grupo** (desempate: maior comprimento, depois ordem alfabética) |
| — | `city`, `state` | `NULL`. Não existem no legado. `state` é `char(2)` — se um dia for preenchido, `'RS'`, nunca `'Rio Grande do Sul'` |
| — | `active` | `true` (default) |
| — | `created_at`/`updated_at` | `now()` (default). O Bubble não tem data de criação de empreendimento |

**Números medidos:**

- pares `(construtora, norm(empreendimento))` distintos: **633**
- variantes brutas distintas de `EMPREENDIMENTO` (com construtora): **686** → a normalização funde **53**
- pares com mais de uma grafia: **90** (ex.: `GARDA` 170 / `Garda` 60 · `MORADA DO CAMPO` 142 / `Morada do Campo` 40 / `Morada do campo` 1 / `MORADA  DO CAMPO` 1 · `SOLAR DOS PASSAROS` 287 / `SOLAR DOS PÁSSAROS` 17 / `Solar dos Passaros` 35 / `SOLAR DOS PASSÁROS` 1)
- pares com nome-placeholder (só dígito/pontuação ou rótulo vazio): **8** → **descartar**
  `('TENDA','?')`, `('TENDA','0')`, `('TENDA','.')`, `('AVULSO','?')`, `('AVULSO','.')`, `('AVULSO','AVULSO')`, `('VASCO','AVULSO')`, `('CYRELA','AVULSO')`
- pares com uma única ocorrência: **330** · pares com ≥5 ocorrências: **158**
- linhas de `pipelines` sem construtora: **17** · sem empreendimento: **39** · com empreendimento e sem construtora: **2**
- empreendimentos cujo nome aparece sob **mais de uma** construtora: **54**
  (ex.: `SOLAR DOS PASSAROS` sob VASCO e LYX; `GARDA` sob TENDA e VASCO; `BLUE LAKE` sob LYX e TENDA)

> Os 54 nomes repetidos entre construtoras **não violam** `unique (developer_id, name)` — a chave é escopada.
> Provavelmente são erro de digitação da construtora no negócio, não dois empreendimentos homônimos. Deixar como
> está: corrigir exigiria julgamento caso a caso e o negócio pode reatribuir na tela.

> ⚠️ **A carga de `deals` precisa usar exatamente o mesmo agrupamento.** O agente de negócios deve resolver
> `project_id` pelo par `(developer_id, norm(EMPREENDIMENTO))` contra um mapa em memória construído aqui —
> **não** por `ilike` no nome bruto, que falharia nos 90 pares com grafia divergente. Entregue o mapa
> `{(developer_id, norm_name): project_id}` como saída desta etapa.

**Volume final: 625 linhas** (633 − 8 placeholders).

---

### 4.3 `leadfies.Fonte` → `lead_sources`

Fonte: `export_All-leadfies-modified--_2026-09-08_19-40-11.csv`, 102.799 registros, coluna `Fonte`
(100% preenchida menos 43 vazios; **14 valores distintos**).

O catálogo alvo **já tem 6 códigos** vindos de `supabase/seed.sql:120-128` (`meta_ads`, `whatsapp`, `organico`,
`indicacao`, `importacao`, `portal`). A carga **acrescenta 6** e reaproveita os existentes. De-para completo em
§5.2.

| Origem | Destino | Regra |
|---|---|---|
| `leadfies.Fonte` (valor) | `lead_sources.code` + `.label` + `.channel` | De-para fixo da §5.2. Insert com `on conflict (code) do nothing` |
| — | `lead_sources.form_id` | **`NULL` obrigatoriamente.** É unique parcial (`0003:201`) e é a ponte da roleta via `distribution_group_forms` (`0056:102-116`). Preencher com qualquer coisa desvia a distribuição |
| — | `lead_sources.sdr_agent_id` | **`NULL` obrigatoriamente.** Origem com agente de SDR **desvia da roleta**: o webhook inicia conversa em vez de chamar `assign_lead` (`supabase/functions/meta-ads-webhook/index.ts:307-313`) |
| — | `welcome_template_id` | `NULL` |
| — | `active` | `true` |
| — | `created_at`/`updated_at` | `now()` (default). O Bubble não tem entidade "fonte", só o rótulo no lead |

`Fonte` **não é uma tabela** no Bubble: é um texto por lead. Não há `unique id`, então não há linha em
`import_bubble_map`; a idempotência é o `code`.

---

### 4.4 `links` → `useful_links`

Arquivo: `export_All-links_2026-09-08_19-41-17.csv` — **3 registros, 6 colunas, SEM coluna `unique id`**
(é o único arquivo do grupo sem PK do Bubble).

| # | Origem | Destino | Regra | Risco |
|---|---|---|---|---|
| 0 | `link` | `useful_links.url` | `strip()`. Valida contra `useful_links_url_absolute` (`0063:93-97`): `^https?://[^[:space:]]+$`. As 3 já passam | baixo |
| 1 | `nome` | `useful_links.label` | `strip()`. (O front lê `label` e renomeia para `title` na memória — `Links.tsx:85`) | nenhum |
| 2 | `Creation Date` | `useful_links.created_at` **e** `sort_order` | `parse_dt()`; `sort_order` = posição cronológica 1,2,3 | nenhum |
| 3 | `Modified Date` | `useful_links.updated_at` | `parse_dt()`. Igual ao create nas 3 (nunca editados) | nenhum |
| 4 | `Slug` | **DESCARTAR** | 0 de 3 preenchidas | nenhum |
| 5 | `Creator` | **DESCARTAR** | `useful_links` não tem `created_by`. Valor `Douglas Gomes` nas 3 | nenhum |

Colunas do destino sem origem: `icon` (`NULL` ou nome de ícone lucide — o seed usa `'book-open'`, `'search'`,
`'home'`) e `category` (NOT NULL, default `'geral'`, que é exatamente o `SEM_CATEGORIA` do front, `Links.tsx:22`).

**As 3 linhas, prontas para inserir:**

| label | url | category | icon | sort_order | created_at |
|---|---|---|---|---:|---|
| Site Faceimob | `https://faceimob.com.br/` | `geral` | `globe` | 1 | 2025-07-25 10:34 −03 |
| Portfólio de Produtos | `https://drive.google.com/drive/folders/1P5Bb0FvjKICKogqrrNB62sw0o1ZtVkZ3?usp=drive_link` | `geral` | `folder` | 2 | 2025-07-25 12:07 −03 |
| Webmail Faceimob | `https://webmail.faceimob.com.br/` | `geral` | `mail` | 3 | 2025-07-25 12:08 −03 |

> Idempotência: `lower(url.rstrip('/'))`. É a mesma regra que o front usa para recusar link duplicado
> (`normalizeUrl`, `Links.tsx:41`) — usar outra faria a carga criar um duplicado que a tela depois acusa.

> O link do Drive tem `?usp=drive_link` (compartilhamento pessoal). Se a pasta não estiver aberta, o atalho
> quebra para quem não tem acesso. Validar antes de publicar (§9.D6).

---

### 4.5 `dicadeouros` → `gold_tips`

Arquivo: `export_All-dicadeouros-modified_2026-09-08_19-37-31.csv` — **10 registros** (28 linhas físicas: há
quebra de linha dentro de aspas), 6 colunas.

| # | Origem | Destino | Regra | Risco |
|---|---|---|---|---|
| 0 | `dica` | `gold_tips.title` **e** `gold_tips.body` | `body = limpa_bbcode(dica)`; `title` pela heurística abaixo. **Uma coluna vira duas** — não há título separado no legado | Médio: título sintético (§9.D5) |
| 1 | `Creation Date` | `gold_tips.created_at` **e** `sort_order` | `parse_dt()`; `sort_order` = rank cronológico 1..10. **`created_at` explícito é obrigatório**: `PipelineTopRanking.tsx:64` ordena por ele | Alto se esquecido |
| 2 | `Modified Date` | `gold_tips.updated_at` | `parse_dt()`. Idêntico ao create nas 10 (nunca editadas) | nenhum |
| 3 | `Slug` | **DESCARTAR** | 0 de 10 preenchidas | nenhum |
| 4 | `Creator` | `gold_tips.author_id` | Resolver `Douglas Gomes` contra `profiles.full_name` por `norm()`. **Cobertura 10/10** (§6.2) | baixo |
| 5 | `unique id` | `import_bubble_map.bubble_id` | idempotência | nenhum |

Colunas do destino sem origem: `active` — ver regra abaixo.

**Heurística do título** (`title` é NOT NULL e não existe no legado):

```python
MARCADORES = ("👉", "🎯", "📲", "📢", "💥")
def titulo(texto, maxlen=60):
    linha = limpa_bbcode(texto).split("\n")[0].strip()
    for mk in MARCADORES:                       # corta no marcador de "a dica em si"
        if mk in linha:
            linha = linha.split(mk)[0].strip()
    linha = linha.strip(" -–—:!?.")
    if len(linha) > maxlen:
        linha = linha[:maxlen].rsplit(" ", 1)[0] + "…"
    return linha or "Dica de ouro"
```

**Saída da heurística nas 10 — copiar verbatim** (ordem cronológica; `sort_order` = `#`):

| # | `created_at` | `unique id` | `title` gerado | `active` |
|---:|---|---|---|---|
| 1 | 2026-01-06 15:08 | `1767722934861x794510297930137600` | `💡 Dica de Ouro – Vendas MCMV` | false |
| 2 | 2026-01-15 12:55 | `1768492556846x122436471030546430` | `📞 DICA DE OURO – LIGAÇÃO DO CORRETOR (MCMV)` | false |
| 3 | 2026-01-23 11:23 | `1769178227964x467802563942285300` | `🥉 DICA DE OURO – FUNIL` | false |
| 4 | 2026-02-01 22:52 | `1769997141330x393272395172675600` | `🔥 HOJE É DIA DE DECISÃO 🔥` | false |
| 5 | 2026-02-04 15:49 | `1770230973776x891238313642164200` | `✅ Reunião Geral Janeiro ✅` | false |
| 6 | 2026-02-05 21:36 | `1770338168943x150981762154496000` | `⏰ Fevereiro é curto. Carnaval passa rápido. A venda não…` | false |
| 7 | 2026-03-10 15:23 | `1773167033655x936286802761744400` | `📌 Dica de Ouro de Março` | false |
| 8 | 2026-04-07 11:26 | `1775572010148x200185147179139070` | `😉💰🚀` | false |
| 9 | 2026-05-15 14:58 | `1778867884660x173873086179049470` | `🏆 Dica de ouro de Maio` | false |
| 10 | 2026-06-25 00:03 | `1782356586252x906525879730700300` | `🏡 Quem acompanha, vende` | **true** |

> **`active` = só a mais recente.** É a invariante do próprio app: `GamificationAdmin.tsx:39-40` desativa todas
> antes de inserir uma nova, e `PipelineTopRanking.tsx:64` lê `active=true … limit 1`. Importar as 10 ativas não
> quebra nada, mas deixa 9 linhas mentindo sobre o estado. Com esta regra, o banner do pipeline nasce mostrando
> a dica de 25/06/2026 — material de demo pronto.

> A #8 (`😉💰🚀`) é o único título ruim: o texto começa com um bloco só de emoji. As alternativas são
> `Proibido Resmungar!` (segunda linha) ou revisão humana. Como são 10 linhas, revisar à mão custa 10 minutos
> e resolve as 10 (§9.D5).

> As #4, #5 e #6 são **avisos datados** (reunião de 05/02, Carnaval), não dicas de venda reutilizáveis.
> Semanticamente pertencem a `important_notices`. Decisão do negócio (§9.D5); o default é mantê-las em
> `gold_tips` com `active=false`, o que não causa dano.

---

### 4.6 `mensagemdodias` → `important_notices`

Arquivo: `export_All-mensagemdodias-modified_2026-09-08_19-41-43.csv` — **18 registros** (170 linhas físicas),
6 colunas.

| # | Origem | Destino | Regra | Risco |
|---|---|---|---|---|
| 0 | `mensagem` | `important_notices.title` **e** `.body` | `body = limpa_bbcode(mensagem)`; `title` pela mesma heurística da §4.5 | Médio (§9.D5) |
| 1 | `Creation Date` | `important_notices.created_at` **e** `.starts_at` | `parse_dt()`. Os dois. `created_at` é o que ordena o banner; `starts_at` é o que a RLS filtra | Alto se esquecido |
| 2 | `Modified Date` | `important_notices.updated_at` | `parse_dt()`. Igual ao create nas 18 | nenhum |
| 3 | `Slug` | **DESCARTAR** | 0 de 18 preenchidas | nenhum |
| 4 | `Creator` | `important_notices.created_by` | `Douglas Gomes` → `profiles`. Cobertura 18/18 | baixo |
| 5 | `unique id` | `import_bubble_map.bubble_id` | idempotência | nenhum |

Colunas do destino sem origem:

| Coluna | Valor | Justificativa |
|---|---|---|
| `severity` | `'info'` nas 18 | NOT NULL, CHECK em `('info','warning','critical')`. O legado não tem campo de severidade. Nem os recados com `URGENTE 🚨` justificam `critical` retroativamente |
| `ends_at` | `starts_at` da mensagem **seguinte**; na última (25/06/2026 00:01), `starts_at + 30 dias` | Reproduz a semântica de mural do Bubble: o cartaz vale até ser substituído. Com isso as 18 ficam **fora da janela** hoje (09/09/2026) e nada aparece na tela — que é o estado correto: são campanhas de jan–jun/2026 encerradas |
| `active` | `false` nas 18 | Complementa o `ends_at`. A RLS (`0011:498-503`) já esconderia, mas `active=false` deixa explícito no admin que é histórico. Republicar é 1 clique |

**Consequência da regra de `ends_at`+`active`:** o banner de avisos do pipeline nasce **vazio**. Se o objetivo for
demo com o mural cheio, republique manualmente a #18 (§9.D3).

**Títulos gerados nas 18** (`created_at` em `America/Sao_Paulo`):

| # | `created_at` | `unique id` (prefixo) | `title` gerado |
|---:|---|---|---|
| 1 | 2026-01-06 14:38 | `1767721101806x694221…` | `Produtos Foco desta semana` |
| 2 | 2026-01-09 16:51 | `1767988295618x483072…` | `URGENTE 🚨 BATEU LEVOU R$ 500,00 REAIS POR VENDA LYX COM…` |
| 3 | 2026-01-23 14:56 | `1769191017033x212947…` | `⚠️ BATEU LEVOU ⚠️ SÓ VENDA TENDA R$ 200,00 CORRETOR R$…` |
| 4 | 2026-01-27 15:39 | `1769539186091x394586…` | `⚠️ BATEU LEVOU ⚠️ SÓ VENDA TENDA R$ 200,00 CORRETOR R$…` |
| 5 | 2026-02-01 11:07 | `1769954850043x566589…` | `⚠️ BATEU LEVOU ⚠️` |
| 6 | 2026-02-01 22:48 | `1769996922186x613663…` | `⚠️BATEU LEVOU TENDA ⚠️` |
| 7 | 2026-02-05 21:34 | `1770338052702x280632…` | `Fevereiro Começou` |
| 8 | 2026-02-13 13:19 | `1770999541037x844073…` | `Carnaval Começou` |
| 9 | 2026-02-19 14:21 | `1771521718002x266537…` | `Vamos fazer um Fevereiro Histórico` |
| 10 | 2026-03-10 15:20 | `1773166808474x365797…` | `🥳 BATEU LEVOU 🥳` |
| 11 | 2026-03-10 15:22 | `1773166964714x841883…` | `🥳 BATEU LEVOU 🥳` |
| 12 | 2026-04-07 11:28 | `1775572104720x969815…` | `Bateu Levou sendo apurados e pagos` |
| 13 | 2026-04-14 12:18 | `1776179917522x346140…` | `Meta não se bate por acaso` |
| 14 | 2026-04-14 12:24 | `1776180289790x887650…` | `Meta não se bate por acaso` |
| 15 | 2026-04-14 12:25 | `1776180350774x331217…` | `https://youtu.be/XEsKqh-2e3U` ⚠️ **candidata a descarte** |
| 16 | 2026-04-15 12:48 | `1776268109900x618412…` | `🥳 BATEU LEVOU 🥳` |
| 17 | 2026-05-15 14:56 | `1778867813543x983844…` | `🚀⚠️ VAMOS LÁ ⚠️🚀` |
| 18 | 2026-06-25 00:01 | `1782356515100x470227…` | `🚀 Recado Faceimob 🚀` |

> **A #15 é lixo:** 30 caracteres contendo só o embed `[youtube]XEsKqh-2e3U[/youtube]`, publicada **1 minuto**
> depois da #14 que já continha o mesmo vídeo. Acidente de edição. Recomendação: descartar (fica 17). Decisão
> em §9.D3.
> **#3⊂#4⊂#5≡#6**, **#10⊂#11** e **#13⊂#14** são reedições sucessivas do mesmo recado (o gestor recriava o
> registro em vez de editar). Texto exato distinto em 18/18, então dedupe por igualdade não pega nada — a
> sobreposição é semântica. Manter todas preserva o histórico; guardar só a última versão de cada recado deixa
> 14. Decisão do negócio.

---

### 4.7 `pipelines.OrigemLead` → `deals.lead_origin` (consumido pelo agente de negócios)

`deals.lead_origin` é `text` livre (`0006_deals.sql:48`), sem CHECK. Distribuição medida (7.568 negócios):

| Valor bruto (repr) | Registros | Destino |
|---|---:|---|
| *(vazio)* | 3.601 | `NULL` |
| `'Lead Próprio'` | 2.832 | `'Lead Próprio'` |
| `'Leadfy'` | 576 | `'Leadfy'` |
| `'Lead\xa0Indicação'` (**com NBSP**) | 359 | `'Indicação'` |
| `'Lead Loja'` | 166 | `'Lead Loja'` |
| `'Lead Feirão'` | 34 | `'Lead Feirão'` |

Regra: `v.replace('\xa0',' ').strip()`, depois o de-para da §5.3. **O NBSP é obrigatório tratar** — sem isso
`Lead Indicação` nunca casa com nada.

---

### 4.8 `leadfies.Imóvel` → `ad_campaigns` — **opcional, decisão D4**

`Imóvel` **não é imóvel: é o nome da campanha/anúncio** que gerou o lead. 335 valores distintos não vazios,
94.455 leads com valor, 8.344 sem.

O bloqueio: `ad_campaigns.external_id` é NOT NULL e **unique global** (`0067`), e o Bubble **não exporta id de
campanha da Meta em lugar nenhum** (`pipelines.Campanha`, `Canal`, `Criativo Meta`, `Formulário Meta` e `Fonte`
estão 100% vazias). Só existe o nome.

Se aprovado (§9.D4):

| Origem | Destino | Regra |
|---|---|---|
| `leadfies.Imóvel` (distinct) | `ad_campaigns.name` | valor bruto, `strip()` |
| idem | `ad_campaigns.external_id` | **sintético**: `'bubble:' + slugify(Imóvel)` — 335 valores distintos, sem colisão |
| idem | `ad_campaigns.developer_id` | resolução por nome dentro do texto (§6.3). **104 de 335 campanhas resolvem**, cobrindo **34.333 leads** |
| — | `platform` | `'meta'` (default) — 91,85% dos leads vêm de `Facebook Leads` |
| — | `status` | `NULL`. Se preencher, **tem que ser MAIÚSCULO** (`ad_campaigns_status_maiusculo`, `0084:41-43`) |
| — | `total_spend` | `0` (default). CHECK `>= 0` |
| — | `daily_budget`, `lifetime_budget`, `starts_on`, `ends_on`, `synced_at` | `NULL` |
| — | `lead_source_id` | id de `meta_ads` |

**Consequência de importar:** a tela `/marketing` passa a atribuir 34.333 leads a 18 construtoras
(`marketing_developer_summary` faz `left join ad_campaigns c on c.external_id = l.campaign_id`, `0063:213`) —
mas com `total_spend = 0` em todas, o CPL sai **zero** em toda a operação, o que é pior que "sem dado".
**Consequência de não importar:** os 102.799 leads caem no balde "Sem construtora" da tela de marketing, e
`leads.campaign_name` guarda o texto do `Imóvel` sozinho (o agente de leads deve fazer isso de qualquer jeito).

Recomendação: **não importar por default.** É catálogo fabricado para um módulo cujo número principal (verba)
não existe no legado. Se o negócio quiser a atribuição por construtora, aí sim — e nesse caso `leads.campaign_id`
tem que receber **o mesmo `'bubble:'+slug`**, senão o join não fecha.

---

## 5. De-para de valores

### 5.1 `Construtoras.CCA` → `developers.flow`

| Valor Bubble | Registros | `developer_flow` semântico | **O que gravar na carga** |
|---|---:|---|---|
| `CCA Faceimob` | 16 | `internal` | `internal` |
| `CCA Externo` | 22 | `external` | **`internal`** (ver abaixo) |
| *(vazio)* | 3 (RPM, SOLV, VIVER) | — | `internal` (default) |
| **desconhecido** | 0 | — | `internal` + linha no relatório de carga; **nunca abortar** por causa de flow |

**Por que as 22 externas entram como `internal`:** `developers_external_needs_email` exige `submission_email`
quando `flow='external'`. O e-mail **não existe em nenhuma coluna de nenhum CSV**. As três saídas:

| Opção | Consequência |
|---|---|
| **(A) tudo `internal`** ← recomendada | Nenhum e-mail falso no banco. Negócio novo dessas 22 vai para a esteira interna do CCA em vez de disparar `developer_submissions`. **Precisa de ação humana**: virar o switch + preencher e-mail em `/admin/construtoras` para as 22 antes do primeiro negócio novo. Histórico não sofre (negócio antigo já está decidido) |
| (B) `external` com e-mail placeholder | O fluxo fica correto de cara, **mas** `developer_submissions` é despachado por cron e a edge function **manda e-mail de verdade** — para um endereço inventado (bounce) ou, pior, para um endereço real errado. Risco de vazamento de documento de cliente |
| (C) `external` com e-mail de uma caixa interna controlada | Fluxo correto e sem vazamento, mas o documento para na caixa interna e alguém tem que reencaminhar à mão. Aceitável como ponte |

As 22 `CCA Externo`: ABACO, BALIZA, BELMAIS, BOLOGNESI, CELSUL, CONCORDIA, COUTO, DALLASANTA, ELIOWINTER,
Harmonia, LOTTICCI, LOTTICI, LYX, MAIS LAR, MGF, MNB, MRV, PARADIS, PAVEI, SALIS, SOUTH, VIEZZER.

### 5.2 `leadfies.Fonte` → `lead_sources` (código, rótulo, canal)

`channel` tem CHECK em `('meta','whatsapp','organic','indication','import','portal','other')` (`0003:192-193`).

| Valor Bubble | Leads | `code` | `label` | `channel` | Novo? |
|---|---:|---|---|---|---|
| `Facebook Leads` | 94.421 | `meta_ads` | Meta Ads | `meta` | existe (seed) |
| `Facebook` | 267 | `meta_ads` | — | — | reaproveita |
| `Facebot` | 68 | `meta_ads` | — | — | reaproveita |
| `Chatbot Leadfy` | 3.703 | `leadfy` | Leadfy (chatbot) | `other` | **novo** |
| `Integracao Leadfy` | 1 | `leadfy` | — | — | reaproveita |
| `WhatsApp` | 1.792 | `whatsapp` | WhatsApp | `whatsapp` | existe (seed) |
| `BotConversa` | 464 | `botconversa` | BotConversa | `whatsapp` | **novo** |
| `Importados da planilha` | 813 | `importacao` | Importação | `import` | existe (seed) |
| `TecImob 2` | 742 | `tecimob` | TecImob | `portal` | **novo** |
| `VivaReal` | 1 | `vivareal` | VivaReal | `portal` | **novo** |
| `Instagram` | 409 | `instagram` | Instagram | `meta` | **novo** |
| `Site Faceimob` | 22 | `organico` | Orgânico | `organic` | existe (seed) |
| `Indicação` | 2 | `indicacao` | Indicação | `indication` | existe (seed) |
| `Não definido` | 51 | `nao_informado` | Não informado | `other` | **novo** |
| *(vazio)* | 43 | `nao_informado` | — | — | reaproveita |
| **qualquer valor desconhecido** | — | `nao_informado` | — | — | **nunca abortar**; contar e listar no relatório de carga |

**Total: 6 códigos novos.** Cobertura: **100% dos 102.799 leads** têm um `source_id` resolvido.

> `Facebook`, `Facebot` e `Instagram` são resíduo de nomenclatura de 2024/2025. Fundir `Facebook`/`Facebot` em
> `meta_ads` perde só a distinção de nomenclatura antiga; `Instagram` ganha código próprio porque é uma
> superfície de anúncio que o negócio ainda diferencia. Consequência de fundir tudo em `meta_ads`: os 409 leads
> de Instagram viram indistinguíveis, e não há como reverter depois da carga sem reprocessar o CSV.

### 5.3 `pipelines.OrigemLead` → `deals.lead_origin`

O `<Select>` de origem no front oferece **5 opções fixas**: `["Lead Próprio", "Indicação", "Facebook", "Google", "Stand"]`
(`src/components/pipeline/DealForm.tsx:30`). O campo no banco é texto livre, sem CHECK.

| Valor Bubble (normalizado) | Registros | `deals.lead_origin` | Está na lista do front? |
|---|---:|---|---|
| `Lead Próprio` | 2.832 | `Lead Próprio` | **sim** |
| `Lead Indicação` (NBSP) | 359 | `Indicação` | **sim** |
| `Leadfy` | 576 | `Leadfy` | **não** |
| `Lead Loja` | 166 | `Lead Loja` | **não** |
| `Lead Feirão` | 34 | `Lead Feirão` | **não** |
| *(vazio)* | 3.601 | `NULL` | — (o form cai no primeiro item da lista ao editar) |
| **desconhecido** | 0 | gravar o texto bruto normalizado | — |

**Consequência de preservar o rótulo bruto** (recomendado): o histórico fica verdadeiro, mas ao abrir um desses
776 negócios para editar, o `<Select>` fica sem opção marcada até o corretor escolher uma — e se ele salvar, o
valor legado é substituído em silêncio.
**Alternativa:** colapsar `Leadfy`→`Facebook`, `Lead Loja`/`Lead Feirão`→`Stand`. O select funciona, mas 776
negócios passam a mentir sobre a origem.
**Pendência de front (fora deste escopo, 1 linha):** acrescentar `"Leadfy"`, `"Lead Loja"`, `"Lead Feirão"` ao
array `ORIGENS` em `DealForm.tsx:30` resolve os dois problemas de uma vez. É a saída certa.

### 5.4 De-paras que **não** pertencem a este domínio

Estão aqui só para o agente que escrever o código não procurar no lugar errado:

- **STATUS do Bubble → `pipeline_stages.code` + `deals.outcome`**: domínio de negócios
  (`docs/importacao/mapa/negocios.md` / `alvo/negocios_alvo.md`). `pipeline_stages` é catálogo, mas o de-para de
  21 valores de `statusNumero`/`STATUS2` só faz sentido junto com a carga de `deals`.
- **`Funcao` → `app_role`**: domínio de identidade (`alvo/identidade.md`). `user_roles` é N:N.
- **`leadfies.Status` → `lead_status` + `lead_funnel_stage`**: domínio de leads (`alvo/leads_alvo.md`).
  Lembrete crítico de lá: **status e funnel_stage sempre explícitos**, senão o default `'queued'` joga 102 mil
  leads na roleta e dispara WhatsApp de verdade.

---

## 6. Resolução de FK — os relacionamentos vêm como nome de exibição

Nenhum arquivo deste domínio traz FK como `unique id`. São três casamentos por nome, com algoritmos diferentes.

### 6.1 `pipelines.construtora` / `CONSTRUTORA2` → `developers.id`

```python
# 1) construir o índice a partir do PRÓPRIO catálogo importado (41 linhas)
idx = { norm2(nome): developer_id for nome, developer_id in developers_carregados }

# 2) resolver, com fallback entre as duas colunas
def resolve_developer(linha):
    for col in ("CONSTRUTORA2", "construtora"):      # ordem importa: CONSTRUTORA2 é a canônica
        v = (linha.get(col) or "").strip()
        if not v:
            continue
        d = idx.get(norm2(v))
        if d:
            return d
    return None                                       # → developer_id NULL + linha no relatório
```

Por que `norm2` (agressiva, sem espaço) e não `norm`:

- As **6 linhas** de `pipelines.construtora` com `MAISLAR` só casam com o catálogo `MAIS LAR` depois de remover
  o espaço. Com `norm` simples ficariam órfãs.
- **Verificado que é seguro**: `norm2` aplicada aos 41 nomes do catálogo produz **41 chaves distintas, zero
  colisão**. Não existe par no catálogo que a normalização agressiva funda por engano (`LOTTICI` e `LOTTICCI`
  continuam separados, que é o comportamento correto — a fusão é decisão de negócio, não de normalização).

**Cobertura medida:** com `COALESCE(CONSTRUTORA2, construtora)` + `norm2`, **7.551 de 7.568 negócios resolvem
(99,78%)**; os 17 restantes não têm construtora em nenhuma das duas colunas → `developer_id = NULL`.
**Órfãos: 0.**

- **Não encontrado:** gravar `developer_id = NULL` (a coluna é nullable) e registrar a linha. **Nunca criar
  construtora nova em tempo de carga** — `developers.name` é unique e um typo viraria catálogo permanente.
- **Ambíguo:** impossível por construção (índice de 41 chaves distintas). Se um dia acontecer, abortar a carga:
  escolher errado atribui negócio à construtora errada e `on delete restrict` torna a correção cara.

### 6.2 `Creator` → `profiles.id` (`gold_tips.author_id`, `important_notices.created_by`)

```python
alvo = norm(linha["Creator"])                          # 'DOUGLAS GOMES'
cands = [p for p in profiles if norm(p["full_name"]) == alvo]
author_id = cands[0]["id"] if len(cands) == 1 else None
```

- Valor em **100% das 28 linhas** de `dicadeouros`+`mensagemdodias`: `Douglas Gomes`.
- No CSV de Users (`export_All-Users-modified--_2026-09-08_19-44-45.csv`, 298 registros) há **exatamente 1**
  `Nome_completo` igual a `Douglas Gomes` (`Funcao = ADM`, e-mail `controle@faceimob.com.br`). **Sem ambiguidade.**
- **Cobertura: 28/28 (100%)** — desde que o agente de identidade já tenha criado esse `profile`. Se não tiver,
  as duas colunas são nullable: gravar `NULL` e registrar.
- Em `Construtoras` há 1 linha com `Creator = '(App admin)'` (a LOTTICCI). Não importa: `developers` não tem
  coluna de autor.
- **Regra geral para não-encontrado:** `NULL` + relatório. Nunca criar profile em tempo de carga de catálogo.

> ⚠️ Atenção ao contraste com o resto do export: `identidade.md` mediu que 10 dos 12 gerentes de equipe e 11 das
> 12 referências de diretor **não** casam por nome exato (`Archimedes Boff` × `Antonio Archimedes Boff`) e que há
> ambiguidade real (`Fabio Batista` com 2 candidatos). **Isso não afeta este domínio** — aqui o único nome a
> resolver é um, e ele casa exato. Não copie daqui um algoritmo de casamento de pessoas para o domínio de
> hierarquia; lá é preciso o desempate por prefixo/e-mail descrito em `identidade.md`.

### 6.3 `leadfies.Imóvel` → `developers.id` (só se `ad_campaigns` for importado)

Duas passadas, nesta ordem:

```python
def resolve_developer_por_campanha(v):
    # (1) SEGMENTO: o nome da campanha é "Construtora | Produto | ..." — casa um segmento inteiro
    for p in (x.strip() for x in v.split("|")):
        d = idx.get(norm2(p))
        if d:
            return d, "segmento"
    # (2) PALAVRA INTEIRA no texto todo, do nome mais longo para o mais curto
    nv = norm(v)
    for chave, dev_id in sorted(idx_por_nome.items(), key=lambda kv: -len(kv[0])):
        if len(chave) >= 3 and re.search(r"(?<![A-Z0-9])" + re.escape(chave) + r"(?![A-Z0-9])", nv):
            return dev_id, "palavra"
    return None, None
```

**Cobertura medida** (335 nomes distintos, 94.455 leads com `Imóvel` preenchido):

| Método | Campanhas | Leads |
|---|---:|---:|
| segmento (`Vasco \| Solar dos Passaros`) | 80 | — |
| palavra inteira (`Casas Vasco`, `FEIRÃO TENDA`) | 24 | — |
| **total resolvido** | **104 (31,0%)** | **34.333 (36,4%)** |
| sem construtora identificável | 231 | 60.122 |

18 construtoras alcançadas: VASCO 22.162 · MC3 3.826 · ABACO 2.594 · TENDA 2.059 · MNB 1.108 · MORANA 671 ·
LYX 506 · APICE 433 · SOUTH 428 · MRV 360 · CELSUL 125 · MGF 23 · COUTO 16 · Harmonia 13 · BELMONTE 4 · RNI 3 ·
LOTUS 1 · BALIZA 1.

> **A fronteira de palavra é obrigatória.** Sem ela (`norm2` concatenado, substring solta), `Viverdes Zona Sul`
> — que é outra empresa — casa com `VIVER` e leva 3 leads para a construtora errada. Medido: a versão sem
> fronteira atribui 34.336 leads a 19 construtoras; com fronteira, 34.333 a 18. A diferença é exatamente o
> falso positivo.
> Os 231 sem match são campanhas genéricas de topo de funil (`Porta de Entrada | Cidades` 13.634,
> `Programa MCMV` 8.722, `Feirão | Faceimob` 4.971) — não é falha do algoritmo, é ausência de construtora no
> nome. `developer_id = NULL` é a resposta certa.

---

## 7. Idempotência — a tabela `import_bubble_map`

Quatro das sete tabelas destino **não têm** onde guardar o `unique id` do Bubble. Sem isso, rodar a carga duas
vezes duplica 31 linhas (`gold_tips` 10 + `important_notices` 18 + `useful_links` 3) — `developers` e
`developer_projects` estão protegidas pelos seus uniques nativos.

DDL proposta (para o agente que escrever a migration; **não foi criada nesta fase**):

```sql
-- supabase/migrations/<ts>_00XX_import_bubble_map.sql
create table if not exists public.import_bubble_map (
  bubble_table text        not null,          -- 'Construtoras' | 'links' | 'dicadeouros' | 'mensagemdodias' | …
  bubble_id    text        not null,          -- 'unique id' do Bubble; para `links`, a URL normalizada
  target_table text        not null,          -- 'developers' | 'useful_links' | 'gold_tips' | …
  target_id    uuid        not null,
  imported_at  timestamptz not null default now(),
  notes        text,                          -- fuso assumido, versão do script, arquivo de origem
  primary key (bubble_table, bubble_id)
);
create index if not exists import_bubble_map_target_idx
  on public.import_bubble_map (target_table, target_id);

alter table public.import_bubble_map enable row level security;
create policy import_bubble_map_admin on public.import_bubble_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

- **`bubble_table` na PK** porque os `unique id` do Bubble são únicos por tabela, não globalmente.
- Só admin lê: a tabela expõe a topologia do sistema antigo, não é dado de operação.
- Fica em `public` (e não em `private`) porque uma tela de admin de importação vai querer lê-la; se isso nunca
  acontecer, `private` é mais apertado e igualmente fácil.

**Algoritmo de reimportação** (idêntico para as 4 tabelas com mapa):

```
para cada linha da origem:
    alvo = select target_id from import_bubble_map
           where bubble_table = :t and bubble_id = :uid
    se alvo existe:  UPDATE na tabela destino, id = alvo
    senão:           INSERT + INSERT no mapa
```

Para `developers` e `developer_projects` o mapa é redundante mas barato de manter — grave também, porque é o que
permite auditar "de onde veio esta construtora" seis meses depois. Para `lead_sources` não grave: a chave é o
`code` e o de-para é N:1 (três valores do Bubble caem em `meta_ads`).

**72 linhas de mapa** na primeira carga: 41 (`Construtoras`) + 10 (`dicadeouros`) + 18 (`mensagemdodias`) +
3 (`links`, com `bubble_id` = URL normalizada, já que o arquivo não tem `unique id`).

---

## 8. Lacunas

### 8.1 Dado da origem **sem destino** no schema novo

| # | Origem | Volume | Por que não tem destino | O que fazer |
|---|---|---:|---|---|
| L1 | `Construtoras.cor` | 41 valores | `developers` não tem coluna de cor; a tela `AdminDevelopers.tsx` não tem campo de cor | **Descartar.** Se o negócio quiser o chip colorido de volta, é coluna nova + campo na tela (feature, não migração) |
| L2 | `Construtoras.agil_qtd` / `vendas_qtd` / `vgv_qtd` | 41×3 | São agregados vivos; no alvo saem de `deals` | Descartar. Conferir depois da carga de negócios que os agregados batem |
| L3 | `Construtoras.meta` | 5 valores | A meta por construtora mora em `meta-constutoras` (402 linhas), domínio de metas — e **esse CSV também não tem tabela alvo** (ver `game_alvo.md` §T9) | Descartar aqui. A lacuna de `meta-constutoras` é do agente de metas |
| L4 | Regras de campanha "Bateu Levou" dentro do texto de `mensagemdodias` (R$ 200 corretor / R$ 50 gerente / R$ 50 diretor, metas por construtora) | 11 das 18 mensagens | Não existe como dado estruturado em **nenhum** CSV — é prosa | Fica como texto no `body`. Reproduzir "Bateu Levou" no FACEIMOB é **feature nova**, não migração |
| L5 | Embed de vídeo `[youtube]XEsKqh-2e3U[/youtube]` | 2 mensagens | `important_notices.body` é texto | `limpa_bbcode` converte para `https://youtu.be/XEsKqh-2e3U`. Perde o player, mantém o conteúdo |
| L6 | `EMPREENDIMENTO` — cidade e estado | 625 projetos | O legado não tem | `city`/`state` = `NULL` (são nullable) |
| L7 | Id de campanha da Meta | — | `pipelines.Campanha`, `Canal`, `Fonte`, `Criativo Meta`, `Formulário Meta` estão **100% vazias**; `leadfies` só tem o nome | Sem recuperação. §4.8 |
| L8 | `leadfies.Identificador` (slug de 6 chars, 95,5% preenchido) | 102.799 | É identificador **do lead**, não da fonte | Domínio de leads (`leads.external_id`) |
| L9 | `Slug` (nativo do Bubble) nos 4 arquivos | 0% preenchido em todos | Campo morto | Descartar |

### 8.2 Coluna **NOT NULL do destino sem origem**

| Tabela | Coluna | Default proposto | Justificativa |
|---|---|---|---|
| `developers` | `slug` | `slugify(name)` explícito | 41 slugs distintos verificados. O trigger `developers_ensure_slug` geraria o mesmo, mas mandar explícito deixa o insert idempotente por `slug` |
| `developers` | `flow` | `'internal'` | §5.1 — a constraint de e-mail não deixa alternativa segura |
| `developers` | `active` | `true` (33) / `false` (8) | tabela da §4.1 |
| `developer_projects` | `name` | variante bruta mais frequente do grupo normalizado | §4.2 |
| `developer_projects` | `active` | `true` | 625 projetos com uso comprovado em negócio |
| `lead_sources` | `label` | rótulo humano do de-para §5.2 | — |
| `lead_sources` | `channel` | do de-para §5.2 | CHECK de 7 valores |
| `useful_links` | `category` | `'geral'` | é o default da coluna **e** o `SEM_CATEGORIA` do front |
| `useful_links` | `sort_order` | 1, 2, 3 por ordem de criação | não existe no legado |
| `gold_tips` | `title` | heurística §4.5 (tabela pronta com os 10) | não existe no legado |
| `gold_tips` | `sort_order` | rank cronológico 1..10 | não existe no legado |
| `gold_tips` | `active` | só a mais recente `true` | invariante do app (`GamificationAdmin.tsx:39-40`) |
| `important_notices` | `title` | heurística §4.5 (tabela pronta com os 18) | não existe no legado |
| `important_notices` | `severity` | `'info'` | CHECK `('info','warning','critical')`; sem campo equivalente no legado |
| `important_notices` | `starts_at` | `Creation Date` | — |
| `important_notices` | `active` | `false` nas 18 | campanhas encerradas; §4.6 |
| `import_bubble_map` | todas | ver DDL §7 | — |

---

## 9. Decisões que só o dono do negócio pode tomar

| # | Decisão | Opções e consequências | Default se não houver resposta |
|---|---|---|---|
| **D1** | **As 22 construtoras `CCA Externo` entram com que fluxo?** | (A) `internal` nas 41 — nada quebra, mas alguém tem que preencher 22 e-mails na tela antes do primeiro negócio novo dessas construtoras, senão o documento vai para a esteira interna. (B) `external` com e-mail placeholder — o cron **manda e-mail de verdade** com anexo de cliente para endereço inventado. (C) `external` com caixa interna — correto, mas reencaminhamento manual | **(A)**, com a lista das 22 entregue ao negócio |
| **D2** | **`LOTTICI` e `LOTTICCI` são a mesma incorporadora?** (idem `MAIS LAR` × `MAISLAR`, `Harmonia` × `HARMONIA`) | Fundir: 40 construtoras, os 7 negócios de `LOTTICI` ficam juntos, e `developers.name` unique impede refazer depois sem `on delete restrict` atrapalhar. Não fundir: 41 linhas, uma delas inerte (`LOTTICCI` tem 0 uso e foi criada pelo `(App admin)`) | **Não fundir**; `LOTTICCI` entra `active=false` |
| **D3** | **Importar as 18 mensagens do mural ou só as recentes?** | 18 = histórico completo, mas 6 são reedições do mesmo recado (#3⊂#4⊂#5≡#6, #10⊂#11, #13⊂#14) e a #15 é lixo de 30 caracteres. 14 = só a versão final de cada recado. 3–5 = só o que tem valor operacional | **17** (as 18 menos a #15), todas `active=false` |
| **D4** | **Criar 335 `ad_campaigns` a partir do nome da campanha?** | Sim: 34.333 leads passam a ser atribuídos a 18 construtoras na tela `/marketing`, ao custo de `external_id` sintético (`bubble:<slug>`) e `total_spend = 0`, que zera o CPL de toda a operação. Não: os 102.799 leads caem em "Sem construtora" e o `Imóvel` fica só em `leads.campaign_name` | **Não criar.** Reversível: dá para criar depois, desde que `leads.campaign_id` receba o mesmo `bubble:<slug>` na carga de leads |
| **D5** | **Revisar à mão os 28 títulos de `gold_tips`/`important_notices`?** | A heurística gera títulos aceitáveis em 26 de 28; os ruins são a dica #8 (`😉💰🚀`) e o aviso #15 (uma URL). 28 linhas = ~15 min de revisão humana e o mural nasce apresentável para a demo | **Usar a heurística**; oferecer a planilha de 28 títulos para revisão |
| **D6** | **O link do Drive (`Portfólio de Produtos`) fica público?** | A URL tem `?usp=drive_link` (compartilhamento pessoal). Se a pasta não estiver aberta, o card quebra para quem não tem acesso — parece bug do sistema novo | Importar como está e validar o acesso antes de anunciar a tela |
| **D7** | **Recortar o histórico por data?** | Este domínio tem 41 construtoras de mai/2024 em diante e 28 peças de conteúdo de jan–jun/2026. **Não há o que recortar**: as construtoras são catálogo vivo e o conteúdo é de 2026. O recorte "só de 2024 em diante" pertence a leads (102.799, desde 2024) e negócios (7.568) | **Importar tudo** |
| **D8** | **Acrescentar `Leadfy`, `Lead Loja` e `Lead Feirão` ao `<Select>` de origem?** (`DealForm.tsx:30`, 1 linha) | Sim: 776 negócios abrem com a origem certa marcada. Não: o select abre vazio nesses 776 e, se o corretor salvar, sobrescreve a origem legada em silêncio | **Sim** — é 1 linha e evita perda de dado por uso normal |

---

## 10. Volume por tabela destino

| Tabela | Linhas | Como cheguei ao número |
|---|---:|---|
| `developers` | **41** | 41 registros no snapshot `19-37-19` (o `19-36-44` é o mesmo conjunto, 25 min mais velho) |
| `developer_projects` | **625** | 633 pares `(construtora, norm(EMPREENDIMENTO))` distintos em 7.568 negócios, menos 8 placeholders |
| `lead_sources` | **+6** | 14 valores de `Fonte` → 12 códigos, dos quais 6 já existem no seed |
| `useful_links` | **3** | 3 registros no CSV |
| `gold_tips` | **10** | 10 registros (28 linhas físicas — `wc -l` não vale) |
| `important_notices` | **18** (17 com D3) | 18 registros (170 linhas físicas) |
| `import_bubble_map` | **72** | 41 + 10 + 18 + 3 |
| **subtotal** | **775** | |
| `ad_campaigns` *(só com D4)* | 335 | 335 valores distintos de `Imóvel` em 102.799 leads |

Nenhuma das tabelas deste domínio está na publication `supabase_realtime` e nenhuma tem gatilho de notificação
ou de pontuação — a carga é silenciosa. As telas afetadas na primeira abertura: `/admin/construtoras` (41 linhas),
`/links` (3 cards), banner de dica/aviso do pipeline (1 dica ativa, 0 avisos ativos).

---

## 11. Verificações pós-carga

```sql
-- 1. as 41 construtoras entraram e nenhuma perdeu o slug
select count(*) as total,
       count(*) filter (where active) as ativas,
       count(*) filter (where slug is null or slug = '') as sem_slug
  from public.developers;                       -- esperado: 41 | 33 | 0

-- 2. nenhuma construtora externa sem e-mail (a constraint garante; serve de tripwire para D1)
select count(*) from public.developers
 where flow = 'external' and submission_email is null;          -- esperado: 0

-- 3. empreendimentos sem construtora órfã, e nenhum nome duplicado dentro da mesma construtora
select count(*) from public.developer_projects;                 -- esperado: 625
select developer_id, name, count(*) from public.developer_projects
 group by 1,2 having count(*) > 1;                              -- esperado: 0 linhas

-- 4. as 12 origens de lead, com canal válido
select code, label, channel, form_id, sdr_agent_id from public.lead_sources order by code;
--   esperado: 12 linhas; form_id e sdr_agent_id NULOS em todas as 6 novas

-- 5. conteúdo: created_at veio do legado, não do now() da carga
select 'gold_tips' t, min(created_at), max(created_at), count(*) from public.gold_tips
union all
select 'important_notices', min(created_at), max(created_at), count(*) from public.important_notices;
--   esperado: gold_tips 2026-01-06..2026-06-25 (10) | notices 2026-01-06..2026-06-25 (18 ou 17)

-- 6. exatamente uma dica ativa, nenhum aviso na janela
select count(*) from public.gold_tips where active;                                  -- esperado: 1
select count(*) from public.important_notices
 where active and starts_at <= now() and (ends_at is null or ends_at > now());        -- esperado: 0

-- 7. links absolutos (o CHECK garante; confirma que os 3 entraram)
select count(*) from public.useful_links where url ~* '^https?://';                   -- esperado: 3

-- 8. o mapa de idempotência cobre tudo que precisa
select bubble_table, count(*) from public.import_bubble_map group by 1 order by 1;
--   esperado: Construtoras 41 | dicadeouros 10 | links 3 | mensagemdodias 18
```

**Verificação cruzada antes da carga de negócios** (roda no CSV, não no banco): todo valor distinto de
`COALESCE(CONSTRUTORA2, construtora)` em `pipelines` tem que achar linha em `developers` por `norm2`.
Medido agora: **32 valores distintos, 32 casam, 0 órfãos**. Se depois da carga esse número não for 0, alguém
renomeou uma construtora entre a carga do catálogo e a dos negócios.

---

## 12. Comandos executados (rastreabilidade)

Todo número deste documento sai de um destes. Scripts em
`<scratchpad>/cat1.py` … `cat10.py` (temporários, fora do repo). Nenhum comando tocou o banco; nenhum arquivo do
repositório foi alterado além deste relatório.

```
ls -la DOCUMENTOS/DADOS_BUBBLE/
cat  docs/importacao/SCHEMA_ALVO.md
cat  docs/importacao/perfil/catalogo.md
grep -n construtora|EMPREENDIMENTO|OrigemLead  docs/importacao/perfil/pipelines.md
grep -n lead_source|Fonte|Imóvel               docs/importacao/perfil/leads.md
sed -n  docs/importacao/alvo/{leads_alvo,negocios_alvo,game_alvo}.md
sed -n  supabase/migrations/20260725120200_0003_catalog.sql            # developers, developer_projects, lead_sources
sed -n  supabase/migrations/20260725121000_0011_marketing_workspace.sql# useful_links, important_notices, gold_tips, ad_campaigns, RLS
sed -n  supabase/migrations/20260908890000_0089_ad_campaigns_gestao.sql
sed -n  supabase/migrations/20260904631500_0067_ad_campaigns_external_id_unico.sql
grep -n slugify supabase/migrations/20260725120000_0001_foundation.sql
grep -rn gold_tips|important_notices|useful_links src/                 # PipelineTopRanking, GamificationAdmin, Links
grep -n  ORIGENS src/components/pipeline/DealForm.tsx
sed -n   src/pages/AdminDevelopers.tsx  src/pages/Links.tsx
sed -n   supabase/seeds/020_catalog_distribution_sdr.sql  supabase/seeds/040_reports_game_workspace.sql

python cat1.py    # perfil coluna a coluna de Construtoras; CCA; cor; colisões de norm/norm2
python cat2.py    # pares construtora×empreendimento em pipelines; órfãos; OrigemLead
python cat3.py    # streaming de leadfies (102.799): header, Fonte, Imóvel
python cat4.py    # Imóvel → developers, versão substring (34.336 leads / 19 construtoras)
python cat5.py    # auditoria de falso positivo; perfil de links/dicas/mensagens; NBSP em OrigemLead
python cat6.py    # Imóvel → developers com fronteira de palavra (34.333 / 18); dimensionamento de projetos
python cat7.py    # 'Douglas Gomes' em Users; colisão de slugs das 41 construtoras
python cat8.py    # validação do parser de data nos 4 arquivos (144 datas, 0 falhas)
python cat9.py    # geração dos 28 títulos (gold_tips + important_notices)
python cat10.py   # uso por construtora (pipes / projetos / leads / metas) → flag active
```
