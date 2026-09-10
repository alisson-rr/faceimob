# Perfil de dados — grupo "Metas e Resultados" (export Bubble)

Arquivos perfilados (todos em `DOCUMENTOS/DADOS_BUBBLE/`):

| # | Arquivo | Entidade Bubble | Registros (parse CSV) | Linhas físicas (`\n`) | Bytes |
|---|---------|-----------------|----------------------:|----------------------:|------:|
| 1 | `export_All-meta-constutoras-modified_2026-09-08_19-41-57.csv` | meta-constutora | **402** | 403 | 58.914 |
| 2 | `export_All-meta-equipes-modified_2026-09-08_19-42-19.csv` | meta-equipe | **201** | 202 | 28.808 |
| 3 | `export_All-resultado-anuals-modified_2026-09-08_19-44-26.csv` | resultado-anual | **67** | 68 | 9.596 |
| 4 | `export_All-vendas-modified_2026-09-08_19-45-58.csv` | venda | **6** | 7 | 1.201 |
| 5 | `export_All-financeiros_2026-09-08_19-38-25.csv` | financeiro | **26** | 27 | 2.923 |

Nestes 5 arquivos **linhas físicas = registros + 1 (cabeçalho)**: nenhum campo contém quebra de linha embutida.
Ainda assim todo o perfil foi feito com o módulo `csv` do Python 3.12 (`csv.DictReader`), nunca por split.

Método: scripts em `<scratchpad>/prof_metas.py`, `prof_metas2.py`, `prof_metas3.py`, `prof_metas4.py`.
Todo número deste relatório saiu da execução desses scripts. Onde há hipótese, ela está marcada como hipótese.

---

## 0. Convenções comuns aos 5 arquivos

### 0.1 Datas
Formato en-US do Bubble: `May 1, 2024 12:00 am`, `Dec 27, 2025 5:15 pm`.
Parse: `datetime.strptime(v, "%b %d, %Y %I:%M %p")`. **100% dos valores não vazios parseiam** nos 5 arquivos (0 falhas).

**Fuso não declarado no arquivo.** Suposição adotada: `America/Sao_Paulo`.
Evidência de que a suposição é a certa para os campos de competência: **todos** os valores de
`meta-constutoras.mes` (401), `meta-equipes.mes` (199) e `resultado-anuals.data` (67) têm
**dia = 1 e hora = 00:00** — 0 exceções. Se o Bubble tivesse renderizado em UTC um instante gravado
em `-03`, apareceriam datas do tipo "Apr 30 ... 3:00 am". Não aparece nenhuma.

> **Armadilha de importação:** `mes`/`data` são *competência mensal*, não instante.
> Converter para UTC joga o valor para o mês anterior (`2024-05-01 00:00 -03` → `2024-04-30 03:00Z`).
> Extrair `(ano, mês)` do texto e montar `date(ano, mês, 1)` sem passar por timezone.

`Creation Date` / `Modified Date` são instantes reais (horas variadas) e aí sim devem ser
interpretados como `America/Sao_Paulo` → `timestamptz`.

### 0.2 Números
Decimal brasileiro com **vírgula** e **sem separador de milhar**: `11095182,46`, `186402,89`.
Conversão segura: `v.replace('.','').replace(',','.')` → `float`. Nenhum valor com ponto de milhar foi
encontrado (`vgv`, `valor`, `valorTotal` conferidos linha a linha).

### 0.3 Referências
Como avisado no briefing, os exports `-modified` trazem relacionamento como **texto de exibição**.
Confirmado coluna a coluna neste grupo:

| Coluna | Formato observado | Aponta para |
|---|---|---|
| `meta-constutoras.construtora` | nome de exibição (`TENDA`) | `Construtoras.nome` |
| `meta-constutoras.equipe` | nome de exibição (`Archimedes`) | `Equipes.nome` |
| `meta-equipes.equipe` | nome de exibição | `Equipes.nome` |
| `vendas.pipeline` | nome de exibição **do cliente** (`CLIENTE` do pipeline) | `pipelines.CLIENTE` |
| `financeiros.pipeline` | nome de exibição **do cliente** | `pipelines.CLIENTE` |
| `*.Creator` | nome de exibição do usuário | `Users` |

Nenhuma coluna deste grupo traz `unique id` de outra tabela. **Não há lista concatenada com `" , "`
em nenhuma coluna destes 5 arquivos** — a ambiguidade de vírgula-em-nome não afeta este grupo
(afeta a ponta oposta: `pipelines.financeiro`, ver §5.3).

### 0.4 Colunas de serviço
`Slug` está **vazio em 100% das linhas** dos 5 arquivos — descartar.
`Creator` = `Douglas Gomes` em **100% das linhas dos 4 arquivos que têm a coluna** (402 + 201 + 67 + 6);
é o operador único do backoffice, não carrega informação de negócio.
`financeiros` **não tem** `Creator`, `Slug` nem `unique id` (ver §5.3 — é o problema mais grave do grupo).

---

## 1. `meta-constutoras` — meta de vendas por construtora × equipe × mês

**402 registros · 9 colunas.**
Modela quantas unidades cada equipe deve vender de cada construtora naquele mês. É o desdobramento
da meta da equipe por produto/incorporadora.

### 1.1 Colunas

