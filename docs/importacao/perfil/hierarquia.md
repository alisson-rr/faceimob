# Perfil — hierarquia comercial (corretors + gerentes + Equipes)

Export Bubble em `DOCUMENTOS/DADOS_BUBBLE`. Perfilamento feito com o módulo `csv` do Python 3.12
(parser real, aspas e quebras de linha respeitadas). Todo número deste documento saiu de um script
executado sobre os arquivos; nada foi estimado.

Destino no schema alvo (`docs/importacao/SCHEMA_ALVO.md`, apenas contexto — o mapeamento é de outra fase):
`teams(name, slug, director_id, manager_id, active)`, `team_members(team_id, profile_id, joined_at, left_at)`,
`profiles(full_name, email, status, …)` e `user_roles(profile_id, role)` com `app_role ∈ {director, manager, broker, …}`.

## Sumário executivo (as 6 perguntas)

| # | Pergunta | Resposta curta |
|---|---|---|
| a | `corretors.user` é unique id ou nome? | **Nome de exibição**, nunca unique id (0/294). E o nome exibido é `Users.colaboradores` (apelido curto), **não** `Users.Nome_completo`. |
| a | corretors sem Users / Users sem corretors | **63** linhas de corretors sem User por nome exato (7 recuperáveis, 56 lixo de importação); **8** Users sem ficha de corretor (nenhum deles é `Funcao=CORRETOR`). |
| b | Equipes.corretores | **264** nomes, **0** repetidos entre equipes, **198** não batem com `Users.Nome_completo` — mas **264/264 (100%)** batem com `Users.colaboradores` e com `corretors.Nome`. |
| c | Diretor × gerente × gerente_gerente | `Diretor` = 4 valores (topo). `gerente` = 12 (um por equipe). `gerente_gerente` é **cópia byte a byte de `gerente` em 12/12** — campo morto. |
| d | Lista das equipes | 12 equipes, tabela completa na seção (d). |
| e | gerentes.diretor × gerente × nome | `nome == gerente` em 18/22, `nome == diretor` em 6/22 (diretores apontando para si). A tabela modela **a célula de gerência**, não a pessoa. |
| f | Níveis reais | **3**: diretor → gerente → corretor. `gerente_gerente` não cria um 4º nível. |

---

## 0. Contagem real de registros

Parse CSV, não `wc -l` (há quebras de linha dentro de aspas em outros arquivos do export; nestes três não há,
mas a contagem abaixo é do parser de qualquer forma).

| arquivo | bytes | linhas físicas | **registros** | colunas |
|---|---|---|---|---|
| `export_All-corretors-modified_2026-09-08_19-37-25.csv` | 55.556 | 366 | **365** | 11 |
| `export_All-gerentes-modified_2026-09-08_19-38-54.csv` | 3.498 | 23 | **22** | 10 |
| `export_All-Equipes-modified_2026-09-08_19-38-04.csv` | 7.143 | 13 | **12** | 14 |
| _(referência)_ `export_All-Users-modified--_2026-09-08_19-44-45.csv` | 133.295 | 299 | **298** | 34 |

Suposição de fuso registrada: as datas vêm no formato en-US `Mon D, YYYY h:mm am/pm` **sem fuso declarado**.
Tratadas como `America/Sao_Paulo`. Janelas observadas:

| tabela | Creation Date | Modified Date |
|---|---|---|
| corretors | 2024-05-12 01:49 → 2026-09-05 11:01 | 2024-05-21 19:13 → 2026-09-08 16:37 |
| gerentes | 2024-05-12 02:08 → 2026-02-05 21:32 | 2024-05-13 17:22 → 2026-08-12 15:32 |
| Equipes | 2024-05-11 18:18 → 2026-02-05 21:36 | 2026-06-01 01:15 → 2026-09-08 16:37 |

---

## 1. A descoberta que destrava tudo: `Users.colaboradores`

Todas as colunas de relacionamento destes três arquivos vêm como **texto de exibição**. O texto exibido para
um registro do tipo `User` no Bubble **não é `Nome_completo`** — é a coluna `colaboradores`, que no export de
Users é o **apelido/nome curto** da pessoa (ex.: `Nome_completo = "Antonio Archimedes Boff"` →
`colaboradores = "Archimedes Boff"`).

Evidência:

- `Users.colaboradores`: 298 valores preenchidos em 298 linhas, **298 distintos** → chave natural única de Users.
- `colaboradores == Nome_completo` em apenas **82/298**; `colaboradores` é subconjunto dos tokens de
  `Nome_completo` em **287/298**.
- Cobertura dos valores distintos de cada coluna-referência (quanto de cada coluna existe em cada universo de nomes):

| coluna | distintos | `corretors.Nome` | `gerentes.nome` | `Equipes.nome` | `Users.Nome_completo` | **`Users.colaboradores`** |
|---|---|---|---|---|---|---|
| `corretors.user` | 289 | 100% | 6% | 1% | 26% | **100%** |
| `corretors.Nome` | 352 | 100% | 5% | 1% | 22% | **82%** |
| `Equipes.corretores` (itens) | 264 | 100% | 4% | 1% | 25% | **100%** |
| `Equipes.Diretor` | 4 | 75% | **100%** | 0% | 25% | 100% |
| `Equipes.gerente` | 12 | 92% | **100%** | 17% | 17% | 100% |
| `Equipes.gerente_gerente` | 12 | 92% | **100%** | 17% | 17% | 100% |
| `gerentes.nome` | 20 | 80% | 100% | 15% | 15% | 85% |
| `gerentes.gerente` | 16 | 94% | **100%** | 12% | 19% | 100% |
| `gerentes.diretor` | 6 | 100% | 83% | 0% | 33% | **100%** |
| `Users.equipe` | 12 | 17% | 25% | **100%** | 0% | 17% |
| `Users.gerencia` | 16 | 94% | 94% | 12% | 19% | **100%** |
| `Users.diretor` | 5 | 100% | **100%** | 0% | 0% | 100% |

**Consequência prática para o importador:** a chave de junção pessoa↔pessoa em todo este grupo é
`Users.colaboradores` (normalizado: `strip`, colapso de espaços, remoção de acentos, `lower`).
Usar `Nome_completo` perde ~75% dos vínculos. Nenhum unique id aparece em coluna de relacionamento
(verificado: zero valores com padrão `\d{13}x\d{15,}` fora da coluna `unique id`).

---

## 2. Perfil coluna a coluna

### 2.1 `corretors` — 365 registros, 11 colunas

