# Perfil de dados — grupo `gameficacaos` + `DadosGames` (export Bubble)

Data do perfil: 09/09/2026 · Fase: somente leitura (nenhum acesso a banco, nenhum arquivo do repo alterado).
Destino provável no schema alvo (`docs/importacao/SCHEMA_ALVO.md`): `game_seasons`, `game_scoring_rules`,
`game_season_results` e — com ressalvas grandes — `game_events`.

---

## 1. Resumo executivo

Duas tabelas do Bubble formam o módulo de gamificação do sistema legado:

- **`DadosGames`** é o **catálogo de temporadas**: 7 linhas, uma por mês corrido de março a setembro de 2026.
  Cada linha carrega início, fim, nome do mês, um flag de "mês ativo" e **a tabela de pontos por evento**
  (aprovado, esteira ágil, incompleto com doc, ligação, venda). Vira `game_seasons` (7 linhas) +
  `game_scoring_rules` (7 temporadas × 5 códigos = 35 regras por temporada, ou 5 regras padrão + overrides).
- **`gameficacaos`** é o **placar agregado por pessoa por temporada**: 1 063 linhas, 162 pessoas distintas.
  Não guarda evento a evento — guarda **contadores** (`StatusAprovado`, `StatusEsteiraAgil`,
  `StatusIncompleto`, `StatusVenda`, `ligacoes`) e o total já calculado (`pontos`).

**A descoberta que decide o mapeamento:** a fórmula `pontos = Σ(contador × peso da temporada)` foi
verificada e **bate em 622 das 629 linhas que têm temporada (98,9 %)**. Ou seja, as colunas `Status*` **não**
são enum nem booleano nem pontos — são **quantidade de eventos**, e o peso vem do `DadosGames` apontado por
`gameMes`. Isso é o que permite reconstruir `game_events` sinteticamente.

**A ressalva que limita o mapeamento:** existe um segundo regime de dados. As **434 linhas sem `gameMes`**
(criadas entre 05/01/2026 e 09/04/2026, antes do `DadosGames` existir) guardam nas mesmas colunas
**pontos já acumulados**, não contadores — e nelas `pontos` não fecha com a soma (só 242 de 434 fecham,
e entre as 200 com pontuação real apenas 8 fecham). Esse bloco **não é reconstruível** e não deve ser
importado como resultado de temporada.

---

## 2. Arquivos e contagem real

| Arquivo | Bytes | `wc -l` | **Registros reais (parser CSV)** | Colunas |
|---|---:|---:|---:|---:|
| `export_All---DadosGames-modified_2026-09-08_19-36-26.csv` | 1 552 | 8 | **7** | 14 |
| `export_All---gameficacaos-modified--_2026-09-08_19-36-34.csv` | 225 018 | 1 064 | **1 063** | 19 |

Nestes dois arquivos `wc -l` coincide com registros + 1 — **não há quebra de linha dentro de campo**.
Mesmo assim todo o perfil foi feito com o módulo `csv` do Python 3.12 (`csv.DictReader`), nunca com split.

Encoding: UTF-8 com BOM (lido como `utf-8-sig`). Todos os campos vêm entre aspas.

---

## 3. `DadosGames` — as 7 temporadas (conteúdo integral)

O arquivo tem 7 linhas; segue **todo** o conteúdo, porque é ele que vira `game_seasons` +
`game_scoring_rules`. Os `unique id` estão completos de propósito: são a chave que `gameficacaos.gameMes`
referencia.

| # | `Mes_nome` | `Inicio` | `Fim` | Duração | `MesAtivo` | `unique id` |
|---|---|---|---|---|---|---|
| 1 | Março | Mar 28, 2026 3:21 pm | Apr 1, 2026 10:00 am | 3d 18h | não | `1774722066067x931669531211071500` |
| 2 | Abril | Apr 2, 2026 10:29 pm | May 1, 2026 10:00 am | 28d 11h | não | `1775179767952x241770602164387840` |
| 3 | Maio | May 2, 2026 11:54 am | Jun 2, 2026 12:16 pm | 31d 0h | não | `1777733691612x529025119208341500` |
| 4 | Junho 26 | Jun 2, 2026 12:19 pm | Jul 2, 2026 2:04 pm | 30d 1h | não | `1780413583538x628405435254702100` |
| 5 | Julho 26 | Jul 2, 2026 2:04 pm | Aug 4, 2026 10:08 am | 32d 20h | não | `1783011899732x715484072877490200` |
| 6 | Agosto 2026 | Aug 4, 2026 10:12 am | Sep 1, 2026 12:52 pm | 28d 2h | não | `1785849124693x952265896335769600` |
| 7 | Setembro 2026 | Sep 1, 2026 12:53 pm | Sep 30, 2026 12:53 pm | 29d 0h | **sim** | `1788277988370x359280909145341950` |

Observações sobre o calendário:

- As temporadas são **contíguas** (gap de 0 a 1 dia entre `Fim` de uma e `Inicio` da seguinte), mas **não
  coincidem com o mês civil**: "Junho 26" vai de 02/06 a 02/07, "Julho 26" de 02/07 a 04/08. `Mes_nome` é um
  rótulo humano, não um período — o período real é `Inicio`/`Fim`.
- "Março" durou só 3 dias e 18 horas: a temporada foi criada em 28/03, então o mês de março **não está
  coberto por completo**. Isso explica por que os totais de março são pequenos.
- O nome do mês não segue padrão: `Março`, `Abril`, `Maio`, `Junho 26`, `Julho 26`, `Agosto 2026`,
  `Setembro 2026`. Para `game_seasons.label` convém normalizar (ex.: `2026-03`, `2026-04`…).
