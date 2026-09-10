# Handoff S — Os 4 literais que sobraram, os 137 px que ninguém quis, e um achado 🔴 no caminho

> Tarefa S, 27/08/2026 · branch `nova` · **nada commitado** · **não publicado**.
> Rodou em paralelo com Q e R.

---

## 0. Em uma linha

Os 4 literais do `NotificationBell` saíram e a `PENDENTE_DE_OUTRA_TAREFA` está vazia; o
`resolveLink` mudou para `src/lib/notificationLink.ts` sem `eslint-disable` e sem `vi.mock`;
o Checkpoint a 375 px foi de **137 px de transbordo para 0 nos dois temas com uma causa só**
— o `BrandMotif` era falso positivo; e o `bg-black/40` do `MetaAdsSetup` virou `bg-muted`
com o par entrando no teste de contraste.

**No caminho apareceu um 🔴 que não é meu e não posso consertar** (arquivo fora da minha
lista): o **popover do sino é invisível** — cortado pelo `overflow-hidden` do `<header>`.
Diagnosticado, correção candidata medida em 18 combinações, §5.

---

## 1. Entrega 1 — os 4 literais e a lista que não virou permanente

### O badge do sino a 12 px: `h-4 min-w-4` **aguentou** — não precisou de `h-5`

A receita da N (`handoff-N` §6.2) era `<Badge size="sm">` mais
`absolute -top-1 -right-1 h-4 min-w-4 px-1`, com o aviso "se apertar, vira `h-5 min-w-5`".
**Medi em vez de decidir no olho**, com o badge renderizado de verdade (12 notificações não
lidas gravadas numa conta descartável) e captura a `deviceScaleFactor: 4`, porque um selo de
16 px de lado não se julga numa captura 1:1:

```
sino·dark·375   {"texto":"3",  "fonte":"12px","caixa":{"w":17,  "h":16},"glifo":{"w":7,   "h":16},"sobraLargura":10,"sobraAltura":0}
sino·light·375  {"texto":"3",  "fonte":"12px","caixa":{"w":17,  "h":16},"glifo":{"w":7,   "h":16},"sobraLargura":10,"sobraAltura":0}
sino·dark·375   {"texto":"12", "fonte":"12px","caixa":{"w":20.8,"h":16},"glifo":{"w":10.8,"h":16},"sobraLargura":10,"sobraAltura":0}
sino·light·375  {"texto":"12", "fonte":"12px","caixa":{"w":20.8,"h":16},"glifo":{"w":10.8,"h":16},"sobraLargura":10,"sobraAltura":0}
```

`sobraAltura: 0` quer dizer que a linha do glifo ocupa exatamente os 16 px da caixa — e o
`overflow` do badge é `visible`, então nada é cortado. Com dois dígitos a caixa cresce para
20,8 px pelo `min-w`, e o selo **não encosta no avatar**: `dentroDoBotao: true` nas quatro
medições. Ficou como está — `h-5 min-w-5` engordaria o selo por um aperto que não existe.

**Capturas:** `smoke-s-sino-{dark,light}-375.png` (ampliadas 4×; a do escuro está com 12,
a do claro com 3, que é como as tirei ao longo da medição).

### As quatro trocas

| Linha (arquivo original) | Antes | Agora |
|---|---|---|
| `:122` badge de não-lidas | `h-4 min-w-4 px-1 text-[9px] tabular-nums` | `size="sm" … h-4 min-w-4 px-1 tabular-nums` |
| `:139` "Marcar todas como lidas" | `h-6 text-[10px]` | `h-6 text-xs` |
| `:162` corpo da notificação | `text-[10px]` | `text-xs` |
| `:163` data/hora | `text-[10px]` | `text-xs` |

Conferido na tela (§5, captura `smoke-s-sino-experimento-*`): as três linhas do popover
medem `12px` de `font-size`, e o texto continua cabendo no `w-80` — a linha do cabeçalho
("Notificações" + o botão) não estoura os 320 px.

### A lista

`PENDENTE_DE_OUTRA_TAREFA` ficou **vazia** (`const PENDENTE_DE_OUTRA_TAREFA: string[] = []`),
com o comentário que explica por que ela existe intacto. O teste continua reprovando nos dois
sentidos: literal novo em qualquer arquivo de `src/**` reprova, e se alguém puser uma linha
ali e limpar o arquivo, reprova também.

```
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/     → vazio
```

---

