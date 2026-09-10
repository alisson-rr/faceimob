# Perfil do export Bubble — grupo "Catálogo": Construtoras + links + dicadeouros + mensagemdodias

Data do perfil: 09/09/2026 · Fase somente leitura (nenhum comando rodou contra banco).
Origem: `DOCUMENTOS/DADOS_BUBBLE/` · Parser: módulo `csv` do Python 3.12, `csv.field_size_limit(1e9)`, encoding `utf-8-sig`.
Script usado: `<scratchpad>/perfil_catalogo.py` e `<scratchpad>/refs.py` (temporários, fora do repo).

## 0. Resumo executivo

Cinco arquivos, quatro entidades, **72 registros no total**. É o catálogo estático do sistema legado: quem são as
construtoras/incorporadoras com que a Faceimob trabalha, três atalhos de menu, dez "dicas de ouro" e dezoito
"mensagens do dia" (murais internos). Não há dado pessoal, nem CPF, nem telefone, nem e-mail em nenhum dos cinco
arquivos — a única coluna com nome de pessoa é `Creator` (autor do registro no Bubble: `Douglas Gomes` em 71 de 72
registros, `(App admin)` em 1).

| Entidade | Arquivo | Registros reais | Linhas físicas | Tabela alvo provável |
|---|---|---:|---:|---|
| Construtoras (snapshot A) | `export_All-Construtoras-modified_2026-09-08_19-36-44.csv` | 41 | 42 | `developers` |
| Construtoras (snapshot B) | `export_All-Construtoras-modified_2026-09-08_19-37-19.csv` | 41 | 42 | `developers` |
| links | `export_All-links_2026-09-08_19-41-17.csv` | 3 | 4 | `useful_links` |
| dicadeouros | `export_All-dicadeouros-modified_2026-09-08_19-37-31.csv` | **10** | 28 | `gold_tips` |
| mensagemdodias | `export_All-mensagemdodias-modified_2026-09-08_19-41-43.csv` | **18** | 170 | `important_notices` |

> **Correção de contagem.** O briefing falava em "~27 dicas" e "~169 mensagens": esses são números de **linha física**
> (`wc -l`), não de registro. Os campos de texto contêm quebras de linha dentro de aspas. A contagem real, via parser
> CSV, é **10 dicas** e **18 mensagens**. Nenhuma linha tem número de colunas divergente do header (`ragged = 0` nos
> cinco arquivos), então o parse é confiável.

**Suposição de fuso horário** (vale para os cinco arquivos): as datas vêm em formato en-US sem fuso declarado
(`May 11, 2024 6:30 pm`). Trato como `America/Sao_Paulo` e recomendo importar como `timestamptz` já convertido para
UTC com esse offset. Se o Bubble exportou em UTC, todos os horários ficam 3h adiantados — o impacto é cosmético aqui
(catálogo), mas o mesmo pressuposto vai valer para leads/pipelines, onde importa.

---

## 1. Construtoras — os dois arquivos são duplicata exata?

**Não são.** Mesmo tamanho (6.294 bytes) e mesmo header, mas conteúdo diferente.

```
md5 19-36-44 = d0e81fe246ddb9039fa45d815a18cf3a
md5 19-37-19 = 4c3b67a7a9922034c1d226071ccf0f10
cmp          → differ: char 132, line 2
```

Comparação linha a linha, com `unique id` como chave: 41 uids em cada arquivo, **0 exclusivos de um lado ou do
outro**, e **18 das 41 linhas com alguma diferença**. As diferenças reais são só três células:

| Construtora | Coluna | 19-36-44 (A) | 19-37-19 (B) |
|---|---|---|---|
| TENDA | `agil_qtd` | `38` | `36` |
| VASCO | `agil_qtd` | `30` | `27` |
| 18 linhas | `Modified Date` | `Sep 8, 2026 4:12 pm` | `Sep 8, 2026 4:37 pm` |

Ou seja: **são dois snapshots da mesma tabela, tirados com 25 minutos de diferença** no mesmo dia do export. Entre
um e outro, um workflow do Bubble recalculou `agil_qtd` (contador vivo, decrescente aqui) e carimbou `Modified Date`
em 18 registros. O tamanho idêntico em bytes é coincidência: `38`→`36` e `30`→`27` não mudam o comprimento, e
`4:12 pm`→`4:37 pm` também não.

**Decisão de importação:** importar **apenas `export_All-Construtoras-modified_2026-09-08_19-37-19.csv`** (o mais
recente). O arquivo A não traz nenhum registro que B não tenha. E as duas colunas que divergem (`agil_qtd`) são
contadores derivados que **não devem ser importados** de qualquer forma (ver §1.3).

### 1.1. Perfil coluna a coluna (arquivo B, 41 registros)

Header: `agil_qtd, CCA, cor, meta, metas, nome, vendas_qtd, vgv_qtd, Creation Date, Modified Date, Slug, Creator, unique id`

