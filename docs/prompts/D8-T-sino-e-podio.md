# Tarefa T — O popover do sino está invisível no ar, e o pódio escreve número sem formatar

> Contexto do agente: **limpo**. Tarefa curta, os dois defeitos já vêm diagnosticados e medidos por
> outra pessoa — o seu trabalho é aplicar, provar e publicar. Roda **em paralelo com U**; as duas
> não compartilham nenhum arquivo.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL no ar:
  **https://faceimob.vercel.app** (homologação `mcmqgxvtwegtptfseqvw`). Leia `.claude/CLAUDE.md`,
  `.claude/rules/code-style.md`, e `docs/prompts/handoff-S.md` §5 — é lá que está a medição inteira
  do item 1.
- **O repositório agora está commitado** (`5943b45`, 27/08). `git checkout --` voltou a significar
  "desfazer". Ainda assim: se o seu trabalho não estiver commitado, ele continua valendo a regra de
  copiar antes de desfazer.
- **Você pode editar:** `src/components/layout/AppLayout.tsx`, `src/components/NotificationBell.tsx`,
  `src/components/engagement/Podium.tsx`.
- **NÃO toque em:** `supabase/**`, `src/components/pipeline/**`, `src/lib/dealStatus.ts`,
  `supabase/seeds/**` — **tudo isso é da Tarefa U**, que roda agora · `e2e/**` (você **roda**, não
  edita).
- Sem hex, sem paleta literal, **sem `text-[Npx]`** — `src/lib/type-scale.test.ts` reprova, e a lista
  de exceções dele está **vazia**. Não ponha nada lá.

## Entrega 1 — 🔴 O popover do sino não aparece

**É o defeito de maior consequência que sobrou da rodada anterior, e está no ar agora.** O sino é um
dos extras do roteiro do cliente: clicar nele hoje parece não fazer nada.

**Onde:** `src/components/layout/AppLayout.tsx:48`.

```tsx
<header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 overflow-hidden border-b border-border px-4 sm:px-6">
```

**O diagnóstico, medido pela Tarefa S na página:**

```
popover: {"caixa":[-2,55,318,418], "corta":"header.glass [0..64]",
          "linhas":[{"fonte":"12px"},{"fonte":"12px"},{"fonte":"12px"}]}
```

O painel existe, tem 363 px de altura e o conteúdo certo. Ele é `absolute` dentro de um
`div.relative` que vive **dentro do `<header>`**, e o header tem 64 px de altura com
`overflow-hidden`. Sobram **9 px visíveis de 363**.

**Duas coisas que a S já descartou — não repita o caminho:**

1. **Trocar para `position: fixed` não resolve.** A classe `.glass` tem `backdrop-blur-xl`
   (`backdrop-filter`), e isso faz do header um *containing block* — ele passaria a cortar até
   descendente `fixed`.
2. **O `overflow-hidden` do header não está mais segurando nada.** Ele foi posto quando o título do
   `AppLayout` era `shrink-0 truncate`; a Tarefa N trocou para `min-w-0 truncate`, e agora o
   `truncate` corta o título sozinho, o `BrandMotif` se corta sozinho e a tira de ranking tem o
   `overflow-hidden` dela.

**A correção candidata, já medida sem editar arquivo** (injetada por CSS na página):

```css
header.glass { overflow: visible; }
```

Com ela ligada, a varredura de **9 telas × 2 temas** deu `transbordo=0` em 18 de 18, `<11px=0` em
18 de 18 e `erros=0`.

**Não aplique no escuro assim mesmo.** Meça você, do seu jeito, antes e depois — inclusive **a 375 px
e a 1280 px, nos dois temas**, com o sino **aberto** e **fechado**. O que a S mediu foi um
experimento por CSS; o que você vai entregar é a classe trocada no componente, e não é
automaticamente a mesma coisa (a ordem das classes do Tailwind e o `sticky` podem interagir).

**Acabamento que vem junto:** a 375 px o painel de `w-80` fica em `[-2 … 318]` — 2 px para fora pela
esquerda. Não cria barra de rolagem (o `scrollWidth` não cresce para a esquerda), mas um
`max-w-[calc(100vw-1rem)]` resolve de graça. Confira que resolve mesmo antes de escrever que resolveu.

**Prova esperada:** abrir o sino e ver as notificações, nos dois temas, nas duas larguras. Capturas em
`docs/design-system/` com prefixo **`smoke-t-`** — não sobrescreva `smoke-j-*`, `smoke-n-*`,
`smoke-q-*` nem `smoke-s-*`. A S deixou o estado quebrado em `smoke-s-sino-aberto-{dark,light}-375.png`;
é a sua linha de base.

