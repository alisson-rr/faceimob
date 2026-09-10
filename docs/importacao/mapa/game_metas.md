# Mapa de importação — Gamificação, metas e resultados (Bubble → Supabase)

Data: 09/09/2026 · Fase: somente leitura (nenhum acesso a banco, nenhum arquivo de código alterado).
Escrito para ser executado por outro agente **sem reabrir CSV**.

Fontes deste documento:
- Perfil da origem: `docs/importacao/perfil/gamificacao.md`, `docs/importacao/perfil/metas.md`
- Restrições do destino: `docs/importacao/alvo/game_alvo.md`, `docs/importacao/alvo/operacao_alvo.md`, `docs/importacao/SCHEMA_ALVO.md`
- Conferências próprias (scripts em `<scratchpad>/hdr.py`, `g1.py`..`g4.py`, Python 3.12, módulo `csv`): cabeçalhos exatos, reconciliação de pontos, cobertura de FK, duplicatas. Todo número desta página saiu da execução desses scripts ou de citação explícita dos relatórios acima.

---

## 0. Escopo

**Arquivos de origem (7):**

| Arquivo | Entidade | Registros | Colunas |
|---|---|---:|---:|
| `export_All---DadosGames-modified_2026-09-08_19-36-26.csv` | catálogo de temporadas | 7 | 14 |
| `export_All---gameficacaos-modified--_2026-09-08_19-36-34.csv` | placar agregado por pessoa/temporada | 1.063 | 19 |
| `export_All-meta-equipes-modified_2026-09-08_19-42-19.csv` | meta mensal por equipe | 201 | 9 |
| `export_All-meta-constutoras-modified_2026-09-08_19-41-57.csv` | meta por construtora × equipe × mês | 402 | 9 |
| `export_All-resultado-anuals-modified_2026-09-08_19-44-26.csv` | resultado consolidado mensal | 67 | 8 |
| `export_All-vendas-modified_2026-09-08_19-45-58.csv` | resíduo abandonado | 6 | 14 |
| `export_All-financeiros_2026-09-08_19-38-25.csv` | plano de pagamento do negócio | 26 | 7 |

**Tabelas de destino tocadas:** `game_seasons`, `game_scoring_rules`, `game_season_results`, `goals`, `annual_results`.
**Tocadas com volume zero (declarado):** `game_events`, `funnel_targets`, `marketing_investments`, `daily_reports`, `daily_entries`.

**Fora deste mapa** (mesmo domínio no relatório de alvo, mas origem no grupo *catálogo*): `gold_tips` ← `dicadeouros`, `important_notices` ← `mensagemdodias`, `useful_links` ← `links`. Estão mapeados pelo agente do domínio de catálogo (`docs/importacao/perfil/catalogo.md` §2–§4). Se aquele mapa não existir, estas três tabelas ficam sem carga — não as reivindique aqui para não duplicar.

**Dependências de outros domínios (bloqueantes):**

1. `profiles` já carregado **e** com o de-para `Users.unique id → profiles.id` disponível ao loader (domínio identidade). Sem esse de-para, a resolução de `gameficacaos.user` cai de 100 % para heurística de nome — ver §3.1.
2. `teams` já carregado, com `teams.name` = `Equipes.nome` do Bubble (domínio identidade).
3. `developers` já carregado — só se a decisão D6 (metas por construtora) for "importar".
4. `deals` + `deal_participants` já carregados — só para o backfill opcional de `game_season_results.vgv` (§7.3).

---

## 1. Ordem de carga

```
[pré] profiles, teams, team_members, developers        (domínio identidade / catálogo)
  ↓
1. TRAVAS: cron faceimob-* off + automation_settings.leads_paused = true
   (operacao_alvo.md; não é opcional, ver §2)
  ↓
2. game_seasons          7 linhas — TODAS já fechadas (inclusive Setembro/2026)
  ↓
3. game_scoring_rules   35 linhas — season_id preenchido, uma por (temporada, código)
  ↓
4. game_season_results  629 linhas — depende de 2 + profiles
  ↓
5. goals                191 linhas — depende de teams (independente de 2..4)
6. annual_results        66 linhas — independente de tudo
  ↓
[depois, se houver] carga de deals/CCA/documentos  ← só depois do passo 2 (T1)
  ↓
7. LIMPEZA: delete from notifications where kind = 'game_paused'
8. Abertura da temporada de produção (1 linha, feita pelo admin na tela ou por INSERT)
9. Reativar crons + leads_paused = false
```

Os passos 5 e 6 não têm dependência nenhuma com o jogo: podem rodar em qualquer ordem depois de `teams`.

---

## 2. Pré-condições que decidem a carga

### 2.1 Todas as 7 temporadas entram FECHADAS — inclusive a "ativa"

Motivo (T1 do `game_alvo.md`, cabeçalho da migration `0060_gamificacao.sql:61-68`): com uma temporada aberta, a carga de negócios/CCA/documentos **pontua na temporada corrente** por quatro gatilhos (`deals_award_points`, `deal_participants_award_points`, `cca_award_points`, `deal_documents_award_points`), e nenhum deles tem exceção para `postgres`/`service_role`.

Receita:

```sql
-- (a) encerre a temporada aberta que existir no destino (seed/demo)
update public.game_seasons
   set closed_at = now(), period_end = greatest(period_start, current_date)
 where closed_at is null;

-- (b) só então insira as 7 legadas, todas com closed_at e period_end preenchidos
-- (c) NÃO abra nenhuma temporada antes de terminar a carga de deals/CCA
```

Consequência aceita: durante a carga `award_game_points` descarta o ponto e grava **uma** notificação `game_paused` **não lida por pessoa** (`0078:174-201`, canal `in_app` — não dispara WhatsApp). Limpar no passo 7 com `delete from public.notifications where kind = 'game_paused';`.

Consequência de **não** fazer isso: milhares de `game_events` de 600 pontos com `occurred_at = now()` na temporada corrente, e `game_events` está na publication realtime — cada linha `venda` toca a fanfarra em toda tela aberta (T2).

### 2.2 Identidade de carga

`postgres` (dono, nenhuma tabela tem `FORCE ROW LEVEL SECURITY`) ou `service_role` (`BYPASSRLS`). Não use sessão `authenticated`: `goals_write` limita diretor ao próprio recorte e `marketing_investments` exige o par admin/marketing.

### 2.3 Fuso e formato — as regras de conversão

- **REGRA-D1 (competência mensal, NUNCA converter fuso).** Vale para `meta-equipes.mes`, `meta-constutoras.mes`, `resultado-anuals.data`. Parse `strptime(v, "%b %d, %Y %I:%M %p")`, pegue `(year, month)` e monte `date(year, month, 1)`. Converter para UTC joga a competência para o mês anterior (`2024-05-01 00:00 -03` → `2024-04-30 03:00Z`). Evidência: 667 de 667 valores têm dia 1 e hora 00:00.
- **REGRA-D2 (instante real → timestamptz).** Vale para `Creation Date`, `Modified Date`, e para `DadosGames.Fim` quando vira `closed_at`. Parse igual, então `.replace(tzinfo=ZoneInfo("America/Sao_Paulo"))`. O Brasil não tem horário de verão desde 2019, então todo valor de 2021–2026 é offset fixo `-03:00` — não há instante ambíguo neste export.
- **REGRA-D3 (data de temporada).** `DadosGames.Inicio`/`Fim` → `period_start`/`period_end` são `date`: use o dia do **calendário local**, sem passar por fuso. Nenhum dos 14 valores está perto da meia-noite (o mais cedo é 10:00), então a regra é segura.
- **REGRA-N1 (número pt-BR).** `v.replace(".", "").replace(",", ".")` → `Decimal`. Conferido: nenhum valor deste grupo usa ponto de milhar (`vgv`, `valor`, `valorTotal`, `pontos`, `Status*`).
- **REGRA-N2 (inteiro).** `Decimal.quantize(Decimal(1), rounding=ROUND_HALF_UP)`. Aplica-se a `points` e `sales` de `game_season_results` (a origem tem `,5`).
- **REGRA-S1 (normalização de nome para FK).** `unicodedata.normalize("NFKD", s)` → remove combining marks → `.lower()` → `" ".join(s.split())`. Resolve `"Susana "` (espaço à direita, defeito presente também em `Equipes.nome`) e acentuação.