## 2. Entrega 2 — `resolveLink` mudou de casa

**Mora em `src/lib/notificationLink.ts`.** O teste foi junto:
`src/components/NotificationBell.test.ts` → `src/lib/notificationLink.test.ts`.

O que a mudança apagou, que era o preço registrado no `handoff-M` §3:

- **o `// eslint-disable-next-line react-refresh/only-export-components`** — o arquivo do
  componente voltou a exportar só o componente;
- **o `vi.mock("@/integrations/supabase/client")`** — o teste não importa mais um módulo que
  arrasta o cliente Supabase, então não precisa fingir que ele existe. São 4 linhas a menos
  de andaime e uma dependência a menos entre teste e infraestrutura.

**A validação não afrouxou.** A tabela do `handoff-M` §3 continua valendo, e os três casos
"fáceis de perder numa reescrita" estão cobertos — inclusive o **CR**, que o teste anterior
não tinha (a tabela citava "tab, CR e LF", o teste só media tab e LF):

| Entrada | Destino |
|---|---|
| `/pipeline` | `/pipeline` (intacto) |
| `/leads/<uuid>` | `/leads?lead=<uuid>` (a reescrita de sempre) |
| `/leads?lead=<uuid>` | intacto |
| `//externo.example` | `/dashboard` |
| `\\externo.example` | `/dashboard` |
| `/\externo.example` | `/dashboard` |
| `https://externo.example` | `/dashboard` |
| `javascript:alert(1)` | `/dashboard` |
| `/<TAB>/externo.example` | `/dashboard` |
| `/<CR>/externo.example` | `/dashboard` ← **caso novo** |
| `/<LF>/externo.example` | `/dashboard` |
| `/leads ?lead=1` | `/dashboard` |

4 blocos, 12 asserções, verdes.

### ⚠️ O lint continua em **7 avisos**, não 6 — e a premissa do enunciado estava errada

O enunciado esperava 6 ("a Entrega 2 apaga um"). Não apaga, e a razão é aritmética: o aviso
do `NotificationBell` **estava suprimido**, então nunca entrou na contagem. O `handoff-M` §3
diz isso com todas as letras — *"sem ele o lint iria a 8 avisos"* —, ou seja, com o `disable`
o total já era 7. Tirar a exportação não tira um aviso da conta: tira o **teto de 8** de
cima da mesa, que é o ganho de verdade.

Os 7 que ficam são exatamente os 7 pré-existentes do `handoff-N` §8, nenhum novo:

```
ComparativeFunnel.tsx:17 · UpdateNotifier.tsx:32 · ui/badge.tsx:41 · ui/button.tsx:56
ui/sidebar.tsx:636 · ui/sonner.tsx:22 · contexts/AuthContext.tsx:42
```

---

## 3. Entrega 3 — os 137 px do Checkpoint: **uma causa, não duas**

### O método

O mesmo da J e da N: por código na página, `scrollWidth === clientWidth` na raiz, nos dois
temas a 375 px, com sessão real (OTP via `generate_link`, RLS valendo) contra o Supabase
**local**, harness efêmero de Playwright que **importa** os ajudantes de `e2e/support/` sem
editar nada em `e2e/**`, em porta própria (5198).

**Uma coluna a mais que a N, e é ela que muda a resposta: `clipadoPor`.** Um retângulo pode
ultrapassar a viewport e mesmo assim **não** empurrar o `scrollWidth`, se um ancestral com
`overflow: hidden` o cortar. `getBoundingClientRect()` ignora clipping — então uma varredura
que só olha retângulo acusa inocente. O harness sobe a árvore de cada culpado procurando o
primeiro ancestral que clipa e que cabe na viewport, e separa "REAL" de "clipado".

### O que a coluna mostrou: o `BrandMotif` é **falso positivo**

```
### checkpoint·dark·375   transbordo=137
    REAL     [40..512] div.flex.items-center.gap-2                         ← a causa
    REAL     [346..512] button…SelectTrigger
    clipado  [90..498] div.absolute.-right-16.bottom-[12%].h-72.w-72  ← div.pointer-events-none.absolute.inset-0
```

O `BrandMotif` já tem `overflow-hidden` **na própria raiz** (`src/components/shared/BrandMotif.tsx:16`:
`pointer-events-none absolute inset-0 overflow-hidden`). Os cinco retângulos rotacionados
vazam da raiz, mas a raiz os corta — eles nunca chegaram ao `scrollWidth`.

