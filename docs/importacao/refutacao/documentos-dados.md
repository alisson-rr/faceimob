# Refutação por dados — mapa "Documentos, CCA e Storage"

Alvo: `docs/importacao/mapa/documentos.md`. Lente: **dados** (os CSVs reais, não o schema).
Data: 09/09/2026. Somente leitura: nenhum comando contra banco, nenhum arquivo de código tocado.

Método: scripts Python 3.12 em streaming (`csv.DictReader`, `field_size_limit = 50 MB`) no scratchpad
(`chk1.py` … `chk12.py`), usando **as funções de transformação do próprio mapa** (`norm`, `url_norm`,
`split_lista`, `dt`, `sanitize`, regexes da §3.2). Dado pessoal mascarado; nenhuma senha lida.

**Veredito: REFUTADO — gravidade média.** O mapa é majoritariamente reprodutível: 35 afirmações
factuais bateram **na casa da unidade**. Mas a §4.1 ("a resolução crítica") tem números de homonímia
que não fecham em nenhuma leitura, e o número-manchete de volume (30.279 objetos) não é reprodutível
a partir da regra que o próprio mapa declara.

---

## 1. O que foi refutado

### R1 (mais grave) — §4.1: a homonímia está subdimensionada em ~16%

Mapa: *"123 nomes de `CLIENTE` pertencem a 2 ou 3 negócios (249 linhas de `pipelines`); 171 negócios com arquivo caem nesse grupo"*.

Medido em `export_All-pipelines-modified--_2026-09-08_19-43-56.csv` com o `norm()` da §2.1 (`chk4.py`, `chk11b.py`):

| Métrica | Mapa | Medido |
|---|---:|---:|
| nomes `CLIENTE` com 2+ negócios | 123 | **143** (140 com 2 · 3 com 3 · nenhum com 4+) |
| linhas de `pipelines` envolvidas | 249 | **289** |
| negócios com arquivo no grupo ambíguo | 171 | **182** (90 nomes) |
| linhas duplicadas em `deal_documents` | 636 | **766** contando por nome / **623** na reconstrução completa (R2) |

Leituras alternativas testadas e descartadas: restringir aos nomes que aparecem em `doc-clientes` dá
**110 nomes / 222 linhas**; incluir `historicoPipes` não muda (110/222). Nenhuma chega a 123/249.

Por que importa: é exatamente esse grupo que aciona a regra 3c ("anexar o pacote aos dois negócios").
O mapa também mediu que os nomes de arquivo carregam CPF (§2.6 diz 1.127 formatados; medi **1.113** no
meu conjunto, mais 576 com 11 dígitos isolados) — ou seja, o passo que anexa documento ao homônimo é o
passo que espalha CPF para o negócio errado. Subdimensionar em 16% quem cai nesse caminho subdimensiona
o risco que D8 pede para o dono decidir.

### R2 — §0/§8: o volume-manchete não sai da regra declarada

Mapa: **30.279** objetos distintos, **30.915** linhas de `deal_documents`, **4.520** negócios com
arquivo (59,7%), **636** linhas duplicadas. Definição declarada: *"união (snapshot corrente de
`doc-clientes` por negócio) ∪ (`pipelines.documentos`), URLs normalizadas"*.

Implementei três leituras de "snapshot corrente" (`chk5.py`, `chk10.py`) e **as três convergem no mesmo conjunto**:

| Variante de "snapshot corrente" | URLs | ∪ `documentos` |
|---|---:|---:|
| A — último registro por nome (por `Creation Date`) | 29.251 | **29.721** |
| B — registro apontado por `pipelines.doc`, senão o último por nome | 29.251 | **29.721** |
| C — união de A com todos os registros apontados por `doc` | 29.329 | **29.721** |
| (teto absoluto) todas as URLs de `doc-clientes` ∪ `documentos` | 32.587 | 32.850 |

Reconstrução completa por negócio (`chk10.py`): **4.439** negócios com ao menos 1 arquivo (58,7%),
**30.344** pares `(negócio, arquivo)`, **29.721** objetos, **623** de duplicação.

O mapa está ~1,9% acima em todos os eixos, de forma sistemática. Não é erro grosseiro, mas significa
que **o número que responde "quantos arquivos subir" não é reprodutível pela regra escrita** — e o mapa
se declara "especificação de implementação, sem reabrir CSV". Quem implementar vai obter 29.721 e não
terá como saber qual dos dois é o certo.

Sinal de que a metodologia do mapa é real e a divergência é só de recorte: rodando as regexes da §3.2
sobre os meus 29.721 arquivos, os percentuais batem com os do mapa dentro de 0,2 pp
(`ctps` 9,17% vs 9,16% · `rg_cpf` 14,28% vs 14,24% · `outros` 29,55% vs 29,32%) e a distribuição de
extensões tem a mesma forma (pdf 24.258 de 29.721 = 81,6% vs 81,9%).

### R3 — §4.2: aritmética interna não fecha