---

## 3. Resolução de FK

Nos exports `-modified` do Bubble, **uma única coluna deste domínio é `unique id`: `gameficacaos.gameMes`**. Todo o resto vem como nome de exibição.

### 3.1 `gameficacaos.user` → `profiles.id` — cobertura 629/629 (100 % do que se importa)

O caminho **não** é casar nome com nome. O ancoradouro é `Users.GameAtual`, que é `unique id` de `gameficacaos`:

```
Users.GameAtual (unique id de gameficacaos)
  → linha de gameficacaos → campo `user` (nome curto do jogo)
  → assim se obtém o par exato (Users.unique id, nome curto), sem heurística
```

Medições próprias (`g3.py`, `g4.py`):

| medida | valor |
|---|---:|
| Users com `GameAtual` preenchido | 142 |
| desses, que resolvem para uma linha de `gameficacaos` | **142 (100 %, 0 órfãos)** |
| nomes curtos distintos em `gameficacaos.user` | 162 |
| nomes curtos cobertos pela âncora | 142 |
| ambiguidade (um nome curto → 2 Users) | **0** |
| colisão (um User → 2 nomes curtos) | **0** |
| **linhas com `gameMes` cobertas** | **629 de 629 (100 %)** |
| linhas sem `gameMes` cobertas | 396 de 434 |
| usuários distintos nas 629 linhas | **142** — exatamente o conjunto ancorado |

Ou seja: os 20 nomes não cobertos aparecem **apenas** no bloco legado (sem `gameMes`), que não é importado. Para o recorte que vai para o banco, a resolução é **determinística e completa**. (O relatório de perfil sugeria heurística de nome com 151 únicos/6 ambíguos/5 sem match; a âncora `GameAtual` torna a heurística desnecessária para as linhas importáveis.)

**Algoritmo (o loader faz, nesta ordem):**

1. Ler `export_All-Users-modified--_..._19-44-45.csv`; para cada linha com `GameAtual`, achar a linha de `gameficacaos` por `unique id` e registrar `mapa[REGRA-S1(gameficacaos.user)] = Users.unique id`.
2. Traduzir `Users.unique id → profiles.id` com o de-para produzido pela carga de identidade (**dependência declarada**; se ele não existir, exigir do agente de identidade que persista `profiles.id ← Users.unique id`).
3. Fallback para nome não coberto (só ocorre fora do recorte importável): casamento por **subconjunto de tokens** — todo token do nome curto aparece no `profiles.full_name` normalizado por REGRA-S1, sem exigir ordem. Medido nos 20 restantes: 17 únicos, 1 ambíguo, 2 sem match.
4. **Ambíguo (2+ candidatos): não importar a linha; jogar em `rejeitados.csv` com os candidatos.** Nunca escolher o primeiro.
5. **Não encontrado: não importar a linha; registrar em `rejeitados.csv`.** Nunca criar `profiles` a partir do jogo — `game_season_results.profile_id` é `on delete restrict` e um perfil fantasma vira lixo permanente.

### 3.2 `gameficacaos.gameMes` → `game_seasons.id`

`unique id` do `DadosGames`. 7 de 7 resolvem, 0 órfãos. A conversão é a UUIDv5 de §4 — nenhuma consulta ao banco é necessária.

### 3.3 `meta-equipes.equipe` / `meta-constutoras.equipe` → `teams.id`

Nome de exibição. Casamento por REGRA-S1 contra `teams.name`. Medido: **12 de 12** nomes distintos de `meta-equipes` batem com `Equipes.nome`, nos dois sentidos (nenhum órfão). Cobertura de linhas: **191 de 191** úteis.

Catálogo para conferência (12 equipes, com o `unique id` do Bubble para o de-para de identidade):

| `Equipes.nome` | Diretor | Gerente | `unique id` |
|---|---|---|---|
| `Archimedes` | Archimedes Boff | Archimedes Boff | `1715462324608x711409717943992300` |
| `Zona Sul` | Fabio Batista | Fabio Batista | `1715462336273x873325835064442900` |
| `Mauricio` | Mauricio Vieira | Mauricio Vieira | `1715462360291x397423419338260500` |
| `Jose Portilho` | Archimedes Boff | Jose Portilho | `1715462386743x419590813112598500` |
| `Faceimob` | Gerente Interino | Gerente Interino | `1715739954400x469372796444082200` |
| `Susana ` *(espaço final)* | Archimedes Boff | Susana Cristina Prates | `1742427055245x762680743764688900` |
| `Victor` | Fabio Batista | Victor Rafael | `1742429245196x825460870659702800` |
| `Veronica` | Fabio Batista | Veronica Oliveira | `1742429818299x159180040535015420` |
| `Alisson` | Mauricio Vieira | Alisson Luiz | `1742430183691x513737875719716860` |
| `Alexandre` | Archimedes Boff | Alexandre Chaves | `1759511468463x938777397630074900` |
| `Daiane Dias` | Fabio Batista | Daiane Dias | `1767921360889x976580818878070800` |
| `Leonardo` | Mauricio Vieira | Leonardo Vallier | `1770338183290x298941981563027460` |

Equipe não encontrada: **não importar a linha** (não criar `teams` a partir de uma meta). Equipe vazia: ver §8, lacuna L3.

### 3.4 `*.Creator` → `profiles.id` (`goals.created_by`, `annual_results.updated_by`, `game_seasons.closed_by`)

Valor único em 100 % das linhas dos 4 arquivos que têm a coluna: `Douglas Gomes` (mais o rótulo de sistema `(App admin)` em 7 linhas de `gameficacaos`). Regra: tentar REGRA-S1 contra `profiles.full_name` por subconjunto de tokens; **se não achar, gravar NULL**. As três colunas são nuláveis e nenhuma tela depende delas. Não vale gastar decisão humana num campo de autoria de backoffice.

### 3.5 `meta-constutoras.construtora` → `developers.id`

9 valores distintos (`APICE`, `LYX`, `MC3`, `MELNICK`, `MORANA`, `MRV`, `SOUTH`, `TENDA`, `VASCO`), todos presentes no catálogo `Construtoras` (41 linhas). Só se aplica se a decisão D6 for "importar".

---

## 4. Idempotência — chave natural por tabela destino

**Recomendação: UUIDv5 determinístico calculado no loader, sem tabela nova.** O Postgres deste projeto não tem `uuid-ossp` (só `pgcrypto`, `citext`, `pg_trgm`, `btree_gist` — `0001_foundation.sql:7-10`), então `uuid_generate_v5` não existe em SQL. O loader (Python/Node) calcula e manda o literal.

```python
import uuid
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://faceimob.com.br/import/bubble")
# NS = 834b56e0-9263-5e1d-af8e-eb91a3616732   (constante; NÃO recalcular com outra string)
def bid(entidade: str, unique_id: str) -> uuid.UUID:
    return uuid.uuid5(NS, f"{entidade}:{unique_id}")
```

Os 7 ids de temporada já ficam fixados aqui (confira contra a sua implementação antes de carregar):