| # | Coluna | Tipo observado | Preench. | Distintos | Exemplos | Significado no negócio | Referência? |
|---|---|---|---:|---:|---|---|---|
| 0 | `agil_qtd` | inteiro | 100% | 7 | `36`, `27`, `0` | Contador de negócios na "esteira ágil" da construtora. Volátil (mudou em 25 min). | não |
| 1 | `CCA` | texto | **92,7%** (38/41) | **2** | `CCA Externo`, `CCA Faceimob` | **Não é booleano nem nome de agência.** É o roteamento da esteira de crédito: quem faz a análise (CCA = Central de Crédito e Aprovação). | não — é enum de 2 valores |
| 2 | `cor` | cor_hex + texto | 100% | 38 | `#fb0205`, `#f07777`, `rgba(114,28,29,1)` | Cor do chip/etiqueta da construtora na UI. | não |
| 3 | `meta` | inteiro | **12,2%** (5/41) | 4 | `40`, `25`, `10` | Meta de vendas do produto (unidades). Só 5 construtoras têm. | não |
| 4 | `metas` | vazio | **0%** | 0 | — | Campo morto (lista que nunca foi usada). **Descartar.** | não |
| 5 | `nome` | texto | 100% | **41** | `TENDA`, `VASCO`, `ABACO` | Nome comercial da construtora/incorporadora. **É a chave natural.** | é o alvo de referências vindas de outros CSVs |
| 6 | `vendas_qtd` | inteiro | 100% | 2 | `0` (39×), `1` (2×) | Contador de vendas do período corrente. Derivado. | não |
| 7 | `vgv_qtd` | inteiro | 61,0% (25/41) | 3 | `0` (23×), `189000`, `226500` | VGV acumulado do período corrente (R$). Derivado. | não |
| 8 | `Creation Date` | data_en_us | 100% | 24 | `May 11, 2024 6:30 pm` | Data de cadastro no Bubble. | não |
| 9 | `Modified Date` | data_en_us | 100% | 9 | `Sep 8, 2026 4:37 pm` | Última alteração. Poluída por workflows de contador. | não |
| 10 | `Slug` | vazio | **0%** | 0 | — | Campo nativo do Bubble, nunca preenchido. **Descartar.** | não |
| 11 | `Creator` | texto | 100% | 2 | `Douglas Gomes` (40), `(App admin)` (1) | Autor do registro. Vem como **nome de exibição**, não uid. | `nome_exibicao->Users` |
| 12 | `unique id` | bubble_uid | 100% | 41 | `1715463014195x324571545029050400` | PK do Bubble. | PK |

### 1.2. O que é o campo `CCA` (resposta direta)

`CCA` **não é booleano** e **não é nome de agência**. É um seletor de duas opções que define **por onde a análise de
crédito daquela construtora tramita**:

- `CCA Faceimob` (16 construtoras) — a análise é feita pela central de crédito interna da Faceimob.
- `CCA Externo` (22 construtoras) — a análise é feita pela agência/correspondente da própria construtora.
- vazio (3 construtoras: **RPM, SOLV, VIVER**) — as mesmas três que estão inativas (cor `#ffffff`, `Modified Date`
  parado em `Sep 20, 2024`, zero uso em pipelines). Tratar como registro abandonado.

Isso mapeia 1:1 no enum `developer_flow` do schema alvo (`internal | external`): `CCA Faceimob → internal`,
`CCA Externo → external`. E é coerente com a existência das colunas `cca_externo1..4` em `pipelines`.

### 1.3. Contadores derivados — não importar

`agil_qtd`, `vendas_qtd` e `vgv_qtd` são **agregados vivos mantidos por workflow do Bubble**, não fatos. Prova: entre
os dois snapshots (25 minutos), `agil_qtd` de TENDA caiu de 38 para 36 e de VASCO de 30 para 27, sem que nada mais
mudasse. `vendas_qtd` tem só dois valores no universo inteiro (`0` em 39 linhas, `1` em 2) e `vgv_qtd` só três —
são o placar do mês corrente, não histórico.

No schema alvo esses números saem de `deals`/`deal_participants` por agregação. Importar as colunas seria criar uma
segunda fonte de verdade que já nasce errada. **Descartar as três.**

### 1.4. Lista completa das 41 construtoras (arquivo B, ordem alfabética)

`meta` e `metas` vazios omitidos como `—`. `uso_pipe` = quantas vezes o nome aparece na coluna `construtora` do
export `pipelines` (7.568 registros) — cruzamento feito para separar catálogo vivo de lixo.