| coluna | tipo observado | preench. % | distintos | exemplos (mascarados) | significado | referência |
|---|---|---|---|---|---|---|
| `agil_qtd` | inteiro (texto) | 100,0 | 9 | `0` · `7` · `2` | contador de leads recebidos na roleta "ágil"; 333 zeros | não |
| `ativo` | booleano pt-BR | 81,9 | 2 | `sim` · `não` | corretor participa da distribuição | não |
| `Nome` | texto | 100,0 | 358 (352 normalizados) | `Cezar Luiz Pereira` · `Alexandre Chaves` · `Nancy Kuhn` | nome curto do corretor; **é a chave natural desta tabela** | `nome_exibicao->Users` (via `colaboradores`) |
| `user` | texto | 80,5 | 289 | `Cezar Luiz Pereira` · `Nancy Kuhn` · `Alexandre Chaves` | link para o registro `User` dono da ficha | `nome_exibicao->Users` (via `colaboradores`, 100%) |
| `vendas_mes` | inteiro (texto) | 100,0 | **1** | `0` | vendas do mês; **zerado em 365/365** | não |
| `VGV_mes` | inteiro (texto) | 100,0 | **1** | `0` | VGV do mês; **zerado em 365/365** | não |
| `Creation Date` | data/hora en-US | 100,0 | 270 | `May 12, 2024 1:49 am` | criação no Bubble | não |
| `Modified Date` | data/hora en-US | 100,0 | 163 | `Sep 8, 2026 4:37 pm` | última modificação | não |
| `Slug` | vazio | 0,0 | 0 | — | nunca usado | não |
| `Creator` | texto | 100,0 | 2 | `Douglas Gomes` (289) · `(App admin)` (76) | quem criou no Bubble | `nome_exibicao->Users` |
| `unique id` | unique id Bubble | 100,0 | 365 | `1715489371224x818508991618875400` | PK do Bubble | não |

Distribuições completas:

| `ativo` | n | | `agil_qtd` | n | | `vendas_mes` / `VGV_mes` | n |
|---|---|---|---|---|---|---|---|
| `não` | 209 | | `0` | 333 | | `0` | 365 |
| `sim` | 90 | | `1` | 13 | | | |
| _(vazio)_ | 66 | | `2` | 10 | | | |
| | | | `3` | 3 | | | |
| | | | `4` | 2 | | | |
| | | | `11` · `7` · `6` · `5` | 1 cada | | | |

### 2.2 `gerentes` — 22 registros, 10 colunas

| coluna | tipo observado | preench. % | distintos | exemplos | significado | referência |
|---|---|---|---|---|---|---|
| `ativo` | booleano pt-BR | 86,4 | 2 | `sim` (10) · `não` (9) · vazio (3) | célula de gerência em uso | não |
| `diretor` | texto | 81,8 | 6 | `Archimedes Boff` · `Fabio Batista` · `Mauricio Vieira` | diretor a quem a célula responde | `nome_exibicao->gerentes.nome` (5/6) / `Users.colaboradores` (6/6) |
| `gerente` | texto | 86,4 | 16 | `Archimedes Boff` · `Victor Rafael` · `Gerente Interino` | pessoa que gere a célula | `nome_exibicao->Users` (100% via `colaboradores`) |
| `nome` | texto | 100,0 | 20 | `Archimedes Boff` · `Zona Sul` · `Gerente Interino` | rótulo do registro (quase sempre = `gerente`) | `nome_exibicao->Users` (85%) |
| `obtd` | vazio | 0,0 | 0 | — | campo abandonado | não |
| `Creation Date` | data/hora en-US | 100,0 | 18 | `May 12, 2024 2:08 am` | criação | não |
| `Modified Date` | data/hora en-US | 100,0 | 19 | `Aug 12, 2026 3:32 pm` | modificação | não |
| `Slug` | vazio | 0,0 | 0 | — | nunca usado | não |
| `Creator` | texto | 100,0 | 2 | `Douglas Gomes` (20) · `(App admin)` (2) | criador | `nome_exibicao->Users` |
| `unique id` | unique id Bubble | 100,0 | 22 | `1715490526523x532612809930833900` | PK | não |

Distribuição completa de `diretor`: `Archimedes Boff` 6 · `Fabio Batista` 4 · _(vazio)_ 4 · `Mauricio Vieira` 3 ·
`Douglas Gomes` 2 · `Luis Hahn` 2 · `Leone Bampi` 1.

### 2.3 `Equipes` — 12 registros, 14 colunas

| coluna | tipo observado | preench. % | distintos | exemplos (truncados) | significado | referência |
|---|---|---|---|---|---|---|
| `corretores` | texto — lista com separador `" , "` | 100,0 | 12 | `Suane Tossi , Jorge Giorgi Gadret , Tayron dos Santos , …` | membros da equipe | `lista_nomes->corretors.Nome` / `Users.colaboradores` (264/264) |
| `Diretor` | texto | 100,0 | 4 | `Archimedes Boff` · `Fabio Batista` · `Mauricio Vieira` · `Gerente Interino` | diretor responsável | `nome_exibicao->gerentes.nome` (4/4) |
| `gerente` | texto | 100,0 | 12 | `Victor Rafael` · `Jose Portilho` · `Daiane Dias` | gerente da equipe | `nome_exibicao->gerentes.nome` (12/12) |
| `gerente_gerente` | texto | 100,0 | 12 | idem `gerente` | **duplicata exata de `gerente`** em 12/12 | `nome_exibicao->gerentes.nome` (12/12) |
| `meta` | vazio | 0,0 | 0 | — | nunca preenchido | não |
| `meta_equipe` | vazio | 0,0 | 0 | — | nunca preenchido | não |
| `nome` | texto | 100,0 | 12 | `Archimedes` · `Zona Sul` · `Susana ` (com espaço final) | nome da equipe; **chave natural** | não |
| `qtd_batd` | inteiro (texto) | 100,0 | 2 | `0` (10) · `13` (2) | vendas batidas acumuladas | não |
| `vgv_batd` | inteiro (texto) | 100,0 | 3 | `0` (10) · `226500` · `189000` | VGV batido acumulado | não |
| `Creation Date` | data/hora en-US | 100,0 | 10 | `May 11, 2024 6:18 pm` | criação | não |
| `Modified Date` | data/hora en-US | 100,0 | 7 | `Sep 8, 2026 4:37 pm` | modificação | não |
| `Slug` | vazio | 0,0 | 0 | — | nunca usado | não |
| `Creator` | texto | 100,0 | 1 | `Douglas Gomes` | criador | `nome_exibicao->Users` |
| `unique id` | unique id Bubble | 100,0 | 12 | `1715462324608x711409717943992300` | PK | não |

---

## (a) `corretors.user` — formato e cobertura

**Formato: nome de exibição.** Nenhum dos 294 valores preenchidos tem o padrão de unique id (0/294).

| fato | valor |
|---|---|
| linhas | 365 |
| `user` preenchido | 294 (80,5%) |
| `user` vazio | 71 |
| `user` idêntico a `Nome` | 293 |
| `user` preenchido **e diferente** de `Nome` | **1** — `Nome = "Lauren Carvalho"`, `user = "Lauren de Carvalho"` (ativo=sim, uid `…26129400`) |
| valores de `user` repetidos em ≥2 linhas | 5: `alexandre chaves`, `felipe di pompo`, `rafael ramires`, `veronica oliveira`, `lauren de carvalho` |
| `user` distintos | 289 — **289/289 (100%) existem em `Users.colaboradores`**; só 75/289 (26%) em `Users.Nome_completo` |