A conta do `handoff-N` §6.1 ("consertar só o item 1 deixa 123 px") é **aritmética sobre os
retângulos** (498 − 375 = 123), não uma medição. **Não é o que acontece.** Consertar só o
item 1 dá **0**:

| | dark·375 | light·375 |
|---|---|---|
| **antes** | **137** | **137** |
| **depois** | **0** | **0** |

O `antes` **não reverte o código**: injeta por CSS a geometria anterior
(`flex-wrap: nowrap` no div interno, `width: 14rem` no gatilho) na mesma carga de página do
`depois`, então a única variável é a geometria. Ele reproduz os 137 px e os mesmos retângulos
`[40..512]` / `[346..512]` — é o mesmo defeito, não outro parecido.

### O conserto — duas linhas em `Checkpoint.tsx`, nenhuma no shell

```tsx
<div className="flex flex-wrap items-center gap-2">          // era `flex items-center gap-2`
  …
  <SelectTrigger className="w-full sm:w-56 h-8 text-xs">     // era `w-56 h-8 text-xs`
```

Os 4 botões mais o `Select` de 224 px pedem 472 px numa faixa de 311 px; sem quebra de linha
empurravam a página inteira. Com `flex-wrap` eles empilham em três linhas a 375 px e voltam a
uma linha só a partir do `sm` (640 px) — medido: `checkpoint·{dark,light}·1280 → transbordo=0`,
sem mudança de arranjo.

