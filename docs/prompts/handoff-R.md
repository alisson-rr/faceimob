# Handoff R — "19. REPROVADO" encerra o negócio; motivo obrigatório virou obrigatório

27/08/2026 · branch `nova` · **nada commitado** · **nada publicado**
(a Tarefa Q publica nesta rodada; o meu diff fica fora do ar — §8).

Rodou em paralelo com Q e S. Toquei só `src/lib/dealStatus.*`,
`src/components/pipeline/**` e `e2e/admin/perder-negocio.spec.ts`.

---

## 1. O placar

| | Antes | Agora |
|---|---|---|
| `npm run typecheck` | ✅ | ✅ os 3 projects |
| `npm run lint` | 0 erros · 7 avisos | **0 erros · 7 avisos** (os mesmos, todos `react-refresh` pré-existentes) |
| `npx vitest run` | 192 | **199** (+7) |
| `npm run build` | ✅ | ✅ 10,08 s |
| `npx playwright test e2e/admin/perder-negocio.spec.ts` | 4 verdes | **5 verdes** (42,9 s) |

> **Ressalva sobre o número de testes de unidade.** O enunciado dizia 190; a
> baseline que eu medi antes de escrever qualquer teste era **192**. Não
> investiguei a diferença — `src/lib/type-scale.test.ts` é da Tarefa N e a
> Tarefa S está mexendo nele agora, então a contagem se move sozinha. Os **+7**
> são meus e são verificáveis: 4 em `dealStatus.test.ts` e 3 em
> `statuses.test.ts` (novo).

O E2E rodou em `E2E_PORT=5299`: a 5199 estava ocupada por um `vite` de outra
tarefa desta rodada. Não matei o processo.

---

## 2. Entrega 1 — onde corrigi, e por que ali

### 2.1 A decisão

**Não mexi em `normalizeStatus` nem em `Status1`.** Criei uma lista única de
motivos de perda + um predicado em `src/lib/dealStatus.ts`, e o `if` do
`changeStatus` passou a consultar o predicado.

```ts
// src/lib/dealStatus.ts
export const LOSS_REASONS = ["17. DISTRATO", "18. QUEDA", "19. REPROVADO", "OFF"];
const LOSS_LABELS = new Set(LOSS_REASONS.map(bare));
export const isLossStatus = (s) => LOSS_LABELS.has(bare(s));
```

`bare()` é a normalização de rótulo que já existia **dentro** de
`normalizeStatus` (tira prefixo numerado, apara, caixa alta), agora extraída
para as duas usarem — refatoração sem mudança de comportamento, provada pelos
testes de `normalizeStatus` que continuam idênticos e verdes.

`LOSS_REASONS` foi **movida** do `LoseDealDialog` para lá. Não há mais duas
listas: o diálogo importa a lista para montar o Select, o `changeStatus`
importa o predicado. Uma regra, uma casa.

### 2.2 Por que não em `normalizeStatus`

O enunciado descreve a opção "acrescentar `REPROVADO` a `Status1`" como a que
"alcança de uma vez todos os chamadores". **Fui conferir chamador por chamador
e ela não alcança nenhum.** Com `REPROVADO` dentro de `Status1`, e sem tocar em
mais nada:

| Chamador | Regra hoje | Com `REPROVADO` em `Status1` |
|---|---|---|
| `dashboard/data.ts` (5 usos) | compara com `"VENDA"`, `"PROPOSTA"`, `"QUEDA"`, `"DISTRATO"` **literais** | idêntico |
| `isResultado` / `isProducao` | `=== "VENDA"` / `=== "PROPOSTA"` | idêntico |
| `DealForm.tsx:55` | `QUEDA \|\| DISTRATO \|\| OFF` | idêntico |
| `newSchema.ts:574` (`saveLegacyDeal`) | `QUEDA \|\| DISTRATO \|\| OFF` | idêntico |
| `useDealActions.ts:70` | `QUEDA \|\| DISTRATO \|\| OFF` | **idêntico — o bug continua de pé** |
| `isPerda` | `QUEDA \|\| DISTRATO` | passaria a `true` — e `isPerda` **não tem um único consumidor** no repositório |

Ou seja: mexer em `Status1` **não conserta o defeito** (o `if` lista três
constantes soltas, não consulta `Status1` inteiro) e o único efeito real seria
armar `isPerda` — que hoje é código morto. No dia em que alguém plugar `isPerda`
no dashboard, "reprovado" viraria perda contábil sem que ninguém tivesse
decidido isso. É a "mudança de número que a diretoria vê sem aviso" do
enunciado, só que diferida e sem rastro.