| # | nome | cor | CCA | meta | metas | agil_qtd | vendas_qtd | vgv_qtd | criado em | uso_pipe |
|---:|---|---|---|---:|---|---:|---:|---:|---|---:|
| 1 | ABACO | `#bec1fd` | CCA Externo | — | — | 0 | 0 | — | 11/05/2024 | 44 |
| 2 | ADITAR | `#d1caca` | CCA Faceimob | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 3 | APICE | `#c29e9e` | CCA Faceimob | — | — | 1 | 0 | — | 11/05/2024 | 133 |
| 4 | AVULSO | `#8e8e8e` | CCA Faceimob | — | — | 0 | 0 | 0 | 11/05/2024 | 58 |
| 5 | BALIZA | `#0d275f` | CCA Externo | — | — | 0 | 0 | 0 | 11/05/2024 | 17 |
| 6 | BELMAIS | `#f59494` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | 6 |
| 7 | BELMONTE | `#858181` | CCA Faceimob | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 8 | BOLOGNESI | `#333c4f` | CCA Externo | — | — | 0 | 0 | — | 11/05/2024 | 25 |
| 9 | CELSUL | `#2080ac` | CCA Externo | — | — | 0 | 0 | — | 12/08/2024 | 12 |
| 10 | CNT | `#433f3f` | CCA Faceimob | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 11 | CONCORDIA | `#1c6972` | CCA Externo | — | — | 0 | 0 | 0 | 30/01/2025 | 1 |
| 12 | COUTO | `#ff6e6e` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | 2 |
| 13 | CYRELA | `#d6acef` | CCA Faceimob | — | — | 0 | 0 | 0 | 11/05/2024 | 42 |
| 14 | DALLASANTA | `#c18e8e` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 15 | ELIOWINTER | `#4864ae` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 16 | ENGEPP | `#6a5b5b` | CCA Faceimob | — | — | 0 | 0 | 0 | 12/05/2024 | 1 |
| 17 | Harmonia | `#27a592` | CCA Externo | — | — | 0 | 0 | 0 | 23/02/2026 | **0** (mas `HARMONIA` ×1) |
| 18 | LOTTICCI | `#FFFFFF` | CCA Externo | — | — | 0 | 0 | 0 | 13/05/2024 | **0** |
| 19 | LOTTICI | `#843f3f` | CCA Externo | — | — | 0 | 0 | — | 12/05/2024 | 3 |
| 20 | LOTUS | `rgba(114,28,29,1)` | CCA Faceimob | — | — | 0 | 0 | — | 12/05/2024 | 42 |
| 21 | LYX | `#611718` | CCA Externo | — | — | 6 | 0 | — | 11/05/2024 | 350 |
| 22 | MAIS LAR | `rgba(114,28,29,1)` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | 19 (+6 como `MAISLAR`) |
| 23 | MC3 | `#ff9700` | CCA Faceimob | **20** | — | 4 | 0 | — | 11/05/2024 | 397 |
| 24 | MELNICK | `#15b3b0` | CCA Faceimob | — | — | 0 | 0 | — | 11/05/2024 | 51 |
| 25 | MGF | `#ca8a09` | CCA Externo | — | — | 2 | 0 | — | 20/02/2026 | 1 |
| 26 | MMR | `#3268ac` | CCA Faceimob | — | — | 0 | 0 | — | 25/11/2024 | 14 |
| 27 | MNB | `#6e6b6b` | CCA Externo | — | — | 0 | 0 | — | 12/05/2024 | 32 |
| 28 | MORANA | `#7f09c5` | CCA Faceimob | **10** | — | 1 | 0 | — | 11/05/2024 | 193 |
| 29 | MRV | `#29c509` | CCA Externo | **10** | — | 4 | 0 | — | 11/05/2024 | 433 |
| 30 | PARADIS | `#424242` | CCA Externo | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 31 | PAVEI | `#a7a7a7` | CCA Externo | — | — | 0 | 0 | 0 | 14/05/2026 | 1 |
| 32 | RNI | `#53ccc9` | CCA Faceimob | — | — | 0 | 0 | 0 | 11/05/2024 | 15 |
| 33 | RODOBENS | `#28a8db` | CCA Faceimob | — | — | 0 | 0 | 0 | 12/05/2024 | 3 |
| 34 | RPM | `#ffffff` | *(vazio)* | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 35 | SALIS | `#9cc3c8` | CCA Externo | — | — | 0 | 0 | — | 12/05/2024 | 5 |
| 36 | SOLV | `#ffffff` | *(vazio)* | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |
| 37 | SOUTH | `#0028aa` | CCA Externo | — | — | 0 | **1** | **226500** | 11/05/2024 | 87 |
| 38 | TENDA | `#fb0205` | CCA Faceimob | **40** | — | 36 | 0 | — | 11/05/2024 | **3437** |
| 39 | VASCO | `#f07777` | CCA Faceimob | **25** | — | 27 | **1** | **189000** | 11/05/2024 | **2108** |
| 40 | VIEZZER | `#4289a9` | CCA Externo | — | — | 0 | 0 | 0 | 04/07/2024 | 1 |
| 41 | VIVER | `#ffffff` | *(vazio)* | — | — | 0 | 0 | 0 | 12/05/2024 | **0** |

Uso de `pipelines` menor que o total (7.551 preenchidos de 7.568) porque 17 pipelines não têm construtora.

### 1.5. Relacionamentos (formato da referência)

`Construtoras` é **referenciada por nome de exibição**, nunca por `unique id`, em todos os exports que verifiquei:

| CSV que referencia | Coluna | Formato | Casam | Órfãos |
|---|---|---|---:|---|
| `pipelines-modified--` (7.568 reg.) | `construtora` | `nome_exibicao->Construtoras` | 31 de 33 distintos | `MAISLAR` (6), `HARMONIA` (1) |
| `pipelines-modified--` | `CONSTRUTORA2` | `nome_exibicao->Construtoras` | 32 de 32 distintos | 0 |
| `meta-constutoras-modified` (402 reg.) | `construtora` | `nome_exibicao->Construtoras` | 9 de 9 distintos | 0 |

`pipelines.EMPREENDIMENTO` (688 valores distintos, 7.529 preenchidos) é o **produto/loteamento** da construtora
(`SOLAR DO BOSQUE` 542, `RESERVA DO PARQUE` 334, `PARQUE PONTAL` 262, `ALTO DA COLINA` 237…). Não existe CSV próprio
de empreendimentos: o catálogo de `developer_projects` do schema alvo, se for populado, terá que ser **derivado por
distinct** de `pipelines(construtora, EMPREENDIMENTO)`. Fica para o agente de pipelines.

### 1.6. Problemas de qualidade — Construtoras

1. **Duplicidade de arquivo:** dois snapshots da mesma tabela com 25 min de diferença. Importar só o `19-37-19`.
2. **Nomes quase-duplicados no próprio catálogo:** `LOTTICI` (uid `…1715557971482x…`) e `LOTTICCI` (uid
   `…1715652404604x…`) são a mesma incorporadora grafada de dois jeitos; `LOTTICCI` tem 0 uso, cor `#FFFFFF` e foi
   criada pelo `(App admin)` — é registro acidental. Idem `MAIS LAR` × `MAISLAR` (essa segunda só existe dentro de
   `pipelines`, não no catálogo) e `Harmonia` × `HARMONIA`.
3. **Caixa inconsistente:** 40 nomes em CAIXA ALTA, 1 em Title Case (`Harmonia`). Qualquer join por nome precisa de
   `upper(trim())` **e** de normalização de espaço, senão `MAIS LAR`/`MAISLAR` continua órfão.