Mapa: *"25.153 de 29.871 arquivos (84,2%) ganham `uploaded_by`; 4.613 ficam com `NULL`"*.
29.871 − 25.153 = **4.718**, não 4.613. Além disso 29.871 é um **quarto total** de arquivos, ao lado de
30.279 (objetos), 30.915 (linhas) e 29.721 (medido aqui). Pelo menos um desses números está errado.

### R4 — §2.2: "707 linhas têm exatamente 16 arquivos"

Medido (`chk9.py`): **763** linhas com os 16 slots `url_N` preenchidos — e **763** também contando URLs
distintas por linha (as duas leituras coincidem). No recorte corrente por nome são **86**. Nenhuma
leitura dá 707. O ponto qualitativo (o teto de 16 trunca em silêncio) continua de pé.

### R5 — §2.5: "`dataInicioAtividade ` — texto, não data — 0/306 parseiam"

Medido (`chk7.py`): das 306 preenchidas, **9 parseiam como data real** (ex.: `01/02/2025`); as demais são
texto (`21 ANOS`, `INTEGRAL`, `1 ano`). A recomendação (gravar cru) sobrevive; o "0/306" não.

### R6 — §2.4: "`nomesArquivos` bate em 65.294/65.323 pares (99,96%)"

Medido (`chk9.py`, `chk10.py`): o denominador **65.323 reproduz exatamente** (pares das linhas em que o
`split(" , ")` tem o mesmo tamanho dos dois lados) — mas nessas linhas o nome bate em **65.323/65.323
(100,00%)**. Considerando todos os 72.227 pares posicionais, batem 70.568 (97,70%). Os 29 desencontros
alegados não reproduzem em nenhum dos dois recortes.

### R7 — §10.1: "todo o intervalo do export (ago/2023 a set/2026)"

Medido (`chk2.py`, `chk3.py`, `chk11b.py`): a data mais antiga nos três arquivos deste domínio é
**13/05/2024** (`pipelines`), **18/09/2024** (`doc-clientes`) e **29/04/2025** (`historicoPipes`).
Não existe registro de 2023 aqui. Cosmético: o argumento do offset fixo `-03:00` continua válido
(tudo é pós-2019), mas a premissa declarada não corresponde ao dado.

### R8 — divergências menores

- §4.1 "todos os 4.425 nomes de pipeline vindos das duas tabelas": são **5.633** nomes distintos
  (`doc-clientes` sozinha já tem 5.633; `historicoPipes` tem 2.386, contida na primeira). O "zero
  órfãos" está certo — a contagem, não.
- §2.5 `formaAtuacao` "169 variantes": 169 é a contagem **crua**; com o `upper(trim())` que o próprio
  mapa manda aplicar são **151**. Idem `segmentoAtividade`: 242 cru, **215** normalizado.
- §4.1 "36 vieram apenas da coluna `pipelines.documentos`": só **3** negócios têm `documentos` e nenhum
  registro de `doc-clientes` pelo nome (`chk12.py`).

---

## 2. O que foi confirmado (não mexer)

Rodado e batendo **exatamente**:

- **Estrutura:** `doc-clientes-modified` 25.890×23 · `historicoPipes-modified` 10.343×9 ·
  `pipelines-modified` 7.568×110 (`chk1.py`).
- **§3.1 inteira:** 30 valores distintos de `STATUS2`, **cada contagem da tabela bate na unidade**
  (1.172 / 718 / 699 / 668 / 663 / 590 / 551 / 465 / 423 / 361 / 201 / 186 / 170 / 120 / 96 / 86 / 81 /
  69 / 68 / 44 / 36 / 36 / 20 / 19 vazios / 13 / 8 / 2 / 1 / 1 / 1). Nenhum rótulo fora do de-para.
  Os 3 rótulos com NBSP existem e somam **262 linhas** — o aviso de normalizar `\xa0` é real.
  Totais por destino conferem: approved 3.979 · pending 1.454 · rejected 1.256 · under_review 476 ·
  cancelled 290 · sent_to_agency 94 · 19 sem caso = 7.568 (`chk1.py`).
- **§2.7 / constraint de decisão:** 5.235 casos decididos; **1.450 (27,7%) com o carimbo `Sep 18, 2024`**;
  `ENVIO` preenchida em 7.567/7.568; e **zero** decididos sem `mudou_status` **e** sem `ENVIO` — o
  fallback proposto nunca cai em `NULL` e `cca_cases_decision_consistency` não derruba a carga (`chk2.py`).
- **Formato de data:** `strptime(v, "%b %d, %Y %I:%M %p")` parseia **100%** das 4 colunas de data de
  `pipelines` (0 falhas em ~30 mil valores) e 100% dos `Creation Date` de `doc-clientes` e
  `historicoPipes` (`chk2.py`, `chk3.py`, `chk10.py`).
- **§2.2:** `Slug` 0/25.890 preenchida · `pipeline` vazio em 12 · `Creator` vazio em 120 · `arquivos`
  preenchida em 2.240 (**8,65%**) · **56** linhas em que `arquivos` traz URL fora dos 16 slots
  (⇒ os 2.184 idênticos) · sentinela `https:` em **261.023** ocorrências · **19.527** linhas com `url_N`
  e `arquivos` vazio (`chk3.py`).
