# Refutação — mapa "Gamificação, metas e resultados" (`docs/importacao/mapa/game_metas.md`) pela lente **dados**

Data: 09/09/2026 · Fase somente leitura: nenhum comando tocou o banco; nenhum arquivo de código do repo foi alterado.
Parser: módulo `csv` do Python 3.12, encoding `utf-8` com `errors='replace'` (o export usa latin-1 em alguns acentos,
o que não afeta nenhuma contagem aqui). Scripts temporários fora do repo, no scratchpad da sessão.

**Veredito: REFUTADO (parcial), gravidade alta.** O mapa é excepcionalmente fiel ao CSV: das ~35 afirmações
factuais que consegui medir, **31 batem ao número exato** (contagens, pesos por temporada, reconciliação
622/629, âncora `GameAtual` 142/142, 12 equipes, duplicata de 2024-11, `valor × vezes = valorTotal` 26/26,
os 7 UUIDv5 publicados). Nada do que encontrei **bloqueia** a carga — nenhum INSERT proposto viola constraint.

O que não se sustenta é a afirmação central da §3.1: **"cobertura 629/629 (100 % do que se importa)" mede o
nome contra o export de `Users`, não contra `profiles`** — e 160 das 629 linhas (25,4 %) pertencem a 55 pessoas
que o próprio export marca como `Ativo = não`. O documento nunca cita a coluna `Ativo` e não define o que
acontece com o `rank` quando uma linha é rejeitada, embora a própria §10 diga que "o `rank` só faz sentido com
o conjunto completo de participantes".

---

## 1. Defeito principal — a cobertura de 100 % é contra `Users`, não contra `profiles`; 25 % do placar depende de gente desligada

**Onde:** §3.1 (tabela de medições, "a resolução é **determinística e completa**"), §5.2 (linha `user`,
"629/629 cobertos"), §10 (linha `game_season_results` = **629**), §11 verificação 8 ("esperado: … 629").

**O que fiz:** reproduzi a âncora do documento (`Users.GameAtual` → linha de `gameficacaos` → `user`), que
confere exatamente, e então cruzei os 142 nomes ancorados com a coluna `Ativo` do mesmo arquivo de `Users`.

| medida | mapa | medido |
|---|---:|---:|
| Users com `GameAtual` | 142 | **142** ok |
| resolvem para `gameficacaos` | 142 (0 órfãos) | **142, 0 órfãos** ok |
| ambiguidade / colisão | 0 / 0 | **0 / 0** ok |
| linhas com `gameMes` cobertas | 629/629 | **629/629** ok |
| — dessas, pessoas com `Users.Ativo = 'não'` | *não citado* | **55 de 142 (38,7 %)** |
| — linhas dessas pessoas | *não citado* | **160 de 629 (25,4 %)** |
| — dessas 160, com `pontos > 0` | *não citado* | **70** |

Distribuição por temporada das 160 linhas: Março 32, Abril 34, Maio 35, Junho 26 25, Julho 26 23,
Agosto 2026 7, Setembro 2026 4.

**Por que isso é um defeito e não implicância.** A §3.1 declara a dependência "de-para `Users.unique id` →
`profiles.id`" e trata a cobertura como resolvida. Mas `profiles.id` referencia `auth.users`: criar perfil para
55 ex-funcionários é uma decisão de negócio do domínio de identidade (conta de autenticação para quem saiu),
não um detalhe de loader. Se a identidade importar só ativos — a escolha mais provável —, este mapa perde
**160 linhas** e a regra §3.1.5 manda mandá-las para `rejeitados.csv`.

**A consequência que o documento não fecha: o `rank`.** §5.2 e §7.2 dizem `row_number()` por temporada sobre
`(points desc, profiles.full_name asc)`. Com rejeição em massa restam dois caminhos, e o mapa não escolhe
nenhum:

- **rank calculado antes da rejeição** → a temporada vai ao banco com buraco (rank 1, 3, 4, 8…). A verificação
  §11.4 **não pega isso**: ela compara `count(*)` com `count(distinct rank)`, e `row_number()` nunca repete —
  "linhas = ranks" continua verdadeiro com buraco. A prosa da §11.4 diz "sem buraco", a consulta não testa buraco.
- **rank recalculado depois da rejeição** → ranks contíguos, mas o pódio congelado deixa de ser o que o Bubble
  mostrou: quem era 3º vira 1º porque os dois primeiros saíram da empresa. Congelar histórico errado é
  exatamente o que `game_season_results` existe para impedir (cabeçalho da `0010_gamification.sql:126-129`).