As 71 linhas com `user` vazio são um bloco homogêneo: 70 criadas por `(App admin)`, `ativo` vazio em 66 delas,
todas criadas entre `May 13, 2024 10:55 pm` e `May 21, 2024 10:57 am`, e apenas 4 aparecem em alguma equipe.
São lixo de uma carga inicial.

### corretors → Users (cascata de estratégias, aplicada em ordem)

| estratégia | linhas resolvidas |
|---|---|
| 1. `Nome` == `Users.Nome_completo` (normalizado) | 82 |
| 2. `Nome` == `Users.colaboradores` | 220 |
| 3. `Nome` == `Users.corretor` | 0 (coluna só tem 11 valores, todos já cobertos) |
| 4. tokens do nome curto ⊆ tokens de **um único** `Users.Nome_completo` | 7 |
| 5. tokens batem em **vários** Users (ambíguo) | **0** |
| 6. nenhum Users compatível | **56** |
| **total** | **365** |

Ou seja: **302 linhas (82,7%) resolvem por igualdade exata de nome** (colaboradores ou nome completo),
mapeando para **290 Users distintos**; 7 exigem match por tokens (sem ambiguidade); **56 são órfãs**.

### Os 56 corretors sem User — lista completa

Todos criados por `(App admin)`, com `user` vazio, `ativo` vazio ou `não`, e **nenhum** em qualquer equipe.
53 deles no mesmo minuto: `May 13, 2024 11:56 am`.

`Alessandro Bueno` · `Ana Paula Souza Machado` · `Anderson Aguiar` · `Angelo Goncalves Nunes` ·
`Ana Tielle dos Santos Dinate` · `Antonio Edson Leon de Oliveira` · `Calebe Goncalves de Oliveira` ·
`Augusto Santanna` · `Bruno Rocha Dias` · `Claudinei Soares Domingues` · `Douglas Santos de Oliveira` ·
`Dyonatan` · `Fabricio da Silva Geremias` · `Fabiano Gomes Pereira` · `Elisadora Cunha da Rosa` ·
`Felipe Galisteo` · `Fabiano da Silva Geremias` · `Felipe Lopes` · `Fernando Baumi` · `Filipe Erbe` ·
`Jose Junior de Carvalho` · `Flavia Regina Freitas de Souza` · `Geise Estreito Souza` ·
`Henrique de Vargas Pacheco` · `Joao Adriano Esteves Rochedo` · `Jonata de Freitas Delfino` ·
`Jessica Fontela da Silva` · `Graziela Roza da Silva` · `Jose Neres da Silva Junior` · `Juan Dias Mendes` ·
`Lucas Lima` · `Larissa Macedo` · `Khauane da Silva Santos` · `Marco Aurelio da Silva` ·
`Matheus Espindola de Souza` · `Luiz Borges` · `Paola Daunaimer` · `Paulo Roberto Antunes de Freitas` ·
`Thais Dutra Machado` · `Rafael da Silva Porto` · `Peterson Renato Silva da Silva` · `Rodrigo Espindola` ·
`Rejane Quintana` · `Tiago Ivandrey Rocha da Silva` · `Vera Regina Santos de Freitas e Souza` ·
`Vinicios Alvarenga Boeira` · `Vera Lucia dos Santos` · `Zilvia Boesche` · **`Prime Imob`** · **`Melo Imob`** ·
`CAROL` · `Juca Echer` · `Bianca cunha` · **`Imob Prime`** · **`IMOB Prime`** · `RAFAEL DA SILVA PORTO`

(os cinco em negrito não são pessoa física — são imobiliárias parceiras cadastradas como corretor)

### Users sem ficha de corretor: **8**

Nenhum é `Funcao = CORRETOR` (os 275 Users `CORRETOR` têm 100% de correspondência em `corretors`):

| `colaboradores` | Funcao | Ativo |
|---|---|---|
| `JR` | _(vazio)_ | não |
| `Cintia almeida` | CCA | não |
| `Inajara Gaspar` | CCA | sim |
| `Thayse Oliveira` | CCA | sim |
| `Joice Milchareck` | CCA | não |
| `Olavio Dal Magro` | SÓCIO | sim |
| `Selmira Tia` | SERVICOS GERAIS | sim |
| `Gerente Interino` | GERENTE | sim |

### Por que 365 corretors × 298 Users

| parcela | linhas |
|---|---|
| linhas em `corretors` | **365** |
| − linhas excedentes por nome duplicado dentro de `corretors` (12 nomes com 2–3 linhas) | −13 |
| − linhas órfãs do lote `(App admin)` de mai/2024, sem User, sem equipe | −56 |
| = linhas úteis, com User e nome único | **296** |
| Users distintos alcançados por essas linhas | **290** |
| Users totais | **298** = 290 com ficha de corretor + 8 sem (CCA, sócio, serviços gerais, gerente interino) |
| composição de Users por função | CORRETOR 275 · GERENTE 8 · DIRETOR 5 · CCA 5 · SÓCIO 2 · ADM 1 · SERVICOS GERAIS 1 · vazio 1 |

Resumo em uma frase: **`corretors` é maior que `Users` porque acumula 13 duplicatas e 56 fichas de um import
legado que nunca virou usuário; `Users` tem 8 pessoas que nunca foram corretoras.** Não é histórico de
demissão — desligado continua com ficha nos dois lados (`corretors.ativo=não` 209 × `Users.Ativo=não` 204,
e no cruzamento dos 82 casos de nome completo idêntico a concordância é 55 `não/não` + 21 `sim/sim`,
6 divergentes apenas onde `corretors.ativo` está vazio).

### Duplicatas dentro de `corretors` (12 nomes, 13 linhas excedentes)

| nome | linhas | sufixo dos unique ids | `ativo` de cada |
|---|---|---|---|
| `Felipe di Pompo` | 3 | `…592830`, `…986900`, `…927400` | não, não, não |
| `Alexandre Chaves` | 2 | `…368400`, `…985000` | sim, não |
| `Rafael Ramires` | 2 | `…406000`, `…662100` | sim, não |
| `Roberto Cauduro` | 2 | `…342530`, `…549140` | não, _(vazio)_ |
| `Tamara Correa` | 2 | `…788400`, `…486500` | não, _(vazio)_ |
| `Alice Alves` | 2 | `…012500`, `…754800` | sim, _(vazio)_ |
| `Veronica Oliveira` | 2 | `…556800`, `…853200` | sim, sim |
| `Fernando Santos` | 2 | `…185300`, `…682800` | _(vazio)_, sim |
| `Kevyn Bueno` | 2 | `…338200`, `…928000` | _(vazio)_, não |
| `Rafael da Silva Porto` | 2 | `…322050`, `…870240` | _(vazio)_, _(vazio)_ |
| `Imob Prime` | 2 | `…988000`, `…847000` | _(vazio)_, _(vazio)_ |
| `Juliana Torres da Silva` | 2 | `…981700`, `…183200` | não, não |