Há ainda um argumento de contrato: `dealStatus.test.ts:21` declara
`normalizeStatus("19. REPROVADO") → null` como comportamento **desejado**
("tira o prefixo sem inventar status para os demais rótulos"), e `legacyStatus()`
em `newSchema.ts:160` só produz VENDA/PROPOSTA/QUEDA/DISTRATO. `Status1` é o
vocabulário do relatório; "REPROVADO" é rótulo do Status 2. São camadas
diferentes e continuam separadas.

**Encerrar ≠ contar como perda.** É a distinção que o predicado novo torna
explícita e que `isPerda` guarda: `isLossStatus("19. REPROVADO")` é `true` (tira
do funil), `isPerda("19. REPROVADO")` é `false` (não entra na conta de perdas do
dashboard). "OFF" é o mesmo caso e já era assim — a semântica declarada no topo
do arquivo o chama de "Ignorado", não de "Perda". Há teste para os dois.

### 2.3 Quantas linhas do banco a escolha afeta: **zero**

Consultado no banco de homologação (`deals`, 27/08/2026):

```sql
select coalesce(status_detail,'(null)'), outcome, count(*) from deals group by 1,2;
-- (null) | open | 20
-- (null) | won  |  9
-- (null) | lost |  2
```

| | |
|---|---|
| negócios em `deals` | 31 |
| com `status_detail` preenchido | **0** |
| com `"19. REPROVADO"` (normalizado, com ou sem prefixo) | **0** |
| linhas em `deal_history` citando REPROVADO | **0** |

**Nenhum negócio da homologação tem `status_detail`.** A coluna existe desde a
migration `0020` e o seed não a preenche; quem grava ali é exatamente a tela que
eu corrigi. Então:

- **o caminho que escolhi** muda 0 linhas — ele só decide o que acontece daqui
  para frente;
- **o outro caminho** (`REPROVADO` em `Status1`) também mudaria 0 linhas *hoje*,
  porque não há o que reler. A diferença entre os dois não é o número de agora, é
  o que cada um faz com o próximo "19. REPROVADO" que for gravado: o meu manda
  para a confirmação; o outro deixaria `isPerda` armado para reclassificá-lo em
  silêncio na primeira vez que alguém usasse essa função.

Em produção o quadro pode ser outro — lá o `status_detail` vem da planilha. Se
alguém for aplicar isto numa base com histórico, a conferência é uma linha:
`select count(*) from deals where status_detail ilike '%REPROVADO%'`. Com o
caminho que escolhi, essas linhas **não mudam de leitura**: continuam onde estão,
com a etapa que têm. Nenhuma retroatividade.

### 2.4 Um segundo buraco, no mesmo rótulo

`LoseDealDialog.tsx:45` testava o preset com `normalizeStatus(presetStatus)`.
Como isso devolve `null` para "19. REPROVADO", **mesmo com o `if` corrigido** o
diálogo abriria mostrando "17. DISTRATO" — trocando o motivo escolhido pelo mais
forte da lista, sem avisar. Agora usa `isLossStatus`, e o teste E2E novo cobra o
rótulo certo no Select.

Este achado é o argumento mais forte a favor de um predicado único: os dois
pontos que decidiam "isto é perda?" erravam do mesmo jeito, por perguntarem à
função errada.

---

## 3. Entrega 2 — o diálogo nos dois caminhos de entrada

| Entrada | Motivo | Botão "Encerrar negócio" |
|---|---|---|
| Botão "Perder o negócio de X" na linha | **vazio**, placeholder "Escolha o motivo" | **desabilitado** até escolher |
| Status 2 da tabela → rótulo de perda | **pré-preenchido** com o rótulo escolhido lá | habilitado |

O que mudou em `LoseDealDialog.tsx`: estado inicial `""` em vez de
`LOSS_REASONS[0]`; `SelectValue` com `placeholder`; `disabled={saving || !allowed || !status}`;
e um `if (!lostStage || !status) return` no `confirm()` — a guarda vale por si,
não confia só no botão desabilitado.

Duas armadilhas que o diff precisou tratar:

1. `choices` era `LOSS_REASONS.includes(status) ? … : [status, ...LOSS_REASONS]`.
   Com `status = ""` isso renderizaria um `<SelectItem value="">`, que o Radix
   **recusa em runtime** ("must have a value prop that is not an empty string").
   Virou `!status || LOSS_REASONS.includes(status) ? …`.
2. O galho `[status, ...LOSS_REASONS]` continua necessário: `isLossStatus` aceita
   rótulo sem prefixo ("QUEDA", vindo de importação), que é motivo válido e não
   está na lista literal. Sem ele o Select abriria em branco com o preset.