- `Fim` de Setembro (30/09/2026 12:53) é **futuro** em relação à data do export (08/09/2026): é uma data
  planejada, não um fechamento. Combinado com `MesAtivo = sim`, confirma que Setembro é a temporada aberta.

### 3.1 Tabela de pontos por evento (vira `game_scoring_rules`)

| `Mes_nome` | `Pontos_Aprovado Total ou condicionado` | `Pontos_Esteira agil (1* envio)` | `Pontos_Incompleto com doc` | `Pontos_Ligacao` | `Venda` |
|---|---:|---:|---:|---:|---:|
| Março | 250 | 200 | 50 | 1 | 700 |
| Abril | 250 | 200 | 10 | 1 | 700 |
| Maio | 250 | 140 | 10 | 1 | 600 |
| Junho 26 | 250 | 140 | 10 | 1 | 600 |
| Julho 26 | 600 | 250 | 140 | 10 | 600 |
| Agosto 2026 | 20 | 15 | 4 | 1 | 160 |
| Setembro 2026 | 20 | 15 | 4 | 1 | 160 |

**Os pesos mudam por temporada** — em Julho houve uma inflação (aprovado 250→600, esteira 140→250,
incompleto 10→140) e em Agosto uma deflação de ~30× (aprovado 600→20, venda 600→160). Por isso a escala de
`pontos` não é comparável entre temporadas: 23 670 pontos em Julho e 1 008 em Agosto podem ser o mesmo
desempenho. Modelar como regra **por temporada** (`game_scoring_rules.season_id` preenchido), nunca como
regra padrão única.

### 3.2 Correspondência com os `event_code` já existentes no FACEIMOB

O `supabase/seed.sql` já define 5 códigos padrão. O casamento é quase perfeito:

| Coluna Bubble | `event_code` no FACEIMOB | Existe? |
|---|---|---|
| `Pontos_Aprovado Total ou condicionado` | `aprovado` | sim (padrão 250) |
| `Pontos_Esteira agil (1* envio)` | `esteira` | sim (padrão 140) |
| `Pontos_Incompleto com doc` | `incompleto_com_doc` | sim (padrão 10) |
| `Venda` | `venda` | sim (padrão 600) |
| `Pontos_Ligacao` | — | **não existe** (precisa criar `ligacao`) |
| — | `distrato` (−600) | existe no alvo, **não existe no Bubble** como peso próprio |

O distrato no Bubble aparece como `StatusVenda = -1` (venda negativa), não como código próprio. Ver §5.3.
Os valores padrão do `seed.sql` são exatamente os pesos da temporada **Maio/Junho 26** — o seed já foi
calibrado por essa referência.

### 3.3 Perfil coluna a coluna — `DadosGames` (7 registros)

| Coluna | Tipo observado | Preench. | Cardinal. | Exemplos | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `Fim` | data en-US | 100 % | 7 | `Apr 1, 2026 10:00 am`, `May 1, 2026 10:00 am`, `Sep 30, 2026 12:53 pm` | fim da temporada | não |
| `Inicio` | data en-US | 100 % | 7 | `Mar 28, 2026 3:21 pm`, `Apr 2, 2026 10:29 pm`, `May 2, 2026 11:54 am` | início da temporada | não |
| `Mes_nome` | texto | 100 % | 7 | `Março`, `Junho 26`, `Setembro 2026` | rótulo humano da temporada | não |
| `MesAtivo` | `sim`/`não` | 100 % | 2 | `não` (6), `sim` (1) | temporada aberta | não |
| `Pontos_Aprovado Total ou condicionado` | int | 100 % | 3 | `250`, `600`, `20` | peso do evento "análise aprovada" | não |
| `Pontos_Esteira agil (1* envio)` | int | 100 % | 4 | `200`, `140`, `250`, `15` | peso do 1º envio à esteira ágil | não |
| `Pontos_Incompleto com doc` | int | 100 % | 4 | `50`, `10`, `140`, `4` | peso do envio incompleto com documento | não |
| `Pontos_Ligacao` | int | 100 % | 2 | `1`, `10` | peso por ligação | não |
| `Venda` | int | 100 % | 3 | `700`, `600`, `160` | peso da venda | não |
| `Creation Date` | data en-US | 100 % | 7 | `Mar 28, 2026 3:21 pm`, … | criação no Bubble; ≈ igual a `Inicio` em todas as 7 | não |
| `Modified Date` | data en-US | 100 % | 6 | `May 19, 2026 5:16 pm`, `Jun 2, 2026 12:16 pm` | última edição; em 5 das 7 coincide com o `Fim` (o fechamento é a última edição) | não |
| `Slug` | — | **0 %** | 0 | — | vazio em 100 % | não |
| `Creator` | texto | 100 % | 1 | `Douglas G***` | quem criou (uma pessoa só) | **nome de exibição** → Users |
| `unique id` | uid Bubble | 100 % | 7 | ver tabela §3 | PK | PK |

---

## 4. `gameficacaos` — perfil coluna a coluna (1 063 registros)