| `Mes_nome` | `unique id` do Bubble | `game_seasons.id` |
|---|---|---|
| Março | `1774722066067x931669531211071500` | `a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1` |
| Abril | `1775179767952x241770602164387840` | `e90b33f6-8518-5aef-805a-b17ee4d16405` |
| Maio | `1777733691612x529025119208341500` | `b783bb1d-5534-56a6-971e-21f348eca187` |
| Junho 26 | `1780413583538x628405435254702100` | `8153fe4d-0a40-510c-b34b-81f0c6ad50c7` |
| Julho 26 | `1783011899732x715484072877490200` | `cbb712fe-5ed5-5280-adaf-6b1613111280` |
| Agosto 2026 | `1785849124693x952265896335769600` | `edadcd7c-3596-5af9-957f-c4c85faf8f42` |
| Setembro 2026 | `1788277988370x359280909145341950` | `6bb69ec8-8d30-520e-9f8e-ee3c4b48925b` |

### Chave de idempotência por tabela

| Tabela destino | Chave natural (o que impede duplicar) | Cláusula de conflito | Onde fica o `unique id` do Bubble |
|---|---|---|---|
| `game_seasons` | `id` = `bid("DadosGames", unique id)` | `on conflict (id) do nothing` | é o próprio `id` (derivado) |
| `game_scoring_rules` | índice parcial `(season_id, event_code) where season_id is not null` | `on conflict (season_id, event_code) where season_id is not null do update set points = excluded.points, label = excluded.label, active = excluded.active` | `id` = `bid("DadosGames.rule", f"{unique id}:{event_code}")` |
| `game_season_results` | **PK `(season_id, profile_id)`** — a tabela não tem coluna `id` | `on conflict (season_id, profile_id) do update set rank=…, points=…, sales=…, breakdown=…, frozen_at=…` | não cabe; rastreio pelo par `(gameMes, user)` no log da carga |
| `goals` | índice parcial `goals_team_idx (team_id, period_type, period, metric) where scope = 'team'` | `on conflict (team_id, period_type, period, metric) where scope = 'team' do update set target = excluded.target` | `id` = `bid("meta-equipes", unique id)` |
| `annual_results` | **unique de tabela `(year, month)`** | `on conflict (year, month) do update set sales_count=…, vgv=…, notes=…` | `id` = `bid("resultado-anuals", unique id)` **e** `notes = 'bubble:<unique id>'` (a coluna `notes` não é escrita nem exibida por nenhuma tela — `pages/Resultados.tsx:126-137` só a repassa) |

**Armadilha T3 (`game_alvo.md` §9):** `game_scoring_rules` e `goals` têm índice **parcial**. O upsert do PostgREST falha com 42P10 sempre. Em SQL direto funciona **desde que o predicado do índice seja repetido na cláusula** (`on conflict (cols) where <predicado>`), que é a forma escrita acima. `on conflict on constraint <nome>` **não** funciona: são `create unique index`, não constraints.

**Tabela de-para opcional.** Se a operação exigir auditoria de reimportação (quem virou quem, quando), crie:

```sql
create table if not exists private.import_bubble_map (
  source_table text not null,
  bubble_id    text not null,
  target_table text not null,
  target_pk    text not null,
  imported_at  timestamptz not null default now(),
  primary key (source_table, bubble_id, target_table)
);
```

Fica em `private` (schema já usado pelo projeto, fora do PostgREST, sem necessidade de RLS). **Não é necessária para idempotência** — o UUIDv5 já resolve. Exige migration nova, portanto só com autorização (decisão D8).

---

## 5. Mapeamento coluna a coluna

Legenda: **[D1]/[D2]/[D3]/[N1]/[N2]/[S1]** = regras de conversão de §2.3.

### 5.1 `DadosGames` (7 linhas, 14 colunas) → `game_seasons` + `game_scoring_rules`

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `unique id` | `game_seasons.id` | `bid("DadosGames", valor)` — tabela de §4 | nenhum |
| `Inicio` | `game_seasons.period_start` | **[D3]** data local. Ex.: `Mar 28, 2026 3:21 pm` → `2026-03-28` | nenhum |
| `Fim` | `game_seasons.period_end` | **[D3]** data local. Ex.: `Apr 1, 2026 10:00 am` → `2026-04-01` | Junho termina e Julho começa em `2026-07-02` (dois dias compartilhados). Não viola constraint; **não recalcular** o congelado depois |
| `Fim` | `game_seasons.closed_at` | **[D2]** para as 6 com `MesAtivo = 'não'`. Para `Setembro 2026` (`MesAtivo = 'sim'`), `closed_at = now()` da carga e `period_end = 2026-09-30` mesmo sendo futuro | T6: `closed_at` e `period_end` são bicondicionais (`0010:69-71`). Um nulo sem o outro = 23514 |
| `Mes_nome` | `game_seasons.label` | `season_label_ptbr(period_start)` — `Março`→`Março 2026`, `Junho 26`→`Junho 2026`, `Setembro 2026`→`Setembro 2026`. Sem CHECK no banco; a normalização é para o histórico ficar coerente com o que o produto gera | rótulo deixa de ser literalmente o do Bubble (registrado aqui) |
| `MesAtivo` | — (regra, não coluna) | `'sim'`/`'não'` decide só a origem de `closed_at` (linha acima). **Nenhuma temporada entra aberta** (§2.1) | se alguém importar Setembro aberta, a carga de deals pontua nela (T1) |
| `Pontos_Aprovado Total ou condicionado` | `game_scoring_rules` (`event_code='aprovado'`) | 1 linha por temporada: `season_id`, `event_code`, `label='Análise aprovada'`, `points=int(valor)`, `active=true` | — |
| `Pontos_Esteira agil (1* envio)` | `game_scoring_rules` (`event_code='esteira'`) | idem, `label='Envio para esteira ágil'` | — |
| `Pontos_Incompleto com doc` | `game_scoring_rules` (`event_code='incompleto_com_doc'`) | idem, `label='Incompleto com documento'` | — |
| `Venda` | `game_scoring_rules` (`event_code='venda'`) | idem, `label='Venda'` | — |
| `Pontos_Ligacao` | `game_scoring_rules` (`event_code='ligacao'`) | idem, `label='Ligação'`. **Só com `season_id` preenchido — nunca criar a regra padrão (`season_id is null`)** | nenhum gatilho do FACEIMOB emite `ligacao`; como regra padrão apareceria na tela como código que nunca pontua |
| `Creation Date` | `game_seasons.created_at` | **[D2]**. Coincide com `Inicio` nas 7 | T10: sobrescrito por qualquer UPDATE posterior |
| `Modified Date` | `game_seasons.updated_at` | **[D2]** | T10 |
| `Slug` | **DESCARTAR** | vazio em 100 % das 7 linhas | — |
| `Creator` | `game_seasons.closed_by` (best effort) | §3.4; NULL se não resolver. Valor único `Douglas Gomes` | — |

**Conteúdo integral do arquivo** (para conferência do loader — pesos por temporada):

| `Mes_nome` | `Inicio` → `Fim` | ativo | `aprovado` | `esteira` | `incompleto_com_doc` | `ligacao` | `venda` |
|---|---|---|---:|---:|---:|---:|---:|
| Março | 2026-03-28 → 2026-04-01 | não | 250 | 200 | 50 | 1 | 700 |
| Abril | 2026-04-02 → 2026-05-01 | não | 250 | 200 | 10 | 1 | 700 |
| Maio | 2026-05-02 → 2026-06-02 | não | 250 | 140 | 10 | 1 | 600 |
| Junho 26 | 2026-06-02 → 2026-07-02 | não | 250 | 140 | 10 | 1 | 600 |
| Julho 26 | 2026-07-02 → 2026-08-04 | não | 600 | 250 | 140 | 10 | 600 |
| Agosto 2026 | 2026-08-04 → 2026-09-01 | não | 20 | 15 | 4 | 1 | 160 |
| Setembro 2026 | 2026-09-01 → 2026-09-30 | **sim** | 20 | 15 | 4 | 1 | 160 |