4. **Formato de cor misto:** 36 valores `#rrggbb`, 2 valores `rgba(114,28,29,1)` (LOTUS e MAIS LAR), 1 em maiúsculas
   (`#FFFFFF`). `developers` não tem coluna de cor no schema alvo — se a cor for preservada, precisa de coluna nova
   ou de descarte consciente. Normalizar para `#rrggbb` minúsculo antes de gravar.
5. **`#ffffff` como marca de "morto":** RPM, SOLV e VIVER têm cor branca, `CCA` vazio, `Modified Date` congelado em
   `Sep 20, 2024` e zero uso. São os únicos três registros sem `CCA`.
6. **Colunas 100% vazias:** `metas` e `Slug`. Descartar.
7. **10 construtoras nunca usadas em nenhum pipeline** (ADITAR, BELMONTE, CNT, DALLASANTA, ELIOWINTER, Harmonia,
   LOTTICCI, PARADIS, RPM, SOLV, VIVER — 11 contando VIVER). Catálogo inflado.
8. **`meta` preenchida em só 5 de 41.** As metas de verdade vivem no CSV `meta-constutoras` (402 registros,
   construtora × equipe × mês). A coluna `meta` aqui é resíduo de uma versão anterior — **não importar**, para não
   criar duas fontes de meta.

### 1.7. Volume relevante — Construtoras

Dos 41 registros, **~30 valem importação**: os 30 com uso comprovado em `pipelines`. Os outros 11 são catálogo
morto (0 uso, 0 vendas). Recomendação prática: importar os 41 com `active = (uso_pipe > 0)` — assim nenhum
`deal` histórico fica órfão no momento do carregamento de pipelines, e o catálogo já entra higienizado na UI.
Custo: 11 linhas inertes. Alternativa (importar só 30) exige tratar `MAISLAR`/`HARMONIA` como órfãos na carga de
pipelines de qualquer jeito.

Colunas que efetivamente atravessam: `nome`, `CCA`, `cor`, `Creation Date`, `unique id`. As outras oito são vazias,
derivadas ou resíduo.

---

## 2. links — 3 linhas, para que servem

Arquivo: `export_All-links_2026-09-08_19-41-17.csv` · 476 bytes · **3 registros** · 6 colunas.
Header: `link, nome, Creation Date, Modified Date, Slug, Creator`

**Este arquivo não tem coluna `unique id`.** É a única exceção do grupo. Sem PK do Bubble, a chave natural
disponível é a URL (`link`), que é única nas 3 linhas.

### 2.1. Perfil coluna a coluna

| # | Coluna | Tipo | Preench. | Distintos | Exemplos | Significado | Referência? |
|---|---|---|---:|---:|---|---|---|
| 0 | `link` | url | 100% | 3 | `https://faceimob.com.br/` | URL de destino do atalho. | não |
| 1 | `nome` | texto | 100% | 3 | `Site Faceimob`, `Portfólio de Produtos` | Rótulo exibido no menu. | não |
| 2 | `Creation Date` | data_en_us | 100% | 3 | `Jul 25, 2025 10:34 am` | Cadastro. | não |
| 3 | `Modified Date` | data_en_us | 100% | 3 | `Jul 25, 2025 10:34 am` | Igual ao create nas 3. Nunca editados. | não |
| 4 | `Slug` | vazio | 0% | 0 | — | Descartar. | não |
| 5 | `Creator` | texto | 100% | 1 | `Douglas Gomes` | Autor. | `nome_exibicao->Users` |

### 2.2. As 3 linhas, integrais

| nome | link | criado |
|---|---|---|
| Site Faceimob | `https://faceimob.com.br/` | 25/07/2025 10:34 |
| Portfólio de Produtos | `https://drive.google.com/drive/folders/1P5Bb0FvjKICKogqrrNB62sw0o1ZtVkZ3?usp=drive_link` | 25/07/2025 12:07 |
| Webmail Faceimob | `https://webmail.faceimob.com.br/` | 25/07/2025 12:08 |

**Para que servem:** é a barra de "links úteis" do painel do corretor no Bubble — três atalhos criados na mesma
tarde de 25/07/2025 e nunca mais tocados: o site institucional, a pasta do Drive com o portfólio de produtos (material
de venda das construtoras) e o webmail corporativo. Cai direto em `useful_links` (`label`, `url`, `icon`, `category`,
`sort_order`, `active`) do schema alvo.

### 2.3. Problemas de qualidade — links

1. **Sem `unique id`.** Não há PK estável do legado; usar a URL como chave de idempotência da carga.
2. **Sem `icon`, sem `category`, sem `sort_order`.** O schema alvo pede `icon` (opcional), `category` (NOT NULL) e
   `sort_order` (NOT NULL). Terão que ser inventados na carga — sugestão: `category = 'geral'`, `sort_order` pela
   ordem de criação (1, 2, 3), `icon` nulo.
3. **Link do Google Drive com `?usp=drive_link`** — é um link de compartilhamento pessoal. Se a pasta não estiver
   com permissão aberta, o atalho quebra para quem não tem acesso. Vale validar antes de publicar na UI nova.
4. Volume trivial: **3 registros, todos relevantes.** Poderiam até ser digitados à mão no seed.

---

## 3. dicadeouros — as dicas têm título separado do corpo?

Arquivo: `export_All-dicadeouros-modified_2026-09-08_19-37-31.csv` · 3.191 bytes · **10 registros** (28 linhas
físicas) · 6 colunas.
Header: `dica, Creation Date, Modified Date, Slug, Creator, unique id`