**Correção mínima (não exige reabrir CSV, os números estão acima):**

1. Acrescentar à §3.1 a linha "55 dos 142 (`Ativo = não`) respondem por 160 das 629 linhas" e transformar a
   dependência 1 em pré-condição verificável: *o de-para tem de conter os 142, inclusive os inativos*.
2. Elevar a decisão: **D11 — importar `profiles` de ex-funcionário?** (a) sim, perfil sem conta de auth, placar
   íntegro; (b) não, e então o mapa precisa dizer se o `rank` congela com buraco ou é recalculado.
3. Trocar a verificação §11.4 por uma que realmente detecte buraco:
   `select season_id from public.game_season_results group by 1 having max(rank) <> count(*);` — esperado: vazio.

---

## 2. Defeitos secundários

### 2.1 São **quatro** fronteiras de temporada compartilhadas, não uma — e o backfill de VGV só avisa de uma

§5.1 (coluna Risco de `Fim`) e §7.3 ("**Cuidado:** Junho e Julho compartilham `2026-07-02`") tratam a
sobreposição como caso isolado. Medido no CSV, o `period_end` de uma temporada é igual ao `period_start` da
seguinte em **4 das 6 fronteiras**:

| termina | data | começa |
|---|---|---|
| Maio | **2026-06-02** | Junho 26 |
| Junho 26 | **2026-07-02** | Julho 26 |
| Julho 26 | **2026-08-04** | Agosto 2026 |
| Agosto 2026 | **2026-09-01** | Setembro 2026 |

O `update` da §7.3 usa `closed_at::date >= period_start and closed_at::date <= period_end`: um negócio fechado
em **2026-06-02, 2026-08-04 ou 2026-09-01** entra no VGV congelado de **duas** temporadas, e o operador não foi
avisado desses três. (A frase "dois dias compartilhados" da §5.1 também não descreve o par Junho/Julho, que
compartilha um dia só.) Correção: trocar a lista por "4 fronteiras: 06-02, 07-02, 08-04, 09-01" e dar o alerta
uma vez, não por par.

### 2.2 `Creation Date` **não** coincide com `Inicio` nas 7 temporadas

§5.1 afirma "Coincide com `Inicio` nas 7". Coincide em **6**: `Julho 26` tem `Inicio = Jul 2, 2026 2:04 pm` e
`Creation Date = Jul 2, 2026 2:05 pm` (1 minuto de diferença). Sem efeito na carga — o SQL da §7.1 já usa o
valor certo (`'2026-07-02 14:05:00-03'`) —, mas a afirmação está errada.

### 2.3 A soma da D3 (138 para 2025-09) mistura linha que o próprio mapa descarta

§9/D3 diz "a soma mensal salta de ~90 para **138**/162/209/363". Somando só as **linhas úteis** (as 191 que a
§5.3 manda importar), 2025-09 dá **133**: 24 + 34 + 39 + 36. Os 5 que faltam vêm da linha com `equipe` vazia,
descartada pela lacuna L3. Os outros três meses conferem (162, 209, 363). O quadro da anomalia não muda; o
número publicado, sim.

### 2.4 "os 4 arquivos que têm a coluna [`Creator`]" — são 6

§3.4. Têm `Creator`: `DadosGames`, `gameficacaos`, `meta-equipes`, `meta-constutoras`, `resultado-anuals` e
`vendas`. Só `financeiros` não tem. O conteúdo da afirmação se sustenta (100 % `Douglas Gomes`, mais 7
`(App admin)` em `gameficacaos`) — a contagem de arquivos, não.

---

## 3. O que foi confirmado nos CSVs (para não refazer)

Cabeçalhos e volumes dos 7 arquivos (14/19/9/9/8/14/7 colunas; 7/1.063/201/402/67/6/26 registros) — todos
exatos. Além disso:

**`DadosGames`** · a tabela de pesos da §5.1 é literal, inclusive a inversão aparente de `Julho 26`
(aprovado 600, esteira 250, incompleto 140, ligação 10, venda 600) · `MesAtivo` = 6×`não` + 1×`sim` (Setembro)
· `Slug` vazio em 7/7 · `Creator` = `Douglas Gomes` em 7/7 · nenhum `Inicio`/`Fim` perto da meia-noite
(o mais cedo é 10:00) → **REGRA-D3 é segura**.

