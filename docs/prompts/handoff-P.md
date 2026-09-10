# Handoff P — A rede de segurança que faltava: perder negócio, teclado, faxina do `e2e:remote`

27/08/2026 · branch `nova` · **nada commitado** · **nada publicado**
(a Tarefa O publica por último nesta rodada).

Rodou em paralelo com M, N e O. **Só `e2e/**` e `playwright.config.ts` foram
tocados** — nenhuma linha de `src/`.

---

## 1. O placar, em números

`npx supabase db reset && npx playwright test`, alvo local, execução serial.

| | Antes (handoff-J) | Agora |
|---|---|---|
| Testes na suíte | 136 | **147** (+11) |
| Passam | 134 | **142** |
| Falham | 2 (flaky, `trava-atendimento`) | **5** (todas em Gamificação — §7.1) |
| `test.skip` novos | 0 | **1** (só no alvo remoto — §5.3) |

```
  5 failed
    [admin]  › gamificacao.spec.ts:108 › o placar da tela é o que está em game_events
    [admin]  › gamificacao.spec.ts:120 › mudar a pontuação em game_scoring_rules muda o placar
    [admin]  › gamificacao.spec.ts:163 › o pódio mostra exatamente os três primeiros
    [admin]  › gamificacao.spec.ts:193 › agrupa pelo diretor real da equipe, sem nome inventado
    [broker] › gamificacao.spec.ts:23  › vê o próprio placar vindo de game_events
  142 passed (6.1m)
```

**As cinco são a mesma coisa e não são minhas: a tela de Gamificação está fora
do kit e a suíte cobra o kit lá (§7.1).** Falham igual quando o arquivo roda
sozinho (`npx playwright test e2e/admin/gamificacao.spec.ts
e2e/broker/gamificacao.spec.ts`), o que descarta ordem de execução e descarta
qualquer coisa que eu tenha tocado: meus arquivos novos vêm depois deles no
alfabeto, e a única mudança minha em `admin/` que roda antes é o `test.skip` do
`fechamento-mes`, que no alvo local é `false` e não muda nada. **Os dois testes
que a J deixou vermelhos (`trava-atendimento`) passaram**, aqui e nas outras seis
execuções desta sessão.

**Onze testes novos**, todos verdes:

| Arquivo | Testes | Cobre |
|---|---|---|
| `e2e/admin/perder-negocio.spec.ts` | 4 | F14 — confirmação com motivo (§2) |
| `e2e/broker/kanban-gesto.spec.ts` | 5 | teclado e arrastar de verdade (§3) |
| `e2e/admin/importar-planilha.spec.ts` | 2 | o `.xls` recusado com instrução (§6) |

Validação:

```
npm run typecheck   ✅ os 3 projects (app, node, e2e)
npm run lint        ✅ 0 erros · 7 avisos pré-existentes (react-refresh, todos em src/)
```

---

## 2. Perder negócio (F14) — `e2e/admin/perder-negocio.spec.ts`

Era um `Switch` em `scale-75` que encerrava o negócio num clique; a Tarefa H
trocou por um `AlertDialog`. Não havia um teste sequer. Agora há quatro, e todos
terminam em `deals` — nenhum para no toast.

### 2.1 O que cobra

| Teste | O que prova, no banco |
|---|---|
| `pedir para perder abre a confirmação e não muda deals` | clicar em "Perder o negócio de X" abre o diálogo e **não escreve nada** (etapa, `outcome`, `status_detail`, `lost_reason` e `closed_at` comparados como um objeto só, depois de 1 s de espera) |
| `cancelar a confirmação não deixa efeito colateral` | com o motivo trocado e a observação digitada, "Cancelar" não grava; o Status 2 da linha **volta ao valor do banco**; e reabrir o diálogo começa do padrão, sem estado vazado |
| `confirmar com motivo encerra o negócio e grava motivo e observação` | `stage_id` = etapa Perdido, `outcome` = `lost`, `closed_at` preenchido, `status_detail` = "18. QUEDA", `lost_reason` = "18. QUEDA — <observação>"; depois de recarregar a linha diz "Perdido" e os dois controles ficam desabilitados |
| `perder pelo Status 2 da tabela passa pela mesma confirmação` | o segundo caminho de entrada (escolher "17. DISTRATO" no Select da linha) **não grava direto** — abre a mesma confirmação com o motivo já escolhido; sem observação o `lost_reason` é o rótulo puro; e o negócio sai da conta de ativos |