| Coluna | Tipo observado | Preench. | Distintos | Exemplos (mascarados quando aplicável) | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `construtora` | texto | 100,00% (402) | 9 | `TENDA`, `VASCO`, `MRV` | Incorporadora alvo da meta | **sim** → `Construtoras.nome` (nome de exibição) |
| `equipe` | texto | 97,26% (391) | 11 (+vazio) | `Archimedes`, `Zona Sul`, `Mauricio` | Equipe dona da meta | **sim** → `Equipes.nome` (nome de exibição) |
| `mes` | data Bubble | 99,75% (401) | 23 | `May 1, 2024 12:00 am`, `Jan 1, 2026 12:00 am` | Competência mensal (sempre dia 1, 00:00) | não |
| `meta` | inteiro | 100,00% (402) | 14 | `3`, `10`, `4` | Quantidade de unidades a vender | não |
| `Creation Date` | data Bubble | 100,00% | 147 | `May 11, 2024 8:13 pm` | Criação no Bubble | não |
| `Modified Date` | data Bubble | 100,00% | 149 | `Oct 21, 2025 5:52 pm` | Última edição | não |
| `Slug` | — | 0,00% | 0 | — | vazio | não |
| `Creator` | texto | 100,00% | 1 | `Douglas Gomes` | Operador | **sim** → `Users` (nome) |
| `unique id` | id Bubble | 100,00% (402) | 402 | `1715469228707x150666705989533700` | PK Bubble | PK |

### 1.2 Distribuição completa — `construtora` (9 valores)

`TENDA` 95 · `VASCO` 93 · `MRV` 66 · `LYX` 53 · `MC3` 44 · `MORANA` 34 · `APICE` 10 · `MELNICK` 6 · `SOUTH` 1

Integridade: **as 9 existem em `Construtoras.nome`** (41 construtoras no catálogo).
32 construtoras do catálogo nunca receberam meta: ABACO, ADITAR, AVULSO, BALIZA, BELMAIS, BELMONTE,
BOLOGNESI, CELSUL, CNT, CONCORDIA, COUTO, CYRELA, DALLASANTA, ELIOWINTER, ENGEPP, Harmonia, LOTTICCI,
LOTTICI, LOTUS, MAIS LAR, MGF, MMR, MNB, PARADIS, PAVEI, RNI, RODOBENS, RPM, SALIS, SOLV, VIEZZER, VIVER.

### 1.3 Distribuição completa — `equipe` (11 valores + vazio)

`Archimedes` 104 · `Zona Sul` 103 · `Mauricio` 102 · `Jose Portilho` 66 · **`` (vazio) 11** ·
`Faceimob` 4 · `Alexandre` 2 · `Alisson` 2 · `Susana ` 2 · `Veronica` 2 · `Victor` 2 · `Daiane Dias` 2

Integridade: **as 11 existem em `Equipes.nome`** (12 equipes no catálogo). Só `Leonardo` nunca recebeu
meta por construtora. Atenção: o valor é literalmente `"Susana "` **com espaço à direita**, tanto aqui
quanto em `Equipes.nome` — o join casa sem `trim`, mas normalizar é mais seguro.

### 1.4 Distribuição completa — `meta` (14 valores)

`3` 111 · `10` 48 · `4` 42 · `1` 42 · `8` 40 · `5` 34 · `2` 34 · `9` 15 · `6` 13 · `7` 9 · `20` 6 · `12` 4 · `11` 2 · `15` 2

Sempre inteiro pequeno (1–20) = **contagem de unidades**, não valor financeiro.

### 1.5 Cobertura temporal

Faixa: **2024-05 .. 2026-09**, 23 meses distintos com dado, **6 meses buracos**:
`2024-12`, `2025-09`, `2025-11`, `2025-12`, `2026-06`, `2026-07`.

Registros por mês:
2024-05:12 · 2024-06:24 · 2024-07:19 · 2024-08:16 · 2024-09:16 · 2024-10:15 · 2024-11:12 ·
2025-01:12 · 2025-02:16 · 2025-03:24 · 2025-04:24 · 2025-05:20 · 2025-06:20 · 2025-07:22 · 2025-08:20 ·
2025-10:15 · 2026-01:26 · 2026-02:15 · 2026-03:15 · 2026-04:15 · 2026-05:19 · 2026-08:15 · 2026-09:9

Soma de `meta` por mês (unidades):
2024-05:72 · 2024-06:90 · 2024-07:80 · 2024-08:82 · 2024-09:100 · 2024-10:91 · 2024-11:175 ·
2025-01:55 · 2025-02:65 · 2025-03:100 · 2025-04:100 · 2025-05:90 · 2025-06:90 · 2025-07:95 · 2025-08:95 ·
2025-10:90 · 2026-01:100 · 2026-02:90 · 2026-03:83 · 2026-04:81 · 2026-05:90 · 2026-08:90 · 2026-09:70

Faixa por equipe (n, primeiro..último mês):
`Archimedes` 104 2024-05..2026-09 · `Zona Sul` 103 2024-05..2026-09 · `Mauricio` 102 2024-05..2026-09 ·
`Jose Portilho` 65 2024-06..2026-01 · `Faceimob` 4 2024-06 · `Alexandre`/`Alisson`/`Daiane Dias`/`Susana `/`Veronica`/`Victor` 2 cada, **só 2026-01** · vazio 11 2024-05..2024-07

Faixa por construtora:
`TENDA` 95 2024-05..2026-09 · `VASCO` 93 2024-05..2026-09 · `MRV` 65 2024-05..2026-08 ·
`LYX` 53 2025-01..2026-09 · `MC3` 44 2024-09..2026-04 · `MORANA` 34 2024-06..2026-05 ·
`APICE` 10 2025-07..2026-08 · `MELNICK` 6 2025-07..2026-05 · `SOUTH` 1 2026-05

### 1.6 Chave natural e qualidade

Chave natural: **(`construtora`, `equipe`, `mes`)**. 401 combinações, **1 duplicada**:

- `TENDA` / `Archimedes` / `Apr 1, 2026`, `meta=8` nas duas — criadas com 1 minuto de diferença
  (`Apr 13, 2026 7:51 pm` e `7:52 pm`). Duplo clique do operador. Deduplicar mantendo a mais recente.

