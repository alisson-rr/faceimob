# Refutação — `mapa/game_metas.md` pela lente **integridade**

Data: 09/09/2026 · Escopo: só leitura de arquivos (nenhum comando contra o banco, nenhum arquivo de
código alterado). Todo número abaixo saiu de um script `csv.DictReader` (Python 3.12) no scratchpad da
sessão ou de `grep`/`sed` nas migrations — os comandos estão citados em cada linha.

**Veredito: REFUTADO.** A aritmética do mapa está certa e a resolução de FK é melhor do que o próprio
documento vende — reproduzi 629/629, 142/142, 191/191, 622/629 e 66/67 exatamente. O que quebra é a
**mecânica**: (1) a receita de carga que o documento declara idempotente **destrói a temporada de
produção** se rodar duas vezes; (2) a regra de arredondamento de `sales` **conta duas vezes a venda
rateada** — a soma não fecha por +5,2 %; (3) a verificação pós-carga do §11 dá falso negativo em
qualquer banco com os seeds aplicados, que é justamente o de homologação.

---

## 0. O que foi confirmado (para não jogar fora o que está certo)

| afirmação do mapa | como medi | resultado |
|---|---|---|
| 1.063 linhas em `gameficacaos`, 629 com `gameMes`, 434 sem | `g1.py` | ✔ 1.063 / 629 / 434 |
| `gameMes` é `unique id` (não nome de exibição) | `g1.py`, amostra `1774722066067x931…` | ✔ |
| 7/7 `gameMes` resolvem em `DadosGames`, 0 órfãos | `g5.py` + `g6.py` | ✔ |
| **par `(gameMes, user)` único nas 629** | `g1.py` — 629 pares crus e 629 normalizados | ✔ **0 duplicatas** |
| Users = 298; com `GameAtual` = 142; 0 órfãos | `g2.py` | ✔ 298 / 142 / 0 |
| âncora `Users.GameAtual`: 142 nomes curtos, **0 ambíguos, 0 colisões** | `g2.py` | ✔ |
| nomes distintos nas 629 = 142 = exatamente o conjunto ancorado | `g2.py` (0 fora dos dois lados) | ✔ **629/629 cobertas** |
| pesos por temporada da tabela de §5.1 | `g5.py` (dump do CSV) | ✔ linha a linha, incl. o salto de Julho |
| `pontos == Σ(contador × peso)` em 622 de 629 | `g6.py` | ✔ e as 7 divergências são todas de Agosto com `Modified Date = Sep 1, 2026 12:52 pm` |
| `meta-equipes`: 201 → 191 úteis, 2 sem `mes`, 8 sem `equipe` | `g3.py` | ✔ |
| 191 pares `(equipe, mes)` distintos **mesmo depois de REGRA-S1 + [D1]** | `g3.py` | ✔ 0 colisões — `"Susana "` não colide com ninguém |
| `mes`: 191/191 no dia 1 às 00:00 | `g3.py` | ✔ |
| `resultado-anuals`: 67 linhas, 66 meses, só 2024-11 duplicado, 2024-10 ausente | `g4.py` | ✔ |
| índices parciais `game_scoring_rules_default_idx` / `_season_idx` | `0010:96-99` | ✔ a cláusula `on conflict (…) where …` do §4 é a forma correta |
| `game_season_results` sem coluna `id`, PK `(season_id, profile_id)` | `0010:131-142` | ✔ |
| `goals_team_idx (team_id, period_type, period, metric) where scope='team'` | `0011:87-91` | ✔ |
| `annual_results` com `unique (year, month)` | `0012:306-318` | ✔ |
| regra de `rank` da RPC = `row_number() over (order by points desc, full_name)` | `0060:528-532` | ✔ |
| jogo parado grava **um** aviso `game_paused` **não lido por pessoa** | `0078:166-201` | ✔ e o comentário confirma: "O ponto não é recuperado quando a próxima temporada abrir" |
| `annual_results.notes` não é apagado pela tela | `src/pages/Resultados.tsx:120-137` | ✔ a tela reenvia o `notes` atual no upsert |