### O que isso quebrou na suíte da Tarefa P — e o que fiz

Duas asserções cobravam o comportamento antigo. **Ajustei as duas**, com o
motivo escrito no lugar:

| `perder-negocio.spec.ts` | Antes | Agora |
|---|---|---|
| linha 112 | `toBeEnabled()` ao abrir pelo botão | `toBeDisabled()` + o motivo nasce em "Escolha o motivo" |
| linha 150 | reabrir mostra "17. DISTRATO" | reabrir mostra "Escolha o motivo" |

O teste que o enunciado mandou preservar — **"perder pelo Status 2 da tabela
passa pela mesma confirmação"**, que depende do preset — não precisou de uma
linha: é justamente o caminho onde o pré-preenchimento fica. Verde nas duas
execuções.

Também reescrevi o parágrafo do cabeçalho do spec que documentava
"confirmar sem motivo não existe na tela": agora existe, e é recusado.

---

## 4. Entrega 3 — os testes

### 4.1 Unidade — +7

**`src/lib/dealStatus.test.ts`** (+4), quatro `it` novos em `describe("isLossStatus")`:

- todo item de `LOSS_REASONS` satisfaz `isLossStatus` — a lista e o desvio são a
  mesma regra, e este teste falha no dia em que voltarem a ser duas;
- compara sem prefixo (`"QUEDA"`, `"REPROVADO"`, `"  19. reprovado  "`);
- não encerra o que não é motivo (`"16. PENDENTE"`, `"21. RESTRIÇÃO"`,
  `"PROPOSTA"`, `"VENDA"`, `""`, `null`);
- **o que não mudou**: `normalizeStatus("19. REPROVADO")` continua `null`,
  `isPerda("19. REPROVADO")` e `isPerda("OFF")` continuam `false`. É o teste que
  guarda o número da diretoria contra a correção.

**`src/components/pipeline/statuses.test.ts`** (novo, 3 testes) — o cruzamento
entre catálogo e semântica, que é onde o defeito nasceu e onde o próximo vai
nascer. Ver §5.

### 4.2 E2E — +1

`"19. REPROVADO" na tabela não grava direto — passa pela mesma confirmação`,
no feitio dos quatro da P: cobra `deals`, não o toast.

Escolher "19. REPROVADO" no Select da linha → a confirmação abre → o motivo
chega escolhido → **1 s de espera e `deals` idêntico ao de antes** (objeto
inteiro: `stage_id`, `outcome`, `status_detail`, `lost_reason`, `closed_at`) →
confirmar grava `status_detail` e `lost_reason` = "19. REPROVADO", `stage_id` =
etapa Perdido, `outcome` = `lost`, e o negócio sai da conta de
`outcome=eq.open`.

**Provado que o teste reprova sem a correção.** Copiei `useDealActions.ts` para
o scratchpad, devolvi o `if` antigo (`normalizeStatus` + três constantes), rodei
e restaurei da cópia:

```
1 failed
  [admin] › perder-negocio.spec.ts:224 › "19. REPROVADO" na tabela não grava direto
  > 238 |     await expect(confirmacao(page)).toBeVisible();
```

Falha exatamente onde deve: a confirmação **não abre**. Depois de restaurar, os
5 voltaram a passar. Nenhum `git checkout` / `git restore` foi usado em nenhum
momento desta tarefa.

---

## 5. Os outros rótulos do Status 2 — o que eu achei

Correção de dois números do enunciado, conferidos em `statuses.ts`:

- o catálogo tem **32** rótulos, não 19 (21 com prefixo numérico de "02." a
  "21." — o 15 aparece duas vezes — e 11 sem prefixo);
- deles, **três** viram `Status1`, não cinco: `PROPOSTA`, `17. DISTRATO`,
  `18. QUEDA`. `VENDA` e `OFF` são `Status1` mas **não estão no catálogo**, ou
  seja, não são escolhíveis no Select da tabela.

**Nenhum outro rótulo cai no mesmo buraco.** Varri os 32 procurando algo que
signifique encerramento e não estivesse em `LOSS_REASONS`. Os candidatos são os
de tom `danger`, e nenhum é perda:

| Rótulo `danger` | Encerra? | Por quê |
|---|---|---|
| `17. DISTRATO`, `18. QUEDA`, `19. REPROVADO` | sim | são os três motivos alcançáveis pela tabela |
| `APROV. TOT. RESTRIÇÃO`, `APROV. COND. RESTRIÇÃO` | não | aprovado **com** restrição — o negócio segue vivo |
| `INCOMPLETO` | não | estado de cadastro, não desfecho |