Problemas:
1. **11 linhas com `equipe` vazia** (2,74%) — todas em 2024-05/06/07, construtoras TENDA/VASCO/MRV/MORANA,
   com metas iguais às da versão por equipe. Hipótese: meta global da construtora antes de existir o
   desdobramento por equipe. Sem equipe, não há a quem atribuir → descartar ou tratar como escopo global.
2. **1 linha com `mes` vazio** (`MRV` / `Jose Portilho` / `meta=3`, criada `Oct 7, 2024 10:24 pm`) — sem
   competência, não importável.
3. **6 meses sem nenhuma meta** (§1.5) — meta simplesmente não foi cadastrada naqueles meses.
4. Equipes novas (Alexandre, Alisson, Daiane Dias, Susana, Veronica, Victor) só têm meta por construtora
   em **2026-01**; nos demais meses de 2026 só existe meta agregada por equipe (arquivo 2). Ou seja, o
   desdobramento por construtora foi abandonado para as equipes novas.

### 1.7 Volume relevante

402 → −1 (sem mês) → −11 (sem equipe) → −1 (duplicata) = **389 linhas úteis** (96,8%).

---

## 2. `meta-equipes` — meta mensal por equipe

**201 registros · 9 colunas.**
É a meta principal da operação: quantas vendas cada equipe deve fechar no mês, mais um segundo número
(`meta_remuneracao`) usado para remuneração/comissionamento.

### 2.1 Colunas

| Coluna | Tipo observado | Preench. | Distintos | Exemplos | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `equipe` | texto | 96,02% (193) | 12 (+vazio) | `Archimedes`, `Mauricio`, `Zona Sul` | Equipe dona da meta | **sim** → `Equipes.nome` |
| `mes` | data Bubble | 99,00% (199) | 29 | `Feb 1, 2026 12:00 am` | Competência mensal (dia 1, 00:00) | não |
| `meta` | inteiro | 100,00% (201) | 42 | `8`, `20`, `4` | Meta operacional de vendas (unidades) | não |
| `meta_remuneracao` | inteiro | 81,59% (164) | 10 | `8`, `20`, `25` | Meta usada para remuneração/comissão | não |
| `Creation Date` | data Bubble | 100,00% | 80 | `Jun 17, 2026 11:40 am` | — | não |
| `Modified Date` | data Bubble | 100,00% | 78 | `Apr 13, 2026 7:58 pm` | — | não |
| `Slug` | — | 0,00% | 0 | — | vazio | não |
| `Creator` | texto | 100,00% | 1 | `Douglas Gomes` | — | **sim** → `Users` |
| `unique id` | id Bubble | 100,00% (201) | 201 | `1715462759633x569763979572281340` | PK Bubble | PK |

### 2.2 As equipes batem com `Equipes.csv`? **Sim, 100%.**

`Equipes.csv` tem **12 equipes**. `meta-equipes` cobre **as 12** — nenhum nome órfão nos dois sentidos
(`meta-equipes.equipe − Equipes.nome = ∅` e `Equipes.nome − meta-equipes.equipe = ∅`).

Catálogo de equipes (nome, diretor, gerente) para o join:

| Equipe | Diretor | Gerente | Linhas em meta-equipes | Faixa |
|---|---|---|---:|---|
| `Archimedes` | Archimedes Boff | Archimedes Boff | 29 | 2024-05..2026-09 |
| `Zona Sul` | Fabio Batista | Fabio Batista | 29 | 2024-05..2026-09 |
| `Mauricio` | Mauricio Vieira | Mauricio Vieira | 29 | 2024-05..2026-09 |
| `Jose Portilho` | Archimedes Boff | Jose Portilho | 29 | 2024-05..2026-09 |
| `Alisson` | Mauricio Vieira | Alisson Luiz | 12 | 2025-03..2026-09 |
| `Susana ` (com espaço) | Archimedes Boff | Susana Cristina Prates | 12 | 2025-03..2026-09 |
| `Victor` | Fabio Batista | Victor Rafael | 12 | 2025-03..2026-09 |
| `Veronica` | Fabio Batista | Veronica Oliveira | 9 | 2025-06..2026-07 |
| `Daiane Dias` | Fabio Batista | Daiane Dias | 9 | 2026-01..2026-09 |
| `Leonardo` | Mauricio Vieira | Leonardo Vallier | 8 | 2026-02..2026-09 |
| `Alexandre` | Archimedes Boff | Alexandre Chaves | 7 | 2026-01..2026-07 |
| `Faceimob` | Gerente Interino | Gerente Interino | 6 | 2024-05..2024-10 |
| *(vazio)* | — | — | 8 | 2024-05..2025-09 |

Observação: as colunas `meta` e `meta_equipe` de `Equipes.csv` estão **vazias em todas as 12 linhas** —
a meta vive só aqui, não há valor concorrente no cadastro da equipe.

### 2.3 O que é `meta_remuneracao`

Coluna inteira, 164/201 preenchidas (81,59%), 10 valores distintos:
`8` 67 · `20` 39 · `25` 25 · `15` 12 · `18` 5 · `12` 4 · `23` 4 · `5` 4 · `0` 2 · `30` 2

Evidências do que ela é:
- **Só aparece a partir de 2024-09.** Os 4 primeiros meses da base (2024-05 a 2024-08) não têm nenhum
  valor; de 2024-09 em diante todo mês tem. É um campo acrescentado depois.
- Comparada com `meta` na mesma linha: **igual em 85 linhas, `meta` maior em 43, `meta` menor em 36**.
  Não é derivada de `meta` por nenhuma fórmula.
- É **estável por equipe ao longo do tempo** enquanto `meta` oscila. Exemplo real (2026):
  `Archimedes` meta 4 / meta_rem 25 (jan), meta 5 / meta_rem 25 (fev); `Zona Sul` meta 4 / meta_rem 25;
  `Mauricio` meta 16 / meta_rem 20. Já as equipes pequenas ficam `8`/`8`.