**Não toquei em `overflow-hidden` de pai nenhum**, que era o risco do enunciado ("se você
puser `overflow-hidden` no pai errado, corta o motivo gráfico onde ele hoje funciona"). Não
foi preciso: o `BrandMotif` já se corta sozinho. `src/components/shared/BrandMotif.tsx`
está **intacto** — `git diff` vazio nele.

### As telas que conferi por causa do `BrandMotif`

Como não mudei o `BrandMotif` nem os pais dele, "antes" e "depois" são o mesmo código por
construção. O que fiz foi provar que **nenhuma tela ganhou transbordo** e que o motivo
continua enquadrado onde ele funciona de propósito. **11 telas × 2 temas = 22 combinações a
375 px**, todas `transbordo=0` e `<11px=0`:

| Tela | Onde o `BrandMotif` entra | dark | light |
|---|---|---|---|
| `dashboard` | `AppLayout` (cabeçalho) | 0 | 0 |
| `pipeline` | `AppLayout` | 0 | 0 |
| `leads` | `AppLayout` | 0 | 0 |
| `cca` | `AppLayout` | 0 | 0 |
| `checkin` | `AppLayout` | 0 | 0 |
| `gamification` | `AppLayout` | 0 | 0 |
| `checkpoint` | `AppLayout` | 0 | 0 |
| `equipes` | `AppLayout` | 0 | 0 |
| `admin/meta-ads` | `AppLayout` | 0 | 0 |
| `login` | **`Login.tsx`, dois usos** (`opacity-70` e `opacity-30 lg:hidden`) | 0 | 0 |
| `404` | **`NotFound.tsx`** (sem `className`, o caso "cru") | 0 | 0 |

O quinto consumidor é o `EmptyState` (`shared/EmptyState.tsx:29`, `opacity-40`), que só
aparece com lista vazia — **não consegui forçá-lo** nas telas semeadas e digo isso em vez de
fingir que medi. Ele usa a mesma raiz `absolute inset-0 overflow-hidden` dos outros cinco
usos, e como não mudei nada em `BrandMotif` nem no `AppLayout`, o risco dele é o mesmo de
ontem — nem maior, nem menor.

Nas 22 combinações o `BrandMotif` aparece sempre como `clipado`, nunca como `REAL`.
`erros de console = 0` em todas, menos o 404, que loga o próprio 404 (pré-existente).

**Capturas:** `smoke-s-checkpoint-antes-{dark,light}-375.png` (a página inteira sai com
512 px de largura — é o transbordo em imagem) e `smoke-s-checkpoint-{dark,light}-375.png`
(375 px, tudo dentro, sino e avatar visíveis). Mais `smoke-s-metaads-{dark,light}-375.png`.
Nenhuma `smoke-j-*` nem `smoke-n-*` foi tocada — conferido.

---

## 4. Entrega 4 — `bg-black/40` → `bg-muted`, e o par **entrou** no teste

`src/pages/MetaAdsSetup.tsx:117`:

```tsx
<pre className="text-xs bg-muted text-muted-foreground border border-border rounded-lg p-3 overflow-x-auto font-mono">
```

**Por que `muted` e não outro token:** já existe um `<pre>` no repositório com esse par —
`src/components/dashboard/GoalCard.tsx:72` (`bg-muted … text-muted-foreground`). Reaproveitei
em vez de inventar um terceiro jeito de pintar bloco de código.

**A ordem que o enunciado pede: escolher o token depois de saber que ele mede.** O par
`muted-foreground` sobre `muted` **não estava** nos 73 do `theme-contrast.test.ts` — havia
`muted-foreground` sobre `background` e sobre `card`, não sobre `muted`. Então **acrescentei**:

```ts
// Bloco de codigo (`<pre>` do GoalCard e do MetaAdsSetup) e o unico lugar
// onde `muted` e superficie de leitura, nao so preenchimento neutro.
["muted-foreground", "muted", 4.5],
```

Medido pelo próprio teste, que lê o `index.css`: **7,02:1 no escuro · 5,47:1 no claro** —
os dois acima de 4,5. O teste foi de 73 para **75** casos, e a linha nova também passa a
cobrir o `<pre>` do `GoalCard`, que estava sem medição desde sempre.

**O que o `bg-black/40` fazia de errado, para ficar registrado:** no tema claro ele pintava
o bloco de escuro e deixava a tinta herdada (`card-foreground`, quase preta) por cima —
texto escuro sobre fundo escuro. É o achado T03 (regra 1: paleta literal) com consequência
real, não só de estilo. Conferido na captura `smoke-s-metaads-light-375.png`.

---

## 5. 🔴 Achado que **não é meu e não consertei**: o popover do sino é invisível

Apareceu quando fui conferir as três linhas de 12 px do popover (Entrega 1): abri o sino e
**não apareceu nada**. Medido na página:

```
popover: {"caixa":[-2,55,318,418], "corta":"header.glass [0..64]",
          "linhas":[{"fonte":"12px"},{"fonte":"12px"},{"fonte":"12px"}]}
```

O painel existe, tem 363 px de altura e o texto certo. Ele é `absolute` dentro de
`div.relative` que está **dentro do `<header className="glass … overflow-hidden">`** do
`AppLayout`. O header tem 64 px: sobram **9 px visíveis** (55..64) de 363. Clicar no sino
parece não fazer nada.

**Não adianta trocar para `position: fixed`:** a `.glass` tem `backdrop-blur-xl`
(`backdrop-filter`), o que faz do header um *containing block* — ele passaria a cortar até
descendente fixo. A correção pequena é no shell.

**A correção candidata, medida sem editar arquivo** (injetada por CSS na página):

```css
header.glass { overflow: visible; }   /* hoje: overflow-hidden */
```

```
EXPERIMENTO → {"popoverVisivel":true,"caixa":[-2,55,318,418],"transbordo":0}
```

E a varredura inteira com ela ligada, **9 telas × 2 temas**: `transbordo=0` em 18 de 18,
`<11px=0` em 18 de 18, `erros=0`. Ou seja: **o `overflow-hidden` do header não está segurando
nada mais** desde que a Tarefa N trocou o título de `shrink-0 truncate` para
`min-w-0 truncate` — o `truncate` já corta o título sozinho, o `BrandMotif` já se corta
sozinho, e a tira de ranking tem o `overflow-hidden` dela.

**Por que não fiz:** `src/components/layout/AppLayout.tsx` **não está na minha lista de
arquivos**, e Q e R estão editando o mesmo repositório agora. É uma palavra, está medida,
e o próximo dono do shell aplica com a evidência acima. Captura do estado quebrado em
`smoke-s-sino-aberto-{dark,light}-375.png` e do estado corrigido em
`smoke-s-sino-experimento-{dark,light}-375.png`.

Detalhe de acabamento que vem junto quando alguém pegar isto: a 375 px o painel de `w-80`
fica em `[-2 … 318]` — 2 px para fora pela **esquerda**. Não cria transbordo (o `scrollWidth`
não cresce para a esquerda), mas um `max-w-[calc(100vw-1rem)]` resolveria de graça.

---

## 6. Sobre o banco local — o que toquei e o que devolvi

A Tarefa P estava com a suíte E2E rodando **neste mesmo banco local** durante a medição: as
dez contas `e2e.*` apareciam e sumiam no meio das minhas leituras (provisionamento e
`deprovision` da suíte dela). Duas consequências:

1. **Não usei as contas `e2e.*`.** Criei uma descartável, `prova-s@faceimob.invalid`, com
   papel de `admin`, mais 12 notificações para o badge ter o que contar. A limpeza da P é por
   e-mail literal e por `slug` de equipe, então essa conta nunca entrou no caminho dela.
2. **Devolvi o banco.** `delete from auth.users where email='prova-s@faceimob.invalid'` —
   as notificações caem por cascade. Conferido depois:

```
conta_sobrou 0 · notif_sobrou 0 · teams 4 · profiles 24
```

`teams 4 · profiles 24` é o mesmo número do `handoff-M` §2.3 depois da limpeza dele. As dez
contas `e2e.*` estão de pé com os papéis da P (`{broker,admin}`, `{broker,director}`, …) —
**não mexi em nenhuma delas**. O harness (`.harness-s.local/`, pasta `*.local`, ignorada
pelo git) foi apagado; `git status` não tem nada meu fora dos arquivos abaixo.

**Não usei `git checkout --` nem `git restore` em momento nenhum** (`handoff-N` §7).

---

## 7. Validação

```bash
npm run typecheck   # ✅ os 3 projects (app, node, e2e)
npm run lint        # ✅ 0 erros · 7 avisos — os 7 pré-existentes, nenhum novo (ver §2)
npx vitest run      # ✅ 15 arquivos, 199 testes
npm run build       # ✅ 12,5 s
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/   # ✅ vazio
```

**Sobre os 199.** A base era 190/14. Meus: **+2** (o par de contraste novo, ×2 temas) e
0 líquido no `resolveLink` (4 testes que mudaram de arquivo, +1 asserção de CR) → **192/14**.
Os outros **+7 em +1 arquivo** são da **Tarefa R**, que está no mesmo repositório agora:
`src/components/pipeline/statuses.test.ts` (3, novo) e `src/lib/dealStatus.test.ts` (4 → 8).
Não toquei em nenhum dos dois.

**Não publiquei.** Quem publica nesta rodada é a Tarefa Q, e ela publica antes de eu
terminar. **O meu diff está fora do ar.** Para subir:

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

---

## 8. Arquivos

**Criados**
`src/lib/notificationLink.ts` · `src/lib/notificationLink.test.ts` ·
`docs/design-system/smoke-s-*.png` (12) · este handoff.

**Editados**
`src/components/NotificationBell.tsx` (4 literais + o `resolveLink` saiu daqui) ·
`src/lib/type-scale.test.ts` (`PENDENTE_DE_OUTRA_TAREFA` vazia) ·
`src/pages/Checkpoint.tsx` (2 classes) ·
`src/pages/MetaAdsSetup.tsx` (1 classe) ·
`src/lib/theme-contrast.test.ts` (1 par novo)

**Apagado**
`src/components/NotificationBell.test.ts` (virou `src/lib/notificationLink.test.ts`; nunca
tinha sido commitado, então não aparece como `D` no `git status`)

**Não toquei**
`src/components/shared/BrandMotif.tsx` (estava na minha lista, mas a medição mostrou que
não precisava — §3) · `src/components/layout/AppLayout.tsx` (fora da lista; §5) ·
`src/pages/Gamification.tsx` (Q) · `src/components/pipeline/**` e `src/lib/dealStatus.ts` (R) ·
`e2e/**` · `supabase/**` · `package.json`

---

## 9. Para quem pegar isto amanhã

1. **O popover do sino não aparece** (§5). É uma palavra em `AppLayout.tsx`, já medida em
   18 combinações. É o item de maior consequência que sobrou desta rodada.
2. **O `handoff-N` §6.1 tem um número errado**, e o correto está no §3 daqui: consertar só a
   causa 1 do Checkpoint dá **0**, não 123. O `BrandMotif` nunca contribuiu — quem for medir
   transbordo por retângulo, separe o que está clipado.
3. **`PENDENTE_DE_OUTRA_TAREFA` está vazia.** Se precisar pôr uma linha ali, ponha com dono e
   com prazo, senão vira licença permanente de novo.
4. **O par `muted-foreground`/`muted` agora é medido.** Bloco de código pode usar `bg-muted`
   sem chute; qualquer outra superfície de leitura nova, acrescente o par antes de pintar.
5. Continua valendo: **não use `git checkout --` neste branch.**