Os pesos mudaram 3 vezes (Maio, Julho, Agosto): a escala de pontos **não é comparável entre temporadas**. É exatamente por isso que a regra vai com `season_id` preenchido, e não como regra padrão.

### 5.2 `gameficacaos` (1.063 linhas, 19 colunas) → `game_season_results`

**Recorte importável: as 629 linhas com `gameMes`.** As 434 sem `gameMes` são um regime de dados diferente (as colunas `Status*` guardam pontos acumulados, não contadores) e `pontos` não fecha com nenhuma composição do arquivo (8 de 200 fecham) — **DESCARTAR em bloco**, ver lacuna L1.

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `gameMes` | `game_season_results.season_id` | `bid("DadosGames", valor)`. Vazio (434 linhas) → linha descartada | 7/7 resolvem |
| `user` | `game_season_results.profile_id` | §3.1 (âncora `Users.GameAtual`) | 629/629 cobertos; ambíguo/não achado → rejeitar linha |
| `pontos` | `game_season_results.points` | **[N1]** + **[N2]**. 14 linhas fracionárias (10 em Agosto, 4 em Setembro). Vazio → 0 | `points` é `int`; arredondar é perda declarada de ±0,5 |
| `StatusVenda` | `game_season_results.sales` | **[N1]**; se ≥ 0 → **[N2]**; **se < 0 → `sales = 0`** (2 linhas: uma em Março, uma em Abril, ambas `-1`) | a origem só tem o líquido do mês: 2 vendas − 1 distrato aparece como `1`. Distrato só é visível quando o líquido é negativo |
| `StatusVenda` | `breakdown['venda']` ou `breakdown['distrato']` | `v = StatusVenda × peso_venda da temporada`. Se `StatusVenda > 0` → `breakdown['venda'] = round(v)`; se `< 0` → `breakdown['distrato'] = round(v)` (negativo) e **sem** chave `venda` | mesma limitação do líquido |
| `StatusAprovado` | `breakdown['aprovado']` | `round(StatusAprovado × peso_aprovado)`; omitir a chave se 0 | 241 células ≠ 0 |
| `StatusEsteiraAgil` | `breakdown['esteira']` | `round(× peso_esteira)`; omitir se 0 | 300 células ≠ 0 |
| `StatusIncompleto` | `breakdown['incompleto_com_doc']` | `round(× peso_incompleto)`; omitir se 0 | 215 células ≠ 0 |
| `ligacoes` | `breakdown['ligacao']` | `round(× peso_ligacao)`; omitir se 0 | 59 células ≠ 0. Não vira `sales` nem `game_events` |
| (derivado) | `breakdown['ajuste']` | `points − soma(demais chaves)`, **só quando ≠ 0**. Garante o invariante "soma do breakdown = points" (verificação 3 do `game_alvo.md` §11) | 7 linhas de Agosto têm `pontos ≠ Σ(contador × peso)` (deltas +80×3, +40, +10×2, −60) — ajuste manual no fechamento. Chave desconhecida é ignorada pelo front (`useGameRanking.ts:104-105` só lê `esteira` e `aprovado`) |
| (derivado) | `game_season_results.rank` | `row_number()` por temporada ordenando `points desc, profiles.full_name asc` — **a mesma regra da RPC** (`0060:532`). NOT NULL, sem default | há muitos empates de `points` (0 é o valor mais comum): o desempate por `full_name` é o que torna o rank determinístico e reexecutável |
| (derivado) | `game_season_results.vgv` | **0 na primeira leva.** Backfill opcional em §7.3 depois da carga de negócios | não existe VGV neste export |
| `Modified Date` | `game_season_results.frozen_at` | **[D2]** | tabela sem `updated_at` → imune ao T10 |
| `Creation Date` | **DESCARTAR** | é a criação da linha de placar (em lote, no 1º dia da temporada); a tabela destino não tem `created_at` | — |
| `Atual` | **DESCARTAR** | flag redundante e furado: 81 `sim` (todos em Setembro), mas 10 das 91 linhas de Setembro não estão marcadas. A verdade da temporada corrente é `DadosGames.MesAtivo` | — |
| `equipe` | **DESCARTAR neste domínio** | é o retrato mensal da equipe da pessoa (582 de 629 preenchidas, 12 valores, 12/12 casam com `Equipes.nome`). `game_season_results` não tem coluna de equipe — a equipe vem por `team_members` na hora da leitura. **É evidência boa para `team_members.joined_at/left_at`** (14 pessoas mudaram de equipe): repasse ao agente de identidade | perder isso não afeta o placar |
| `Diretor` | **DESCARTAR neste domínio** | idem (563 de 629; 3 valores, 3/3 casam) | idem |
| `notificouSeloFechamento` | **DESCARTAR** | estado de UI do Bubble (selo já notificado). O FACEIMOB usa `notifications`, com semântica diferente | — |
| `notificouSeloLigacao` | **DESCARTAR** | idem | — |
| `notificouSeloVenda` | **DESCARTAR** | idem | — |
| `Slug` | **DESCARTAR** | vazio em 100 % das 1.063 linhas | — |
| `Creator` | **DESCARTAR** | rastro do Bubble (`Douglas Gomes` 1.056, `(App admin)` 7). `game_season_results` não tem coluna de autor | — |
| `unique id` | **DESCARTAR como coluna** | a PK do destino é `(season_id, profile_id)`; guarde no log da carga (ou em `private.import_bubble_map` se D8 = sim) | — |

**Reconciliação verificada (script `g4.py`):** `pontos == Σ(contador × peso da temporada)` em **622 de 629** linhas (98,9 %). As 7 divergências são todas de `Agosto 2026`, todas com `Modified Date = Sep 1, 2026 12:52 pm` (o instante do fechamento). Regra adotada: **`pontos` do Bubble é a verdade**, o resíduo vai para `breakdown['ajuste']`.

### 5.3 `meta-equipes` (201 linhas, 9 colunas) → `goals`

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `unique id` | `goals.id` | `bid("meta-equipes", valor)` | — |
| `equipe` | `goals.team_id` | §3.3 (REGRA-S1 contra `teams.name`). Vazio (8 linhas) → descartar | 12/12 nomes resolvem |
| — | `goals.scope` | literal `'team'` | `goals_scope_team` é **bicondicional**: `scope='team'` exige `team_id` e proíbe `profile_id` |
| — | `goals.period_type` | literal `'month'` | — |
| `mes` | `goals.period` | **[D1]** → `date(ano, mês, 1)`. Vazio (2 linhas: `Alisson` e `Susana `) → descartar | dia diferente de 1 some da tela (`newSchema.ts:583-597` filtra `.eq("period", periodIso)`) |
| `meta` | `goals.target` | inteiro → `numeric(14,2)`. `check (target >= 0)`; todos os 201 valores são positivos | **valores de 2025-09 a 2025-12 são anômalos** (soma mensal 138→363 contra ~90 do resto). Decisão D3 |
| — | `goals.metric` | literal `'sales'` | o CHECK aceita `sales, vgv, leads, visits, analyses, approvals` |
| `meta_remuneracao` | **LACUNA (L2)** | 160 das 191 linhas úteis têm valor. `goals.metric` não tem valor compatível e o CHECK recusa qualquer outro. Decisão D2 | perder o patamar contratual de comissionamento |
| `Creation Date` | `goals.created_at` | **[D2]** | T10 |
| `Modified Date` | `goals.updated_at` | **[D2]** | T10 |
| `Creator` | `goals.created_by` | §3.4; NULL se não resolver | — |
| `Slug` | **DESCARTAR** | vazio em 100 % | — |