**Onde o motivo é gravado** — conferido no código antes de escrever o teste, não
suposto: `LoseDealDialog` faz um `update` em `deals` com
`{ stage_id, status_detail, lost_reason }`. `lost_reason` é `"<rótulo> —
<observação>"` quando há observação e o rótulo puro quando não há. **Não existe
tabela de motivos nem linha própria em `deal_history`.**

### 2.2 O que deliberadamente NÃO cobre

1. **"Confirmar sem motivo" — porque não existe na tela.** O enunciado pedia
   "confirmar sem motivo não grava". Esse caminho é inalcançável: o motivo é um
   `<Select>` que **nasce preenchido** com `LOSS_REASONS[0]` = "17. DISTRATO", e
   pelo Status 2 da linha ele nasce com o rótulo escolhido lá. Não há estado
   vazio a alcançar nem pelo mouse nem pelo teclado. O que dá para cobrar — e é
   o que os testes cobram — é que o motivo gravado **nunca é nulo nem vazio**,
   com e sem observação. A consequência de "obrigatório" ser na prática
   "pré-selecionado" está em §7.3.
2. **O caminho "seu perfil não pode mover para a etapa de perda".** O aviso
   existe (`LoseDealDialog`, com o botão desabilitado), mas é inalcançável com os
   papéis da suíte: `stage_permissions` dá `can_enter` em `lost` para admin,
   director, manager, broker e cca. Alcançá-lo exigiria **mexer na matriz**, que
   é justamente o que `broker/etapas.spec.ts` evita fazer num banco
   compartilhado. Fica descoberto, de propósito e por escrito.