| Coluna | Tipo observado | Preench. | Cardinal. | Exemplos (mascarados) | Semântica | Referência |
|---|---|---:|---:|---|---|---|
| `Atual` | `sim`/`não` | 55,13 % (586/1063) | 2 | `não` (505), `sim` (81) | flag "esta é a linha da temporada corrente" — **não confiável**, ver §5.4 | não |
| `Diretor` | texto | 67,73 % (720/1063) | 3 | `Archimedes B***`, `Mauricio V***`, `Fabio B***` | diretor da pessoa no mês | **nome de exibição** → Users/Equipes.Diretor (3/3 casam) |
| `equipe` | texto | 71,59 % (761/1063) | 12 | `Victor`, `Jose Portilho`, `Zona Sul` | equipe da pessoa no mês | **nome de exibição** → Equipes.nome (12/12 casam) |
| `gameMes` | uid Bubble | 59,17 % (629/1063) | 7 | `1774722066067x931669531211071500` | temporada | **unique_id → DadosGames** (7/7 resolvem) |
| `ligacoes` | int | 64,44 % (685/1063) | 71 | `0` (572), `11`, `338` | **quantidade** de ligações no mês | não |
| `notificouSeloFechamento` | `sim`/`não` | 98,02 % (1042) | 2 | `não` (819), `sim` (223) | selo/badge de fechamento já notificado | não |
| `notificouSeloLigacao` | `sim`/`não` | 94,07 % (1000) | 2 | `não` (951), `sim` (49) | selo de ligação já notificado | não |
| `notificouSeloVenda` | `sim`/`não` | 93,23 % (991) | 2 | `não` (917), `sim` (74) | selo de venda já notificado | não |
| `pontos` | int (827) + decimal vírgula (14) | 79,12 % (841) | 392 | `2534`, `391,5`, `-650` | total de pontos da pessoa na temporada | não |
| `StatusAprovado` | int (594) + decimal (37) | 59,36 % (631) | 32 | `0` (390), `2` (84), `0,5` (18) | **contador** de análises aprovadas | não |
| `StatusEsteiraAgil` | int (693) + decimal (41) | 69,05 % (734) | 45 | `0` (331), `1` (99), `200` (49) | **contador** de envios à esteira (mas ver regime legado) | não |
| `StatusIncompleto` | int (707) + decimal (31) | 69,43 % (738) | 48 | `0` (416), `1` (73), `50` (37) | **contador** de envios incompletos com doc | não |
| `StatusVenda` | int (605) + decimal (29) | 59,64 % (634) | 15 | `0` (438), `1` (97), `-1` (2) | **contador** de vendas (negativo = distrato) | não |
| `user` | texto | 100 % | **162** | `Daiane J*** d*** C***`, `Janaina F***` | a pessoa pontuada | **nome de exibição** → corretors.Nome (161/162) |
| `Creation Date` | data en-US | 100 % | 92 | `Jan 5, 2026 9:50 am` | criação da linha | não |
| `Modified Date` | data en-US | 100 % | 368 | `Jan 30, 2026 7:21 pm` | última atualização do placar | não |
| `Slug` | — | **0 %** | 0 | — | vazio em 100 % | não |
| `Creator` | texto | 100 % | 2 | `Douglas G***` (1056), `(App admin)` (7) | quem criou | nome de exibição / rótulo de sistema |
| `unique id` | uid Bubble | 100 % | **1063** | `1767617448541x501585000700782700` | PK, sem duplicata | PK |

Faixa temporal: `Creation Date` de **05/01/2026 09:50** a **05/09/2026 11:01**; `Modified Date` de
**05/01/2026 09:50** a **08/09/2026 16:14** (dia do export). Nenhuma linha tem `Modified < Creation`.

### 4.1 Distribuições completas dos campos pedidos

**`Atual`** (3 estados, incluindo vazio) — `não` 505 · vazio 477 · `sim` 81.

**`notificouSeloFechamento`** — `não` 819 · `sim` 223 · vazio 21.
**`notificouSeloLigacao`** — `não` 951 · `sim` 49 · vazio 63.
**`notificouSeloVenda`** — `não` 917 · `sim` 74 · vazio 72.

**`StatusVenda`** (16 valores distintos — distribuição completa):
`0` 438 · vazio 429 · `1` 97 · `2` 43 · `0,5` 17 · `3` 13 · `4` 5 · `1,5` 4 · `5` 4 · `2,5` 4 · `3,5` 3 ·
`-1` 2 · `7` 1 · `9` 1 · `6` 1 · `4,5` 1.

**`StatusAprovado`** (33 distintos — completa):
vazio 432 · `0` 390 · `2` 84 · `4` 33 · `1` 22 · `0,5` 18 · `6` 17 · `3` 7 · `5` 7 · `8` 7 · `2,5` 6 ·
`10` 5 · `1,5` 4 · `14` 4 · `12` 3 · `16` 3 · `7` 2 · `10,5` 2 · `26` 2 · `4,5` 2 · e 13 valores com 1
ocorrência cada (`19`, `25,5`, `13`, `7,5`, `6,5`, `30`, `24`, `22`, `20,5`, `9`, `28`, `5,5`, `11`).

**`StatusEsteiraAgil`** (46 distintos — top 40 + cauda):
`0` 331 · vazio 329 · `1` 99 · `2` 57 · **`200` 49** · `3` 36 · **`400` 18** · `4` 17 · `5` 14 · `0,5` 14 ·
**`800` 10** · **`600` 10** · `1,5` 7 · `6` 6 · `4,5` 6 · `7` 5 · `10` 5 · `3,5` 4 · **`1200` 3** ·
**`1000` 3** · **`300` 3** · **`1600` 3** · `8` 3 · `11` 3 · **`100` 2** · `12` 2 · `9` 2 · `5,5` 2 ·
`16` 2 · `21` 2 · **`1400` 1** · **`3000` 1** · `31,5` 1 · `24,5` 1 · `32` 1 · `23,5` 1 · `26` 1 · `19` 1 ·
`14` 1 · `11,5` 1 · **cauda: 6 valores distintos, 6 ocorrências**.
Os valores em negrito (múltiplos de 100/200) são o **regime legado em pontos**, não contadores — ver §5.2.