Filtro: 201 → −2 (sem `mes`) → −8 (sem `equipe`) = **191 linhas**, todas com `(equipe, mes)` único (conferido: 191 pares distintos, 0 duplicatas). Faixa 2024-05 a 2026-09, 29 meses **sem buraco**.

### 5.4 `meta-constutoras` (402 linhas, 9 colunas) → **sem destino** (decisão D6)

Não existe escopo por construtora em `goals` (`scope in ('global','team','profile')`) nem coluna `developer_id`. Também **não é** `marketing_investments` (lá `amount` é dinheiro aportado; aqui `meta` é contagem de unidades, valores 1..20).

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `construtora` | *pendente* | 9 valores, todos existem em `Construtoras` (→ `developers.name`) | — |
| `equipe` | *pendente* | 11 valores + vazio; 11 existem em `Equipes.nome` (só `Leonardo` nunca teve meta por construtora) | 11 linhas com equipe vazia (L3) |
| `mes` | *pendente* | **[D1]**; 1 linha sem `mes` (MRV/Jose Portilho/meta=3) → não importável | 6 meses sem nenhuma meta na série |
| `meta` | *pendente* | inteiro 1..20 = unidades | — |
| `Creation Date` / `Modified Date` | *pendente* | **[D2]** | — |
| `Creator` | **DESCARTAR** | valor único `Douglas Gomes` | — |
| `Slug` | **DESCARTAR** | vazio em 100 % | — |
| `unique id` | *pendente* | `bid("meta-constutoras", valor)` se D6 = importar | — |

Linhas úteis se a decisão for "importar": 402 − 1 (sem mês) − 11 (sem equipe) − 1 (duplicata `TENDA`/`Archimedes`/`2026-04`, `meta=8` nas duas, criadas com 1 minuto de diferença) = **389**. Conferido: 389 trincas distintas em 390 linhas com equipe e mês.

### 5.5 `resultado-anuals` (67 linhas, 8 colunas) → `annual_results`

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `data` | `annual_results.year` + `.month` | **[D1]**; `year = ano`, `month = mês`. Faixa 2021-01 a 2026-07 → o CHECK `year between 2000 and 2100` passa | — |
| `vendas` | `annual_results.sales_count` | inteiro; `check (sales_count >= 0)` — todos positivos | — |
| `vgv` | `annual_results.vgv` | **[N1]** → `numeric(14,2)`; `check (vgv >= 0)`. Ex.: `11095182,46` → `11095182.46`. Conferido: 67 de 67 no padrão `dígitos[,dígitos]`, nenhum ponto de milhar | — |
| `unique id` | `annual_results.id` + `notes` | `bid("resultado-anuals", valor)`; `notes = 'bubble:<unique id>'` | `notes` não é escrito nem exibido por nenhuma tela; `Resultados.tsx:126-137` só o repassa no upsert |
| `Creation Date` | `annual_results.created_at` | **[D2]** | T10 |
| `Modified Date` | `annual_results.updated_at` | **[D2]** | T10 |
| `Creator` | `annual_results.updated_by` | §3.4; NULL se não resolver | — |
| `Slug` | **DESCARTAR** | vazio em 100 % | — |

**Conflito de 2024-11 (resolvido com dado, decisão D4 para confirmar):** duas linhas para o mesmo mês.

| | `vendas` | `vgv` | `Creation Date` | `unique id` |
|---|---:|---:|---|---|
| A | 109 | 22.461.886,24 | `Nov 15, 2024 11:02 pm` | `1731722576126x249232697823854600` |
| B | 59 | 12.069.138,34 | `Dec 11, 2024 2:30 pm` | `1733938248662x306743899157168100` |

A contagem independente em `pipelines` (`STATUS = VENDA` em 2024-11) dá 57 vendas e VGV 12.069.379,43 — **a linha B casa com novembro real** (diferença de R$ 241,09, 0,002 %). A linha A não casa com nenhum mês isolado e foi criada no meio do mês. **Regra: importar B, descartar A.** Consequência de importar A: 2024 fecha com 797 vendas contra ~738 reais e o painel histórico mostra um pico de 109 vendas que nunca existiu.

**2024-10 não existe na origem** (nunca ganhou linha). Deixar ausente ou lançar 91 vendas / 19.450.408,58 recontados de `pipelines` — decisão D5.

Volume: 67 − 1 (linha A) = **66 linhas**.

### 5.6 `vendas` (6 linhas, 14 colunas) → **DESCARTAR a tabela inteira**

Resíduo abandonado: as 7 colunas de atribuição (`corretor`, `Correto2`, `correto3`, `gerente1`, `gerente2`, `gerente3`) estão **vazias em 100 %** das 6 linhas; as 6 nasceram em 15–16/05/2024 e nunca foram editadas (`Modified Date = Creation Date` nas 6); 5 das 6 são cópia de um `pipelines` com `STATUS = VENDA` e o mesmo valor (4 batem ao centavo, 1 difere R$ 140,00 — transposição de dígito), e a 6ª é órfã (`pipeline` vazio, `valor = 350000`).

Colunas e destino: `Correto2`, `correto3`, `corretor`, `gerente1`, `gerente2`, `gerente3` → DESCARTAR (100 % vazias); `data`, `pipeline`, `valor` → DESCARTAR (duplicata inferior de `pipelines`, domínio de negócios); `Creation Date`, `Modified Date`, `Slug`, `Creator`, `unique id` → DESCARTAR (metadados de linha que não será importada).

**Volume: 0.** Consequência de não importar: nenhuma.

### 5.7 `financeiros` (26 linhas, 7 colunas) → **sem tabela alvo** (decisão D7)

É o plano de pagamento de 7 negócios (entrada/ato + parcelas + intermediárias + financiamento). O schema alvo tem só `deals.vgv_gross`, `discount_pct`, `vgv_net` — não há tabela de composição de pagamento. Adoção no legado < 0,1 % (7 de 7.568 pipelines).

| Coluna origem | Destino | Regra exata | Risco |
|---|---|---|---|
| `nomeCampo` | *sem destino* | texto livre: 16 grafias com `strip`, 14 com `strip+upper` (`Financiamento`/`FINANCIAMENTO`/`financiamento`, `Intermediaria` vs `Intermediária`) | precisaria de catálogo antes de virar coluna |
| `pipeline` | *sem destino* | nome de exibição do **cliente**; join só por `pipelines.CLIENTE` (o arquivo **não tem `unique id`**) | frágil por homônimo; neste recorte de 7 clientes é 1:1 verificado |
| `valor`, `vezes`, `valorTotal` | *sem destino* | **[N1]**; `valor × vezes = valorTotal` em 26 de 26 | a semântica de `valor` oscila entre "parcela" e "bloco somado com vezes=1" |
| `Creation Date`, `Modified Date` | *sem destino* | **[D2]** | — |

**Volume nesta leva: 0.** Se a decisão for importar depois, **reexportar o arquivo com a coluna `unique id`** — sem ela o join reverso a partir de `pipelines.financeiro` (que é lista de `unique id`) é impossível.

---

## 6. De-para de valores

### 6.1 `MesAtivo` → estado da temporada

| Valor Bubble | Ocorrências | Destino | Regra |
|---|---:|---|---|
| `não` | 6 | temporada fechada | `period_end` = `Fim` **[D3]**, `closed_at` = `Fim` **[D2]** |
| `sim` | 1 (Setembro 2026) | **também fechada** | `period_end` = `2026-09-30`, `closed_at` = `now()` da carga (§2.1) |
| *(vazio)* | 0 | — | se aparecer em reexport: tratar como `não` |

### 6.2 Coluna de contador do Bubble → `event_code` do FACEIMOB