Regra de deduplicação sugerida: manter a linha com `ativo='sim'`; havendo empate, a de `Modified Date` maior.

---

## (b) `Equipes.corretores` — a lista de nomes

- Separador confirmado: `" , "` (espaço-vírgula-espaço).
- **264 nomes** extraídos no total (com repetição).
- **264 nomes distintos** (normalizados) → **0 nomes aparecem em mais de uma equipe**. A alocação é exclusiva.
- **198 nomes (75%) não batem com `Users.Nome_completo`** por igualdade exata.
- Mas **264/264 (100%) batem com `Users.colaboradores`** e **264/264 (100%) com `corretors.Nome`**;
  cada um resolve para **exatamente 1 User** (nenhuma ambiguidade).

Ambiguidade do separador — verificação executada:

| checagem | resultado |
|---|---|
| itens contendo `,` depois do split | **0** — nenhum nome tem vírgula neste export, o separador foi seguro |
| itens com mais de 5 tokens (suspeita de fusão de dois nomes) | 1 — `Luiza Eduarda Da Fonseca Da Silva`, que é um nome real de Users |
| itens com espaço duplo ou sobra de espaço | 0 após `strip` (o original traz `Andrielle Ynae Silva da Silva ` com espaço final, normalizado no parse) |

Cobertura cruzada:

- corretors que **não** aparecem em nenhuma equipe: **94** de 365 (só 2 com `ativo=sim`: `Douglas Gomes` e `Lauren Carvalho`).
- corretors que aparecem em alguma equipe: **271 linhas** → 264 nomes distintos (a diferença são as duplicatas).

### `Users.equipe` é a mesma alocação, e está mais completa

`Users.equipe` aponta para `Equipes.nome` (12/12) e cobre 267 pessoas contra 264 na lista de `Equipes.corretores`:

| equipe | em `Equipes.corretores` | em `Users.equipe` | delta |
|---|---|---|---|
| `Archimedes` | 21 | 22 | +1 |
| `Zona Sul` | 30 | 30 | 0 |
| `Mauricio` | 20 | 20 | 0 |
| `Jose Portilho` | 44 | 45 | +1 |
| `Faceimob` | 1 | 2 | +1 |
| `Susana ` | 14 | 14 | 0 |
| `Victor` | 53 | 53 | 0 |
| `Veronica` | 1 | 1 | 0 |
| `Alisson` | 24 | 24 | 0 |
| `Alexandre` | 10 | 10 | 0 |
| `Daiane Dias` | 15 | 15 | 0 |
| `Leonardo` | 31 | 31 | 0 |
| **total** | **264** | **267** | **+3** |

Users com `equipe` vazia: 31. Os 10 Users alocados a uma equipe cujo nome não aparece na lista daquela equipe
(match por tokens) são majoritariamente gente desligada ou de apelido divergente:

| Users.Nome_completo | equipe | Funcao | Ativo |
|---|---|---|---|
| `Junior Sildo Rezende` | Jose Portilho | DIRETOR | não |
| `Felipe Nazareno Guzzatto di Pompo` | Archimedes | CORRETOR | não |
| `Antônio Carlos Martins Gaia` | Mauricio | CORRETOR | não |
| `Gerente Interino` | Faceimob | GERENTE | sim |
| `Allan Freitas da Silva` | Victor | CORRETOR | não |
| `Isabel Cristina Sperandio Pompeu` | Jose Portilho | CORRETOR | não |
| `IGOR RAPHAEL JAQUES PIRES` | Victor | CORRETOR | não |
| `Treicyanne Ribeiro Mendonca` | Victor | CORRETOR | não |
| `Lindomar Amaral Alves` | Leonardo | CORRETOR | não |
| `Ariovaldo Rochenback de Quadros` | Victor | CORRETOR | sim |

(esses 10 casos são justamente os que têm apelido sem relação com o nome civil — ver "problemas de qualidade")

**Recomendação:** importar `team_members` a partir de `Users.equipe`, usando `Equipes.corretores` só como
conferência. `Users.equipe` é 1 valor por pessoa (impossível duplicar), cobre 3 pessoas a mais e dispensa
o split ambíguo.

---

## (c) `Diretor` × `gerente` × `gerente_gerente` em `Equipes`

| comparação | linhas (de 12) |
|---|---|
| `gerente` == `gerente_gerente` | **12** (100%) |
| `Diretor` == `gerente` | 4 |
| `Diretor` == `gerente_gerente` | 4 |
| os três iguais | 4 |
| `gerente` diferente de `Diretor` | 8 |

Semântica:

- **`Diretor`** — o topo da hierarquia. Só 4 valores: `Archimedes Boff` (4 equipes), `Fabio Batista` (4),
  `Mauricio Vieira` (3), `Gerente Interino` (1, que é um *placeholder*, não pessoa).
- **`gerente`** — quem toca a equipe no dia a dia. 12 valores, um por equipe (relação 1:1 com a equipe).
  Nas 4 equipes em que o próprio diretor é o gerente (`Archimedes`, `Zona Sul`, `Mauricio`, `Faceimob`),
  `Diretor == gerente`.
- **`gerente_gerente`** — pelo nome deveria ser "o gerente do gerente" (o nível acima). **Não é**: é cópia
  idêntica de `gerente` nas 12 linhas, com os mesmos 12 valores distintos e a mesma distribuição.
  É um campo abandonado do Bubble; ignore na importação. Se ele funcionasse, deveria conter os mesmos
  valores de `Diretor` — e não contém em 8 das 12 linhas.

Distribuições completas:

| `Diretor` | n | | `gerente` e `gerente_gerente` (idênticos) | n |
|---|---|---|---|---|
| `Archimedes Boff` | 4 | | `Archimedes Boff` · `Fabio Batista` · `Mauricio Vieira` · `Jose Portilho` · `Gerente Interino` · `Susana Cristina Prates` · `Victor Rafael` · `Veronica Oliveira` · `Alisson Luiz` · `Alexandre Chaves` · `Daiane Dias` · `Leonardo Vallier` | 1 cada |
| `Fabio Batista` | 4 | | | |
| `Mauricio Vieira` | 3 | | | |
| `Gerente Interino` | 1 | | | |

---

## (d) As 12 equipes