### 3.1. Resposta direta: **não, não há título separado.**

Existe **uma única coluna de conteúdo (`dica`)**. Não há coluna `titulo`/`nome`/`assunto`. O título, quando existe,
está **embutido no início do próprio texto**, num padrão informal e não confiável para parsing automático:

| Heurística testada | Registros que batem (de 10) |
|---|---:|
| Começa com caractere não alfanumérico (emoji) | **10/10** |
| Tem quebra de linha real (`\n`) no corpo | 6/10 |
| Tem travessão `–` nos primeiros 70 chars (separador título–corpo) | 3/10 |
| Tem `👉` como marcador de "a dica em si" | 4/10 |
| Tem ≥4 maiúsculas seguidas nos primeiros 70 chars (título em caixa) | 4/10 |
| Textos duplicados | 0 (10 distintos) |

Só 3 de 10 seguem o formato `EMOJI TÍTULO – corpo`. Os outros 7 começam direto com o conteúdo, ou usam markup BBCode
para destacar a primeira frase. **Conclusão para o mapeamento:** `gold_tips` tem `title text NOT NULL` e
`body text NOT NULL`. Não dá para derivar `title` automaticamente com qualidade — com 10 registros, o caminho certo
é **escrever os 10 títulos à mão** (revisão humana), ou usar um `title` genérico do tipo `Dica de ouro — jan/2026`
derivado de `Creation Date` e jogar o texto inteiro no `body`.

### 3.2. Perfil coluna a coluna

| # | Coluna | Tipo | Preench. | Distintos | Significado | Referência? |
|---|---|---|---:|---:|---|---|
| 0 | `dica` | texto rico (BBCode) | 100% | 10 | Texto integral da dica. len min 105 / máx 287 / média 194. 6 com `\n`, 8 com vírgula, 0 com aspas. | não |
| 1 | `Creation Date` | data_en_us | 100% | 10 | Data de publicação. | não |
| 2 | `Modified Date` | data_en_us | 100% | 10 | **Idêntica ao create nas 10.** Nunca editadas. | não |
| 3 | `Slug` | vazio | 0% | 0 | Descartar. | não |
| 4 | `Creator` | texto | 100% | 1 | `Douglas Gomes` nas 10. | `nome_exibicao->Users` |
| 5 | `unique id` | bubble_uid | 100% | 10 | PK. | PK |

Exemplos (não mascarados — não há dado pessoal):
- `💡 Dica de Ouro – Vendas MCMV  👉 Pare de vender imóvel, comece a vender aprovação. […]`
- `📞 DICA DE OURO – LIGAÇÃO DO CORRETOR (MCMV)  👉 Ligue para ajudar, não para vender. […]`
- `🥉 DICA DE OURO – FUNIL  🎯 ANÁLISE NÃO É OPÇÃO, É O JOGO […]`

### 3.3. As 10 dicas, integrais (ordem cronológica)

`\n` marca quebra de linha real dentro do campo.

| # | Data | uid | Conteúdo |
|---:|---|---|---|
| 1 | 06/01/2026 15:08 | `1767722934861x794510297930137600` | `💡 Dica de Ouro – Vendas MCMV  👉 Pare de vender imóvel, comece a vender aprovação. O cliente do Minha Casa Minha Vida compra quando sente segurança de que vai conseguir financiar. Explique o processo, simule na hora, valide renda e entrada rapidamente. Quem resolve o medo, fecha a venda.` |
| 2 | 15/01/2026 12:55 | `1768492556846x122436471030546430` | `📞 DICA DE OURO – LIGAÇÃO DO CORRETOR (MCMV)  👉 Ligue para ajudar, não para vender.  Comece assim:  "Quero entender sua renda pra ver se você consegue comprar."  Quem liga focando em resolver (aprovação) cria confiança. Quem liga tentando empurrar imóvel perde o lead.` |
| 3 | 23/01/2026 11:23 | `1769178227964x467802563942285300` | `🥉 DICA DE OURO – FUNIL  🎯 ANÁLISE NÃO É OPÇÃO, É O JOGO Sem análise, não existe funil. Sem funil, não existe venda. 👉 Seu foco diário é gerar análises, não só conversas.` |
| 4 | 01/02/2026 22:52 | `1769997141330x393272395172675600` | `🔥 [b]HOJE É DIA DE DECISÃO[/b] 🔥 \n No último dia, [b]não é sobre falar com todos — é sobre fechar com quem já está quente[/b]!` |
| 5 | 04/02/2026 15:49 | `1770230973776x891238313642164200` | `✅ [b]Reunião Geral Janeiro[/b] ✅ \n \n [i]Dia 05/02 as 09:00 na Macro Office[/i] \n [b]Te esperamos por lá! 🚀[/b]` |
| 6 | 05/02/2026 21:36 | `1770338168943x150981762154496000` | `⏰ [b]Fevereiro é curto. Carnaval passa rápido. A venda não espera.[/b] \n 🎯 [b]Antecipe tudo agora:[/b] \n 👉 Ligue hoje \n 👉 Envie a análise hoje \n 👉 Feche antes do Carnaval \n 🚀 [b]Fevereiro não é mês de ritmo lento. É mês de foco total.[/b]` |
| 7 | 10/03/2026 15:23 | `1773167033655x936286802761744400` | `📌 [b]Dica de Ouro de Março[/b] \n Reative seus leads do início do ano 📲 \n Pergunte sobre os planos de 2026 e apresente o [b]Minha Casa Minha Vida[/b] 🏡 \n Quem volta a falar com o cliente primeiro, fecha primeiro 💰🔥` |
| 8 | 07/04/2026 11:26 | `1775572010148x200185147179139070` | `[h2][b]😉💰🚀[/b][/h2] \n [h2][b]Proibido Resmungar![/b][/h2] \n [b][color=rgb(255, 255, 255)][highlight=rgb(0, 102, 204)]  ORE ET LABORE   [/highlight][/color][/b]` |
| 9 | 15/05/2026 14:58 | `1778867884660x173873086179049470` | `🏆 [i]Dica de ouro de Maio:[/i] quem faz mais contatos agora, assina mais contratos no fim do mês. [i]Volume gera oportunidade e oportunidade gera venda.[/i] 🚀` |
| 10 | 25/06/2026 00:03 | `1782356586252x906525879730700300` | `🏡 [b]Quem acompanha, vende![/b] \n Não basta atender o cliente uma única vez. Os corretores que mais vendem são os que fazem [b]follow-up diário[/b], tiram dúvidas, atualizam o cliente e conduzem a negociação até a assinatura. \n \n #ficaadica` |