**`StatusIncompleto`** (49 distintos — top 40 + cauda):
`0` 416 · vazio 325 · `1` 73 · `2` 41 · **`50` 37** · **`100` 19** · `3` 18 · `4` 14 · **`150` 13** · `5` 10 ·
**`350` 8** · `1,5` 8 · **`200` 6** · `0,5` 6 · `8` 5 · `6` 5 · `10` 5 · `7` 4 · `2,5` 4 · **`125` 3** ·
**`250` 3** · **`400` 3** · **`300` 3** · `5,5` 3 · `25` 2 · `4,5` 2 · `9,5` 2 · `6,5` 2 · `9` 2 · `13` 2 ·
**`325` 1** · **`1200` 1** · **`1000` 1** · **`450` 1** · **`275` 1** · **`225` 1** · **`700` 1** ·
**`175` 1** · **`75` 1** · **`675` 1** · **cauda: 9 valores distintos, 9 ocorrências**.

**`ligacoes`** (72 distintos — top 40 + cauda):
`0` 572 · vazio 378 · `1` 15 · `2` 5 · `3` 4 · `9` 3 · `4` 3 · `34` 3 · `21` 3 · `11` 2 · `108` 2 · `20` 2 ·
`80` 2 · `5` 2 · `150` 2 · `53` 2 · `212` 2 · `8` 2 · `17` 2 · `28` 2 · `130` 2 · `6` 2 · `10` 2 · e
26 valores com 1 ocorrência entre os 40 primeiros (`26`, `156`, `31`, `36`, `143`, `185`, `277`, `282`,
`100`, `13`, `22`, `62`, `15`, `16`, `81`, `293`, `210`, …) · **cauda: 32 valores distintos, 32 ocorrências**.

**`pontos`** — 393 estados distintos (incluindo vazio), muito acima de 40. Top 40:
`0` 248 · vazio 222 · `700` 17 · `200` 13 · `15` 11 · `140` 10 · `250` 9 · `640` 9 · `950` 8 · `450` 8 ·
`4` 6 · `500` 6 · `10` 6 · `1240` 6 · `19` 6 · `1100` 5 · `850` 5 · `1450` 5 · `600` 5 · `1200` 4 · `50` 4 ·
`2200` 4 · `1400` 4 · `1350` 4 · `160` 4 · `1800` 3 · `1650` 3 · `2000` 3 · `400` 3 · `2100` 3 · `800` 3 ·
`20` 3 · `1660` 3 · `1340` 3 · `390` 3 · `1864` 2 · `900` 2 · `1151` 2 · `1201` 2 · `4860` 2 ·
**cauda: 353 valores distintos, 394 ocorrências**.

Estatísticas de `pontos` (841 linhas com valor): min **−650** · p25 **0** · mediana **400** · p75 **1450** ·
p90 **3320** · máx **23 670** · soma **1 018 623** · zeros **248**.

Demais estatísticas numéricas (só linhas com valor preenchido):

| Coluna | n | mín | p25 | mediana | p75 | p90 | máx | soma | zeros |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ligacoes` | 685 | 0 | 0 | 0 | 0 | 16 | 338 | 7 813 | 572 |
| `StatusAprovado` | 631 | 0 | 0 | 0 | 2 | 5 | 30 | 1 073,5 | 390 |
| `StatusEsteiraAgil` | 734 | 0 | 0 | 1 | 4 | 200 | 3 000 | 48 983,5 | 331 |
| `StatusIncompleto` | 738 | 0 | 0 | 0 | 3 | 50 | 1 200 | 18 796,5 | 416 |
| `StatusVenda` | 634 | −1 | 0 | 0 | 1 | 2 | 9 | 321,5 | 438 |

O salto entre p75 e p90 em `StatusEsteiraAgil` (4 → 200) e `StatusIncompleto` (3 → 50) é a assinatura
estatística dos dois regimes convivendo na mesma coluna.

---

## 5. Respostas às perguntas do briefing

### (a) Contagem real

**`DadosGames` = 7 registros. `gameficacaos` = 1 063 registros.** Ambos parseados com `csv.DictReader`;
nenhum campo com quebra de linha, nenhum `unique id` duplicado (1 063 PKs distintas em 1 063 linhas).

### (b) As 7 temporadas e a tabela de pontos

Está integralmente em **§3, §3.1 e §3.2**. Em resumo: 7 temporadas contíguas de 28/03/2026 a 30/09/2026,
apenas a última com `MesAtivo = sim`; 5 pesos por temporada, todos preenchidos em 100 % das linhas; os
pesos mudaram 3 vezes ao longo das 7 temporadas (Maio, Julho e Agosto).

### (c) `gameficacaos`: pessoas, meses, distribuição, o que são os `Status*` e os `notificou*`

**Pessoas distintas: 162** (coluna `user`, 100 % preenchida, nenhuma vazia, nenhuma lista concatenada —
`0` ocorrências de vírgula ou de ` , ` no campo).

**Meses distintos: 7** — `gameMes` está preenchido em 629 das 1 063 linhas (59,17 %) e **os 7 valores
distintos são todos `unique id` válidos do `DadosGames`** (7/7 resolvem, 0 órfãos). Sim: `gameMes` aponta
para `DadosGames`, e este é o **único campo de relacionamento do export que vem como `unique id` e não como
nome de exibição**.

Linhas por temporada e pessoas por temporada:

| Temporada | Linhas | Pessoas distintas | Linhas com `pontos` > 0 | Soma de `pontos` | Máx |
|---|---:|---:|---:|---:|---:|
| Março | 89 | 89 | 40 (1 com pontos < 0) | 34 200 | 3 650 |
| Abril | 91 | 91 | 68 | 163 801 | 13 870 |
| Maio | 95 | 95 | 68 | 151 310 | 16 290 |
| Junho 26 | 87 | 87 | 65 | 101 254 | 9 700 |
| Julho 26 | 88 | 88 | 54 | 207 280 | 23 670 |
| Agosto 2026 | 88 | 88 | 60 | 13 640 | 1 008 |
| Setembro 2026 | 91 | 91 | 37 | 1 606 | 320 |
| **(sem `gameMes` — legado)** | **434** | **113** | 197 (3 com pontos < 0) | 345 532 | 7 406 |

Nas 629 linhas com temporada o par **(`user`, `gameMes`) é único** (629 pares distintos para 629 linhas,
**zero duplicatas**) — é a chave natural. No bloco legado, não: 113 pessoas em 434 linhas, até **6 linhas
por pessoa**, sem nada que as separe além de `Creation Date`.

**O que são os `Status*`: são CONTADORES de eventos, não enum nem booleano.** Prova executada:
para cada linha com `gameMes`, calculei

```
calc = StatusAprovado      × Pontos_Aprovado
     + StatusEsteiraAgil   × Pontos_Esteira
     + StatusIncompleto    × Pontos_Incompleto
     + StatusVenda         × Venda
     + ligacoes            × Pontos_Ligacao