3. **Reabrir um negócio perdido.** A tela não oferece esse caminho ("Reabrir
   depois exige um gestor — não há atalho nesta tela"), então não há o que
   exercitar por aqui.

---

## 3. O gesto de mover o cartão — `e2e/broker/kanban-gesto.spec.ts`

### 3.1 Teclado — coberto, e nunca tinha sido apertado

Quatro testes, todos passando. As teclas vão pelo `Input.dispatchKeyEvent` do
Chromium: é tecla de verdade, não evento sintético.

- **`Shift+→` move para a próxima etapa** — o cartão recebe foco de verdade
  (`toBeFocused()`, para o teste não passar se o `tabIndex` sumir), o rótulo
  acessível ensina o gesto, o toast confirma e `deals.stage_id` muda; o cartão
  aparece na coluna nova.
- **`Shift+←` volta para a anterior** — mesma prova, sentido contrário.
- **seta sozinha NÃO move** — a regra que some sem ninguém notar numa
  refatoração (`if (!event.shiftKey) return;`). Depois de `→` e `←` sem Shift, e
  1 s de espera, a etapa no banco é a mesma, nenhum toast apareceu e o foco
  continua no cartão.
- **Enter abre o negócio** — mesmo `onKeyDown`, caminho mais curto.

### 3.2 Mouse — **ficou coberto**, ao contrário do que o enunciado previa

`await cartao.dragTo(colunaVisita)` funciona e é estável. O Chromium recebe
mouse down, movimento e up, e **o próprio navegador constrói o `DataTransfer` do
HTML5** — que é exatamente o que faltava no `dispatchEvent("dragstart")` de
`broker/etapas.spec.ts`.

**Medido antes de manter, porque HTML5 drag-and-drop tem fama de instável:**
`--repeat-each=3` no arquivo inteiro → **15/15 passaram**, o arrastar em
1,7 s / 1,8 s / 1,9 s. E repetiu verde em **todas as dez execuções desta
sessão** (por arquivo, por project e completas), incluindo as duas interrompidas.
Se algum dia oscilar, o remédio é apagar esse único teste: o efeito continua
provado em `etapas.spec.ts` nos dois sentidos.

Não mexi em `etapas.spec.ts`: ele cobra a **matriz de permissão** (etapa negada
avisa e não grava), e o evento sintético serve bem para isso.

---

## 4. `trava-atendimento` — a causa medida (e ela não é a que estava escrita)

### 4.1 O que o enunciado e o handoff-J diziam

> «`release_expired_leads()` passa a cada 30 s e devolve para a fila o lead que
> estourou o prazo; `trava-atendimento` cria justamente um lead com prazo curto
> e conta com ele na lista do corretor. Na execução completa há minutos entre o
> `beforeAll` e a asserção.»

**Duas coisas nessa frase não se sustentam:**

1. O lead **nunca foi criado no `beforeAll`** — o arquivo já usava `beforeEach`
   (linha 32 da versão da J). A sugestão do enunciado ("criar o lead no momento
   em que vai usá-lo") já estava aplicada.
2. O prazo é `now() + 5 min` e o timeout do teste é 45 s. `release_expired_leads`
   só toca em lead com `attend_deadline < now()`. **O lead do teste não tinha
   como expirar durante o teste.**

### 4.2 O que realmente acontece — medido

Escrevi um spec de medição descartável (rodado e apagado): abrir `/leads` como
corretor, esperar carregar, e **só então** inserir outro lead atribuído a ele —
que é o que `release_expired_leads()` → `assign_lead()` faz a cada 30 s quando o
corretor está na `distribution_queue`. Resultado impresso pela medição:

```
[medição] botões que casam /atender/i com o popup aberto: 1
[medição] texto "Atender agora" no DOM: 1
[medição] botão do lead por PAPEL: 0 · por TEXTO: 1
[medição] aria-hidden no container da página: 14
```

Leitura: o `NewLeadNotifier` abre o popup "Lead atribuído a você!". É um `Dialog`
do Radix, e enquanto ele está aberto **o resto da página fica `aria-hidden`**.
Consequência:

- o botão do lead na linha **sai da árvore de acessibilidade** (0 por papel,
  1 por texto) → `expect(page.getByRole("button", { name: nome })).toBeVisible()`
  falha, que é a linha 68 e a linha 84 da versão antiga;
- o **único** botão que casa `/atender/i` passa a ser o **"Atender agora" do
  popup**, de outro lead → o clique da linha 86 iria para o lead errado.

**O teste não perdia o lead. Perdia a página.** O cron é a *origem* das chegadas
(por isso só morde na execução completa, quando dá tempo de um lead alheio
expirar), mas o *mecanismo* da falha é o modal — o mesmo que o
`playwright.config.ts` já descreve para o paralelismo, e que também vale em série.

### 4.3 O conserto (no cenário, não na aplicação, e sem `retries`)

Em `beforeEach`, **fecha a presença aberta do corretor** antes de montar o
cenário:

```ts
await db.update(`checkins?profile_id=eq.${brokerId}&checked_out_at=is.null`,
                { checked_out_at: new Date().toISOString() });
```

`distribution_queue` exige `checked_out_at is null` (migration `0005`, linha
352). Sem presença aberta o corretor sai da roleta, e **a origem do popup some**
— é determinístico, não uma janela de sorte. O popup continua sendo
comportamento pedido na ata de 23/07; este cenário é sobre a trava, não sobre a
roleta.

Além disso, **as asserções passaram a ser feitas dentro da linha do lead**
(`page.getByRole("row").filter({ hasText: nome })`) em vez da página inteira —
inclusive as duas negativas do fim ("a tela para de cobrar o prazo"), que numa
página `aria-hidden` passariam por motivo errado.

Nesta sessão os três testes de `trava-atendimento` passaram em todas as
execuções que chegaram até eles — a completa, a por project e as duas
interrompidas (numa delas o terceiro teste aparece vermelho: foi o instante em
que o Ctrl+C caiu em cima dele, não uma falha do cenário).

**Ressalva honesta: não consegui reproduzir a falha original nem uma vez** — nem
antes nem depois do conserto. Ela não reapareceu em nenhuma das execuções
completas desta sessão. O que está fechado é a causa medida em §4.2; não é uma
falha que eu tenha visto acontecer e depois visto parar.

---

## 5. `deprovisionE2EUsers()` — a faxina do `e2e:remote`

`e2e/support/users.ts` (substitui o `removeE2EUsers()`, que era código morto e
**engolia o erro da Admin API**) + `e2e/global-teardown.ts`, ligado no
`playwright.config.ts`.

### 5.1 O que apaga, e só

Marcador explícito, nunca "criado recentemente":

1. as **duas equipes pelo `slug`** (`equipe-e2e-alfa` / `beta`) — `team_members`,
   `daily_reports`, `funnel_targets`, `public_links`, `goals` e `allowed_ips`
   delas caem por cascade;
2. as linhas das quatro tabelas com `on delete restrict` que pertencem a esses
   perfis — `game_events`, `game_season_results`, `daily_entries`,
   `deal_participants`. **Sem isso o `DELETE` do usuário falha**: o cascade vai
   até `profiles` e para ali. Era exatamente aí que o `removeE2EUsers()` falhava
   em silêncio, porque não conferia a resposta;
3. o negócio que ficou **sem nenhum participante** depois do passo 2 — só pode
   ter sido criado pela suíte, porque negócio do seed sempre tem corretor do
   seed. Sem esse passo a faxina trocaria "corretor de teste na lista de equipe"
   por "negócio órfão na contagem do Pipeline";
4. as **dez contas** pelos e-mails literais de `E2E_USERS`; `profiles` cai por
   cascade a partir de `auth.users`.

### 5.2 As contagens — provadas no alvo local

**Execução completa** (`npx supabase db reset && npx playwright test`):

| | perfis | equipes | contas | temporadas | abertas | início da aberta | negócios | leads | `deal_participants` | `game_events` |
|---|---|---|---|---|---|---|---|---|---|---|
| **antes** | 14 | 2 | 14 | 2 | 1 | 2026-08-01 | 6 | 39 | 19 | 20 |
| **depois** | 14 | 2 | 14 | 2 | 1 | 2026-08-01 | 6 | 39 | 19 | 20 |

**Bate coluna por coluna.** A última linha do relatório é
`[e2e] faxina: 10 usuário(s) e 2 equipe(s) removidos`. A temporada aberta voltou
para 2026-08-01 mesmo depois de `fechamento-mes` a ter fechado no meio — mérito
do `afterAll` daquele spec, não da faxina; é justamente por isso que ele não roda
no remoto (§5.3).

**Execução interrompida com Ctrl+C de verdade** — `CTRL_C_EVENT` gerado com
`GenerateConsoleCtrlEvent` e entregue direto ao processo do Playwright (validei o
mecanismo antes com um script isca: o `process.on("SIGINT")` recebeu e a limpeza
assíncrona dele terminou):

| | perfis | equipes | contas |
|---|---|---|---|
| antes | 14 | 2 | 14 |
| depois do Ctrl+C | **24** | **4** | **24** |

**O teardown NÃO roda no Ctrl+C.** O Playwright morreu sem imprimir resumo e sem
chamar a faxina. Testei também `--global-timeout` estourando: **também não roda**,
e aí a causa está no código (`taskRunner.ts`) — a limpeza herda o **mesmo
`deadline`** da execução, que já venceu.

Depois de cada interrupção, a faxina é uma linha, e ela funciona (medido: as
contagens voltaram a 14/2/14 nas duas vezes):

```bash
npm run e2e:remote -- --grep "nada-para-rodar"
```

O preparo reaproveita as contas que ficaram, o Playwright responde `No tests
found` e o `globalTeardown` limpa. Está escrito no `e2e/README.md`.

### 5.3 O buraco que sobra — e o único `test.skip` novo

Como o teardown não sobrevive a uma interrupção, **fechar o buraco no teardown
era impossível**. Ele foi fechado onde dói:

**`e2e/admin/fechamento-mes.spec.ts` não roda no alvo remoto**
(`test.skip(resolveTarget().name === "remote", …)`). É o único arquivo que mexe
na temporada aberta do game: o `beforeAll` move o `period_start` para 10/2026, o
teste fecha a temporada e o `afterAll` desfaz os três passos. Uma interrupção em
qualquer ponto do meio deixa a homologação com agosto **fechado** e o pódio da
demonstração vazio — e o `globalTeardown` não teria como consertar, porque ele
não sabe qual era o `period_start` de antes.

**Conferido que o `skip` é seguro**: com a condição forçada a `true`, os 3 testes
saíram como `skipped` e o `beforeAll` **não rodou** — a temporada continuou em
2026-08-01 e a contagem de negócios não mudou. Um `skip` que ainda executasse o
`beforeAll` seria pior que nada.

Sobra ainda, e não é resolvível daqui:

- **linhas marcadas com `runTag()` por um spec interrompido** — `deals`/`leads`
  com `notes` começando em `e2e-`, e `game_scoring_rules` com `event_code` no
  mesmo padrão (a regra "Bônus E2E …" aparece na tela de Gamificação). São de
  cada spec, e o `afterAll` de cada um é que as remove. Não pus na faxina de
  propósito: o enunciado limita o marcador a e-mails e slugs, e alargar isso é
  decisão de quem for rodar remoto.
- **morte súbita** (`taskkill /F`, SIGKILL, terminal fechado no X) — mesmo caso
  do Ctrl+C, mesmo remédio.

### 5.4 Um efeito colateral no alvo local, de propósito

Como a faxina roda **também no local**, depois de `npm run e2e` os dez usuários
não existem mais. `npm run demo:preparar` (que aponta para
`e2e.broker@faceimob.test` no local) passa a dizer:

> «Usuário e2e.broker@faceimob.test não existe no banco local. Rode
> `npm run e2e -- --project=anonimo` uma vez para criá-lo.»

A mensagem já existia e resolve em um comando. Preferi isso a ter a faxina só no
remoto: o invariante "a suíte devolve o banco como encontrou" é o que torna o
`e2e:remote` usável, e um invariante com exceção não é invariante.

---

## 6. O `.xls` recusado — `e2e/admin/importar-planilha.spec.ts`

Dois testes. `importSheet.test.ts` já cobrava a mensagem **no parser**; o que
faltava era ela **chegar à tela** — um `catch` que virasse `console.error`, ou um
estado de erro que ninguém renderizasse, passariam pelo teste de unidade sem
ninguém ver a frase.

- **o `.xls` antigo é recusado com instrução na tela** — um arquivo com a
  assinatura OLE2 do Excel 97-2003 entra pelo `input[type=file]` e a tela mostra
  a frase inteira, palavra por palavra: *"Planilha no formato antigo (.xls). Abra
  no Excel e salve como .xlsx ou CSV."*. E a recusa é recusa: sem prévia, botão
  "Importar 0 leads" desabilitado. O teste também cobra que o `accept` continua
  `.csv,.xlsx,.xls` — aceitar o `.xls` **é de propósito**, para o usuário
  descobrir o motivo em vez de o arquivo sumir da janela.
- **contraprova com um CSV válido** — sem ela o teste acima passaria também se o
  dropzone estivesse quebrado e recusasse tudo. Sai sem importar: nada é gravado.

---

## 7. Defeitos de produto encontrados — **nenhum corrigido** (`src/` não é meu)

### 7.1 🔴 A tela de Gamificação está fora do kit — e 5 testes E2E cobram o kit lá

**Onde:** `src/pages/Gamification.tsx`.

**O que falha** (as 5 falhas do placar, fora a §7.5):

| Teste | Cobra | A tela faz |
|---|---|---|
| `admin/gamificacao:108` e `:120`, `broker/gamificacao:23` | pontos em pt-BR ("9.000") | `<TableCell …>{s.points}</TableCell>` — número cru, "9000" (linha 457) |
| `admin/gamificacao:163` | `aria-label` "Nº lugar: Fulano, N pontos" nos 3 degraus | o pódio da tela não usa o `Podium` de `@/components/engagement`, que é quem escreve esse rótulo (`Podium.tsx:202`) |
| `admin/gamificacao:193` | os cartões de diretoria titulados em `<h2>` | usa `Card`/`CardTitle`, que renderiza **`<h3>`** (`ui/card.tsx:19`); quem titula em `<h2>` é o `SectionCard` do kit (`SectionCard.tsx:48`) |

**Como reproduzir:** `npx playwright test e2e/admin/gamificacao.spec.ts
e2e/broker/gamificacao.spec.ts` — falha isolado exatamente como falha na
execução completa, o que descarta ordem de execução e descarta qualquer coisa
que eu tenha mexido.

**O que eu sei e o que eu não sei.** A tela **não importa** `SectionCard`,
`PageHeader`, `Podium` nem `num()` — e a versão do último commit também não
importava; hoje o arquivo está a **uma linha** do commit (`closeGameSeason(undefined,
true)` → `closeGameSeason()`, que não é minha). O arquivo foi **escrito hoje às
10:27:37**, no meio da varredura de tipografia que passou por 30 arquivos de
`src/` entre 09:53 e 10:49. Não dá para dizer, do working tree, se alguém
reverteu uma versão com kit que nunca foi commitada ou se a tela nunca teve o
kit e o placar 134/136 da J estava otimista nesses 5 testes. **O fato
verificável é o de cima: a Gamificação é a única tela ainda fora do kit, e a
suíte cobra o kit lá.**

**Não reescrevi os seletores.** Fazer os testes casarem com a tela atual
apagaria o contrato de acessibilidade do pódio e o `<h2>` das seções — e se a
tela perdeu isso hoje, seria maquiar o placar em cima de uma regressão. É uma
decisão de quem for dono de `src/pages/Gamification.tsx`: **ou a tela volta para
o kit (5 testes ficam verdes), ou alguém decide que a Gamificação fica fora do
kit e os 5 testes descem para o que a tela faz.**

### 7.2 🟠 "19. REPROVADO" escapa da confirmação de perda

**Onde:** `src/components/pipeline/useDealActions.ts:70` e
`src/components/pipeline/LoseDealDialog.tsx:20`.

**Como reproduzir:** Pipeline → tabela → Status 2 de qualquer negócio →
"19. REPROVADO". O negócio recebe `status_detail = "19. REPROVADO"` **direto no
banco, sem confirmação nenhuma**, com `lost_reason = null`, e **continua ativo no
funil e no VGV**.

**Causa:** `changeStatus` desvia para a confirmação quando
`normalizeStatus(status)` dá `QUEDA`, `DISTRATO` ou `OFF`. `normalizeStatus` tira
o prefixo numerado, então "19. REPROVADO" vira `"REPROVADO"`, que não está na
lista de `Status1` — e cai no `update` direto. Só que **"19. REPROVADO" é um dos
quatro motivos de perda oferecidos pelo próprio `LoseDealDialog`**
(`LOSS_REASONS`). Ou seja: escolhido no diálogo ele encerra o negócio; escolhido
na tabela ele não encerra nada.

**Consequência:** o mesmo rótulo significa duas coisas diferentes conforme onde
foi clicado. Um negócio "reprovado" pela tabela segue somando VGV e ranking.

**Não escrevi teste para isto de propósito:** um teste aqui congelaria o
comportamento atual, e ele é o que precisa mudar.

### 7.3 🟡 "Motivo obrigatório" é, na prática, "motivo pré-selecionado"

**Onde:** `src/components/pipeline/LoseDealDialog.tsx:44-46`.

O `<Select>` de motivo nasce com `LOSS_REASONS[0]` = **"17. DISTRATO"**. Quem
abre a confirmação e aperta "Encerrar negócio" sem olhar grava um distrato — que
é o rótulo mais forte da lista. Não há estado vazio nem validação de bloqueio.

**Consequência:** o campo cumpre "sempre grava algum motivo", que é o que os
testes cobram, mas não cumpre "quem encerra escolheu o motivo". A correção
provável é nascer sem valor e desabilitar o botão até haver escolha —
`src/`, não apliquei.

### 7.4 🟡 O popup de lead atribuído deixa a página inteira `aria-hidden`

**Onde:** `src/components/NewLeadNotifier.tsx:203` (o `Dialog`).

É comportamento correto de modal, mas com um efeito que vale registrar porque
custou uma investigação: enquanto o popup está aberto, **nenhum controle da tela
por baixo existe para um leitor de tela** — nem para o `getByRole` do Playwright
(medido em §4.2: 14 nós com `aria-hidden`, botão do lead 0 por papel). Para o
corretor no meio de um atendimento, é a tela inteira sumindo até ele fechar o
aviso. Se algum dia isso incomodar, o caminho é o popup virar um toast com ação
em vez de um modal.

### 7.5 🟢 `ERR_NO_BUFFER_SPACE` em `marketing/aportes` — ambiente, não produto

`[marketing] › aportes.spec.ts:34` falhou **uma vez**, numa execução completa do
meio da sessão, com `Failed to load resource: net::ERR_NO_BUFFER_SPACE` pego pela
fixture de console. **Não reproduziu na execução final** nem em nenhuma outra. É
exaustão de soquete do Windows depois de horas de execução seguida — não é
defeito da aplicação e não é seletor. Fica registrado para não ser investigado
duas vezes se aparecer de novo.

---

## 8. Fora de escopo — anotado, não feito

- **Um banco por worker** para devolver o paralelismo (`playwright.config.ts` já
  registra a dívida). Outra escala de trabalho.
- **`Checkin.tsx` e `LeadDetailModal.tsx`**, que ninguém decompôs ainda.
- **O sino abrindo o lead por `?lead=<id>`** (handoff-J §1.2 passo 4c). Continua
  provado só contra o mock, no `handoff-G` §7. Não sobrou tempo depois da
  investigação da §4 e da §5.2.

---

## 9. Arquivos

**Criados**
`e2e/admin/perder-negocio.spec.ts` · `e2e/broker/kanban-gesto.spec.ts` ·
`e2e/admin/importar-planilha.spec.ts` · `e2e/global-teardown.ts` · este handoff.

**Editados**
`e2e/support/users.ts` (`removeE2EUsers` → `deprovisionE2EUsers`) ·
`e2e/broker/trava-atendimento.spec.ts` (§4) ·
`e2e/admin/fechamento-mes.spec.ts` (o `skip` do remoto) ·
`e2e/helpers/negocio.ts` (3 campos a mais no tipo `DealRow`) ·
`e2e/README.md` (a seção da faxina) · `playwright.config.ts` (uma linha:
`globalTeardown`).

**Nada em `src/`. Nada commitado. Nada publicado.**

---

## 10. Para quem pegar isto depois

1. **Decida a Gamificação (§7.1).** São 5 dos testes vermelhos, e a pergunta é de
   produto, não de teste: a tela volta para o kit ou sai do contrato?
2. **`19. REPROVADO` (§7.2)** é um buraco de verdade na trava de perda, e é uma
   condição só em `useDealActions.ts`.
3. **`e2e:remote` já é usável** — com a ressalva de que uma interrupção pede a
   linha de faxina do `e2e/README.md`, e de que o `fechamento-mes` não roda lá.
4. **Não confie no `globalTeardown` para o Ctrl+C.** Está medido em §5.2; a
   documentação do Playwright não promete isso e o comportamento observado é o
   contrário do que a leitura do `taskRunner.ts` sugere.