- Em 2024-09: `Archimedes` 20/18, `Zona Sul` 21/20, `Jose Portilho` 15/12, `Mauricio` 31/23,
  `Faceimob` 2/**0**. Um "0" de remuneração para a equipe interina é coerente com "esta equipe não
  entra no plano de remuneração".

**Leitura:** `meta` é a meta operacional do mês (varia com o cenário, é o número cobrado no painel);
`meta_remuneracao` é o patamar contratual que dispara comissão/bônus (varia pouco, é negociado por
equipe). São duas metas independentes sobre a mesma dimensão (equipe, mês), não uma o cálculo da outra.
*Isto é interpretação a partir dos dados; não há documentação do Bubble no export para confirmar.*

### 2.4 Distribuição completa — `meta` (42 valores)

`8` 70 · `20` 18 · `4` 10 · `10` 9 · `5` 8 · `2` 7 · `18` 6 · `12` 6 · `25` 5 · `7` 5 · `9` 5 · `23` 4 ·
`24` 3 · `15` 3 · `31` 3 · `30` 3 · `21` 2 · `33` 2 · `14` 2 · `11` 2 · `16` 2 · `22` 2 · `39` 2 · `48` 2 ·
`13` 2 · `1` 2 · `6` 1 · `38` 1 · `17` 1 · `19` 1 · `3` 1 · `32` 1 · `34` 1 · `36` 1 · `27` 1 · `62` 1 ·
`46` 1 · `70` 1 · `45` 1 · `77` 1 · `106` 1 · `135` 1

Os valores altos (`62`..`135`) concentram-se em 2025-10..2025-12 (ver soma por mês abaixo) — provável
mudança de unidade naqueles meses (de "vendas" para outra métrica) ou meta de campanha de fim de ano.
**Não confirmado**; sinalizar antes de importar como `sales`.

### 2.5 Cobertura temporal

Faixa: **2024-05 .. 2026-09**, **29 meses distintos, sem nenhum buraco** (série mensal contínua).

Registros por mês: 2024-05:6 · 06:6 · 07:5 · 08:5 · 09:5 · 10:5 · 11:4 · 12:4 · 2025-01:4 · 02:4 · 03:8 ·
04:4 · 05:4 · 06:9 · 07:10 · 08:5 · 09:5 · 10:4 · 11:4 · 12:4 · 2026-01:10 · 02:11 · 03:11 · 04:11 ·
05:11 · 06:11 · 07:11 · 08:9 · 09:9

Soma de `meta` por mês: 2024-05:75 · 06:81 · 07:77 · 08:77 · 09:89 · 10:93 · 11:87 · 12:115 ·
2025-01:75 · 02:75 · 03:98 · 04:92 · 05:89 · 06:100 · 07:108 · 08:120 · 09:138 · 10:162 · 11:209 · 12:363 ·
2026-01:80 · 02:81 · 03:87 · 04:87 · 05:91 · 06:95 · 07:70 · 08:70 · 09:70

O salto 2025-09..2025-12 (138 → 363) contra ~90 do resto reforça a suspeita de §2.4.

### 2.6 Chave natural e qualidade

Chave natural: **(`equipe`, `mes`)**. 200 combinações, **1 duplicada** — e é entre as linhas de equipe vazia:
`("", Jul 1, 2025)` com `meta=7` (criada `Jul 11, 2025`) e `meta=5, meta_rem=5` (criada `Jul 15, 2025`).
Entre as 191 linhas com equipe **e** mês preenchidos **não há duplicata**.

Problemas:
1. **8 linhas com `equipe` vazia** (3,98%): 2024-05 (meta 12), 2024-06 (12), 2025-03 (10), 2025-06 (5),
   2025-07 (7 e 5 — a duplicata), 2025-08 (5), 2025-09 (5). Não atribuíveis.
2. **2 linhas com `mes` vazio**: `Alisson` meta 8 e `Susana ` meta 8, ambas criadas `Jul 8, 2026 2:4x pm`
   — cadastro iniciado e não concluído. Não importáveis.
3. `"Susana "` com espaço à direita (mesmo defeito no catálogo `Equipes.nome`).
4. `meta_remuneracao` ausente em 37 linhas (18,41%), concentradas em 2024-05..2024-08 (o campo ainda não
   existia) — vazio ali significa "não definido", não "zero".

### 2.7 Volume relevante

201 → −2 (sem mês) → −8 (sem equipe) = **191 linhas úteis** (95,0%), todas com chave única.

---

## 3. `resultado-anuals` — resultado consolidado por mês

**67 registros · 8 colunas.**
Apesar do nome "anual", **a granularidade é mensal**: cada linha é um mês fechado com nº de vendas e VGV
da operação inteira (sem quebra por equipe ou construtora). É o lançamento manual que alimenta a tela de
resultados históricos.

### 3.1 Colunas

| Coluna | Tipo observado | Preench. | Distintos | Exemplos | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `data` | data Bubble | 100,00% (67) | 66 | `Jan 1, 2024 12:00 am`, `Nov 1, 2024 12:00 am` | Competência mensal (dia 1, 00:00) | não |
| `vendas` | inteiro | 100,00% (67) | 37 | `58`, `43`, `77` | Nº de vendas fechadas no mês | não |
| `vgv` | decimal `,` | 100,00% (67) | 67 | `11095182,46`, `7989636,63` | VGV total do mês (R$) | não |
| `Creation Date` | data Bubble | 100,00% | 36 | `May 11, 2024 6:41 pm` | — | não |
| `Modified Date` | data Bubble | 100,00% | 32 | `Jul 13, 2026 2:30 pm` | — | não |
| `Slug` | — | 0,00% | 0 | — | vazio | não |
| `Creator` | texto | 100,00% | 1 | `Douglas Gomes` | — | **sim** → `Users` |
| `unique id` | id Bubble | 100,00% (67) | 67 | `1715463668646x265778707806289920` | PK Bubble | PK |

### 3.2 Granularidade e faixa — resposta direta

- **Granularidade: mensal.** 67 linhas, **66 meses distintos**, todas com dia 1 e hora 00:00.
- **Faixa: 2021-01 .. 2026-07** (67 meses de calendário no intervalo).
- **1 mês ausente: `2024-10`.**
- **1 mês duplicado: `2024-11`** (2 linhas) — é o que faz 67 linhas para 66 meses.

Totais por ano (calculados a partir das 67 linhas, incluindo a duplicata de 2024-11):

| Ano | Meses | Vendas | VGV (R$) |
|---|---:|---:|---:|
| 2021 | 12 | 551 | 79.168.378,59 |
| 2022 | 12 | 599 | 97.377.505,34 |
| 2023 | 12 | 760 | 139.470.398,33 |
| 2024 | 12 linhas / 11 meses | 797 | 155.967.986,99 |
| 2025 | 12 | 633 | 136.478.545,88 |
| 2026 | 7 (jan–jul) | 424 | 97.819.345,83 |

Cronologia de carga (visível pelo `Creation Date`): 2024-01..04 e 2023 inteiro em 11/05/2024;
2022 e 2021 em 13/05/2024 (backfill histórico); de 2024-05 em diante, uma linha por mês criada no
começo do mês seguinte; 2026-02..2026-06 foram lançados de uma vez em `Jul 13, 2026`.

### 3.3 O conflito de 2024-11 — resolvido com dado

As duas linhas:

| `data` | `vendas` | `vgv` | `Creation Date` | `unique id` |
|---|---:|---:|---|---|
| A | 109 | 22.461.886,24 | `Nov 15, 2024 11:02 pm` | `1731722576126x249232697823854600` |
| B | 59 | 12.069.138,34 | `Dec 11, 2024 2:30 pm` | `1733938248662x306743899157168100` |

Contagem independente em `pipelines` (`STATUS = VENDA`, agrupado por `mes`):

| Mês | Vendas em pipelines | VGV BRUTO somado |
|---|---:|---:|
| 2024-09 | 60 | 12.310.971,81 |
| **2024-10** | **91** | **19.450.408,58** |
| **2024-11** | **57** | **12.069.379,43** |
| 2024-12 | 40 | 8.569.595,46 |

**A linha B casa com novembro real**: VGV 12.069.138,34 vs 12.069.379,43 — diferença de R$ 241,09 (0,002%).
A linha A (109 / 22,46 M) não casa com nenhum mês isolado; foi criada em **15/11/2024**, no meio do mês.
Hipótese (não confirmável pelo export): é um lançamento acumulado outubro + novembro-até-a-data, feito
antes de o mês fechar, e nunca apagado. Note que **outubro/2024 nunca ganhou linha própria**.

Recomendação: **manter B, descartar A**, e decidir separadamente sobre 2024-10 — ou deixar o mês ausente,
ou lançá-lo com o valor recontado de `pipelines` (91 / 19.450.408,58), registrando que é derivado.
Consequência de manter A: 2024 fica com 797 vendas contra ~738 reais e o painel histórico mostra um pico
de 109 vendas que nunca existiu.

### 3.4 Qualidade

Fora o par de 2024-11 e o buraco de 2024-10, a série é limpa: sem nulo, sem valor não numérico, sem data
fora do padrão, `vgv` sempre positivo, `vendas` sempre inteiro. `vgv/vendas` fica entre ~R$ 140 mil e
~R$ 240 mil por unidade em todos os meses — coerente com o ticket do segmento econômico.

### 3.5 Volume relevante

**66 registros** (67 − 1 duplicata). Todos valem a pena: é a única série histórica 2021–2023 que existe;
`pipelines` só começa em 2024-01. Perder isso é perder 3 anos de base de comparação.

---

## 4. `vendas` — tabela abandonada

**6 registros · 14 colunas.**

### 4.1 Colunas

| Coluna | Tipo observado | Preench. | Distintos | Exemplos | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `Correto2` | — | **0,00%** | 0 | — | corretor 2 (nunca usado) | seria → `corretors` |
| `correto3` | — | **0,00%** | 0 | — | corretor 3 (nunca usado) | seria → `corretors` |
| `corretor` | — | **0,00%** | 0 | — | corretor 1 (nunca usado) | seria → `corretors` |
| `data` | data Bubble | 100,00% (6) | 2 | `May 15, 2024 12:00 am`, `May 16, 2024 12:00 am` | Data da venda | não |
| `gerente1` | — | **0,00%** | 0 | — | gerente 1 (nunca usado) | seria → `gerentes` |
| `gerente2` | — | **0,00%** | 0 | — | gerente 2 (nunca usado) | seria → `gerentes` |
| `gerente3` | — | **0,00%** | 0 | — | gerente 3 (nunca usado) | seria → `gerentes` |
| `pipeline` | texto | 83,33% (5) | 5 | `JOA***`, `ROG***`, `REN***` (nomes de clientes) | Negócio de origem | **sim** → `pipelines.CLIENTE` (nome de exibição) |
| `valor` | decimal `,` | 100,00% (6) | 6 | `175000`, `350000`, `186402,89` | VGV da venda | não |
| `Creation Date` | data Bubble | 100,00% | 6 | `May 15, 2024 10:19 am` | — | não |
| `Modified Date` | data Bubble | 100,00% | 6 | idem `Creation Date` em todas as 6 | nunca editada | não |
| `Slug` | — | 0,00% | 0 | — | vazio | não |
| `Creator` | texto | 100,00% | 1 | `Douglas Gomes` | — | **sim** → `Users` |
| `unique id` | id Bubble | 100,00% (6) | 6 | `1715779145092x796076414662606800` | PK Bubble | PK |

### 4.2 Abandonada ou de teste? — **Abandonada, e redundante.**

Evidências:
1. **As 7 colunas de atribuição (`corretor`, `Correto2`, `correto3`, `gerente1/2/3`) estão 100% vazias.**
   O rateio que a tabela existiria para modelar nunca foi preenchido — ela nasceu sem cumprir a função.
2. **Vida útil de 2 dias:** todas as 6 linhas criadas em 15 e 16/05/2024; `Modified Date` = `Creation Date`
   nas 6 (nunca reeditadas). Depois disso, nada.
3. **Os dados já existem em `pipelines`.** Cruzando `vendas.pipeline` com `pipelines.CLIENTE`, as 5 linhas
   com pipeline preenchido casam **1:1** com um pipeline `STATUS = VENDA`, e o valor bate:

   | `vendas.pipeline` | `vendas.valor` | `pipelines.VGV BRUTO` | `pipelines.mes` | construtora / corretor |
   |---|---:|---:|---|---|
   | `AND***` | 188.377,44 | **188.377,44** | May 5, 2024 | TENDA / Veronica Oliveira |
   | `JOA***` | 175.000 | **175.000** | May 5, 2024 | VASCO / Tayron dos Santos |
   | `REN***` | 200.550 | **200.550** | May 5, 2024 | VASCO / Rafael Camargo |
   | `ROG***` | 186.402,89 | **186.402,89** | May 5, 2024 | TENDA / Caroline dos Santos Silva |
   | `DAN***` | 181.414,54 | 181.274,54 | May 15, 2024 | TENDA / Alexandre Chaves |

   4 de 5 batem ao centavo; 1 difere em R$ 140,00 (`181.414,54` vs `181.274,54` — transposição de dígito).
   E `pipelines` ainda traz construtora, corretor, gerente e status, que `vendas` deixou vazios.
4. A 6ª linha tem `pipeline` **vazio** e `valor = 350000` — venda sem negócio associado, não rastreável.

**O que ela modela vs `pipelines`:** `vendas` seria o registro "só da venda" com rateio explícito entre
até 3 corretores e 3 gerentes (o mesmo papel que `deal_participants` tem no schema alvo). `pipelines` é o
negócio inteiro, do lead à venda, e já carrega `CORRETOR 1/2/3`, `GERENTE 1/2/3`, `vgv_corretor_1/2`,
`vgv_gerente_1/2`. `vendas` é uma tentativa descartada de separar o fato "venda" do funil — abandonada em
48 h porque `pipelines` já resolvia.

### 4.3 Volume relevante

**0 registros.** Nada a importar: 5 linhas são duplicata inferior de `pipelines` e 1 é órfã.

---

## 5. `financeiros` — composição do pagamento do negócio

**26 registros · 7 colunas.** É o único arquivo do grupo **sem `unique id`, sem `Creator` e sem `Slug`**.

### 5.1 Colunas

| Coluna | Tipo observado | Preench. | Distintos | Exemplos | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `nomeCampo` | texto livre | 100,00% (26) | 16 (com `strip`) / 14 (com `strip`+`upper`) | `Ato`, `Financiamento`, `Mensais` | Rótulo da parcela/componente do pagamento | não |
| `pipeline` | texto | 100,00% (26) | **7** | `LAI***`, `DAI***`, `HEN***` (nomes de clientes) | Negócio a que a linha pertence | **sim** → `pipelines.CLIENTE` (nome de exibição) |
| `valor` | decimal | 100,00% (26) | 21 | `1000`, `426`, `242880` | Valor unitário da parcela | não |
| `valorTotal` | decimal | 100,00% (26) | 24 | `1000`, `1278`, `41322` | `valor × vezes` | não |
| `vezes` | inteiro | 100,00% (26) | 6 (`1`,`3`,`6`,`24`,`97`,`120`) | `1`, `3`, `120` | Nº de parcelas | não |
| `Creation Date` | data Bubble | 100,00% | 16 | `Dec 27, 2025 5:15 pm` | — | não |
| `Modified Date` | data Bubble | 100,00% | 15 | `Jan 14, 2026 7:28 pm` | — | não |

### 5.2 `nomeCampo` — distribuição completa (14 valores normalizados, 26 linhas)

| `nomeCampo` normalizado (`strip`+`upper`) | n | Grafias cruas encontradas |
|---|---:|---|
| `FINANCIAMENTO` | 5 | `Financiamento` ×3, `FINANCIAMENTO`, `financiamento` |
| `ATO` | 3 | `Ato` ×3 |
| `MENSAIS` | 3 | `Mensais` ×3 |
| `MENSAL (1)` | 2 | `MENSAL (1) ` (espaço final), `MENSAL (1)` |
| `ENTRADA` | 2 | `` Entrada`` (espaço inicial), `Entrada` |
| `INTERMEDIARIA` | 2 | `Intermediaria` ×2 |
| `DESCONTO` | 2 | `Desconto` ×2 |
| `ADIMP. PREMIADA` | 1 | `ADIMP. PREMIADA ` |
| `PARCELAS MENSAIS 1` | 1 | `Parcelas Mensais 1` |
| `INTERMEDIÁRIA` | 1 | `Intermediária` (com acento — não funde com `INTERMEDIARIA`) |
| `FINANCIAMENTO HABITACIONAL` | 1 | `Financiamento Habitacional` |
| `INTERMEDIARIA 2` | 1 | `Intermediaria 2` |
| `PARCELA BONUS` | 1 | `Parcela Bonus` |
| `SINAL` | 1 | `sinal` |

**É texto livre digitado pelo operador**, sem catálogo: mesma coisa escrita de 3 jeitos
(`Financiamento`/`FINANCIAMENTO`/`financiamento`), com e sem acento, com espaço sobrando, com sufixo
numérico (`Intermediaria 2`, `Parcelas Mensais 1`). Semanticamente cai em ~6 famílias:
entrada/ato/sinal · parcelas mensais · intermediárias/balões · financiamento bancário · desconto ·
bônus/prêmio de adimplência.

### 5.3 É parcelamento de negócio? — **Sim, e a ligação está confirmada.**

`pipelines` tem uma coluna `financeiro` que, ao contrário do resto do export `-modified`, vem como
**lista de `unique id` concatenada por `" , "`** — está preenchida em exatamente **7 linhas de
`pipelines`** (de 7.568), as mesmas 7 pessoas que aparecem em `financeiros.pipeline`.

Contagem de ids na lista × linhas no CSV, cliente a cliente:

| Cliente (mascarado) | ids em `pipelines.financeiro` | linhas em `financeiros` | |
|---|---:|---:|---|
| `DAI***` | 6 | 6 | OK |
| `LAI***` | 5 | 5 | OK |
| `HEN***` | 5 | 5 | OK |
| `PAU***` | 4 | 4 | OK |
| `RAI***` | 3 | 3 | OK |
| `THA***` | 2 | 2 | OK |
| `CLE***` | 1 | 1 | OK |
| **Total** | **26** | **26** | **bate exatamente** |

Ou seja: **`financeiros` é filha 1:N de `pipelines`** — a composição do pagamento de um negócio
(entrada + parcelas + intermediárias + financiamento). Exemplo completo de um negócio (`LAI***`,
pipeline `STATUS=VENDA`, construtora RNI, VGV BRUTO 303.600):

```
Ato                 1.000 × 1   =   1.000
MENSAL (1)            426 × 3   =   1.278
ADIMP. PREMIADA    17.089 × 1   =  17.089
MENSAL (1)            426 × 97  =  41.322
FINANCIAMENTO     242.880 × 1   = 242.880
```

> **Problema grave:** o CSV de `financeiros` **não exporta a coluna `unique id`**, mas a ponta
> `pipelines.financeiro` referencia exatamente esses ids. Consequência: **o join por id é impossível**;
> só resta o join por `financeiros.pipeline` → `pipelines.CLIENTE` (nome de exibição, sujeito a homônimo).
> Neste conjunto de 7 clientes os nomes são únicos em `pipelines` (1 match cada, verificado), então o
> join funciona **para este export**. Não funcionaria se o volume fosse maior.
> Alternativa se precisar do id: reexportar `financeiros` no Bubble com a coluna `unique id`.

### 5.4 Coerência aritmética

`valor × vezes == valorTotal` em **26 de 26 linhas** (0 divergências, tolerância R$ 1,00).
A aritmética é consistente, **mas a semântica de `valor` não é**: às vezes é o valor unitário da parcela
(`426 × 97 = 41.322`), às vezes é um bloco já somado lançado com `vezes = 1`
(`Mensais 37.290 × 1`, `Mensais 22.119 × 1`). Não dá para tratar `valor` como "valor da parcela" sem
inspecionar `vezes`.

Anomalia digna de nota: o cliente `LAI***` tem `MENSAL (1)` duas vezes — `426 × 3 = 1.278` e
`426 × 97 = 41.322`, criadas com 1 minuto de diferença. Quase certamente a primeira é erro de digitação
do número de parcelas, corrigida com um novo lançamento em vez de edição. As duas ficaram na base.

### 5.5 Cobertura e volume relevante

Faixa de criação: **27/12/2025 a 06/06/2026**. Cobre **7 negócios** — contra ~7.568 pipelines e centenas
de vendas no mesmo período. **Adoção < 0,1%.** É um recurso lançado no fim de 2025, usado por um operador
em 7 casos e nunca massificado.

**Volume relevante: 26 linhas (7 negócios), mas condicional** — ver §6.

---

## 6. Vale a pena importar? (item **g**)

| Arquivo | Registros | Importáveis | Veredito | Consequência de não importar |
|---|---:|---:|---|---|
| `meta-equipes` | 201 | **191** | **IMPORTAR — prioridade alta** | Painel de metas nasce vazio; 29 meses de histórico de meta por equipe (todas as 12 equipes) se perdem, e com eles a comparação realizado × meta. |
| `resultado-anuals` | 67 | **66** | **IMPORTAR — prioridade alta** | Perde-se a única série 2021–2023 que existe no export (`pipelines` só começa em 2024-01). O gráfico histórico fica com 2,5 anos em vez de 5,5. |
| `meta-constutoras` | 402 | **389** | **IMPORTAR — condicional (falta destino no schema)** | O desdobramento de meta por incorporadora some. Perda real, mas menor: a série tem 6 buracos, não cobre as equipes novas depois de 2026-01 e o número agregado por equipe (arquivo 2) já sustenta o painel principal. |
| `financeiros` | 26 | **26 (7 negócios)** | **NÃO IMPORTAR na primeira leva** | 7 negócios de 7.568 perdem o detalhamento do plano de pagamento. Não há tabela alvo, o rótulo é texto livre e a semântica de `valor` é inconsistente. Custo de modelagem alto, benefício de 7 registros. |
| `vendas` | 6 | **0** | **RESÍDUO — descartar** | Nenhuma. 5 linhas são cópia degradada de `pipelines` (uma delas com erro de R$ 140) e 1 é órfã. |

### 6.1 Onde cada um cai no schema alvo (contexto, não mapeamento)

- `resultado-anuals` → **`annual_results`** (`year`, `month`, `sales_count`, `vgv`, `unique (year, month)`).
  Encaixe 1:1. O `unique (year, month)` já força resolver a duplicata de 2024-11 na entrada.
- `meta-equipes` → **`goals`** com `scope='team'`, `period_type='month'`, `metric='sales'`, `target=meta`,
  `team_id` resolvido por `Equipes.nome → teams.name`. Índice único
  `goals_team_idx (team_id, period_type, period, metric)` é compatível com a chave natural (`equipe`,`mes`).
  **Pendência real:** `metric` tem `check (metric in ('sales','vgv','leads','visits','analyses','approvals'))`
  e **não há valor para `meta_remuneracao`**. Ou se acrescenta um metric novo (ex.: `sales_comp`) ao CHECK,
  ou o campo se perde. Decisão de schema, não de importação.
- `meta-constutoras` → **`goals` não tem dimensão de construtora/incorporadora** (só `scope` global/team/profile).
  Sem alteração de schema (ex.: `developer_id` em `goals`, com o índice único estendido) esses 389 registros
  não têm para onde ir. Alternativa suja: codificar a construtora dentro de `metric` — quebra o CHECK e
  polui a chave; não recomendado.
- `vendas` → seria `deals` + `deal_participants`; já coberto por `pipelines`. Nada a fazer.
- `financeiros` → **não existe tabela de plano de pagamento no schema alvo**. `deals` tem só
  `vgv_gross`, `discount_pct`, `vgv_net`. Precisaria de uma tabela nova (`deal_payment_items`) para 26 linhas.

---

## 7. Respostas diretas ao briefing

**(a) Contagem real (parse CSV, não `wc -l`):**
meta-constutoras **402** · meta-equipes **201** · resultado-anuals **67** · vendas **6** · financeiros **26**.
Linhas físicas = registros + 1 nos cinco (nenhuma quebra de linha embutida).

**(b) Formato de `mes` e faixa:** é **data Bubble en-US**, não texto tipo "Jan 2025":
`May 1, 2024 12:00 am`. **Sempre dia 1, sempre 00:00** (401/401 em meta-constutoras, 199/199 em
meta-equipes, 67/67 em resultado-anuals) — é competência mensal disfarçada de timestamp.
Faixas: meta-constutoras **2024-05..2026-09** (23 meses, 6 buracos); meta-equipes **2024-05..2026-09**
(29 meses, sem buraco); resultado-anuals **2021-01..2026-07** (66 meses, falta 2024-10).

**(c) meta-equipes × Equipes.csv:** **batem 100%** — as 12 equipes do catálogo aparecem e nenhum nome
órfão nos dois sentidos. `meta_remuneracao` é uma **segunda meta, independente**, usada para
remuneração/comissão: só existe a partir de 2024-09, é estável por equipe enquanto `meta` oscila, e não é
derivada de `meta` (igual em 85 linhas, `meta` maior em 43, menor em 36). Detalhe e evidências em §2.3.

**(d) resultado-anuals:** **mensal**, não anual — 67 linhas para 66 meses, 2021-01 a 2026-07, sem quebra
por equipe ou construtora. As 67 ≠ 66 vêm de 2024-11 duplicado e 2024-10 ausente; o cruzamento com
`pipelines` mostra qual das duas linhas é a novembro verdadeira (§3.3).

**(e) vendas:** **abandonada**, não de teste — as 7 colunas de corretor/gerente estão 100% vazias, as 6
linhas nasceram em 15–16/05/2024 e nunca foram editadas, e as 5 rastreáveis são cópia (uma com erro de
R$ 140) de pipelines já existentes. Modelaria o fato "venda" com rateio explícito; `pipelines` já fazia
isso melhor (§4.2).

**(f) financeiros:** `nomeCampo` é **texto livre** (16 valores distintos com `strip`, 14 com `upper`),
não um enum: entrada/ato/sinal, parcelas mensais, intermediárias, financiamento, desconto, bônus.
**Sim, é parcelamento/composição de pagamento do negócio** — confirmado pela contagem exata de 26 ids em
`pipelines.financeiro` contra as 26 linhas, cliente a cliente (§5.3). `valor × vezes = valorTotal` em 26/26.

**(g)** Tabela de vereditos em §6.

---

## 8. Suposições, limites e o que não foi possível responder

1. **Fuso `America/Sao_Paulo`** assumido para `Creation Date`/`Modified Date`. Para `mes`/`data` a
   suposição é irrelevante desde que não se converta timezone — a evidência de dia-1/00:00 em 667 valores
   sustenta tratá-los como data de competência pura.
2. **`meta_remuneracao`** — a leitura "meta contratual de comissionamento" é **inferência a partir do
   comportamento dos dados** (estabilidade por equipe, aparecimento em 2024-09, zero para a equipe
   interina). O export não traz descrição de campo do Bubble; não há como confirmar sem perguntar ao
   operador ou abrir o app legado.
3. **Metas altas de 2025-09..2025-12** em `meta-equipes` (soma mensal 138 → 363 contra ~90 do resto):
   não foi possível determinar se mudou a unidade da métrica, se foi campanha, ou se é erro de digitação.
   Precisa de confirmação humana antes de importar como `metric='sales'`.
4. **Linhas com `equipe` vazia** (11 em meta-constutoras, 8 em meta-equipes): a hipótese de "meta global
   antes do desdobramento por equipe" é consistente com as datas e os valores, mas não é verificável no export.
5. **2024-11 duplicado**: a atribuição da linha A a "acumulado out+nov parcial" é hipótese. O que está
   **comprovado** é que a linha B casa com novembro real de `pipelines` (VGV com 0,002% de diferença) e a
   linha A não casa com nenhum mês isolado.
6. **`financeiros` sem `unique id`**: o join reverso a partir de `pipelines.financeiro` é impossível com
   este export. O join por nome funciona neste recorte (7 clientes, 1 match cada, verificado), mas é
   frágil. Se a linha for importada, reexportar `financeiros` com `unique id`.
7. Nenhum dado sensível foi copiado para este relatório: nomes de clientes aparecem apenas com as 3
   primeiras letras (`LAI***`). Estes 5 arquivos não contêm CPF, PIS, telefone, e-mail, endereço nem senha.