| Coluna origem | `event_code` | Existe no seed padrão? | Onde é usado na carga |
|---|---|---|---|
| `Pontos_Aprovado Total ou condicionado` / `StatusAprovado` | `aprovado` | sim (250) | `game_scoring_rules` + `breakdown` |
| `Pontos_Esteira agil (1* envio)` / `StatusEsteiraAgil` | `esteira` | sim (140) | idem |
| `Pontos_Incompleto com doc` / `StatusIncompleto` | `incompleto_com_doc` | sim (10) | idem |
| `Venda` / `StatusVenda > 0` | `venda` | sim (600) | idem |
| `StatusVenda < 0` | `distrato` | sim (−600) | só no `breakdown`; **não** gerar regra de temporada para `distrato` (o Bubble não tem peso próprio) |
| `Pontos_Ligacao` / `ligacoes` | `ligacao` | **não existe** | criar **apenas** como regra de temporada (`season_id` preenchido). Nunca como regra padrão |

**Código desconhecido em reexport:** rejeitar a linha e registrar. Não inventar `event_code` novo — texto livre no banco significa que um erro de digitação vira um código órfão silencioso (verificação 5 do §11).

### 6.3 Booleanos `sim`/`não`

| Valor | Interpretação | Destino |
|---|---|---|
| `sim` | verdadeiro | usado só em `MesAtivo` (§6.1) |
| `não` | falso | idem |
| *(vazio)* | indefinido | `Atual` e os três `notificou*` são DESCARTADOS, então nenhum vazio precisa de default |

### 6.4 Fracionários e negativos

| Situação | Ocorrências (nas 629) | Regra |
|---|---:|---|
| `pontos` fracionário | 14 | `points` = ROUND_HALF_UP; resíduo entra em `breakdown['ajuste']` |
| `StatusVenda` fracionário | 29 | `sales` = ROUND_HALF_UP (`0,5` → `1`); o `breakdown['venda']` usa o valor **não** arredondado × peso, arredondando só no fim |
| `StatusVenda` negativo | 2 | `sales = 0`, `breakdown['distrato']` negativo |
| contador vazio | — | tratar como 0; não gerar chave no `breakdown` |

### 6.5 De-paras que **não** pertencem a este domínio

O briefing pede `STATUS` do Bubble → `pipeline_stages.code`/`deals.outcome`, `Funcao` → `app_role` e status de lead → `lead_status`/`lead_funnel_stage`. **Nenhuma coluna dos 7 arquivos deste domínio contém esses valores.** Os de-paras vivem em:

- `pipelines.STATUS` → `pipeline_stages.code` + `deals.outcome`: mapa de **negócios** (`docs/importacao/alvo/negocios_alvo.md`).
- `Users.Funcao` → `app_role`: mapa de **identidade** (`docs/importacao/alvo/identidade.md`).
- `leadfies.status` → `lead_status`/`lead_funnel_stage`: mapa de **leads** (`docs/importacao/alvo/leads_alvo.md`).

Reproduzir esses de-paras aqui criaria uma segunda fonte de verdade divergente. Este documento consome o resultado deles (`profiles`, `teams`, `deals`), não os redefine.

---

## 7. Receitas SQL

O loader monta os `VALUES` com os literais já convertidos. Os exemplos abaixo mostram a forma exata da cláusula de conflito, que é onde os erros acontecem.

### 7.1 `game_seasons` + `game_scoring_rules`

```sql
begin;

-- 1. encerra qualquer temporada aberta no destino (seed/demo) — antes de tudo
update public.game_seasons
   set closed_at = now(), period_end = greatest(period_start, current_date)
 where closed_at is null;

-- 2. as 7 temporadas legadas, todas fechadas
insert into public.game_seasons (id, label, period_start, period_end, closed_at, closed_by, created_at, updated_at)
values
  ('a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'Março 2026',    '2026-03-28', '2026-04-01', '2026-04-01 10:00:00-03', null, '2026-03-28 15:21:00-03', '2026-05-19 17:16:00-03'),
  ('e90b33f6-8518-5aef-805a-b17ee4d16405', 'Abril 2026',    '2026-04-02', '2026-05-01', '2026-05-01 10:00:00-03', null, '2026-04-02 22:29:00-03', '2026-05-19 17:16:00-03'),
  ('b783bb1d-5534-56a6-971e-21f348eca187', 'Maio 2026',     '2026-05-02', '2026-06-02', '2026-06-02 12:16:00-03', null, '2026-05-02 11:54:00-03', '2026-06-02 12:16:00-03'),
  ('8153fe4d-0a40-510c-b34b-81f0c6ad50c7', 'Junho 2026',    '2026-06-02', '2026-07-02', '2026-07-02 14:04:00-03', null, '2026-06-02 12:19:00-03', '2026-07-02 14:04:00-03'),
  ('cbb712fe-5ed5-5280-adaf-6b1613111280', 'Julho 2026',    '2026-07-02', '2026-08-04', '2026-08-04 10:08:00-03', null, '2026-07-02 14:05:00-03', '2026-08-04 10:09:00-03'),
  ('edadcd7c-3596-5af9-957f-c4c85faf8f42', 'Agosto 2026',   '2026-08-04', '2026-09-01', '2026-09-01 12:52:00-03', null, '2026-08-04 10:12:00-03', '2026-09-01 12:52:00-03'),
  ('6bb69ec8-8d30-520e-9f8e-ee3c4b48925b', 'Setembro 2026', '2026-09-01', '2026-09-30', now(),                    null, '2026-09-01 12:53:00-03', '2026-09-01 12:53:00-03')
on conflict (id) do nothing;

-- 3. 35 regras (7 temporadas × 5 códigos). Índice PARCIAL: repetir o predicado.
insert into public.game_scoring_rules (id, season_id, event_code, label, points, active)
values
  ('<bid>', 'a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'aprovado',           'Análise aprovada',          250, true),
  ('<bid>', 'a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'esteira',            'Envio para esteira ágil',   200, true),
  ('<bid>', 'a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'incompleto_com_doc', 'Incompleto com documento',   50, true),
  ('<bid>', 'a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'ligacao',            'Ligação',                     1, true),
  ('<bid>', 'a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', 'venda',              'Venda',                     700, true)
  -- … 30 linhas restantes conforme a tabela de pesos de §5.1
on conflict (season_id, event_code) where season_id is not null
  do update set points = excluded.points, label = excluded.label, active = excluded.active;

commit;
```

> `on conflict on constraint game_scoring_rules_season_idx` **não compila**: é índice, não constraint. A forma correta é a inferência com o predicado, acima.

### 7.2 `game_season_results`

`rank` é calculado no loader, ordenando por `(-points, profiles.full_name)` dentro de cada temporada — a mesma regra de `close_game_season` (`0060:532`). Com isso o rank é estável entre execuções.

```sql
insert into public.game_season_results (season_id, profile_id, rank, points, sales, vgv, breakdown, frozen_at)
values
  ('a95ee3f5-4627-5e09-9bcb-8c9ca05db5b1', '<profile uuid>', 1, 3650, 5, 0,
   '{"venda": 3500, "aprovado": 250}'::jsonb, '2026-04-01 10:00:00-03')
  -- … 629 linhas
on conflict (season_id, profile_id) do update
  set rank = excluded.rank, points = excluded.points, sales = excluded.sales,
      breakdown = excluded.breakdown, frozen_at = excluded.frozen_at;
```

Chaves com valor 0 podem ser omitidas do `breakdown` — o front só lê `esteira` e `aprovado` e usa `|| 0`.

### 7.3 Backfill opcional de `vgv` (depois da carga de negócios)

Reproduz exatamente o cálculo da RPC (`0060:536-547`), por temporada:

```sql
update public.game_season_results r
   set vgv = coalesce((
         select sum(d.vgv_net * dp.share_pct / 100)
           from public.deal_participants dp
           join public.deals d on d.id = dp.deal_id
          where dp.profile_id = r.profile_id
            and dp.role = 'broker'
            and d.outcome = 'won'
            and d.closed_at::date >= s.period_start
            and d.closed_at::date <= s.period_end
       ), 0)
  from public.game_seasons s
 where s.id = r.season_id
   and r.vgv = 0;
```

**Cuidado:** Junho e Julho compartilham `2026-07-02`; um negócio fechado nesse dia entra no VGV das duas. É o mesmo comportamento da RPC — se for inaceitável, restrinja com `>` na fronteira e registre a mudança.

### 7.4 `goals` (191 linhas)

```sql
insert into public.goals (id, scope, team_id, profile_id, period_type, period, metric, target, created_by, created_at, updated_at)
values ('<bid>', 'team', '<team uuid>', null, 'month', '2024-05-01', 'sales', 12, null, '2024-05-11 20:13:00-03', '2025-10-21 17:52:00-03')
  -- … 191 linhas
on conflict (team_id, period_type, period, metric) where scope = 'team'
  do update set target = excluded.target;
```

### 7.5 `annual_results` (66 linhas)

Único upsert genuíno do domínio (unique de tabela):

```sql
insert into public.annual_results (id, year, month, sales_count, vgv, notes, updated_by, created_at, updated_at)
values ('<bid>', 2021, 1, 38, 5412345.67, 'bubble:1715463668646x265778707806289920', null, '2024-05-11 18:41:00-03', '2026-07-13 14:30:00-03')
  -- … 66 linhas (2024-11 = só a linha B)
on conflict (year, month) do update
  set sales_count = excluded.sales_count, vgv = excluded.vgv, notes = excluded.notes;
```

---

## 8. Lacunas

### 8.1 Dado da origem sem destino no schema novo

| # | Origem | Volume | Situação | Saída proposta |
|---|---|---:|---|---|
| L1 | `gameficacaos` sem `gameMes` | 434 linhas (113 pessoas) | Regime de dados diferente: `Status*` guardam pontos, não contadores (`StatusEsteiraAgil` múltiplo de 200 em 98 de 103 casos, máx 3.000); `pontos` fecha em só 8 de 200 linhas com valor; até 6 linhas por pessoa sem critério de desempate | **Descartar.** Importar como placar inflaria a escala em ordens de grandeza |
| L2 | `meta-equipes.meta_remuneracao` | 160 valores | `goals.metric` tem CHECK fechado em `sales, vgv, leads, visits, analyses, approvals`; não há valor para "meta de remuneração" e não há segunda coluna de alvo | Decisão D2: (a) descartar, (b) migration acrescentando `sales_comp` ao CHECK |
| L3 | `meta-equipes.equipe` vazia (8) e `meta-constutoras.equipe` vazia (11) | 19 linhas | `goals` com `scope='global'` **proíbe** `team_id`, então a linha caberia como meta global — mas a hipótese "meta global antes do desdobramento" não é verificável no export | **Descartar.** Uma meta global inventada polui o índice `goals_global_idx` e a tela de meta da casa |
| L4 | `meta-constutoras` inteira | 389 linhas úteis | Sem escopo de construtora em `goals` e sem `developer_id`. Não é `marketing_investments` (lá é dinheiro, aqui é unidade) | Decisão D6 |
| L5 | `financeiros` inteira | 26 linhas / 7 negócios | Sem tabela de plano de pagamento no alvo; `nomeCampo` é texto livre; arquivo sem `unique id` | Decisão D7 |
| L6 | `gameficacaos.equipe` / `.Diretor` | 582 / 563 valores | Retrato mensal de vínculo; `game_season_results` não tem essa dimensão | Repassar ao domínio de identidade como evidência de `team_members.joined_at/left_at` (14 pessoas mudaram de equipe, 2 mudaram de diretor) |
| L7 | `ligacao` como evento vivo | 3.425 eventos | Nenhum gatilho do FACEIMOB emite `ligacao`; o código só existirá como regra histórica | Aceito: o histórico preserva os pontos no `breakdown`; o produto novo simplesmente não pontua ligação |
| L8 | `vendas` (6) | 6 linhas | Resíduo abandonado, coberto por `pipelines` | Descartar |

### 8.2 Coluna NOT NULL do destino sem origem

| Tabela | Coluna | Origem? | Default proposto |
|---|---|---|---|
| `game_seasons` | `label` | `Mes_nome` (irregular) | `season_label_ptbr(period_start)` |
| `game_scoring_rules` | `label` | não existe | literal por código: `Análise aprovada`, `Envio para esteira ágil`, `Incompleto com documento`, `Ligação`, `Venda` (os mesmos do `seed.sql:150-156`) |
| `game_season_results` | `rank` | não existe | `row_number()` por `(points desc, full_name)` dentro da temporada |
| `game_season_results` | `vgv` | não existe | `0` (default da coluna); backfill opcional §7.3 |
| `game_season_results` | `points` | `pontos` (14 fracionários, 222 vazios no arquivo) | vazio → `0`; fracionário → ROUND_HALF_UP |
| `game_season_results` | `sales` | `StatusVenda` (429 vazios, 2 negativos) | vazio → `0`; negativo → `0` |
| `goals` | `scope`, `period_type`, `metric` | não existem | literais `'team'`, `'month'`, `'sales'` |
| `annual_results` | `sales_count`, `vgv` | `vendas`, `vgv` | 100 % preenchidos; nenhum default necessário |
| `funnel_targets` | `scope` | **nenhum CSV corresponde** | manter a linha `global` 10/40/50 do `seed.sql:133-136`. Volume importado: 0 |
| `marketing_investments` | `developer_id`, `period`, `amount` | **nenhum CSV corresponde** | não carregar. Volume: 0 |
| `daily_reports` / `daily_entries` | `team_id` / `report_id`, `profile_id` | **nenhum CSV de diário existe no export** (`ligacoes` é chamada por lead, não checkpoint de equipe) | não carregar. Volume: 0 |

---

## 9. Decisões que só o dono do negócio toma

