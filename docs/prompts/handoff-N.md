# Handoff N — O piso tipográfico virou regra verificável, e o cabeçalho devolveu o sino a 375 px

> Tarefa N, 27/08/2026. Rodou em paralelo com M, O e P. **Nada commitado.**

---

## 0. Em uma linha

O piso do X07 passou a ser **12 px com uma exceção escrita** (11 px só em rótulo curto em
caixa alta com tracking aberto), **142 tamanhos literais saíram de 24 arquivos**, o `Badge`
ganhou `size="sm"` no lugar dos 11 remendos manuais, e o cabeçalho a **375 px deixou de cortar
o sino e o avatar — em 16 de 16 combinações medidas, contra 16 de 16 cortadas antes**.

A entrega que sobrevive a mim é `src/lib/type-scale.test.ts`: a regra agora reprova sozinha.

---

## 1. Entrega 1 — a decisão do piso

**Escolhi o caminho (b): redefinir o X07 para admitir 11 px em rótulo curto em caixa alta.**

O texto que ficou escrito em `docs/design-system.md` §3 e em `docs/sprints/decisoes.md`:

> O piso é **12 px** (`text-xs`). Abaixo dele existe **uma** exceção: **11 px em rótulo curto
> em CAIXA ALTA com `letter-spacing >= 0.1em`** — na prática, a `.text-eyebrow` do kit. A
> exceção é a **forma**, não o número: caixa alta não tem descendente, e o `letter-spacing`
> de 0.14em devolve a separação que o corpo menor tira. Texto corrido de 11 px não tem nem
> uma coisa nem outra. **Zero `text-[Npx]` em `src/**`**, nem acima nem abaixo do piso.

**Por que (b) e não (a).** A `.text-eyebrow` existe exatamente para o caso que a exceção
descreve — as seções do menu lateral, os rótulos das seções do editor de negócio, o `LEADS`
do `KpiCard`. Subir a classe para 12 px inflaria todo rótulo de seção do app por um número
que ninguém verificou contra o desenho, e o ganho de legibilidade em caixa alta com tracking
aberto é o menor de toda a escala.

**O custo, que é real e foi pago.** O requisito deixou de ser um número só. Sem cobrança
automática, (b) vira licença para 11 px em qualquer lugar e o problema volta em três sprints
— foi exatamente assim que ele voltou desta vez. Por isso a exceção virou o teste do §3, e é
por isso que ela é verificável: **forma + número, os dois medidos por código.**

### O que isso passa a permitir, em uma frase por caso

| Caso | Antes | Agora |
|---|---|---|
| Rótulo curto em caixa alta, cor de apoio | `text-[10px] uppercase text-muted-foreground` | `text-eyebrow` (11 px, é a exceção) |
| Rótulo curto em caixa alta, **outra cor** | `text-[9px] uppercase text-warning` | `text-xs uppercase tracking-widest text-warning` — a 12 px a exceção não é necessária |
| Texto corrido, legenda, número, botão | `text-[10px]` / `text-[11px]` | `text-xs` (12 px). Sem exceção |
| Selo dentro de linha de lista | `text-[9px] h-4 px-1` | `<Badge size="sm">` |

**Detalhe do kit que precisa ficar dito:** a `.text-eyebrow` fixa a cor
(`muted-foreground`) e o bloco fica **depois** das utilities geradas — conferido no CSS
compilado, `.text-eyebrow` no byte 52 707 contra `.text-muted-foreground` no 38 873. Logo um
`text-warning` ao lado **não vence**. Quem precisa de outra cor cai na linha 2 da tabela.
Foi o que decidiu não haver `.text-eyebrow-sidebar`: o `SidebarGroupLabel` passou a usar a
própria `.text-eyebrow`, o que também **melhora o contraste** — o `text-sidebar-foreground/60`
que ele usava dá ~56% de luminosidade no escuro e ~50% no claro, contra 72% e 40% do
`muted-foreground`, e a opacidade `/60` não é coberta pelo `theme-contrast.test.ts`.

---

## 2. Entrega 2 — a varredura

**Quantos sumiram:** 142 tamanhos literais em **24 arquivos**, mais 1 citação em comentário.
**Quantos ficaram:** 4, todos em `src/components/NotificationBell.tsx`, que é da **Tarefa M**.