- **Chave de storage:** as 29.721 URLs normalizadas têm todas 5 segmentos, **todos** os `bubble_file_id`
  casam `f<epoch>x<rand>`, **0 colisões** de `(fid, nome saneado)` e 0 fid repetido — a idempotência por
  `storage_path` da §5.1 se sustenta (`chk6.py`). O `split_lista(" , ")` também se sustenta: se ele
  quebrasse uma URL no meio, o fid deixaria de casar o padrão — 0/29.721 falharam.
- **FK por id:** `pipelines.doc` → `doc-clientes.unique id` = **2.857/2.857**, zero órfão; cobre
  2.857/7.568 = 37,7% dos negócios (`chk4.py`).
- **FK por nome:** **zero órfãos** — todos os nomes de `pipeline` de `doc-clientes` e `historicoPipes`
  existem em `pipelines.CLIENTE` (0 de 5.633) (`chk4.py`).
- **§2.5 preenchimento:** `cca_externo1` 646 · `cca_externo2` 296 · `cca_externo3` 8 · `cca_externo4` 8 e
  **idênticos nos 8** · `RefCCHcca` 249 · `financeiro` 7 · `ObsRenda` 162 · `rendaInformal` sim 340/não 143 ·
  `declaraImpostoRenda` 4.174 `não` × **1** `sim` · `emiteNota` 4.175 todos `não` · `cotista`×`cotistaCCA`
  concordam em **386/443** · `documentos` em 4.330 negócios, **2.167** deles sem ponteiro `doc`
  (`chk7.py`, `chk12.py`).
- **§4.3:** `cca_externo1` casa em `Users.email` em **376/646** — número idêntico ao do mapa. Domínios:
  390 `faceimob.com.br`, 104 `gmail.com`, **78 `a.com`** (o lixo que o mapa cita) (`chk8.py`).
- **§4.2:** casamento exato de `Creator` reproduz na unidade — 11.273 (`doc-clientes`) e 3.768
  (`historicoPipes`); ambíguos 63/58; vazios 120/0. A fatia exato+parcial varia com o detalhe da regra
  parcial (medi 84,9% e 87,9%), mas o total das faixas fecha 25.890 e 10.343 (`chk8.py`).
- **§2.4 / §6:** `ativo` = `não` em **10.343/10.343** · **233** linhas sem arquivo · **1.870** URLs que
  não existem em `doc-clientes` · **653** linhas em que o `split` diverge · trilha começa em
  **29/04/2025** (`chk9.py`, `chk11b.py`).
- **§3.3:** **3** executáveis em todo o universo e **0** no conjunto de upload — confirma que o filtro
  `\.(exe|bat|cmd|scr|js)$` só é necessário se D5 trouxer o histórico (`chk9.py`).
- **Lado do schema** (grep em `supabase/`): `document_types` tem exatamente os 9 `code` usados pela §3.2
  e `allows_multiple = false` exatamente nos 6 tipos que o mapa diz que versionam
  (`supabase/seed.sql:67-75`); `cca_stages` tem 6 estágios e **nenhum** com `status = 'cancelled'`
  (`supabase/seed.sql:81-94`) — o buraco de D4 é real; `cca_cases.deal_id` é `unique` e
  `cca_cases_decision_consistency` existe (`supabase/migrations/20260725120600_0007_cca.sql:16-33`);
  `analysis jsonb not null default '{}'` existe (`...0020_core_fixes.sql:147`); `stage_id` existe
  (`...0012_crud_fixes.sql:285`); `deal_documents.storage_path text not null unique`
  (`...0006_deals.sql:260`).

---

## 3. Correção mínima sugerida

1. **§4.1:** trocar "123 nomes / 249 linhas / 171 negócios / 636 linhas duplicadas" por
   **143 nomes (140×2 + 3×3) / 289 linhas / 182 negócios / ~623–766 linhas duplicadas** (a faixa depende
   do recorte de R2), e trocar "4.425 nomes" por **5.633**.
2. **§0/§8/§4.1:** publicar o script que produziu 30.279/30.915/4.520 ou substituir pelos números
   reproduzíveis (**29.721 objetos · 30.344 linhas · 4.439 negócios · 623 duplicadas**). Enquanto os dois
   conjuntos existirem, o passo 6 da §1 (upload) não tem alvo verificável.
3. **§4.2:** refazer a conta de `uploaded_by` sobre o total escolhido em (2) — hoje 25.153 + 4.613 ≠ 29.871.
4. **§2.2 / §2.4 / §2.5 / §10.1:** 707 → **763**; "0/306 parseiam" → **9/306**; "99,96%" → **100% nos
   65.323 pares comparáveis (97,70% sobre os 72.227 pares posicionais)**; "ago/2023" → **mai/2024**.
5. Manter tudo o que está na seção 2 — inclusive as travas da §9, a chave de `storage_path` e o de-para
   da §3.1, que passaram no teste sem ressalva.