| # | equipe | Diretor | gerente | gerente_gerente | membros | qtd_batd | vgv_batd | criada | modificada | unique id (final) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `Archimedes` | Archimedes Boff | Archimedes Boff | Archimedes Boff | 21 | 0 | 0 | 2024-05-11 18:18 | 2026-09-01 01:17 | `…43992300` |
| 2 | `Zona Sul` | Fabio Batista | Fabio Batista | Fabio Batista | 30 | 0 | 0 | 2024-05-11 18:18 | 2026-09-01 01:17 | `…64442900` |
| 3 | `Mauricio` | Mauricio Vieira | Mauricio Vieira | Mauricio Vieira | 20 | 0 | 0 | 2024-05-11 18:19 | 2026-09-05 11:08 | `…38260500` |
| 4 | `Jose Portilho` | **Archimedes Boff** | Jose Portilho | Jose Portilho | 44 | 0 | 0 | 2024-05-11 18:19 | 2026-09-04 17:41 | `…12598500` |
| 5 | `Faceimob` | Gerente Interino | Gerente Interino | Gerente Interino | 1 | 0 | 0 | 2024-05-14 23:25 | 2026-06-01 01:15 | `…44082200` |
| 6 | `Susana ` (espaço final) | **Archimedes Boff** | Susana Cristina Prates | Susana Cristina Prates | 14 | 0 | 0 | 2025-03-19 20:30 | 2026-09-01 20:19 | `…64688900` |
| 7 | `Victor` | **Fabio Batista** | Victor Rafael | Victor Rafael | 53 | 13 | 226.500 | 2025-03-19 21:07 | 2026-09-08 16:37 | `…59702800` |
| 8 | `Veronica` | **Fabio Batista** | Veronica Oliveira | Veronica Oliveira | 1 | 0 | 0 | 2025-03-19 21:16 | 2026-09-01 01:17 | `…35015420` |
| 9 | `Alisson` | **Mauricio Vieira** | Alisson Luiz | Alisson Luiz | 24 | 0 | 0 | 2025-03-19 21:23 | 2026-09-01 01:17 | `…19716860` |
| 10 | `Alexandre` | **Archimedes Boff** | Alexandre Chaves | Alexandre Chaves | 10 | 0 | 0 | 2025-10-03 14:11 | 2026-07-14 17:38 | `…30074900` |
| 11 | `Daiane Dias` | **Fabio Batista** | Daiane Dias | Daiane Dias | 15 | 13 | 189.000 | 2026-01-08 22:16 | 2026-09-08 16:37 | `…78070800` |
| 12 | `Leonardo` | **Mauricio Vieira** | Leonardo Vallier | Leonardo Vallier | 31 | 0 | 0 | 2026-02-05 21:36 | 2026-09-05 11:08 | `…63027460` |

`meta` e `meta_equipe` estão vazias nas 12 linhas (as metas moram em `export_All-meta-equipes-modified…csv`,
fora deste grupo). `qtd_batd`/`vgv_batd` só têm valor em 2 equipes — contadores parciais, não histórico.

### Composição nominal (nomes exatamente como estão no CSV)

- **Archimedes** (21): Suane Tossi; Jorge Giorgi Gadret; Tayron dos Santos; Kelly Carnelutti; Rute Machado; Kamila Mendes; Leandro Augusto Dutra; Daiane Jardim de Cristo; Janaina Fraga; Jenifer Silva; Archimedes Boff; Danielle Moraes; Rafael Ramires; Tabhata Nobre; Kevyn Bueno; Alexandre Chaves; Ezequyel Correa; Marco Antonio; Marcelo Oliveira; Ryan da Rosa; Fernando Santos
- **Zona Sul** (30): Claudia Ribeiro; Elaine Jaqueline Ferroni Gomes Wojahn; Jessica Soares; Iury Ferreira Lopes; Nathan Tomazini; Maria Luiza Viana; Anderson Nascimento; Andrielle Ynae Silva da Silva; Lucas Telles; Samuel Pereira Machado; Patricia Telles Bitdinger; Ryan Vieira; Antonio Luis Pinheiro dos Santos; Caetano Dias; Bernardo dos Santos; Henrique Farias; Wagner Carvalho Batista; Maria Viana; Keisy Antunes; Sonia Castro; Murillo de Zorzi; Isadora Carvalho; Fabio Batista; Caroline dos Santos Silva; Lucas de Camargo; Debora Machado; Caroline Menezes; Jessica Mello; Veronica Oliveira; Valmir Batistella
- **Mauricio** (20): Juliana Torres da Silva; Withynei Santos; Antonia Silveira Portilho; Rafael Camargo; Jader Fraga da Silva; Guilherme Dallmann; Gabrielle de Souza; Jediael Britto; Henrique Martins; Rafael Moiano dos Santos; Barbara Pietra Simas Rosa; Marcelo Vergara; Aurea Barcelos; Caroline Vergara; Silvana Carvalho; Patricia Cardoso; Mauricio Vieira; Marcio Guedes; Fernando Saldanha; Suzana Marcon
- **Jose Portilho** (44): Adriana da Cunha; Cinara Pacheco; Nancy Kuhn; Cezar Luiz Pereira; Janaina Ferreira; Luiza Eduarda Da Fonseca Da Silva; Mariana Costa Barth; Amanda Vívian De Vargas; Caroline da Silva Mendes; Edson Santos Mendes; Josiane Cieplak da Silva; Grazielly Adriana dos Santos; Tainá Volland; Bruna Avila Pereira; Gustavo Bernardo; Cristiane Jabor; Aline Candido; Maribel Maciejewski; Joao Victor Ferreira; Roberto Mendes; Fabiana Souza; Everton Ribeiro; Maria Aparecida Ribeiro; Carlos Antonio; Simone Morales; Jose Portilho; Cris Sperandio; Andre Felipe; Jackeline Merelis; Andrea Cardoso; Mario Junior; Jocilmar Portilho; Gabriel Garcias; Isaías Luca; Patricia Marques; Felipe Hernandez; Luis Henryque; Nathalie Fagundes; Kaua Marques; Isaias Lucca; Jose Teixeira; Carla Roberta Carvalho; Winnie Scapim; Anelise Rodrigues
- **Faceimob** (1): Parceiro Externo
- **Susana ** (14): Ingrid Soares Morais; Paulo Reis; Ellenice Polanczyk; Jenifer Carvalho; Mara Goncalves; Mateus Antunes Martins; Breno Telles Giorgi; Rudinei Teixeira De Souza; Susana Cristina Prates; Kathila Aguiar; Ian Fioravanti; Alessandra Godoy; Fernanda Cardoso Teixeira; Eva Lopes
- **Victor** (53): Cassiele Reis; Laylon Pereira; Marluce Reis; Tiellen Cunha; Pablo Dutra; Iury Magalhaes; Tenilly Brandao; Hygor Luis; Rogerio Bonato; Sergio Filho; Matheus Scherer; Pietro Silveira; Leandro Alves; Richard Lindgren; Allan Izaque; Ariely Vargas; Julia Rezende; Igor JP; Erick Arruda; Julio Ouriques; Fabiano Silva; Felipe Morais; Gabriel Dutra; Pedro Longaray; Victor Rafael; Leonardo Borges; Ana Ribeiro; Emilly Guedes; Luana Baumhardt; Nathalia Sito; Marcelo Pfeiffer; Alessandro Saraiva; Nathan Bittencourt; Emili Torres; Anne Mendonca; Tierry Gomes; Alyce Medeiros; Bianca Oliveira; Eduarda Neto; Naiara Domingos; Isabele Pereira; Andriel Netto; Bruno Bittencourt; Monique Assis; Victor Pereira; Angela Silveira; Moacir Carvalho; Cristiane Gregorio; Camila Santos; Anderson Oliveira; Ari Quadros; Adriel Dias; Lauren de Carvalho
- **Veronica** (1): Manuela Luz
- **Alisson** (24): Stefane Santos; Anderson Prestes; Eduardo Ferreira; Fabiano Vieira; Moises Martins da Rosa; Marina Lima; Leandro Pires; Angelita Aparecida; Alisson Luiz; Artur Bomfim; Everton Silva; Paulo Silveira; Keila Goncalves; Caroline Fonseca; Jaqueline Ferroni; Pedro Vidaletti; Joao Leal; Tiago da Rosa; Larissa Freitas; Francisco Bomfim; Valdoir Lopes; Agnes Soraire; Franciely Santos; Aline Carvalho
- **Alexandre** (10): Silvio Reis; Nubia Nascimento; Edmilson Stadelhofer; Ingrid Souza; Larissa Araujo; Vilenda Louis; Gustavo Teixeira; Kaua Flores; Henry Krug; Jaderson Santos
- **Daiane Dias** (15): Daiane Dias; Cristina Mendes; Alan de Oliveira; Keoma Peres Domingues; Emanuel Silva; Rafael Mello; Josiane Lima; Thales Souza; Daiane Fagundes; Julia Rocha; Tiene Ferreira; Kayteane Botelho Araujo; Janaina de Campos; Sabrina Menezes; Larissa Ortiz
- **Leonardo** (31): Leonardo Vallier; Taua Pinheiro; Andre Hunter; Nino Alves; Pedro Dias; Lucas Barbosa; Anne Markus; Junior Moraes; Ariane Boelter; Kelvin Castro; Rodrigo Risso; Felipe Dal Conte; Luiz Toledo; Jeferson klatt; Leticia Tavares; Jose Alves; Paulo Oliveira; Vitor Saldanha; Rogerio So; Luis Vasconcelos; Andryelle Santos; Fabio Barbosa; Solange Pacheco; Carlos Rodrigues; Jackson da Silva; Eduarda Silva; Matheus Rosa; Ketlen Garcia; Leanderson Vargas; Igor Avila; Alice Alves