### 3.4. Problemas de qualidade — dicadeouros

1. **Markup BBCode do editor rich-text do Bubble** nos registros 4–10: `[b]`, `[i]`, `[h2]`, `[color=rgb(...)]`,
   `[highlight=rgb(...)]`. Os registros 1–3 são texto puro. **Duas gerações de formato no mesmo campo.** Na carga
   é preciso decidir: converter BBCode → HTML/Markdown, ou remover as tags (`re.sub(r'\[/?[^\]]+\]', '', s)`).
   Remover é mais seguro e perde só negrito/itálico; converter para HTML abre superfície de XSS se o front renderizar
   sem sanitizar.
2. **Título ausente** — ver §3.1. `gold_tips.title` é NOT NULL; precisa ser preenchido manualmente ou derivado.
3. **Sem ordenação** — não há campo de ordem; `gold_tips.sort_order` (NOT NULL) terá que sair de `Creation Date`.
4. **Sem flag de ativo** — todas as 10 estão no export sem indicação de publicada/arquivada. Assumir `active = true`
   ou ativar só a mais recente (é o comportamento típico de "dica do dia": uma vigente por vez).
5. **Conteúdo não é atemporal.** Registros 5 (reunião de 05/02), 6 (Carnaval) e 7 (março) são **avisos datados**, não
   dicas de vendas reutilizáveis. Semanticamente estão mais para `important_notices` do que para `gold_tips`.
6. **Autoria:** `Creator` vem como nome de exibição (`Douglas Gomes`), não uid. `gold_tips.author_id` é uuid — o
   vínculo depende do de-para de Users por nome, que é o mesmo problema descrito no perfil de Users.

### 3.5. Volume relevante — dicadeouros

**10 de 10 são relevantes** (0 duplicatas, 0 vazios, nenhum registro de teste). Volume trivial. A questão não é
quantidade e sim curadoria: 6–7 são dicas de vendas de fato (importar em `gold_tips`), 3–4 são avisos com prazo
vencido (`important_notices` já expirado, ou descartar).

---

## 4. mensagemdodias — têm data associada? Histórico ou pool rotativo?

Arquivo: `export_All-mensagemdodias-modified_2026-09-08_19-41-43.csv` · 8.294 bytes · **18 registros** (170 linhas
físicas) · 6 colunas.
Header: `mensagem, Creation Date, Modified Date, Slug, Creator, unique id`

### 4.1. Resposta direta

**(a) Data associada: não existe campo de data próprio.** Não há coluna `data`, `dia`, `vigencia`, `inicio`/`fim`.
As únicas datas são os carimbos nativos do Bubble (`Creation Date` / `Modified Date`).

**(b) São mensagens históricas, não um pool rotativo.** As evidências:

| Métrica | Valor |
|---|---|
| Registros | 18 |
| Textos distintos | **18 de 18** (zero repetição) |
| `Creation Date` distintos | 18 de 18 |
| `Modified Date` == `Creation Date` | **18 de 18** (nenhuma foi editada depois) |
| Janela coberta | 06/01/2026 14:38 → 25/06/2026 00:01 |
| Dias corridos no intervalo | 171 |
| Dias distintos com publicação | **14** |
| Cobertura | **8,2% dos dias** |
| Dias com mais de 1 mensagem | 3 (01/02 ×2, 10/03 ×2, 14/04 ×3) |

Um **pool rotativo** teria poucos textos reutilizados e `Modified Date` mudando conforme fossem reeditados — não é o
caso. Um **mural diário de verdade** teria ~171 registros cobrindo os dias úteis — também não é o caso (8,2%).

O que os dados mostram é um **mural esporádico**: o gestor publica quando tem recado (campanha "Bateu Levou", início
de mês, Carnaval, reunião), a mensagem fica no ar até ser substituída pela próxima. Reforça isso a **sequência de
mensagens acumulativas**: a #3 (23/01) repete o texto da #2 e acrescenta; a #4 (27/01) repete a #3 e acrescenta o
bloco PONTAL; a #5 (01/02) reformata a #4 em BBCode; a #6 (01/02, 11h depois) reformata de novo com emojis. Isso é
alguém **editando o cartaz do mural criando registro novo**, não rotação de pool.

Distribuição por mês: `2026-01` 4 · `2026-02` 5 · `2026-03` 2 · `2026-04` 5 · `2026-05` 1 · `2026-06` 1.
Por dia da semana: Ter 8 · Sex 4 · Qui 3 · Dom 2 · Qua 1 (nenhuma segunda ou sábado).

### 4.2. Perfil coluna a coluna