```
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/
src/components/NotificationBell.tsx:122  text-[9px]   ← badge do sino (a exceção que o enunciado me deu)
src/components/NotificationBell.tsx:139  text-[10px]
src/components/NotificationBell.tsx:162  text-[10px]
src/components/NotificationBell.tsx:163  text-[10px]
```

O inventário inicial tinha **173** literais em 27 arquivos (96 × `10px`, 45 × `11px`,
26 × `9px`, 5 × `8px`, 1 × `0.8rem` — este último no `head_cell` do `ui/calendar.tsx`, acima
do piso mas fora da escala). Desses, **26 eram do `DailyReport.tsx`, que a Tarefa M limpou
enquanto eu trabalhava** — quando fui medir, o arquivo já estava zerado. Os 4 restantes são
os do `NotificationBell`.

### O `Badge` — uma decisão, não doze

`src/components/ui/badge.tsx` ganhou a variante `size`:

```tsx
size: {
  default: "px-2.5 py-0.5",
  sm: "px-2 py-0 leading-5",
}
```

**O que `sm` encolhe é a caixa, não a letra.** Continua em `text-xs`, que é o piso. Selo não
é caixa alta e portanto não entra na exceção de 11 px — a alternativa (uma variante compacta
com fonte própria em 9 ou 10 px) teria reaberto o buraco pelo mesmo lugar por onde ele já
vazou uma vez. **Consequência aceita:** onde o selo estava em 9 px ele cresce para 12 px;
era exatamente o texto que a varredura da J media como ilegível.

Adotada em **11 chamadas, 7 arquivos**: `AdminDailyTeams` (4), `Checkpoint` (2), `TaskPanel`,
`VisitPanel`, `DeveloperSubmissionDialog`, `SdrModule`, `RoleSwitcher`. Os `h-4 px-1`
escritos à mão foram embora junto.

### `CcaBoard.tsx:22` — era comentário, não código

O `text-[8px]` estava **dentro do comentário** que explica o que a Tarefa H removeu (os botões
`opacity-0 group-hover:opacity-100` que viraram o `Select` "Mover para…"). O código já não
existe. Reescrevi a frase para "8 px de fonte" — o comentário continua contando a história e
o `grep` do critério de aceite volta limpo. O teste do §3 também **ignora comentário** de
propósito: reprovar quem *documenta* que removeu um literal é o oposto do que ele quer.

---

## 3. Entrega 3 — a verificação que segura isto

`src/lib/type-scale.test.ts`, no feitio do `theme-contrast.test.ts`: lê o repositório de
verdade, não uma cópia dos números. Três testes:

1. **Nenhuma tela escreve tamanho de fonte literal.** Varre `src/**/*.{ts,tsx}` (fora
   `*.test.*`), tira comentário, e compara a lista de arquivos com violação contra
   `PENDENTE_DE_OUTRA_TAREFA`. A comparação é **exata nos dois sentidos**.
2. **A exceção existe e tem a forma que a justifica.** Ancora o parser de CSS: se o regex de
   blocos quebrar, a varredura do teste 3 passaria sem ter olhado para nada.
3. **Toda regra abaixo de 12 px no `index.css`** traz `text-transform: uppercase`,
   `letter-spacing >= 0.1em` e não desce de `0.6875rem`.

### ⚠️ Para a Tarefa M: o teste vai ficar vermelho quando você terminar

`PENDENTE_DE_OUTRA_TAREFA` tem **uma linha**: `"components/NotificationBell.tsx"`. Ela falha
nos dois sentidos de propósito — literal em arquivo fora da lista reprova, **e arquivo da
lista que já foi limpo também reprova**, com a mensagem "Arquivo da lista
PENDENTE_DE_OUTRA_TAREFA já foi limpo: apague a linha dele daqui."

Quando o `NotificationBell` perder os 4 literais, **apague essa linha do teste**. Lista que só
cresce vira licença permanente, que é exatamente como o piso se perdeu da primeira vez.

### A prova de que reprova

**(a) literal proibido no código.** Injetei `className="text-[9px]"` num `<Badge>` de
`QueuePosition.tsx`:

```
AssertionError: Troque por text-xs/text-sm/text-base, ou por .text-eyebrow se for rotulo em
CAIXA ALTA. Achados: { "components/QueuePosition.tsx": [ "text-[9px] = 9 px — ABAIXO DO PISO" ], … }
  Tests  1 failed | 2 passed
```
Desfeito; `grep -c 'text-\[' src/components/QueuePosition.tsx` → `0`.

**(b) exceção descaracterizada no CSS.** Troquei o `letter-spacing` da `.text-eyebrow` para
`0.05em` e tirei o `text-transform`:

```
AssertionError: .text-eyebrow (11 px): abaixo de 12 px so vale CAIXA ALTA — falta
text-transform: uppercase
  Tests  2 failed | 1 passed
```
Desfeito (ver §7 — foi *aqui* que eu quebrei o `index.css`).

---

## 4. Entrega 4 — o cabeçalho a 375 px

### A causa raiz não era o `w-[150px]`

O `RoleSwitcher` com largura fixa era **o sintoma**, não a causa. A causa está em
`AppLayout.tsx`:

```tsx
<p className="relative shrink-0 truncate …">{pageTitle}</p>
```

**`shrink-0` anula o `truncate`.** A caixa nunca encolhe, então o `text-overflow: ellipsis`
não chega a valer: o excesso sai pela direita, e o `overflow-hidden` do `<header>` corta o
sino e o avatar **em silêncio**. Por isso a varredura da J achou "zero transbordo horizontal"
com o sino inalcançável — não havia barra de rolagem para denunciar. Conferido: a medição
`ANTES` também dá `transbordo=0` nas 16 combinações **com o sino e o avatar cortados**.

Consertar só a largura do Select deixaria a mesma armadilha para a próxima tela de título
comprido — que é a razão de "Esteira CCA" cortar mais que "Dashboard".

### O que mudou

1. **`AppLayout.tsx`** — o título passou a ser quem cede: `shrink-0 truncate` →
   `min-w-0 truncate`. Nada mais no arranjo do cabeçalho.
2. **`RoleSwitcher.tsx`** — o gatilho encolhe para ícone + seta no estreito
   (`h-7 w-auto px-2 … sm:w-36 sm:px-3`, ~52 px em vez de 150). O que sai é o **rótulo do
   papel**, que é o último da fila de importância: **sino, avatar, e só então o seletor**.
   O `aria-label` continua nomeando o controle, então o encolhimento é só visual — e continua
   sendo o mesmo `aria-label` de antes, para não quebrar locator de `e2e/**` (a
   `dashboard-meta.spec.ts` cita esse combobox por nome, ainda que filtre por outra coisa).
3. **O aviso de pré-visualização NÃO some no estreito.** Ele deixou de ser
   `<span className="text-[10px] text-warning hidden sm:inline">pré-visualizando</span>` e
   virou `<Badge variant="outline" size="sm">prévia</Badge>` em tom de aviso — curto o
   bastante para caber a 375 px sem empurrar o sino para fora. Encurtar não é esconder:
   saber que você está vendo a tela como outra pessoa importa **mais** no celular, não menos.
4. Corrigi de passagem uma duplicação que o item 2 expôs: o rótulo do gatilho e o do item da
   lista agora saem do mesmo `optionLabel()`, senão divergiriam na primeira mudança de texto.

---

## 5. A medição — método e antes/depois

**Método: o mesmo da J, por código na página.** Sessão real de admin (`e2e.admin@faceimob.test`,
OTP de verdade via `generate_link`, RLS valendo) contra o Supabase **local**, com um harness
efêmero de Playwright que **importa** os ajudantes de `e2e/support/` sem editar nada em
`e2e/**`, em porta própria (5198). Medi 8 telas × 2 temas × 2 larguras = **32 combinações**
(as 6 da J mais Checkpoint e Equipes, que foram as que mais mexi).

O `ANTES` não reverte o código: injeta por CSS a geometria antiga do cabeçalho
(`flex-shrink:0` no título, 150 px fixos no gatilho, rótulo sempre visível) — que é a única
diferença que a correção introduz naquela linha.

### Cabeçalho a 375 px — 16 combinações