**UUIDv5** · `uuid5(NAMESPACE_URL, "https://faceimob.com.br/import/bubble")` =
`834b56e0-9263-5e1d-af8e-eb91a3616732` e os **7 ids de temporada publicados na §4 batem dígito a dígito**.

**`gameficacaos`** · 629 com `gameMes` / 434 sem · 7 `gameMes` distintos, 0 órfãos · **os 629 pares
`(gameMes, user)` são únicos** (0 duplicata — a PK `(season_id, profile_id)` não colapsa linha nenhuma) ·
142 usuários distintos nas 629, 162 no arquivo inteiro · `pontos`: 14 fracionários (**10 Agosto + 4 Setembro**),
0 vazios nas 629, 222 vazios no arquivo · `StatusVenda`: 29 fracionários, **2 negativos, ambos `-1`, um em
Março outro em Abril** · células ≠ 0: aprovado 241, esteira 300, incompleto 215, ligações 59 ·
soma de `ligacoes` nas 629 = **3.425** (L7) · 236 linhas totalmente zeradas → 393 com sinal ·
`equipe` 582/629 com 12 valores, `Diretor` 563/629 com 3 valores · `Atual = sim` em 81 linhas, **todas de
Setembro** (91 no total) · `Slug` vazio em 1.063/1.063 · `Creator` 1.056 + 7 `(App admin)` ·
**nenhum valor numérico usa ponto de milhar** (REGRA-N1 confirmada).

**Reconciliação** · `pontos == Σ(contador × peso da temporada)` em **622 de 629**; as 7 divergências são todas
de `Agosto 2026`, todas com `Modified Date = Sep 1, 2026 12:52 pm`, deltas **+80 ×3, +40, +10 ×2, −60** —
idêntico ao publicado.

**`meta-equipes`** · 2 sem `mes` (`Alisson`, `Susana `), 8 sem `equipe`, nenhuma linha sem os dois →
**191 úteis** · 12 equipes distintas, **191 pares `(equipe, mes)` únicos** · 29 meses de 2024-05 a 2026-09
**sem buraco** · `meta` inteiro e > 0 em 191/191 · `meta_remuneracao` preenchido em **160** das úteis ·
todos os `mes` com dia 1 e 00:00.

**`Equipes`** · 12 linhas, nomes e `unique id` idênticos à tabela da §3.3, inclusive `'Susana '` com espaço
final. Em `meta-constutoras` a mesma equipe aparece como `'Susana'` **sem** o espaço — REGRA-S1 resolve, mas
confirma que o campo é digitado, não referenciado.

**`meta-constutoras`** · 9 construtoras (`APICE, LYX, MC3, MELNICK, MORANA, MRV, SOUTH, TENDA, VASCO`) ·
11 equipes + vazio, `Leonardo` ausente · 1 sem `mes` (**MRV / Jose Portilho / meta=3**) · 11 sem `equipe` ·
**389 trincas distintas em 390 linhas**, a duplicata sendo `TENDA / Archimedes / 2026-04`, meta 8 nas duas,
criadas com 1 minuto de diferença · `meta` de 1 a 20 · 6 meses sem meta na série (2024-12, 2025-09, 2025-11,
2025-12, 2026-06, 2026-07).

**`resultado-anuals`** · 67 linhas, 66 meses distintos, 2021-01 a 2026-07 · único duplicado **2024-11**, com os
valores exatos da §5.5 (A: 109 / 22.461.886,24 / `Nov 15, 2024 11:02 pm`; B: 59 / 12.069.138,34 /
`Dec 11, 2024 2:30 pm`) · **2024-10 é o único mês ausente** · `vgv` no padrão `dígitos[,dígitos]` em 67/67 ·
`vendas` inteiro em 67/67 · todos os `data` com dia 1 e 00:00.

**Contraprova independente do conflito de 2024-11** (a mais forte do mapa, e ela se sustenta): em
`pipelines-modified`, `STATUS = VENDA` com `mes` em 2024-11 dá **57 vendas** e `VGV BRUTO` =
**12.069.379,43** — a linha B erra o VGV em R$ 241,09 (0,002 %) e a linha A não se aproxima. Total de
pipelines = **7.568**, o mesmo denominador citado na §5.7. Observação para a D4: o casamento é do **dinheiro**;
a **contagem** de B (59) ainda difere em 2 da recontagem (57).

**`vendas`** · 6 linhas · as 6 colunas de atribuição vazias em **6/6** · `Modified Date = Creation Date` em
**6/6** · a órfã (`pipeline` vazio, `valor = 350000`) existe. Descarte justificado.