| # | Coluna | Tipo | Preench. | Distintos | Significado | Referência? |
|---|---|---|---:|---:|---|---|
| 0 | `mensagem` | texto rico (BBCode) | 100% | 18 | Recado do mural. len min 30 / máx 663 / média 322. 13 com `\n`, 15 com vírgula, 0 com aspas. | menciona construtoras por nome, em prosa (não é FK) |
| 1 | `Creation Date` | data_en_us | 100% | 18 | Publicação. Serve como `starts_at`. | não |
| 2 | `Modified Date` | data_en_us | 100% | 18 | Sempre igual ao create. | não |
| 3 | `Slug` | vazio | 0% | 0 | Descartar. | não |
| 4 | `Creator` | texto | 100% | 1 | `Douglas Gomes` nas 18. | `nome_exibicao->Users` |
| 5 | `unique id` | bubble_uid | 100% | 18 | PK. | PK |

Exemplos (não mascarados — não há dado pessoal):
- `Produtos Foco desta semana! - VASCO - TENDA - MRV`
- `URGENTE 🚨  BATEU LEVOU R$ 500,00 REAIS POR VENDA LYX COM META DE 6 UNIDADES !!!!!!  Só BLUE LAKE !!!!`
- `[youtube]XEsKqh-2e3U[/youtube]`

### 4.3. As 18 mensagens (cronológico, resumidas)

Conteúdo integral está no dump `<scratchpad>/saida.txt`, seção `### MSG - CONTEUDO INTEGRAL`. Resumo com o suficiente
para o mapeamento:

| # | Publicada | uid | Assunto | Markup |
|---:|---|---|---|---|
| 1 | 06/01 14:38 | `1767721101806x…` | Produtos foco da semana: VASCO, TENDA, MRV | texto puro |
| 2 | 09/01 16:51 | `1767988295618x…` | Bateu Levou LYX — R$500/venda, meta 6 un., só BLUE LAKE | texto puro |
| 3 | 23/01 14:56 | `1769191017033x…` | Bateu Levou TENDA (200/50/50) + repete LYX | texto puro |
| 4 | 27/01 15:39 | `1769539186091x…` | #3 + bloco PONTAL (meta 8 un., 1.000/500, 20% pró-soluto 60×) | texto puro |
| 5 | 01/02 11:07 | `1769954850043x…` | Mesmo conteúdo da #4, reformatado | `[h3][b]` |
| 6 | 01/02 22:48 | `1769996922186x…` | Mesmo conteúdo, reformatado com emojis 💰 por linha | `[b][i]` |
| 7 | 05/02 21:34 | `1770338052702x…` | "Fevereiro Começou!" — motivacional | `[b][i]` |
| 8 | 13/02 13:19 | `1770999541037x…` | Carnaval + Bateu Levou LYX (meta 10) | `[b][u][i]` |
| 9 | 19/02 14:21 | `1771521718002x…` | Fevereiro histórico + BL TENDA (meta 15) e LYX (meta 10) | `[b][u][i]` |
| 10 | 10/03 15:20 | `1773166808474x…` | BL TENDA 24 / VASCO 24 / LYX 15 / MRV 12 | `*[b]* _[i]_` |
| 11 | 10/03 15:22 | `1773166964714x…` | #10 + MC3 08 vendas (correção 2 min depois) | idem |
| 12 | 07/04 11:28 | `1775572104720x…` | "Bateu Levou sendo apurados e pagos" | `[h2][quote]` |
| 13 | 14/04 12:18 | `1776179917522x…` | Motivacional "meta não se bate por acaso" | `[b]` |
| 14 | 14/04 12:24 | `1776180289790x…` | #13 + vídeo do YouTube embutido | `[h2][youtube]` |
| 15 | 14/04 12:25 | `1776180350774x…` | **Só o embed:** `[youtube]XEsKqh-2e3U[/youtube]` (30 chars) | `[youtube]` |
| 16 | 15/04 12:48 | `1776268109900x…` | BL TENDA 25 / VASCO 25 / LYX 10 / MRV 10 / MC3 08 | `[b][i]` |
| 17 | 15/05 14:56 | `1778867813543x…` | BL por produto (TENDA Alto da Colina, Ventura III; SOUTH Village Club; OPEN; LYX), validade 15/05–25/05, sem meta | `[ml][ul][li]` |
| 18 | 25/06 00:01 | `1782356515100x…` | "Recado Faceimob" — balão/prêmio por venda | `[h3][b]` |

### 4.4. Problemas de qualidade — mensagemdodias

1. **Sem título.** `important_notices.title` é NOT NULL. Mesma situação das dicas: derivar (primeira linha / primeiros
   N chars sem BBCode) ou escrever à mão para 18 registros.
2. **Sem vigência.** `important_notices` tem `starts_at` NOT NULL e `ends_at` opcional. `starts_at` sai de
   `Creation Date`; `ends_at` **não existe no legado** — a única menção de prazo está dentro do texto da #17
   (`VALIDADE DE 15/05 A 25/05`), em prosa. Alternativas: (a) `ends_at = starts_at` da mensagem seguinte, reproduzindo
   a semântica de mural ("vale até a próxima"); (b) `ends_at = NULL` em todas e `active = false` exceto a última;
   (c) extrair as datas do texto — não recomendado, formato livre e só 1 caso.