Ou seja: o tom vermelho e o encerramento **não coincidem**, e o único rótulo em
que coincidiam e que escapava era o "19. REPROVADO".

Isso está travado em `statuses.test.ts`, para não depender da minha leitura:

- `rotulos.filter(isLossStatus)` === exatamente os três;
- `"OFF"` está em `LOSS_REASONS` e **não** está no catálogo — pela tabela há três
  caminhos de entrada para a perda, não quatro;
- os rótulos que viram `Status1` são exatamente `["PROPOSTA", "17. DISTRATO", "18. QUEDA"]`,
  e o catálogo tem 32 itens.

Acrescentar um rótulo ao catálogo sem decidir o que ele significa agora reprova
um teste em vez de virar o próximo achado.

---

## 6. A duplicação que sobra — e por que sobrou

A regra "este status encerra o negócio" existia em **quatro** lugares. Ficaram
dois, e os dois que ficaram estão fora do meu escopo de edição:

| Lugar | Estado |
|---|---|
| `useDealActions.ts:73` | ✅ usa `isLossStatus` |
| `LoseDealDialog.tsx:20` (`LOSS_REASONS`) | ✅ importa a lista de `dealStatus.ts` |
| `newSchema.ts:574` (`saveLegacyDeal`) | ⛔ `QUEDA \|\| DISTRATO \|\| OFF` — fora do escopo |
| `DealForm.tsx:55` (`willLose`) | ⛔ mantido de propósito |

**Por que não toquei no `DealForm`, mesmo ele sendo meu.** O `willLose` só
desenha um aviso: *"Salvar com este status encerra o negócio"*. Quem de fato
decide a etapa ao salvar é `saveLegacyDeal`, em `newSchema.ts` — que a lista de
arquivos desta tarefa não inclui. Trocar só o `willLose` por `isLossStatus`
faria a tela **prometer** um encerramento que o gravador não cumpre, o que é
pior que o desalinhamento atual. Deixei os dois coerentes entre si e pus um
comentário no `DealForm` explicando que ele é espelho de `saveLegacyDeal`, para
ninguém "corrigir" só a metade visível.

**Consequência prática, e ela é real:** "19. REPROVADO" agora encerra o negócio
pelo Select da tabela e pelo diálogo, mas **salvar "19. REPROVADO" no editor do
negócio** (modal de detalhe ou criação — mesmo catálogo de 32 rótulos) ainda
mantém a etapa, com `lost_reason` nulo. É o terceiro caminho de entrada, e é o
mesmo defeito. Fechá-lo é um diff de duas linhas em `saveLegacyDeal`
(`isLossStatus(form.status)` no lugar do ternário) mais uma no `DealForm` — para
quem tiver `src/integrations/supabase/newSchema.ts` no escopo.

---

## 7. Arquivos

**Editados**
`src/lib/dealStatus.ts` (`bare()` extraída · `LOSS_REASONS` + `isLossStatus`) ·
`src/lib/dealStatus.test.ts` (+4) ·
`src/components/pipeline/useDealActions.ts` (o `if`) ·
`src/components/pipeline/LoseDealDialog.tsx` (lista importada · motivo vazio · botão travado) ·
`src/components/pipeline/DealForm.tsx` (**só comentário**, §6) ·
`e2e/admin/perder-negocio.spec.ts` (+1 teste · 2 asserções atualizadas · cabeçalho).

**Criado**
`src/components/pipeline/statuses.test.ts` · este handoff.

**Nada em `supabase/`, `package.json`, `src/pages/` ou no resto de `e2e/`.
Nada commitado.**

---

## 8. Publicação

**Não publiquei.** Quem publica nesta rodada é a Tarefa Q, e ela publica antes
de eu terminar. **O meu diff está fora do ar.** Para subir:

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

---

## 9. Fora de escopo — anotado, não feito

- Restaurar a tela de Gamificação (Tarefa Q).
- Restos da varredura tipográfica e o Checkpoint a 375 px (Tarefa S).
- O modal do `NewLeadNotifier` que deixa a página `aria-hidden` (`handoff-P` §7.4).
- **`saveLegacyDeal` (§6)** — a dívida que sobra desta tarefa, e a mais próxima
  de virar o próximo achado.
- **`isPerda` é código morto** — nenhum consumidor no repositório. Ou o dashboard
  passa a usá-la (e aí a conversa sobre o que conta como perda tem de acontecer
  de propósito, com a diretoria), ou ela sai. Não decidi por conta própria; é a
  mesma pergunta que fez eu não mexer em `Status1`.