| # | Decisão | Opções e consequências |
|---|---|---|
| **D1** | **Importar o placar histórico do jogo?** (629 linhas, Mar–Set/2026) | **Sim:** a tela de Gamificação (`pages/Gamification.tsx:445,488`) passa a mostrar as 7 temporadas fechadas com pódio. **Não:** o jogo começa do zero e nada se perde de operacional — o placar do Bubble não alimenta comissão nem relatório fiscal. Custo de importar: baixo (929 linhas no total). |
| **D2** | **`meta_remuneracao` (160 valores) morre ou ganha coluna?** | (a) **Descartar:** perde-se o patamar contratual de comissionamento de 2024-09 a 2026-09; o painel fica só com a meta operacional. (b) **Migration** acrescentando `'sales_comp'` ao CHECK de `goals.metric` e importando 160 linhas a mais: preserva o dado, mas cria uma métrica que nenhuma tela lê hoje (trabalho de front pendente). |
| **D3** | **As metas de 2025-09 a 2025-12 são vendas mesmo?** | A soma mensal salta de ~90 para 138/162/209/**363**. Pode ser mudança de unidade, campanha de fim de ano ou erro de digitação. **Importar como está:** o gráfico realizado × meta mostra 4 meses de fracasso artificial. **Excluir os 4 meses:** buraco na série. **Corrigir:** exige o número certo, que só a operação tem. |
| **D4** | **2024-11 duplicado: confirmar a escolha da linha B (59 vendas / R$ 12.069.138,34)?** | A evidência é forte (bate com `pipelines` a 0,002 %), mas a linha A (109 / 22,4 M) está no sistema legado há 2 anos e pode ter virado número oficial em alguma apresentação. |
| **D5** | **Lançar 2024-10, que a origem nunca teve?** | (a) Deixar o mês ausente: o gráfico anual de 2024 fica com 11 pontos. (b) Lançar 91 vendas / R$ 19.450.408,58 recontados de `pipelines`, com `notes` marcando que é derivado, não lançado. |
| **D6** | **O que fazer com as metas por construtora (389 linhas)?** | (a) **Descartar:** perde o desdobramento por incorporadora; a série já tem 6 buracos e não cobre as equipes novas depois de 2026-01. (b) **Migration** acrescentando `developer_id` a `goals` + estender o índice único: preserva o dado e abre uma tela nova a construir. (c) Guardar em CSV fora do banco para consulta. |
| **D7** | **Plano de pagamento (`financeiros`, 7 negócios)?** | (a) **Não importar** (recomendado): tabela nova para 26 linhas, com rótulo texto livre e sem `unique id` no export. (b) Importar depois, exigindo reexport do Bubble com `unique id` e uma tabela `deal_payment_items`. |
| **D8** | **Criar `private.import_bubble_map`?** | Não é necessário para idempotência (o UUIDv5 resolve). Vale só se a operação quiser auditar reimportações. Exige migration. |
| **D9** | **Corte temporal.** | Este domínio já é naturalmente recente: o jogo só existe de 03/2026 em diante e as metas de 05/2024. A única série longa é `resultado-anuals` (2021-01 a 2026-07). Importar 2021–2023 custa 36 linhas e é a **única** base histórica que existe (`pipelines` só começa em 2024-01) — recomendo importar tudo, mas a decisão de exibir 5,5 anos no painel é do dono. |
| **D10** | **Quando abrir a temporada nova?** | A carga termina sem temporada aberta (§2.1). Alguém precisa abrir a de produção (tela de Gamificação, ou INSERT direto). Enquanto não abrir, todo movimento gera aviso `game_paused` no sino do corretor. |

---

## 10. Volume estimado por tabela destino

| Tabela destino | Linhas | Origem | Observação |
|---|---:|---|---|
| `game_seasons` | **7** | `DadosGames` | todas fechadas |
| `game_scoring_rules` | **35** | `DadosGames` (5 pesos × 7) | `season_id` preenchido; inclui 7 linhas de `ligacao` |
| `game_season_results` | **629** | `gameficacaos` com `gameMes` | 393 com sinal + 236 zeradas. Importar as 629: o `rank` só faz sentido com o conjunto completo de participantes |
| `goals` | **191** | `meta-equipes` | `scope='team'`, `metric='sales'`. +160 se D2 = (b) |
| `annual_results` | **66** | `resultado-anuals` | 67 − 1 (duplicata de 2024-11). +1 se D5 = lançar 2024-10 |
| `game_events` | **0** | — | recomendado. Alternativa descartada: 1.009 linhas agregadas por (pessoa, temporada, código) ou 6.623 sintéticas — sem `ref_id`, portanto **sem idempotência**, com `occurred_at` inventado e sem representar os `,5` |
| `funnel_targets` | **0** | — | seed global 10/40/50 já cobre |
| `marketing_investments` | **0** | — | nenhum CSV corresponde |
| `daily_reports` / `daily_entries` | **0** | — | não há CSV de diário no export |
| **Total** | **928** | | (1.088 se D2 = (b); 1.317 se D6 = (b)) |

Linhas da origem descartadas por regra: 434 (`gameficacaos` legado) + 10 (`meta-equipes` sem equipe/mês) + 402 (`meta-constutoras`, pendente D6) + 1 (`resultado-anuals` linha A) + 6 (`vendas`) + 26 (`financeiros`, pendente D7) = **879**.

---

## 11. Verificação pós-carga

```sql
-- 1. nenhuma temporada aberta durante a carga; exatamente uma depois de D10
select count(*) from public.game_seasons where closed_at is null;

-- 2. 7 temporadas legadas presentes e fechadas
select label, period_start, period_end, closed_at is not null as fechada
  from public.game_seasons where period_start >= '2026-03-28' order by period_start;

-- 3. soma do breakdown == points (a chave 'ajuste' existe para isto fechar)
select count(*) from public.game_season_results
 where points <> coalesce((select sum(v::numeric) from jsonb_each_text(breakdown) as e(k,v)), 0);
-- esperado: 0

-- 4. rank sem buraco nem empate dentro da temporada
select season_id, count(*) as linhas, count(distinct rank) as ranks
  from public.game_season_results group by 1;   -- linhas = ranks em todas

-- 5. pontuação acidental na temporada corrente durante a carga
select event_code, count(*) from public.game_events
 where created_at > '<início da carga>' group by 1;   -- esperado: vazio

-- 6. avisos de jogo parado gerados pela carga (limpar)
select count(*) from public.notifications where kind = 'game_paused';
delete from public.notifications where kind = 'game_paused';

-- 7. goals sempre no dia 1
select count(*) from public.goals
 where period_type = 'month' and period <> public.month_start(period);   -- esperado: 0

-- 8. contagens
select 'game_seasons' t, count(*) from public.game_seasons where period_start >= '2026-03-28'
union all select 'game_scoring_rules', count(*) from public.game_scoring_rules where season_id is not null
union all select 'game_season_results', count(*) from public.game_season_results
union all select 'goals', count(*) from public.goals where scope = 'team' and metric = 'sales'
union all select 'annual_results', count(*) from public.annual_results;
-- esperado: 7 · 35 · 629 · 191 · 66
```

---

## 12. Suposições declaradas

1. **Fuso `America/Sao_Paulo`** para todo instante do Bubble; o export não declara offset. Sem horário de verão no Brasil desde 2019 → offset fixo `-03:00` em 2021–2026, sem instante ambíguo.
2. **`mes`/`data` são competência mensal, não instante** — sustentado por 667 de 667 valores com dia 1 e hora 00:00. Não passar por conversão de fuso.
3. **`Status*` são contadores de evento** nas 629 linhas com `gameMes` — sustentado pela reconciliação `pontos = Σ(contador × peso)` em 622 de 629 (conferência própria, `g4.py`), não por documentação do Bubble.
4. **`Status*` são pontos acumulados** nas 434 linhas sem `gameMes` — sustentado pela divisibilidade pelos pesos antigos e pela magnitude. Por isso o bloco é descartado.
5. **Os 7 deltas de Agosto são ajuste manual no fechamento** — todos com `Modified Date` no instante do fechamento e magnitude compatível com meia venda / 2 aprovados. Alternativa não descartada: os pesos foram editados no meio da temporada e o export só mostra o valor final. Em qualquer dos casos, `pontos` do Bubble é a verdade adotada.
6. **`0,5` é meio crédito por rateio de negócio entre dois corretores** — inferido de a fórmula fechar exatamente com os meios.
7. **`meta_remuneracao` é o patamar contratual de comissionamento** — inferido do comportamento (só a partir de 2024-09, estável por equipe enquanto `meta` oscila, `0` para a equipe interina). Não há descrição de campo no export.
8. **A carga de identidade vai produzir o de-para `Users.unique id → profiles.id`.** Sem ele, §3.1 degrada para heurística de nome e a cobertura cai de 100 % para ~93 % com casos ambíguos.
9. **`teams.name` no destino será igual a `Equipes.nome` do Bubble** (incluindo `"Susana "`; a normalização REGRA-S1 protege contra o espaço).
10. **Nenhum dado pessoal sensível neste domínio.** Os 7 arquivos não contêm CPF, PIS, telefone, e-mail, endereço nem senha; o único dado pessoal é o nome, que aparece aqui apenas em nomes de equipe e de gestor já presentes na hierarquia.