| | sino cortado | avatar cortado | transbordo | erro de console |
|---|---|---|---|---|
| **antes** | **8 / 16** | **16 / 16** | 2 / 16 (§6.1) | 0 |
| **depois** | **0 / 16** | **0 / 16** | 2 / 16 (§6.1) | 0 |

Exemplos do `antes`, com o retângulo medido contra a viewport de 375 px:

```
dashboard·dark·375     sino cortado (358..386)   avatar cortado (394..426)
cca·dark·375           sino cortado (370..398)   avatar cortado (406..438)   ← "Esteira CCA", o pior
gamification·light·375 sino cortado (369..397)   avatar cortado (405..437)
pipeline·dark·375      sino ok                   avatar cortado (374..406)
```

No `depois`, `sino=ok avatar=ok papel=ok` nas **32** combinações — as 16 de 375 px e as 16 de
1280 px.

### Piso tipográfico — 32 combinações, depois

`menorFonte` é 11 px (a `.text-eyebrow`) em 30 combinações e **12 px** em duas
(`gamification·375`). **`<11px = 0` em todas as 32.** A J media "de 7 a 17 elementos em 11 px
e **pelo menos 1 em 10 px** por tela"; o "pelo menos 1 em 10 px" acabou.

```
dashboard·dark·375     menorFonte=11  <12px=8   <11px=0
pipeline·dark·375      menorFonte=11  <12px=1   <11px=0
leads·dark·375         menorFonte=11  <12px=6   <11px=0
cca·dark·375           menorFonte=11  <12px=7   <11px=0
checkin·dark·375       menorFonte=11  <12px=4   <11px=0
gamification·dark·375  menorFonte=12  <12px=0   <11px=0
checkpoint·dark·375    menorFonte=11  <12px=14  <11px=0
equipes·dark·375       menorFonte=11  <12px=12  <11px=0
```

**Ressalva honesta sobre o "antes" de fonte.** A varredura `ANTES` mexe só na geometria do
cabeçalho, então a coluna de fonte dela **já é a depois**. Onde consegui o A/B real de fonte
foi no Checkpoint, revertendo por string as 10 edições que eu tinha feito naquele arquivo:

```
checkpoint·dark·375   ANTES:  menorFonte=8   <12px=24  <11px=22
checkpoint·dark·375   DEPOIS: menorFonte=11  <12px=14  <11px=0
```

Não refiz isso nas 25 telas: reverter 142 edições em 24 arquivos com M, O e P editando o
mesmo repositório ao lado é risco desproporcional ao ganho. O limite superior já está provado
por outro caminho, e é mais forte que uma contagem de nós: **não existe literal em `src/**` e
a única regra abaixo de 12 px no `index.css` é a `.text-eyebrow`** — logo nenhuma tela, medida
ou não, tem elemento abaixo de 11 px.

### O caso mais cheio: o cabeçalho **em pré-visualização**, a 375 px

É o estado que as capturas das telas não mostram (o admin não está pré-visualizando) e o
único em que o cabeçalho ganha um elemento a mais — o selo "prévia". Medido na **CCA**, que
é o título mais comprido, nos dois temas:

```
previa·dark·375   {"transbordo":0,"sino":"ok","avatar":"ok","papel":"ok","previa":"ok","titulo":56}  erros=0
previa·light·375  {"transbordo":0,"sino":"ok","avatar":"ok","papel":"ok","previa":"ok","titulo":56}  erros=0
```

`titulo: 56` é a correção funcionando: o título encolheu para 56 px e virou "CCA Pi…" em vez
de empurrar o sino para fora. Capturas em `smoke-n-previa-{dark,light}-375.png`.

### Capturas

18 arquivos novos em `docs/design-system/`, prefixo **`smoke-n-`** (8 telas × 2 temas a
375 px, mais os 2 do modo de pré-visualização). As 12 `smoke-j-*` estão intactas — conferido.

---

## 6. Achados que encontrei medindo e **não** consertei

### 6.1 🟠 Transbordo de 137 px no Checkpoint a 375 px — **não é meu**

`checkpoint·dark·375` e `checkpoint·light·375` dão `transbordo=137`. **Medi o mesmo 137 antes
e depois da varredura** (revertendo o arquivo por string), então não é tipografia. São duas
causas, as duas anteriores a mim:

```
culpado: div.flex items-center gap-2                                    [40..512]   ← 137 px de sobra
culpado: button…SelectTrigger…px-3.5 py-2                               [346..512]
culpado: div.absolute -right-16 bottom-[12%] h-72 w-72 … bg-brand-blue/25 [90..498]
```

1. `Checkpoint.tsx:145` — o `<div className="flex items-center gap-2">` com 4 botões mais um
   `Select` de `w-56` **não quebra linha**, dentro de um `<header>` que é `flex-wrap`. Conserto:
   `flex-wrap` no div interno e `w-full sm:w-56` no `SelectTrigger`.
2. O `BrandMotif` (`-right-16`, chega a 498 px) vaza por falta de `overflow-hidden` no pai.
   **Consertar só o item 1 deixa 123 px de transbordo** — os dois precisam ir juntos.

Não fiz porque é X08/dívida de shell, não X07, e o item 2 é justamente o transbordo do `main`
que o enunciado colocou fora de escopo. Mas agora existe o caso que faltava para mexer nele
com luz: **é o Checkpoint, a 375 px, nos dois temas.**

### 6.2 Para a Tarefa M

- Os 4 literais do `NotificationBell.tsx` são seus, como combinado. Quando saírem, apague a
  linha do `PENDENTE_DE_OUTRA_TAREFA` (§3).
- O badge do sino (`text-[9px]`) é o caso do `<Badge size="sm">` que criei — `size="sm"` mais
  `absolute -top-1 -right-1 h-4 min-w-4 px-1`. A 12 px o contador de não-lidas fica maior;
  se apertar, `h-4 min-w-4` vira `h-5 min-w-5`.

### 6.3 Sobrou literal de paleta em `MetaAdsSetup.tsx:117`

`<pre className="text-xs bg-black/40 …">` — troquei o tamanho, deixei o `bg-black/40`. É
paleta literal (regra 1 do design system, achado T03), não piso tipográfico, e mudar cor sem
o teste de contraste medir aquele par é chute. Anotado, não feito.

### 6.4 `src/pages/Gamification.tsx` voltou ao HEAD durante a sessão — **consertei uma linha**

O `npm run typecheck` ficou vermelho no fim com `Gamification.tsx(238,40): Expected 0-1
arguments, but got 2`. Diagnóstico: `git status` mostra o arquivo **idêntico ao HEAD**
(mtime 10:08:23) enquanto praticamente toda outra página está modificada — e o `game.ts` da
árvore de trabalho tirou o segundo parâmetro de `closeGameSeason` de propósito (achado G01 de
21/08: `p_close_month=true` gravava `closed_months` sem migrar as propostas abertas). O
typecheck estava **verde** mais cedo nesta mesma sessão, então o arquivo perdeu a alteração
da árvore de trabalho em algum momento entre 10:0x e agora.

Repus a única linha que faltava — `closeGameSeason(undefined, true)` → `closeGameSeason()` —
e o typecheck voltou a ficar verde **sem mais nenhum erro**, o que é consistente com o diff
perdido ter sido só essa linha. **Não tenho como garantir que era só ela.** Se a Tarefa que
mexe em gamificação tinha mais coisa naquele arquivo, o lugar de conferir é aqui.

---

## 7. Incidente: eu apaguei o `src/index.css` e restaurei — leia isto

**O que aconteceu.** Ao provar que o teste do §3 reprova (§3, prova (b)), desfiz a alteração
temporária com `git checkout -- src/index.css`. O `index.css` do design system **nunca foi
commitado**: o comando trocou o arquivo pela versão do HEAD, que é a paleta antiga
(`--radius: 0.625rem`, Instrument Serif, tokens de outra geração). Perdi 291 linhas.

**Como restaurei, e como sei que está certo.** Achei o `Write` original do arquivo no
transcript da sessão que o criou (`.claude/projects/…/ae616505….jsonl`) — 291 linhas, mesma
estrutura (`@layer base` em 20 e 144, `@layer utilities` em 180, `.text-eyebrow` em 234,
fechamentos em 258/263/267/271/291). Mas era uma versão **anterior**: seis tokens tinham sido
ajustados depois por outra tarefa (`--input` do escuro, `--border`/`--input`/`--chart-3`/
`--gold`/`--sidebar-border` do claro — os ajustes de contraste). Reconciliei com quatro
fontes independentes:

| Região | Como conferi | Resultado |
|---|---|---|
| linhas 1–145 (tokens) | cópia literal do arquivo vivo, lida no começo desta sessão | recolada; `diff` isolou exatamente os 6 tokens |
| linhas 144–178 (`@layer base`) | recompilei e comparei com o CSS do `dist/` gerado **antes** do acidente | **idêntico**, 705 bytes |
| linhas 180–219 (utilities) | mesma comparação, regra a regra | **22 de 22 idênticas**, nenhuma sumiu nem mudou de corpo |
| linhas 220–260 | cópia literal do arquivo vivo | **idêntico**, `diff` vazio |
| linhas 261–291 (keyframes, scrollbar, reduced-motion) | comparação com o CSS do `dist/` | **idêntico** |

E, por cima disso, `theme-contrast.test.ts` — que lê o `index.css` e mede os 73 pares de cor
nos dois temas — **passa**. Se um token tivesse voltado ao valor antigo, ele reprovaria.

**O que se perdeu mesmo assim:** nada de conteúdo que eu consiga detectar. O único risco
residual é um comentário de prosa alterado depois do `Write` original e que não deixe rastro
no CSS compilado.

**A lição, para quem vier:** enquanto este branch tiver 151 arquivos modificados e não
commitados, `git checkout --` / `git restore` **não é desfazer, é apagar**. Para desfazer
uma alteração temporária, guarde uma cópia antes e restaure a partir dela.

---

## 8. Validação

```bash
npm run typecheck   # ✅ os 3 projects (app, node, e2e)
npm run lint        # ✅ 0 erros · 7 avisos pré-existentes (react-refresh em ui/*, AuthContext, ComparativeFunnel, UpdateNotifier)
npx vitest run      # ✅ 190 testes em 14 arquivos (era 183/12 na J: +3 meus, +4 do NotificationBell da M)
npm run build       # ✅ 17,7 s
```

```bash
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/   # ✅ só os 4 do NotificationBell (Tarefa M)
```

**Não publiquei** — a Tarefa O publica por último nesta rodada.

---

## 9. Arquivos

**Criados**
`src/lib/type-scale.test.ts` · `docs/design-system/smoke-n-*.png` (18) · este handoff.

**Editados — origem**
`src/index.css` (comentário da exceção; ver §7) · `src/components/ui/badge.tsx` (`size`) ·
`src/components/ui/sidebar.tsx` (`SidebarGroupLabel` → `.text-eyebrow`) ·
`src/components/ui/calendar.tsx` · `src/components/layout/AppLayout.tsx` ·
`src/components/RoleSwitcher.tsx`

**Editados — varredura** (24 arquivos)
`BrokerEditModal` · `CampaignPerformancePanel` · `DealDocumentUpload` ·
`DeveloperSubmissionDialog` · `MarketingInvestmentPopup` · `QueuePosition` · `TaskPanel` ·
`VisitPanel` · `pipeline/CcaBoard` (comentário) · `AdminDailyTeams` · `AdminIntegrations` ·
`AdminLeadAutomation` · `AdminPermissions` · `Checkpoint` · `DataManagement` · `Equipes` ·
`Login` · `Marketing` · `MetaAdsSetup` · `PublicDirectorCheckpoint` · `SdrModule`

**Editados — documentação**
`docs/design-system.md` (§3 piso, §6 `Badge size`, §7 checklist) ·
`docs/sprints/decisoes.md` (3 decisões de 27/08)

**Editado — fora do meu escopo, com motivo no §6.4**
`src/pages/Gamification.tsx` (uma linha, para o typecheck voltar a ficar verde)

**Não toquei:** `src/pages/DailyReport.tsx`, `src/components/UpdateNotifier.tsx`,
`src/components/NotificationBell.tsx` (Tarefa M) · `package.json` (O) · `e2e/**` (P) ·
`supabase/**`.

---

## 10. Para quem pegar isto amanhã

1. **O piso agora se defende sozinho.** Se `npx vitest run` reprovar em `type-scale`, leia a
   mensagem: ela diz o arquivo, o tamanho em px e se está abaixo do piso.