Ou seja: **o casamento por nome não produz falso positivo nem perda silenciosa** no recorte importável.
A âncora `GameAtual` é genuinamente determinística. O problema é outro.

---

## 1. [ALTA] A receita do §7.1 **não é idempotente — é destrutiva**: reexecutar fecha a temporada de produção

O §4 afirma, em negrito, que a tabela de-para "não é necessária para idempotência — o UUIDv5 já
resolve". Isso vale para as 5 tabelas de destino. **Não vale para o passo 1 da própria receita**, que
não usa chave nenhuma:

```sql
-- §7.1, dentro do begin/commit
update public.game_seasons
   set closed_at = now(), period_end = greatest(period_start, current_date)
 where closed_at is null;          -- ← sem filtro por id, label ou procedência
```

Sequência que o próprio §1 prescreve: passo 8 abre a temporada de produção, passo 9 religa os crons.
A partir daí existe **uma** temporada aberta (garantida pelo índice `game_seasons_one_open`,
`0010:74-75`). Qualquer reexecução do §7.1 — corrigir um peso, reimportar depois de falha parcial,
rodar de novo "porque é idempotente" — pega essa temporada no `where closed_at is null` e a fecha.

Consequências, todas verificadas no código:

1. **O ranking da temporada corrente nunca é congelado.** Quem escreve `game_season_results` é só a
   RPC `close_game_season` (`0060:528`) e os seeds — um `UPDATE` cru na tabela não dispara nada
   (`grep "create trigger" *.sql | grep game_seasons` devolve apenas `game_seasons_set_updated_at`,
   `0010:77`). O placar do mês em curso some.
2. **Todo ponto seguinte é descartado em silêncio e não volta.** `award_game_points` com
   `current_game_season()` nulo entra no ramo de aviso e faz `return null` (`0078:166-201`); o
   comentário da própria migration diz que o ponto não é recuperado quando a próxima temporada abrir.
   Os quatro gatilhos (`deals_award_points`, `deal_participants_award_points`, `cca_award_points`,
   `deal_documents_award_points`) passam a não pontuar nada.
3. **O sintoma visível é só um sino.** Cada pessoa recebe **um** aviso `game_paused` não lido — e o
   passo 7 da própria carga manda apagar `notifications where kind = 'game_paused'`. Quem seguir o
   roteiro apaga o único rastro.
4. **Reabrir não é trivial:** `game_seasons_closed_consistency` (`0010:69-71`) é bicondicional, então
   voltar `closed_at = null` obriga a zerar `period_end` junto.

O §11 tem o teste certo (verificação 1: `count(*) where closed_at is null`), mas ele é descrito como
teste **de carga** ("nenhuma durante a carga; exatamente uma depois de D10") — ninguém roda isso depois
de um reimport de correção.

**Correção mínima** (não exige tabela nova nem migration): trocar o passo 1 por uma pré-condição que
**aborta** em vez de fechar, e deixá-lo fora do bloco reexecutável.

```sql
-- pré-condição, roda uma vez, antes do begin
do $$
begin
  if exists (
    select 1 from public.game_seasons s
     where s.closed_at is null
       and exists (select 1 from public.game_events e where e.season_id = s.id)
  ) then
    raise exception
      'Temporada aberta com eventos reais. Feche pela RPC close_game_season antes de (re)importar.';
  end if;
end $$;

-- só então, e só para a temporada de vitrine que não tem evento nenhum:
update public.game_seasons s
   set closed_at = now(), period_end = greatest(s.period_start, current_date)
 where s.closed_at is null
   and not exists (select 1 from public.game_events e where e.season_id = s.id);
```

---

## 2. [ALTA] O rateio **não bate**: `ROUND_HALF_UP` em `sales` conta a venda partilhada duas vezes

O mapa declara, na suposição 6, que "`0,5` é meio crédito por rateio de negócio entre dois corretores"
— e logo depois, em §6.4, manda `sales = ROUND_HALF_UP(StatusVenda)` (`0,5` → `1`). As duas regras
juntas fazem **uma venda partilhada virar duas vendas** no destino.