Observação: o gerente aparece **dentro** da própria lista de corretores em 10 das 12 equipes
(`Archimedes Boff` em Archimedes, `Fabio Batista` em Zona Sul, `Victor Rafael` em Victor etc.).
Ou seja, gerente é também corretor da própria equipe — o que casa com o invariante do schema alvo de
papéis N:N em `user_roles`.

---

## (e) `gerentes` — o que a tabela realmente modela

| comparação | linhas (de 22) |
|---|---|
| `nome` == `gerente` | 18 |
| `nome` == `diretor` | 6 |
| os três iguais (`nome` == `gerente` == `diretor`) | **6** |
| `diretor` vazio | 4 |
| `gerente` vazio | 3 |
| `nome` vazio | 0 |

**A tabela modela a célula/cargo de gerência, não a pessoa.** Cada linha é "existe uma gerência chamada X,
que responde ao diretor Y". Quando a pessoa é diretora, ela ganha uma linha com `diretor` = ela mesma
(auto-referência), o que produz os 6 casos de "três iguais". Onde `nome != gerente` são registros
degenerados: rótulo de área sem gerente (`Zona Sul`), pessoa sem link (`Paulo Rodrigues`, `Parceiro`) ou
rótulo apelidado (`Douglas` com `gerente = Gerente Interino`).

### Tabela completa

| # | nome | gerente | diretor | ativo | criado | modificado | existe em corretors? | existe em Users.Nome_completo? |
|---|---|---|---|---|---|---|---|---|
| 1 | Archimedes Boff | Archimedes Boff | Archimedes Boff | sim | 2024-05-12 02:08 | 2025-05-11 23:41 | sim | não (é `Antonio Archimedes Boff`) |
| 2 | Leone Bampi | Leone Bampi | Leone Bampi | não | 2024-05-12 02:08 | 2025-03-20 01:50 | sim | sim |
| 3 | Mauricio Vieira | Mauricio Vieira | Mauricio Vieira | sim | 2024-05-12 02:08 | 2025-03-19 21:22 | sim | não |
| 4 | Junior Rezende | Junior Rezende | Archimedes Boff | não | 2024-05-12 02:08 | 2026-01-09 23:44 | sim | não |
| 5 | Fabio Batista | Fabio Batista | Fabio Batista | sim | 2024-05-12 02:08 | 2025-05-11 23:37 | sim | não |
| 6 | **Zona Sul** | _(vazio)_ | _(vazio)_ | não | 2024-05-12 02:13 | 2024-12-21 00:03 | não | não |
| 7 | Gerente Interino | Gerente Interino | _(vazio)_ | não | 2024-05-12 02:14 | 2026-08-05 12:33 | não | sim |
| 8 | **Paulo Rodrigues** | _(vazio)_ | _(vazio)_ | não | 2024-05-13 12:20 | 2024-12-20 23:49 | sim | não |
| 9 | **Parceiro** | _(vazio)_ | _(vazio)_ | _(vazio)_ | 2024-05-13 17:22 | 2024-05-13 17:22 | não | não |
| 10 | **Douglas** | Gerente Interino | Douglas Gomes | _(vazio)_ | 2024-05-16 21:57 | 2025-06-27 23:41 | não | não |
| 11 | Gerente Interino *(dup)* | Gerente Interino | Douglas Gomes | _(vazio)_ | 2024-11-01 11:15 | 2025-06-27 23:41 | não | sim |
| 12 | Felipe di Pompo | Felipe di Pompo | Archimedes Boff | não | 2025-03-19 19:42 | 2025-12-17 13:57 | sim | não |
| 13 | Susana Cristina Prates | Susana Cristina Prates | Archimedes Boff | sim | 2025-03-19 20:30 | 2025-03-19 20:30 | sim | sim |
| 14 | Victor Rafael | Victor Rafael | Fabio Batista | sim | 2025-03-19 21:07 | 2025-03-19 21:07 | sim | não |
| 15 | Veronica Oliveira | Veronica Oliveira | Fabio Batista | sim | 2025-03-19 21:16 | 2026-08-12 15:32 | sim | não |
| 16 | Alisson Luiz | Alisson Luiz | Mauricio Vieira | sim | 2025-03-19 21:22 | 2025-03-19 21:22 | sim | não |
| 17 | Luis Hahn | Luis Hahn | Luis Hahn | não | 2025-05-26 13:32 | 2025-10-10 21:56 | sim | não |
| 18 | Luis Hahn *(dup)* | Luis Hahn | Luis Hahn | não | 2025-06-07 14:18 | 2026-08-05 12:32 | sim | não |
| 19 | Alexandre Chaves | Alexandre Chaves | Archimedes Boff | não | 2025-10-03 14:10 | 2026-08-05 12:32 | sim | não |
| 20 | Jose Portilho | Jose Portilho | Archimedes Boff | sim | 2026-01-07 14:17 | 2026-01-07 14:17 | sim | não |
| 21 | Daiane Dias | Daiane Dias | Fabio Batista | sim | 2026-01-08 22:02 | 2026-01-08 22:02 | sim | não |
| 22 | Leonardo Vallier | Leonardo Vallier | Mauricio Vieira | sim | 2026-02-05 21:32 | 2026-02-05 21:32 | sim | não |