## Entrega 2 — 🟡 O pódio mostra `2440` e a tabela mostra `2.440`, na mesma tela

**Onde:** `src/components/engagement/Podium.tsx`.

Achado da Tarefa Q (`handoff-Q.md` §7.1). O componente renderiza `{points}` cru — o valor que sai do
`useCountUp` — e o `aria-label` do `<li>` também: `"1º lugar: Ana Oliveira, 2440 pontos"`. A tabela
logo abaixo, na mesma tela, usa `num()` de `@/lib/format` e escreve `2.440`.

**Por que vale consertar antes da demonstração:** o pódio é o **primeiro elemento visual** da tela de
Gamificação, e é exatamente a classe de inconsistência que o `src/lib/format.ts` existe para impedir.

**Duas armadilhas:**

1. **O número é animado.** Ele vem de uma contagem que anda de 120 para 130 quando o realtime soma
   pontos (`handoff-B.md` §5). Formatar o valor final e esquecer os quadros intermediários deixa o
   número pulando de formato durante a animação. Decida o que fazer com os quadros e diga qual foi a
   decisão.
2. **O `aria-label` é coberto por teste E2E.** `e2e/admin/gamificacao.spec.ts:163` casa `/lugar:/` e
   sobreviveria à formatação, mas **rode para confirmar** — não conclua pelo regex.

Se você achar que formatar o `aria-label` piora a leitura por leitor de tela (um leitor lê "2.440"
diferente de "2440" dependendo do sintetizador), **essa é uma decisão legítima**: formate o visual,
deixe o rótulo, e escreva o porquê. O que não pode ficar é o mesmo número em dois formatos na mesma
tela sem ninguém ter decidido.

**Outros consumidores do `Podium`:** `PipelineTopRanking.tsx` e `dashboard/TopBrokers.tsx`. Confira os
dois depois de mexer — é componente do kit, não é de uma tela só.

## Entrega 3 — publicar

Você publica. Os defeitos são visíveis no ar e a Tarefa U não vai publicar (o diff dela é banco e
semente, mais uma parte de `src/` que ela avisa).

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

**Os três argumentos importam** — sem `--scope` a CLI responde "Not authorized" mesmo logada, e sem
`--archive=tgz` o envio morre com `fetch failed`. Confira depois:

```bash
curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

contra o do `dist/index.html`. **O que está no ar hoje é `index-B7h7QudJ.js`** (build da Tarefa Q,
que já leva R e S junto — conferido: rebuildar a árvore atual reproduz esse mesmo hash). O seu tem de
ser diferente dele e igual ao seu `dist/`.

**Se a Tarefa U tiver mexido em `src/` quando você for publicar**, o seu build leva o diff dela junto.
Não é problema — mas **diga no handoff** o que estava na árvore no momento do build, para ninguém
depois achar que publicou sozinho.

## Fora de escopo (anote, não faça)

- Qualquer coisa de Esteira Ágil, conferência documental, `status_detail` ou migration — **Tarefa U**.
- O `overflow-hidden` do `main` do `AppLayout` (dívida de shell antiga). O do `<header>` é seu; o do
  `main` **não é**, e a Tarefa S provou que o transbordo do Checkpoint não vinha dele.
- Decompor `Checkin.tsx` ou `LeadDetailModal.tsx`.
- `provisionE2EUsers()` não ser seguro sob concorrência (`handoff-Q.md` §7.4). Só morde harness
  paralelo; a suíte roda serial.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) ·
  `npx vitest run` (**199 testes em 15 arquivos** hoje) · `npm run build` verdes.
- `npx playwright test e2e/admin/gamificacao.spec.ts` verde (a Entrega 2 mexe no que ele cobra).
- Sino aberto e legível nas duas larguras e nos dois temas, com captura.
- Nenhum transbordo horizontal novo: meça as mesmas 9 telas × 2 temas que a S mediu, não só a tela do
  sino.
- Publicado, com o hash conferido nos dois lados.

## Entrega

Não commite. Escreva `docs/prompts/handoff-T.md`: o que você mediu antes e depois no sino (com os
retângulos, não só "funciona"); o que decidiu sobre o `aria-label` e sobre os quadros da animação do
pódio, e por quê; as telas que conferiu por causa dos outros dois consumidores do `Podium`; o hash
publicado e o que estava na árvore no momento do build.