**`financeiros`** · `valor × vezes = valorTotal` em **26 de 26** · `nomeCampo` com **16** grafias após `strip`
e **14** após `strip+upper` · 7 clientes distintos · **o arquivo realmente não tem `unique id`** (7 colunas).

**Alvo (conferido nas migrations, não no banco)** · `game_season_results` é PK `(season_id, profile_id)`, sem
`id`, sem `created_at`/`updated_at`, `rank int not null` sem default, `points int not null` **sem**
`check >= 0` (a linha de −650 pontos entra) · `game_scoring_rules` tem os dois índices parciais citados e
**nenhum CHECK em `event_code`** (criar `ligacao` de temporada é possível) · `goals` tem o CHECK de `metric` e
o `goals_team_idx` exatamente como descrito · `annual_results` tem `unique (year, month)` e `notes` ·
`game_seasons` tem `game_seasons_closed_consistency` bicondicional e `game_seasons_one_open` ·
**nenhuma tabela usa `FORCE ROW LEVEL SECURITY`** · `close_game_season` ordena o rank por
`row_number() over (order by r.points desc, r.full_name)` (`0060_gamificacao.sql:532`) · `seed.sql:150-156`
traz as 5 regras padrão com 10/140/250/600/−600 e exatamente os rótulos que a §5.1 propõe ·
`award_game_points` grava `kind = 'game_paused'`, um não lido por pessoa, canal `in_app`
(`0078_gamificacao.sql:174-201`) · `useGameRanking.ts` lê só `breakdown.esteira` e `breakdown.aprovado` ·
`Resultados.tsx:126-137` só repassa `notes`.

**Fuso** · o `Creation Date` mais antigo de todo o domínio é **2024-05-11**; nenhum valor cai antes do fim do
horário de verão brasileiro (2019). REGRA-D2 com offset fixo `-03:00` está correta para este recorte.

---

## 4. Riscos menores registrados, sem correção proposta

- **`sales` = ROUND_HALF_UP infla a contagem**: 29 `StatusVenda` fracionários viram inteiro (`0,5 → 1`). O mapa
  declara a regra na §6.4, mas não diz que ela transforma meia venda rateada em uma venda cheia no card do
  corretor. É perda declarada, não defeito.
- **1 dos 142 nomes ancorados não tem `Nome_completo` no export.** Se o `profiles.full_name` correspondente
  nascer vazio/nulo, o desempate do `rank` (`order by full_name`) passa a depender da regra de NULLS do loader.
  Vale fixar `nulls last` para reproduzir o `order by` do Postgres.
- **A verificação §11.8 conta a tabela inteira** (`select count(*) from public.game_season_results`), então os
  esperados 629 / 191 / 66 só valem em banco sem seed de demonstração (`supabase/seeds/060`). Convém filtrar
  pelos 7 `season_id` e pela faixa de `period` importada.

---

## 5. Comandos que sustentam este relatório

Todos rodados a partir de `C:/Users/Alisson/CascadeProjects/FACEIMOB/DOCUMENTOS/DADOS_BUBBLE` (leitura) e da
raiz do repo (grep/sed), sem tocar o banco:

- `python` + `csv.DictReader` sobre os 7 CSVs: cabeçalhos, contagens, vazios, fracionários, negativos,
  duplicatas de chave natural, reconciliação `pontos × peso`, sobreposição de fronteiras de temporada.
- `python` + `uuid.uuid5` para o namespace e os 7 ids de temporada.
- Cruzamento `Users.GameAtual` × `gameficacaos.unique id` × `Users.Ativo` (o defeito principal).
- Varredura em streaming de `export_All-pipelines-modified--_…csv` (9,5 MB) para recontar 2024-11.
- `sed -n` em `supabase/migrations/20260725120900_0010_gamification.sql`,
  `20260725121000_0011_marketing_workspace.sql`, `20260725121100_0012_crud_fixes.sql`,
  `20260903600000_0060_gamificacao.sql`, `20260906780000_0078_gamificacao.sql`, `supabase/seed.sql`;
  `grep -i "force row level security"`, `grep "game_paused"`, `grep "notes" src/pages/Resultados.tsx`.

Nenhum dado pessoal foi copiado para este relatório: os únicos nomes citados são nomes de **equipe** e o autor
de backoffice que o próprio mapa já publica. A coluna `senha_temporaria` de `Users` não foi lida em nenhum
momento — o cruzamento usou apenas `GameAtual`, `Ativo` e `Nome_completo` (presença, não conteúdo).