2. **A Tarefa M vai ver o teste vermelho** quando terminar o `NotificationBell` — é de
   propósito, e a mensagem diz o que apagar (§3).
3. **O Checkpoint transborda 137 px a 375 px, e não é tipografia** (§6.1). Duas linhas de
   conserto, mas as duas juntas ou não adianta.
4. **Confira o `Gamification.tsx`** (§6.4) se a gamificação for sua.
5. **Não use `git checkout --` neste branch** (§7).

---

## 11. Revalidação independente — 27/08/2026, sessão nova

A entrega acima foi refeita **do zero por outra sessão**, sem herdar contexto: harness próprio
no scratchpad (não cria arquivo no repositório), Supabase **local** de pé, servidor de
desenvolvimento em porta própria (5198), sessão real de `e2e.admin@faceimob.test` por OTP via
`generate_link`. O objetivo era não acreditar no relatório: **remedir**.

### 11.1 Cabeçalho a 375 px — 8 telas × 2 temas, remedido

O `ANTES` é a mesma técnica do §5 (injeta por CSS a geometria antiga: `flex-shrink:0` +
`min-width:auto` no título, 150 px fixos no gatilho, rótulo sempre visível), medido na
**mesma carga de página** que o `DEPOIS` — então a única variável é a geometria.

| | sino cortado | avatar cortado | seletor de papel cortado | erro de console |
|---|---|---|---|---|
| **antes** | 8 / 16 | 16 / 16 | 0 / 16 | 0 |
| **depois** | **0 / 16** | **0 / 16** | **0 / 16** | **0** |

Bate com o §5 número a número, inclusive os retângulos:

```
dashboard·dark·375     ANTES sino cortado (358..386)  avatar cortado (394..426)
cca·dark·375           ANTES sino cortado (370..398)  avatar cortado (406..438)   ← o pior
gamification·light·375 ANTES sino cortado (369..397)  avatar cortado (405..437)
pipeline·dark·375      ANTES sino ok                  avatar cortado (374..406)
```

### 11.2 Piso tipográfico — remedido nas mesmas 16 combinações

```
menor fonte na página   = 11 px  (a .text-eyebrow) em 14/16 · 12 px em 2/16 (gamification)
elementos abaixo de 11 px = 0    em 16 de 16
```

As amostras dos elementos abaixo de 12 px são **todas** `class="text-eyebrow …"` — ou seja,
o que sobrou abaixo do piso é exatamente a exceção escrita, e nada mais. A J media "pelo
menos 1 em 10 px por tela"; continua zerado.

### 11.3 Correção de um número do §5

A linha `antes` da tabela do §5 dizia `transbordo 0`. É **2 / 16** — o Checkpoint, nos dois
temas. A remedição confirma o que o §6.1 já dizia: **137 px, idênticos antes e depois**, logo
não é tipografia nem cabeçalho. A tabela do §5 foi corrigida para não contradizer o §6.1;
o achado continua aberto e continua fora de escopo.

### 11.4 As quatro validações, refeitas

```
npm run typecheck   ✅ os 3 projects
npm run lint        ✅ 0 erros · 7 avisos react-refresh pré-existentes
npx vitest run      ✅ 190 testes, 14 arquivos
npm run build       ✅ 11,9 s
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/   ✅ só os 4 do NotificationBell (Tarefa M)
```

### 11.5 A trava do §3 reprova mesmo — refeito

Injetado `text-[9px]` em `QueuePosition.tsx:60` (cópia guardada antes, restaurada da cópia —
**não** com `git checkout --`, ver §7):

```
AssertionError: Troque por text-xs/text-sm/text-base, ou por .text-eyebrow se for rotulo em
CAIXA ALTA. Achados: { …, "components/QueuePosition.tsx": [ "text-[9px] = 9 px — ABAIXO DO PISO" ] }
- Expected   [ "components/NotificationBell.tsx" ]
+ Received   [ "components/NotificationBell.tsx", "components/QueuePosition.tsx" ]
  Tests  1 failed | 2 passed
```

Desfeito por cópia; `diff` vazio e `grep -c 'text-\[' src/components/QueuePosition.tsx` → `0`.
Suíte completa verde de novo depois de restaurar.

**Nada foi commitado nesta revalidação.** As únicas escritas foram a correção do número no §5
e esta seção.