```

com os pesos da temporada apontada por `gameMes`, e comparei com `pontos`:

| Temporada | Bate | Não bate |
|---|---:|---:|
| Março | 89 | 0 |
| Abril | 91 | 0 |
| Maio | 95 | 0 |
| Junho 26 | 87 | 0 |
| Julho 26 | 88 | 0 |
| Agosto 2026 | 81 | **7** |
| Setembro 2026 | 91 | 0 |
| **Total** | **622** | **7** |

**622 de 629 (98,9 %)**. As 7 exceções são todas de "Agosto 2026" e todas com `Modified Date` idêntico
(`Sep 1, 2026 12:52 pm` — o instante do fechamento da temporada). Os deltas (`pontos` − `calc`) são
`+80` (×3), `+40`, `+10` (×2) e `−60`; com os pesos de agosto (venda 160, aprovado 20, esteira 15,
incompleto 4) `+80` = meia venda e `+40` = 2 aprovados, o que sugere **ajuste manual no fechamento**,
não erro de parsing. São 7 linhas: tratar como override, mantendo `pontos` do Bubble como verdade.

`ligacoes` também é contador (mesma fórmula, peso `Pontos_Ligacao`), e é a única coluna sem valor
fracionário.

**Valores fracionários (`0,5`, `1,5`, `4,5`…): 138 células** — 37 em `StatusAprovado`, 41 em
`StatusEsteiraAgil`, 31 em `StatusIncompleto`, 29 em `StatusVenda`, 0 em `ligacoes`. Como a fórmula fecha
**incluindo** essas linhas, o `0,5` é **meio crédito real** — o rateio de um negócio entre dois corretores,
exatamente o que no FACEIMOB vira `deal_participants.share_pct`. Consequência direta: 14 linhas têm
`pontos` fracionário (ex.: `391,5`, `197,5`), e `game_events.points` é `int`.

**Os `notificou*` são booleanos de controle de UI**, não pontuação: marcam se o "selo" (badge) já foi
notificado à pessoa. Só 2 estados (`sim`/`não`) mais o vazio, e a proporção de `sim` cai por temporada
(Setembro, aberta, tem 1 `sim` em 91). São estado efêmero do Bubble — **não têm destino no schema alvo**
(o FACEIMOB usa `notifications`, com semântica diferente). Descartar.

### (d) `Atual` marca a temporada corrente?

**Marca, mas é um flag desnaturado — não use como fonte de verdade.** Cruzamento `Atual` × temporada:

| Temporada | `Atual = sim` | `Atual = não` | vazio |
|---|---:|---:|---:|
| Março | 0 | 89 | 0 |
| Abril | 0 | 87 | 4 |
| Maio | 0 | 90 | 5 |
| Junho 26 | 0 | 83 | 4 |
| Julho 26 | 0 | 82 | 6 |
| Agosto 2026 | 0 | 70 | 18 |
| **Setembro 2026** | **81** | 4 | 6 |
| (sem temporada — legado) | 0 | 0 | 434 |

Todos os 81 `sim` estão na temporada aberta (Setembro), e nenhuma outra temporada tem `sim` — a intenção do
campo é clara. Mas **10 das 91 linhas de Setembro não estão marcadas**: 4 com `Atual = não` criadas em
`Sep 1, 2026 12:53 pm` (o próprio instante da virada, provavelmente um lote que a rotina de virada não
alcançou) e 6 sem valor, todas criadas **depois** da virada (01/09 19:39, 01/09 20:19, 02/09, 04/09 ×2,
05/09) — pessoas que entraram no jogo com a temporada já rodando e nunca receberam o flag.

**A fonte de verdade da temporada corrente é `DadosGames.MesAtivo = sim` (1 linha só) cruzado com
`gameficacaos.gameMes`.** `Atual` é redundante e defeituoso: descartar na importação.

### (e) Dá para reconstruir `game_events` evento a evento?

**Não com fidelidade. Só o agregado por pessoa por temporada existe.** Três limitações, em ordem de peso:

1. **Não há data do evento.** A linha é o placar acumulado do mês; `Creation Date` é quando a linha nasceu
   (normalmente o 1º dia da temporada, em lote) e `Modified Date` é a última atualização qualquer. Um
   `game_events.occurred_at` teria de ser inventado.
2. **Não há referência à origem.** Nada liga o contador ao negócio, ao caso da esteira ou à ligação que o
   gerou — `game_events.ref_type` / `ref_id` ficariam nulos, o que **desliga o índice de deduplicação**
   `game_events_dedupe_idx` (ele só age quando `ref_id is not null`). Reimportar duplicaria a pontuação.
3. **Contadores fracionários.** 138 células com `0,5` etc. não se decompõem em eventos inteiros;
   `game_events.points` é `int`.

O que **é** reconstruível, e com boa confiança: para as 629 linhas com temporada, os totais de eventos
implicados são

| `event_code` | Total de eventos (soma dos contadores) | Células fracionárias |
|---|---:|---:|
| `ligacao` | 3 425,0 | 0 |
| `esteira` | 1 083,5 | 41 |
| `aprovado` | 1 073,5 | 37 |
| `incompleto_com_doc` | 721,5 | 31 |
| `venda` | 319,5 | 29 (e 2 negativos) |
| **Total** | **6 623,0** | **138** |

**Recomendação de destino** (decisão do agente de mapeamento, mas com as consequências postas):

- **Caminho A — `game_season_results` (recomendado).** Uma linha por (pessoa, temporada), com `points` =
  `pontos`, `sales` = `StatusVenda`, `breakdown` = jsonb com os 5 contadores e os 5 pesos, `frozen_at` =
  `Fim` da temporada. É exatamente a forma do dado de origem e a tabela existe para congelar histórico.
  *Consequência:* o placar histórico aparece nas telas, mas não há timeline de eventos; e
  `game_season_results` exige `rank` e `vgv` — `rank` dá para calcular ordenando por `pontos` dentro da
  temporada, `vgv` **não existe no export deste grupo** (teria de vir do grupo de vendas/pipelines, ou
  entrar como 0 declarado).
- **Caminho B — `game_events` sintético.** Explodir cada contador em N eventos de `points` = peso, com
  `occurred_at` no meio da temporada e `ref_id` nulo. *Consequência:* ~6 623 linhas fabricadas, sem
  deduplicação, com datas falsas, e ainda assim sem resolver os `0,5`. Só vale se alguma tela do FACEIMOB
  depender de `game_events` para exibir histórico — e mesmo aí, o correto seria 1 evento agregado por
  (pessoa, temporada, código) com `points` já somado, não N eventos.
- **As 434 linhas legadas não vão para nenhum dos dois** — ver §5.2.

### 5.2 O regime legado (434 linhas sem `gameMes`)

Criadas entre **05/01/2026** e **09/04/2026**, com 113 pessoas e até 6 linhas por pessoa (distribuição:
48 pessoas com 5 linhas, 31 com 3, 8 com 6, 7 com 4, 6 com 2, 13 com 1). Concentradas em lotes:
`Mar 28` 178 · `Mar 1` 81 · `Feb 3` 73 · `Jan 5` 65 · `Jan 20` 8 · demais dias, 1 a 4 cada.

Nelas as colunas `Status*` **não são contadores**: são pontos já acumulados. Evidência — dos valores não
nulos, `StatusEsteiraAgil` é múltiplo de 200 em 98 de 103 casos e `StatusIncompleto` múltiplo de 50 em 96
de 107; os máximos são 3 000 e 1 200, incompatíveis com contagem de eventos. `StatusAprovado` só aparece em
2 linhas (ambas 0) e `StatusVenda` em 5.

E `pontos` **não fecha** com a soma dessas colunas: entre as 200 linhas legadas com `pontos ≠ 0`, apenas
**8** fecham; 189 têm `pontos` **maior** que a soma (delta mediano **+1 012**, máximo **+6 406**) e 3 menor.
Exemplo real (mascarado): pessoa com `pontos = 2534` mas `esteira = 400` e `incompleto = 50` — 2 084 pontos
sem origem declarada em nenhuma coluna do arquivo.

**Conclusão:** o bloco legado é um placar de um esquema anterior de pontuação, cuja composição não está no
export. Não é reconstruível nem em pontos por evento nem em contadores. Se houver interesse histórico, o
único uso honesto é guardar o `pontos` como um total opaco de "antes de março/2026" — mas ele mistura até
6 linhas por pessoa sem critério de desempate, então nem somar é seguro.

### 5.3 Distrato

Não existe evento `distrato` no Bubble. O distrato aparece como `StatusVenda = -1`, em **2 linhas**
(uma em Março, uma em Abril), e como `pontos` negativo em **4 linhas** (`-650`, `-466`, `-249`, `-99`;
uma em Março, três no legado). O FACEIMOB tem `event_code = 'distrato'` com peso `-600`. Na importação,
`StatusVenda` negativo deveria virar `distrato` com o valor absoluto, e não `venda` com contador negativo.

### 5.4 Sobre a coluna `Atual`

Ver §(d). Resumo: 81 `sim` (todos em Setembro), 505 `não`, 477 vazios; 10 linhas da temporada corrente sem
o flag. Descartável.

---

## 6. Relacionamentos

| Origem | Destino | Formato no export | Resolução medida |
|---|---|---|---|
| `gameficacaos.gameMes` | `DadosGames.unique id` | **`unique id`** | **7/7 valores distintos resolvem; 0 órfãos.** 629 linhas com valor, 434 sem. |
| `gameficacaos.user` | pessoa | **nome de exibição curto** | 161 de 162 casam exato (normalizado) com `corretors.Nome`; o único que não casa é `Gerente I***`, um perfil funcional. Contra `Users.Nome_completo` casam só **24 de 162** — ver §6.1. |
| `gameficacaos.Diretor` | diretor | **nome de exibição** | 3 valores distintos, **3/3** casam com `Equipes.Diretor`. |
| `gameficacaos.equipe` | equipe | **nome de exibição** | 12 valores distintos, **12/12** casam com `Equipes.nome`. |
| `gameficacaos.Creator` / `DadosGames.Creator` | quem criou | **nome de exibição** | 1 pessoa + o rótulo de sistema `(App admin)` (7 linhas). |
| `Users.GameAtual` | `gameficacaos.unique id` | **`unique id`** | caminho **inverso**: 142 dos 298 Users apontam para uma linha de `gameficacaos`, e **142/142 resolvem**. |

### 6.1 O problema de resolver `user` para `profiles.id`

`gameficacaos.user` é um nome **curto** (143 dos 162 têm só 2 tokens, 16 têm 3, 3 têm 4), enquanto
`Users.Nome_completo` é o nome **civil completo** (113 com 4 tokens, 92 com 3, 45 com 5, 9 com 6). Exemplo
real (mascarado): o jogo diz `Archimedes B***`, o cadastro diz `Antonio A*** B***`. Por isso:

- match exato contra `Users.Nome_completo`: **24 de 162**;
- match por (primeiro + último token): **119 únicos**, 1 ambíguo, 42 sem match;
- **match por subconjunto de tokens** (todo token do nome curto aparece no nome completo, sem ordem):
  **151 únicos · 6 ambíguos · 5 sem match** — cobre **1 015 das 1 063 linhas**. Dos 6 ambíguos, 2 se
  resolvem com o desempate `Users.Ativo = sim`.

A ponte `corretors` **não** resolve: `corretors.user` também é nome de exibição e casa com
`Users.Nome_completo` em apenas 75 de 294 preenchidos; a cadeia completa
`gameficacaos.user → corretors.Nome → corretors.user → Users` entrega só **23 resolvidos** e 138 sem
usuário. `Users.corretor` está preenchido em **11 de 298** — inútil.

**Caminho recomendado:** usar `Users.GameAtual` (que é `unique id`) como âncora exata — 142 dos 298 Users
apontam para uma linha do `gameficacaos` e todos os 142 resolvem, dando o par (`Users.unique id`,
`gameficacaos.user`) sem heurística nenhuma. O ponteiro está desatualizado em parte do cadastro (aponta
para Setembro em 91 casos, Julho 18, Maio 13, Junho 8, Abril 5, Março 4, Agosto 3), mas isso é irrelevante:
qualquer linha apontada já revela o nome curto daquele usuário. Completar o restante com match por
subconjunto de tokens, revisando à mão os 6 ambíguos e os 5 sem match. Também há **5 nomes do jogo com mais de uma linha
em `corretors`** (`Alexandre C***`, `Fernando S***`, `Kevyn B***`, `Rafael R***`, `Veronica O***`) e
**1 nome duplicado dentro de `Users.Nome_completo`** — homônimos reais que precisam de decisão humana.

### 6.2 Equipe e diretor mudam no tempo

`equipe` e `Diretor` estão **na linha do placar**, não no cadastro — ou seja, são um retrato do mês.
**14 pessoas aparecem com mais de uma equipe** ao longo das temporadas e **2 com mais de um diretor**
(ex.: `Alexandre C***` em `Alexandre` e depois `Archimedes`; `Veronica O***` em `Veronica` e `Zona Sul`).
No FACEIMOB isso corresponde a `team_members.joined_at` / `left_at`. **Não** derive a equipe atual da
pessoa a partir da última linha do jogo sem cruzar com o grupo de Equipes/Users.

---

## 7. Problemas de qualidade encontrados

1. **Duas semânticas na mesma coluna.** `Status*` são contadores nas 629 linhas com `gameMes` e pontos
   acumulados nas 434 sem. Importar tudo com a mesma regra infla o placar em ordens de grandeza
   (`StatusEsteiraAgil = 3000` viraria 3 000 envios à esteira).
2. **434 linhas sem temporada e sem chave de mês** (40,8 % do arquivo), com até 6 linhas por pessoa e
   `pontos` que não fecha com nenhuma composição do arquivo (só 8 de 200 fecham).
3. **Contadores fracionários** — 138 células com `,5`; `game_events.points` e
   `game_season_results.points`/`sales` são `int`. 14 linhas têm `pontos` fracionário.
4. **7 linhas de Agosto onde `pontos` ≠ soma ponderada** (deltas +80 ×3, +40, +10 ×2, −60), todas com
   `Modified Date` no instante do fechamento: ajuste manual.
5. **Decimal com vírgula** (`0,5`, `391,5`) — parsing pt-BR obrigatório; `float("0,5")` estoura.
6. **`user` é nome curto, não id** — 138 de 162 não casam com `Users.Nome_completo` sem heurística
   (§6.1); 5 nomes com múltiplas linhas em `corretors` e 1 homônimo dentro de `Users`.
7. **`Atual` incompleto** — 10 das 91 linhas da temporada corrente não estão marcadas.
8. **`Mes_nome` sem padrão** (`Março`, `Junho 26`, `Setembro 2026`) e **temporadas fora do mês civil**
   (Junho 26 = 02/06 a 02/07). Derivar `game_seasons.period_start/period_end` de `Inicio`/`Fim`, e
   **não** do nome.
9. **Março cobre só 3 dias e 18 horas** — a comparação mensal do histórico começa distorcida.
10. **Escala de pontos incomparável entre temporadas** (aprovado 250 → 600 → 20). Qualquer ranking
    histórico agregado sem normalizar por temporada é enganoso.
11. **`Slug` 100 % vazio** nos dois arquivos — descartar.
12. **`Pontos_Ligacao` não tem `event_code` correspondente** no FACEIMOB; `distrato` existe no alvo e não
    na origem (chega disfarçado de `StatusVenda = -1`).
13. **Fuso horário não declarado.** Datas em en-US (`Sep 1, 2026 12:53 pm`) sem offset. Assumido
    **America/Sao_Paulo** — se o Bubble exportou em UTC, todas as datas deslocam 3 h, o que muda a
    fronteira de 2 temporadas (`Setembro` começa 01/09 12:53 e `Agosto` termina 01/09 12:52 — folga de
    1 minuto, mas nenhum registro cai exatamente na fronteira).
14. **Nenhum dado pessoal sensível neste grupo** — sem CPF, PIS, telefone, e-mail ou endereço. O único
    dado pessoal é o nome, mascarado neste relatório. (Os dois arquivos foram varridos coluna a coluna;
    a coluna `senha_temporaria` pertence ao arquivo de Users, não a este grupo.)

---

## 8. Volume relevante para importação

Das 1 063 linhas, **470 estão completamente zeradas** (`pontos` e os 5 contadores todos 0 ou vazios) e
**593 têm algum sinal**. Divididas pelos dois regimes:

| Bloco | Linhas | Com sinal | Recomendação |
|---|---:|---:|---|
| Com `gameMes` (Mar–Set/2026) | 629 | **393** | **Importar.** Chave (`user`, `gameMes`) única, fórmula de pontos verificada em 98,9 %. |
| Sem `gameMes` (legado Jan–Abr/2026) | 434 | 200 | **Não importar como placar.** Semântica diferente, sem chave de mês, `pontos` não reconstituível. |

Números para dimensionar a carga:

- **`game_seasons`: 7 linhas** (100 % aproveitáveis).
- **`game_scoring_rules`: 35 linhas** (7 temporadas × 5 códigos) se cada temporada tiver regra própria —
  necessário, porque os pesos mudaram 3 vezes. Exige criar o `event_code` `ligacao`, que não existe no
  `seed.sql`.
- **`game_season_results`: 629 linhas** no total, ou **393** se filtrar as zeradas. As 236 linhas com
  temporada e sem sinal são pessoas que entraram no mês e não pontuaram — mantê-las preserva o "quem
  participou", descartá-las reduz ruído no ranking. Sugiro **importar as 629 e deixar o filtro para a
  tela**, já que `rank` só faz sentido com o conjunto completo de participantes.
- **`game_events` (se o Caminho B for escolhido): 6 623 eventos** sintéticos, ou **1 009** se agregado
  por (pessoa, temporada, código) — esse é o número de células com contador ≠ 0 nas 629 linhas com
  temporada (`esteira` 300 · `aprovado` 241 · `incompleto_com_doc` 215 · `venda` 194 · `ligacao` 59).
  Mas ver as três limitações em §(e).
- **162 pessoas** precisam existir em `profiles` antes; **151 resolvem automaticamente**, 11 exigem
  decisão manual.
- **Descartar por completo:** `Slug` (vazio), `Atual` (redundante e furado), os três `notificou*`
  (estado de UI), `Creator` (rastro do Bubble).

---

## 9. Suposições declaradas

- **Fuso**: datas tratadas como **America/Sao_Paulo**; o arquivo não declara offset.
- **`Status*` = contadores** nas linhas com `gameMes`: sustentado pelo casamento de 622/629 na fórmula
  `pontos = Σ(contador × peso)`, não por documentação do Bubble.
- **`Status*` = pontos** nas linhas sem `gameMes`: sustentado pela divisibilidade pelos pesos antigos
  (98/103 e 96/107) e pela magnitude (máx 3 000), não por documentação.
- **`0,5` = meio crédito por rateio**: inferido de a fórmula fechar exatamente com os meios; nenhum campo
  do export confirma o motivo.
- **Os 7 deltas de Agosto = ajuste manual**: inferido do `Modified Date` idêntico ao fechamento e da
  magnitude compatível com meia venda / 2 aprovados. Alternativa não descartada: os pesos de Agosto foram
  editados durante a temporada e o export só mostra o valor final.

## 10. Reprodutibilidade

Scripts de perfil (Python 3.12, só `csv`/`re`/`collections`/`unicodedata`, nenhuma dependência instalada),
em `C:/Users/Alisson/AppData/Local/Temp/claude/C--Users-Alisson-CascadeProjects-FACEIMOB/2d71f16a-19ed-42bc-a96d-efa2d4b2d87c/scratchpad/`:
`perfil_game.py` (perfil por coluna e distribuições) · `perfil_game2.py` (verificação da fórmula de pontos,
regime legado, `Atual`) · `perfil_game3.py` (unicidade das chaves, resolução de nomes, agregados por
temporada) · `perfil_game4.py` (cadeia de nomes contra `corretors`/`Users`, datas reais) ·
`perfil_game5.py` (fracionários, negativos, volume, durações) · `perfil_game6.py` e `perfil_game7.py`
(estratégias de casamento de nome). Todo número deste relatório saiu da saída desses scripts.