Medido (`g6.py`, `g12.py`) sobre as 629 linhas importáveis:

| temporada | Σ `StatusVenda` (real) | Σ `sales` gravado | delta | linhas com `,5` |
|---|---:|---:|---:|---:|
| Março | 35 | 36 | **+1** | 0 (o +1 vem de `-1` → `0`) |
| Abril | 61,0 | 63 | **+2,0** | 2 |
| Maio | 73,5 | 76 | **+2,5** | 5 |
| Junho 26 | 58,0 | 65 | **+7,0 (+12,1 %)** | 14 |
| Julho 26 | 43,0 | 45 | **+2,0** | 4 |
| Agosto 2026 | 46,0 | 48 | **+2,0** | 4 |
| Setembro 2026 | 3 | 3 | 0 | 0 |
| **total** | **319,5** | **336** | **+16,5 (+5,2 %)** | **29** |

Não é ruído de arredondamento: em Junho as 14 metades formam 7 pares, e cada par vira 2 vendas onde
houve 1. O número é **exibido**: `useGameRanking.ts:106` mapeia `row.sales → vendas` e
`Gamification.tsx:120` imprime a coluna. Um diretor que somar a coluna do pódio de Junho lê 65 e
compara com `annual_results` (que virá da contagem real de `pipelines`) — dois números do mesmo produto
discordando em 12 %.

O §11 **não tem verificação de `sales`**. As oito consultas checam temporada aberta, breakdown, rank,
`game_events`, `game_paused`, `period` e contagens — nenhuma olha a soma de vendas.

**Correções possíveis** (o banco não obriga nada: `sales int not null default 0`, `0010:137`, **sem**
`check (sales >= 0)`):

- (a) **`ROUND_HALF_EVEN` ou truncar** — a soma erra menos, mas o corretor com uma única venda
  partilhada aparece com `0` vendas na tela. Preserva o agregado, machuca o individual.
- (b) **Manter `ROUND_HALF_UP` e registrar o líquido no `breakdown`** — acrescentar
  `breakdown['vendas_fracao'] = StatusVenda` nas 29 linhas. A tela continua legível, o número exato
  fica auditável e nenhuma migration é necessária (chave desconhecida é ignorada pelo front,
  `useGameRanking.ts:104-105`). **Menor diff, recomendada.**
- (c) Acrescentar verificação ao §11: `select season_id, sum(sales) from game_season_results group by 1`
  conferida contra a soma de `StatusVenda` do log da carga. Qualquer das opções acima precisa dela.

Nota correlata: `sales < 0 → 0` (2 linhas, `-1`) é apresentado no §5.2 como se fosse imposição do
banco. Não é — não existe `check (sales >= 0)` em `game_season_results`. É escolha de produto, e apaga
do `sales` o único sinal de distrato que a origem tem (o `breakdown` preserva).

---

## 3. [MÉDIA] As verificações 2 e 8 do §11 falham num banco com seeds — que é o de homologação