Classificação das 22 linhas:

| natureza | n | quais |
|---|---|---|
| gerente de equipe vigente (aparece em `Equipes.gerente`) | 8 | Susana Cristina Prates, Victor Rafael, Veronica Oliveira, Alisson Luiz, Alexandre Chaves, Jose Portilho, Daiane Dias, Leonardo Vallier |
| diretor que também gere uma equipe | 5 | Archimedes Boff, Mauricio Vieira, Fabio Batista, Gerente Interino ×2 |
| gerente histórico (não consta em equipe atual) | 6 | Leone Bampi, Junior Rezende, Douglas, Felipe di Pompo, Luis Hahn ×2 |
| registro órfão (`gerente` e `diretor` vazios) | 3 | Zona Sul, Paulo Rodrigues, Parceiro |

Notas de integridade: `nome` duplicado em `Gerente Interino` (×2) e `Luis Hahn` (×2).
`gerentes.diretor` referencia `gerentes.nome` em 5 dos 6 valores; a exceção é `Douglas Gomes`, que existe
como `Users.colaboradores`/`Users.Nome_completo` mas cuja linha em `gerentes` se chama só `Douglas`.

---

## (f) A árvore diretor → gerente → corretor

### Reconstrução a partir de `Equipes`

```
Archimedes Boff (diretor)
├── Archimedes Boff        → equipe "Archimedes"      21 corretores
├── Jose Portilho          → equipe "Jose Portilho"   44 corretores
├── Susana Cristina Prates → equipe "Susana "         14 corretores
└── Alexandre Chaves       → equipe "Alexandre"       10 corretores

Fabio Batista (diretor)
├── Fabio Batista          → equipe "Zona Sul"        30 corretores
├── Victor Rafael          → equipe "Victor"          53 corretores
├── Daiane Dias            → equipe "Daiane Dias"     15 corretores
└── Veronica Oliveira      → equipe "Veronica"         1 corretor

Mauricio Vieira (diretor)
├── Mauricio Vieira        → equipe "Mauricio"        20 corretores
├── Alisson Luiz           → equipe "Alisson"         24 corretores
└── Leonardo Vallier       → equipe "Leonardo"        31 corretores

Gerente Interino (placeholder, não é pessoa)
└── Gerente Interino       → equipe "Faceimob"         1 (Parceiro Externo)
```

### Quantos níveis reais

**Três**, e apenas três:

1. **Diretor** — 4 valores distintos em `Equipes.Diretor`, sendo 3 pessoas reais (`Archimedes Boff`,
   `Fabio Batista`, `Mauricio Vieira`) + 1 placeholder (`Gerente Interino`).
2. **Gerente** — 12 valores distintos, 1 por equipe. Destes, **8 não são diretores**
   (Alexandre Chaves, Alisson Luiz, Daiane Dias, Jose Portilho, Leonardo Vallier, Susana Cristina Prates,
   Veronica Oliveira, Victor Rafael); os outros 4 são o próprio diretor acumulando a gerência.
3. **Corretor** — 264 nomes distintos alocados.

Não há 4º nível:

- `gerente_gerente` é idêntico a `gerente` em 12/12 → não introduz nível nenhum.
- A cadeia `gerentes.nome → gerentes.diretor` tem **profundidade máxima 2** (todas as 12 cadeias válidas
  são `gerente → diretor` e param aí; nenhum diretor tem diretor acima, exceto as auto-referências,
  que são ciclos de tamanho 1 e foram tratadas como raiz).
- Acima dos diretores só existe `Douglas Gomes` (`Funcao = ADM`), que aparece como `gerentes.diretor` de
  duas linhas degeneradas (`Douglas` e `Gerente Interino`), não de nenhuma equipe. É o dono/admin do sistema.

### Visão paralela em `Users` (confirma a mesma árvore)

| `Users.diretor` | n | | `Users.gerencia` | n |
|---|---|---|---|---|
| _(vazio)_ | 81 | | Victor Rafael | 53 |
| Fabio Batista | 77 | | Leonardo Vallier | 31 |
| Archimedes Boff | 71 | | Fabio Batista | 30 |
| Mauricio Vieira | 61 | | Alisson Luiz | 24 |
| Junior Rezende | 6 | | Jose Portilho | 23 |
| Luis Hahn | 2 | | Archimedes Boff | 22 |
| | | | Junior Rezende | 22 |
| | | | Mauricio Vieira | 20 |
| | | | Daiane Dias | 15 |
| | | | Susana Cristina Prates | 14 |
| | | | _(vazio)_ | 13 |
| | | | Felipe di Pompo | 10 |
| | | | Alexandre Chaves | 10 |
| | | | Leone Bampi | 8 |
| | | | Gerente Interino · Veronica Oliveira · Kathila Aguiar | 1 cada |

`Users.gerencia` guarda **histórico**: inclui gerentes que já não têm equipe (`Junior Rezende` 22,
`Felipe di Pompo` 10, `Leone Bampi` 8) e uma pessoa que nunca foi gerente (`Kathila Aguiar`, 1).
`Users.gerente` está preenchido em apenas 11/298 — é campo abandonado, ignore.

---

## Problemas de qualidade encontrados

1. **Nenhuma coluna de relacionamento traz unique id.** Tudo é nome de exibição. Uma pessoa renomeada no
   Bubble quebrou (ou quebraria) todos os vínculos retroativamente. Não há como validar as ligações contra
   uma PK — a importação depende inteiramente de casamento por nome.
2. **O nome exibido é o apelido (`Users.colaboradores`), não `Nome_completo`.** Quem juntar por
   `Nome_completo` acerta só 82 de 365 corretors e 66 de 264 membros de equipe.
3. **11 Users têm apelido sem relação com o nome civil** — indício de ficha reciclada ou apelido pessoal.
   Casos: `Henrique Martins` ↔ `Antônio Carlos Martins Gaia`; `Allan Izaque` ↔ `Allan Freitas da Silva`;
   `Cris Sperandio` ↔ `Isabel Cristina Sperandio Pompeu`; `Igor JP` ↔ `IGOR RAPHAEL JAQUES PIRES`;
   `Anne Mendonca` ↔ `Treicyanne Ribeiro Mendonca`; `Nino Alves` ↔ `Lindomar Amaral Alves`;
   `Ari Quadros` ↔ `Ariovaldo Rochenback de Quadros`; `Amanda Vívian De Vargas` ↔ `Amanda Vargas`;
   `JR` ↔ `sjr`; `Vilenda Louis` ↔ **`Nome_completo` vazio**; `Paola Fortes Pereira` ↔ `Paola Fortes Pereira'`
   (apóstrofo espúrio). Esses são exatamente os que não casam por token e exigem revisão manual.