3. **Sem severidade.** `important_notices.severity` é NOT NULL; não há campo equivalente. Assumir `'info'`.
4. **Markup misto e sujo.** Quatro dialetos no mesmo campo: texto puro (#1–4), BBCode Bubble (#5–9, #12–14, #16, #18),
   BBCode + markdown de WhatsApp (`*negrito*`, `_itálico_`) copiado e colado (#10, #11 — repare em
   `_[i]_[/i]__[i]_[/i]___`, que é uma linha de underscores que o editor interpretou como itálico e corrompeu), e
   embed de vídeo `[youtube]XEsKqh-2e3U[/youtube]` (#14, #15). A limpeza precisa tratar os quatro. O embed do YouTube
   **perde a funcionalidade** se as tags forem removidas — decidir se vira link ou some.
5. **Quase-duplicatas por reedição.** #3⊂#4⊂#5≡#6 e #10⊂#11 e #13⊂#14⊃#15 são versões sucessivas do mesmo recado.
   Texto exato distinto em 18/18, então dedupe por igualdade não pega nada — a sobreposição é semântica.
6. **#15 é lixo:** 30 caracteres contendo só o embed, publicada 1 minuto depois da #14 que já continha o mesmo vídeo.
   Provável acidente de edição.
7. **Valores monetários e metas dentro do texto livre** (R$ 200 corretor / R$ 50 gerente / R$ 50 diretor, metas por
   construtora). São regras de campanha de incentivo que **não existem como dado estruturado em lugar nenhum do
   export**. Se o FACEIMOB for reproduzir "Bateu Levou", isso é feature nova, não migração.
8. **Cobertura temporal curta:** só jan–jun/2026, embora o sistema exista desde mai/2024. Ou a funcionalidade é
   recente, ou houve expurgo. Não dá para distinguir com os dados disponíveis.

### 4.5. Volume relevante — mensagemdodias

Das 18: **13–14 valem importação** como histórico de mural. Descartáveis: #15 (só embed, acidente), e as versões
superadas #3, #5 e #10 se a decisão for guardar só a versão final de cada recado (nesse caso sobram ~14). Como valor
operacional futuro, quase zero: são recados de campanhas de jan–jun/2026 já encerradas. **O valor real é histórico
e de demonstração**, não operacional. Se o objetivo for só ter o mural funcionando, importar as 3–5 mais recentes
e arquivar o resto já resolve.

---

## 5. Contexto do schema alvo (só orientação, mapeamento é de outro agente)

Leitura de `docs/importacao/SCHEMA_ALVO.md`, para dizer onde cada entidade tende a cair:

| Entidade Bubble | Tabela alvo | Encaixe | Atrito principal |
|---|---|---|---|
| Construtoras | `developers` (`id, name, slug, flow, submission_email, contact_name, contact_phone, notes, active`) | bom | `flow` sai de `CCA`; **não há coluna de cor**; `slug` precisa ser gerado; `submission_email`/contatos não existem no legado |
| Construtoras → produtos | `developer_projects` (`developer_id, name, city, state, active`) | derivado | não há CSV; só por `distinct(pipelines.construtora, EMPREENDIMENTO)` — 688 nomes distintos |
| links | `useful_links` (`label, url, icon, category, sort_order, active`) | ótimo | falta `category` e `sort_order` no legado; sem `unique id` |
| dicadeouros | `gold_tips` (`title, body, author_id, sort_order, active`) | parcial | `title` NOT NULL sem origem; `author_id` uuid vs `Creator` por nome; BBCode no `body` |
| mensagemdodias | `important_notices` (`title, body, severity, starts_at, ends_at, active, created_by`) | parcial | `title` e `severity` NOT NULL sem origem; `ends_at` inexistente; BBCode misto |

Metas de construtora (`Construtoras.meta`) **não** devem ir para `goals`: a fonte correta é
`export_All-meta-constutoras-modified` (402 registros, construtora × equipe × mês), fora do escopo deste perfil.

---

## 6. O que não consegui responder

1. **Se `agil_qtd` conta negócios ou leads.** Sei que é contador vivo (muda em 25 min) e que só TENDA, VASCO, LYX,
   MRV, MC3, MORANA e APICE têm valor > 0 — os mesmos produtos de maior volume em `pipelines`. Mas não há coluna no
   export que permita reproduzir a fórmula. Só o código do app Bubble diria. **Irrelevante na prática**, porque a
   recomendação é descartar a coluna.
2. **Por que 3 construtoras estão sem `CCA`.** Correlaciona com cor branca, uso zero e `Modified Date` congelado em
   set/2024, o que sustenta a leitura de "registro abandonado" — mas é inferência por correlação, não confirmação.
3. **Se `mensagemdodias` teve registros apagados antes de jan/2026.** O menor `unique id` (`1767721101806x…` =
   06/01/2026) é o mais antigo do arquivo, e uids do Bubble carregam o timestamp de criação no prefixo, então não há
   buraco *dentro* do intervalo exportado. Mas não dá para provar que não existiram registros anteriores a jan/2026 e
   foram deletados.
4. **Se `links` realmente nunca teve `unique id`** ou se a coluna foi omitida na configuração deste export específico.
   Todos os outros 4 arquivos do grupo têm. Sem acesso ao app Bubble, não dá para distinguir.
5. **Semântica exata do sufixo `-modified`** nos nomes de arquivo. Observação empírica: os arquivos `-modified`
   trazem os campos de relacionamento como texto de exibição. `links` não tem sufixo e também não tem relacionamento
   nenhum, então não serve de contraprova.

---

## 7. Comandos executados (rastreabilidade)

Todo número deste relatório sai de um destes:

```
ls -la DOCUMENTOS/DADOS_BUBBLE
md5sum <os 2 arquivos de Construtoras>
cmp <os 2 arquivos de Construtoras>          # differ: char 132, line 2
python <scratchpad>/perfil_catalogo.py       # perfil de colunas, diff por unique id,
                                             # distribuições, análise temporal, dumps integrais
python <scratchpad>/refs.py                  # cruzamento Construtoras.nome × pipelines/meta-constutoras
```

Nenhum arquivo do repositório foi alterado além deste relatório. Nenhum comando tocou o banco.