O §2.1 **sabe** que existem temporadas de seed/demo no destino ("encerre a temporada aberta que existir
no destino (seed/demo)"), mas o §11 espera contagens de tabela limpa: `7 · 35 · 629 · 191 · 66`.
Medido nos seeds que o `db:reset` aplica:

| seed | o que insere | efeito na verificação |
|---|---|---|
| `040:73-84` | 1 `game_seasons` `'Temporada historica demonstrativa'`, `period_start = month_start(current_date) - 3 months` = **2026-06-01** | passa no filtro `period_start >= '2026-03-28'` da verificação 2 → ela devolve 8+ linhas, não 7 |
| `040:105-112` | 3 `game_season_results` | verificação 8 dá **632**, não 629 |
| `040` (bloco `goals`) + `060:837` | **6 + 11** linhas em `goals` | a contagem de `goals scope='team'` estoura os 191 |
| `040:189-195` | 3 `annual_results`, entre elas o mês corrente (2026-09) e o anterior (2026-08) — meses que a série do Bubble **não tem** (ela termina em 2026-07) | verificação 8 dá **≥ 68**, não 66 |
| `060:659-700` | mais `game_season_results` e uma `game_seasons` aberta | idem |

Resultado prático: a verificação pós-carga **acusa erro numa carga perfeita**. O operador aprende a
ignorá-la, e aí ela deixa de detectar a carga que de fato perdeu linha. Correção: filtrar por
procedência em vez de contar a tabela inteira — `where season_id in (<os 7 uuids de §4>)`,
`where id in (<os bid>)` ou `where notes like 'bubble:%'` no caso de `annual_results` (a coluna já
carrega a marca e a tela a preserva).

---

## 4. [MÉDIA] `rank` não é reexecutável: o desempate depende de uma collation que o mapa não fixa

O §5.2 diz que o desempate por `full_name` "é o que torna o rank determinístico e reexecutável", e o
§7.2 manda o **loader** ordenar por `(-points, profiles.full_name)`. Mas quem produziria o rank original
é o Postgres (`0060:532`), com a collation do banco; o loader (Python/Node) ordena por code point. Os
dois discordam em acento.

Medido (`g13.py`, usando `Users.Nome_completo` resolvido pela âncora como proxy de `profiles.full_name`):

| temporada | linhas | linhas empatadas em `points` | posições que mudam entre ordem por code point e ordem sem acento |
|---|---:|---:|---:|
| Março | 89 | 67 | 6 |
| Abril | 91 | 39 | 3 |
| Maio | 95 | 38 | 5 |
| Junho 26 | 87 | 39 | 3 |
| Julho 26 | 88 | 50 | 7 |
| Agosto 2026 | 88 | 45 | 3 |
| Setembro 2026 | 91 | 78 | 8 |
| **total** | **629** | **356 (56,6 %)** | **35** |

35 posições do pódio dependem de qual ordenação o loader usar, e **356 de 629 linhas estão em empate**
— o `rank` é praticamente arbitrário para mais da metade da tabela. A verificação 4 do §11
(`count(*) = count(distinct rank)`) **não detecta nada disso**: `row_number()` sempre gera valores
distintos, então ela passa em qualquer ordenação, certa ou errada.

Correção mínima: fixar a regra — ordenar no **banco**, não no loader (inserir as 629 sem `rank` numa
temporária e derivar com a mesma expressão da RPC); ou, se o rank sair do loader, declarar a collation
(`order by full_name collate "C"`) e usar a mesma dos dois lados. E trocar a verificação 4 por uma que
confira a ordem, não a cardinalidade.

---

## 5. [BAIXA] A mesma pessoa entra duas vezes no pódio — e a métrica de ambiguidade do §3.1 não pode ver isso

A tabela do §3.1 mede "ambiguidade (um nome curto → 2 Users) = 0" e "colisão (um User → 2 nomes
curtos) = 0". Confirmei os dois (`g2.py`). Mas a métrica é da **injetividade nome→User**, e o risco
real está um degrau acima: **dois `Users.unique id` que são a mesma pessoa física**.

Medido (`g8.py`, `g11.py`), com os dados mascarados:

| `Users.unique id` | `Ativo` | nome curto no jogo | e-mail | linhas nas 629 |
|---|---|---|---|---:|
| `1715471847680x488278541024630200` | sim | `Isaias Lucca` | `is********a@faceimob.com.br` (ASCII) | 5 (Maio→Setembro) |
| `1776543984070x320602984160002700` | não | `Isaías Luca` | `is********a@faceimob.com.br` (com `í`, U+00ED) | 1 (Abril) |

Os dois e-mails diferem **em um único code point acentuado** (`0x61` vs `0xed`) — são os únicos 2
e-mails não-ASCII dos 298. Como `profiles.email` é `citext` (`0002:31`), que é *case*-insensível mas
**não** acento-insensível, a carga de identidade cria **dois** perfis, e o `mapa/pessoas.md:116` está
correto quando mede "0 duplicados" (é verdade byte a byte). O resultado neste domínio: a história de
uma pessoa fica partida em duas identidades no pódio, e Abril ganha um participante fantasma de 0 ponto.