4. **13 linhas duplicadas em `corretors`** (12 nomes), com `ativo` divergente entre as cópias em 6 dos casos.
5. **56 fichas de corretor órfãs** criadas por `(App admin)` em 13/05/2024, sem User, sem equipe, sem flag
   de atividade — carga legada abandonada. Inclui 5 registros que são imobiliárias, não pessoas
   (`Prime Imob`, `Melo Imob`, `Imob Prime`, `IMOB Prime`, e `Parceiro Externo` na equipe Faceimob).
6. **Colisões só por caixa/acento**: `Imob Prime`/`IMOB Prime`, `Rafael da Silva Porto`/`RAFAEL DA SILVA PORTO`,
   `Isaías Luca`/`Isaias Lucca` (duas fichas da mesma pessoa em `Jose Portilho`, grafias diferentes).
   Qualquer deduplicação precisa normalizar acento e caixa.
7. **Espaços à direita não aparados** — `Equipes.nome = "Susana "`, `Users.Nome_completo` com espaço final
   em 9 linhas, `corretors.Nome` em 3. Faça `trim` antes de qualquer comparação ou geração de slug.
8. **`gerente_gerente` é campo morto** (cópia de `gerente` em 12/12) e prometeria um nível que não existe.
9. **Campos zerados/vazios que parecem métrica**: `corretors.vendas_mes` e `VGV_mes` são `0` nas 365 linhas;
   `Equipes.meta` e `meta_equipe` vazias nas 12; `gerentes.obtd` vazio nas 22; `Slug` vazio nos três arquivos.
   Não há nada a importar deles.
10. **`gerentes` tem 2 nomes duplicados** (`Gerente Interino`, `Luis Hahn`) e 3 linhas órfãs
    (`Zona Sul`, `Paulo Rodrigues`, `Parceiro`) que não representam gerência alguma.
11. **`Users.equipe` e `Equipes.corretores` divergem em 3 pessoas** (267 × 264) e há 10 Users cuja alocação
    não se reflete na lista da equipe. Duas fontes para o mesmo fato, sem uma ser autoritativa no Bubble.
12. **Fuso horário não declarado** nas datas. Suposição adotada: `America/Sao_Paulo`.
13. `Equipes.Diretor` contém `Gerente Interino`, que não é pessoa — a equipe `Faceimob` é um contêiner de
    parceiro externo, não uma equipe comercial.

---

## Relacionamentos (resumo para o mapeamento)

| origem | destino | formato | cobertura |
|---|---|---|---|
| `corretors.user` | `Users` | nome de exibição = `Users.colaboradores` | 289/289 distintos (100%); 294/365 linhas preenchidas |
| `corretors.Nome` | `Users` | nome de exibição = `Users.colaboradores` | 290/352 distintos; 302/365 linhas por igualdade exata |
| `Equipes.corretores[]` | `corretors.Nome` e `Users.colaboradores` | lista, separador `" , "` | 264/264 (100%) nos dois |
| `Equipes.Diretor` | `gerentes.nome` | nome de exibição | 4/4 (100%) |
| `Equipes.gerente` | `gerentes.nome` | nome de exibição | 12/12 (100%) |
| `Equipes.gerente_gerente` | `gerentes.nome` | nome de exibição — **redundante com `gerente`** | 12/12 (100%) |
| `gerentes.gerente` | `Users.colaboradores` | nome de exibição | 16/16 (100%) |
| `gerentes.diretor` | `gerentes.nome` | nome de exibição | 5/6 (falha em `Douglas Gomes`) |
| `Users.equipe` | `Equipes.nome` | nome da equipe | 12/12 (100%), 267 pessoas |
| `Users.gerencia` | `gerentes.nome` / `Users.colaboradores` | nome de exibição | 15/16 e 16/16 |
| `Users.diretor` | `gerentes.nome` | nome de exibição | 5/5 (100%) |
| `Creator` (3 arquivos) | `Users` | nome de exibição; valores `Douglas Gomes` e `(App admin)` | — |

Chave natural por tabela: `corretors` → `Nome` normalizado (com 12 colisões a resolver);
`gerentes` → `nome` normalizado (2 colisões); `Equipes` → `nome` normalizado (0 colisões).
`unique id` existe nas três e é único, mas **nenhuma outra tabela o referencia** — serve só como
identificador de origem/rastreabilidade na importação.

---

## Volume que vale a pena importar

| tabela | linhas no CSV | recomendado importar | motivo |
|---|---|---|---|
| `Equipes` | 12 | **11** (ou 12) | todas são equipes reais; `Faceimob` é contêiner de parceiro externo — decida se vira `team` ou some |
| `gerentes` | 22 | **13** distintas | 8 gerentes vigentes + 3 diretores reais + `Gerente Interino` (1, deduplicado) + `Douglas Gomes` como admin. Descarte: 3 órfãs, 6 históricas sem equipe, 2 duplicatas |
| `corretors` | 365 | **271 linhas → 264 pessoas** para `team_members`; **290 pessoas** para `profiles` | 271 estão em equipe; 302 resolvem para User; 56 são lixo de import sem User e sem equipe; 13 são duplicatas |

Detalhe do corte de `corretors`:

- 365 linhas − 13 duplicatas = 352 nomes distintos.
- 352 − 56 órfãs sem User = **296 fichas com pessoa identificável**, apontando para **290 Users distintos**.
- Dessas, **271 linhas (264 nomes) têm equipe**; 94 linhas não têm (e só 2 delas são `ativo=sim`).
- Ativos hoje: **90** com `ativo=sim` em `corretors`, **94** com `Ativo=sim` em `Users` — os dois lados
  concordam, e o schema alvo cobre a diferença com `profile_status` (`active`/`terminated`) em vez de um booleano.

Preferir `Users` como fonte de `profiles` (tem email, CPF, CRECI, telefone, datas) e usar `corretors` apenas
para a flag de participação na roleta (`ativo`, `agil_qtd`) e `Users.equipe` para `team_members`.
`vendas_mes`, `VGV_mes`, `meta`, `meta_equipe`, `qtd_batd`, `vgv_batd`, `obtd` e `Slug` não têm dado a importar.

---

## Reprodutibilidade

Scripts usados (fora do repo, no scratchpad da sessão):
`perfil_hierarquia.py` (perfil coluna a coluna + distribuições), `perfil2.py` (alvo de cada referência,
cascata de junção, árvore), `perfil3.py`/`perfil4.py` (verificação de `Users.colaboradores` e lacunas).
Todos usam `csv.DictReader` com `encoding="utf-8-sig"` e normalização
`NFKD → remove combining → colapsa espaços → lower`.

Nenhum valor de `Users.senha_temporaria` foi lido, exibido, copiado ou gravado em qualquer ponto deste
relatório ou dos scripts. CPF, PIS, telefone, e-mail e endereço não aparecem aqui: as três tabelas
perfiladas não contêm essas colunas, e as referências a `Users` usam apenas nome.