Não há colisão de PK (as temporadas não se sobrepõem: 5 linhas Mai–Set contra 1 em Abril), então **não
há perda silenciosa hoje** — mas se houvesse sobreposição, o `on conflict (season_id, profile_id) do
update` do §7.2 sobrescreveria uma linha sem avisar, e a verificação 8 (que já é inválida, item 3) não
veria.

Correção: acrescentar ao §3.1 uma conferência **depois** da tradução — nenhum `profile_id` pode
aparecer mais de 7 vezes nas 629 resolvidas — e uma linha na §12 dizendo que a unicidade de pessoa é
responsabilidade do domínio de identidade, não da âncora. Registrar o par acima como caso conhecido.

---

## 6. [BAIXA] Inconsistências internas menores

| # | Onde | O quê |
|---|---|---|
| a | §6.4 vs §5.2 | `sales` usa `StatusVenda` arredondado, mas `breakdown['venda']` usa o valor **não** arredondado × peso. Uma linha de `0,5` fica com `sales = 1` e `breakdown.venda = 300` de uma venda que vale 600. O invariante da verificação 3 continua fechando (o `ajuste` absorve), mas as duas colunas contam histórias diferentes. |
| b | §3.4 | Define o que fazer quando o `Creator` **não é encontrado** (NULL), mas não quando é **ambíguo** — ao contrário do §3.1, que tem a regra 4 explícita. `Douglas Gomes` casado por subconjunto de tokens contra `profiles.full_name` casa com qualquer "Douglas Gomes *". As 3 colunas são nuláveis, então o dano é baixo; a regra deveria dizer "2+ candidatos → NULL". |
| c | §5.1 vs §7.1 | §5.1 e §3.4 mandam resolver `game_seasons.closed_by` a partir do `Creator` (best effort); o SQL do §7.1 grava `null` nas 7 linhas. Uma das duas seções está errada. |
| d | §1, passos 5 e 6 | "goals — depende de `teams` (independente de 2..4)" e "annual_results — independente de tudo". Ambas têm FK para `profiles` (`goals.created_by`, `0011:78`; `annual_results.updated_by`, `0012:313`). Na prática está coberto porque `profiles` é `[pré]`, mas a frase "independente de tudo" convida a rodar o passo 6 antes da identidade. |

---

## 7. O que **não** consegui refutar

- A âncora `Users.GameAtual` (§3.1). É o ponto mais forte do documento e sobrevive a toda tentativa:
  142 âncoras, 0 órfãos, 0 ambíguos, 0 colisões, 629/629 linhas cobertas, conjunto de nomes idêntico
  dos dois lados. O fallback por subconjunto de tokens (que **sim** é frágil) só toca linhas fora do
  recorte importável.
- As chaves de idempotência das 5 tabelas. Todas conferem contra o DDL, inclusive a armadilha T3 do
  índice parcial (`on conflict (cols) where <predicado>` é mesmo a única forma que compila).
- A unicidade das chaves naturais **na origem**: `(gameMes, user)` 629/629, `(equipe, mes)` 191/191
  mesmo após normalização, `(year, month)` 66/67 com a única duplicata já tratada.
- A reconciliação `pontos = Σ(contador × peso)` (622/629) e a atribuição das 7 divergências ao
  fechamento de Agosto.
- A ordem de carga em relação às FKs: `game_seasons → game_scoring_rules → game_season_results` e
  `profiles`/`teams` em `[pré]` cobrem todas as FKs das 5 tabelas.

---

## 8. Scripts usados

`hdr.py` (cabeçalhos), `g1.py` (duplicatas de `(gameMes,user)`), `g2.py` (âncora `GameAtual`),
`g3.py` (chave de `goals` normalizada), `g4.py` (`annual_results`), `g5.py` (pesos), `g6.py`
(reconciliação e soma de vendas), `g7.py`/`g8.py`/`g10.py`/`g11.py` (homônimos e e-mails), `g12.py`
(metades por temporada), `g13.py` (divergência de `rank`). Todos no scratchpad da sessão, com
`csv.DictReader` + `decimal.Decimal`. Os arquivos deste domínio são pequenos (o maior tem 1.063
linhas); nenhum CSV grande do export foi carregado.
