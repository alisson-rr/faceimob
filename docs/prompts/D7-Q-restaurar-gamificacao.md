# Tarefa Q — A tela de Gamificação foi apagada por engano e está quebrada no ar

> Contexto do agente: **limpo**. É a tarefa mais urgente da rodada e a única que **publica**.
> Roda **em paralelo com R e S** — as três têm listas de arquivos que não se cruzam.
> Leia a seção "A armadilha que causou isto" **antes de rodar qualquer comando git**.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. URL no ar:
  **https://faceimob.vercel.app** (homologação `mcmqgxvtwegtptfseqvw`). Leia `.claude/CLAUDE.md`
  e `.claude/rules/code-style.md`.
- **Você pode editar:** `src/pages/Gamification.tsx` e mais nada em `src/`.
- **NÃO toque em:** `src/components/pipeline/**` e `src/lib/dealStatus.ts` (Tarefa **R**) ·
  `src/components/NotificationBell.tsx`, `src/pages/Checkpoint.tsx`,
  `src/components/shared/BrandMotif.tsx`, `src/lib/type-scale.test.ts` (Tarefa **S**) ·
  `e2e/**` (ninguém nesta rodada — você **roda** a suíte, não a edita) · `supabase/**` ·
  `package.json`.

## O que aconteceu — não é um bug, é trabalho apagado

Em 23/08 a **Tarefa B** remontou a tela de Gamificação sobre o kit: `PageHeader`, `SectionCard`,
o `Podium` de `@/components/engagement`, `num()` para número em pt-BR, e o ciclo de temporada por
`closeMonthAndSeason`/`openGameSeason`. Está escrito em `docs/prompts/handoff-B.md` §5 e §8.

Hoje, 27/08, às 10:27, a **Tarefa M** precisava provar que o detector de "nova versão" dispara
num build novo. Para isso pôs um comentário em `src/pages/Gamification.tsx` — arquivo que não era
dela, escolhido só porque vive num chunk lazy — e depois desfez com `git checkout --`
(`handoff-M.md` §1).

**O arquivo nunca tinha sido commitado.** `git checkout --` não desfez o comentário: trocou o
arquivo pela versão do último commit, apagando a remontagem inteira da Tarefa B.

O que se sabe, medido:

- `git diff --stat -- src/pages/Gamification.tsx` dá **`1+/1-`**, enquanto `Pipeline.tsx` dá
  `226+/1320-` e `Leads.tsx` `205+/844-`. É a única tela nessa situação.
- O arquivo de hoje tem **zero** referências a `Podium`, `SectionCard`, `PageHeader` ou `num()`.
- A **Tarefa N** viu o typecheck quebrar, diagnosticou certo e repôs **uma única linha**
  (`closeGameSeason(undefined, true)` → `closeGameSeason()`), dizendo que não tinha como garantir
  que era só ela (`handoff-N.md` §6.4). Não era.
- A **Tarefa P** mediu a consequência: **5 testes E2E vermelhos** (`handoff-P.md` §7.1). Ela se
  recusou a reescrever os seletores para maquiar o placar, e fez certo.
- A **Tarefa O** publicou às 11h08. **A tela quebrada está no ar agora**, e Gamificação é uma das
  telas do roteiro da demonstração.

## Entrega 1 — restaurar o arquivo

O conteúdo original foi recuperado do transcript da sessão da Tarefa B e está esperando por você:

```
C:\Users\Alisson\CascadeProjects\_recuperacao-faceimob\Gamification.B.tsx
```

**22 619 bytes, 539 linhas.** Se o arquivo não estiver lá, o script ao lado
(`extrair-do-transcript.py`) o extrai de novo: sessão
`~/.claude/projects/C--Users-Alisson-CascadeProjects-FACEIMOB/7e39eab8-3e28-4be2-b40a-ce44cf13367f.jsonl`,
**linha 386**, campo `input.content` do `tool_use` de nome `Write`.

**O que já foi conferido nele — confirme, não refaça:**

- Importa só símbolos que existem na árvore de hoje: `closeMonthAndSeason`, `openGameSeason`,
  `monthStart` (de `@/integrations/supabase/game`), `SectionCard`, `PageHeader`, `EmptyState`,
  `LoadingState`, `StatusBadge` (de `@/components/shared`), `Podium` + `PodiumEntry` (de
  `@/components/engagement`), `brl`/`date`/`num` (de `@/lib/format`),
  `useCurrentSeasonId`/`useSeasonRanking` (de `@/hooks/useGameRanking`).
- **Não tem nenhum `text-[Npx]` nem nenhum hex** — ou seja, passa no `type-scale.test.ts` que a
  Tarefa N acabou de criar. Isso importa: se ele tivesse literais, o teste da N ficaria vermelho
  e você teria de tratar isso junto.
- **O typecheck em cima dele não foi rodado.** É a primeira coisa que você faz.

**O que você tem de decidir olhando:** entre 23/08 e hoje, outras tarefas mexeram em coisas que
essa tela consome — a `closeGameSeason` perdeu um parâmetro, o `Badge` ganhou `size="sm"` (Tarefa
N), o piso tipográfico virou regra. O arquivo recuperado é de 23/08. **Se o typecheck acusar
alguma coisa, conserte no arquivo restaurado; não volte para a versão quebrada.** E se você achar
um ponto onde a versão de hoje (a do HEAD) tem uma correção que a de 23/08 não tem, **traga a
correção para o arquivo restaurado** — o `git diff` entre os dois te mostra isso em um comando.

## Entrega 2 — provar que voltou, pelos testes que já cobram

Não precisa inventar prova: a Tarefa P deixou 5 testes cobrando exatamente o que se perdeu.

```bash
npx playwright test e2e/admin/gamificacao.spec.ts e2e/broker/gamificacao.spec.ts
```

| Teste | Cobra |
|---|---|
| `admin:108`, `admin:120`, `broker:23` | pontos em pt-BR ("9.000") — é o `num()` |
| `admin:163` | `aria-label` "Nº lugar: Fulano, N pontos" nos 3 degraus — é o `Podium` |
| `admin:193` | cartões de diretoria titulados em `<h2>` — é o `SectionCard` (o `Card` cru dá `<h3>`) |

**Os 5 têm de ficar verdes.** Se algum continuar vermelho depois da restauração, é achado novo:
descreva no handoff com a saída, **não reescreva o seletor**. Foi a decisão da P e continua valendo.

Precisa do stack local de pé: `npm run db:start` e, se a base estiver suja de execuções anteriores,
`npx supabase db reset`. **Cuidado:** a Tarefa P ligou uma faxina (`deprovisionE2EUsers`) no
`globalTeardown`, então depois de rodar a suíte os usuários `e2e.*` deixam de existir no local —
é de propósito, e o `npm run e2e -- --project=anonimo` os recria.

Depois rode a suíte inteira uma vez (`npx playwright test`) e ponha o placar no handoff. A P
deixou **147 testes, 142 passando**; com a sua restauração o número esperado é **147/147**.

## Entrega 3 — olhar a tela

Testes verdes não provam que a tela está bonita. Suba o app (`npm run dev`), entre como admin e
confira, nos **dois temas** e a **375 px**:

- o pódio dos 3 primeiros aparece com os degraus 2-1-3 e a coroa no primeiro;
- os números saem em pt-BR ("9.000", não "9000");
- as abas (Ranking / Diretorias / Regras) e o botão "Fechar gameficação" estão lá;
- nada transborda na horizontal e o console fica limpo.

Salve capturas em `docs/design-system/` com prefixo **`smoke-q-`**. Não sobrescreva `smoke-j-*`
nem `smoke-n-*`.

> Contexto útil: a varredura da Tarefa N mediu `gamification·dark·375` com `menorFonte=12` e
> `<12px=0` — mas isso foi medido **na tela quebrada**. Depois da restauração o número esperado é
> `menorFonte=11` (a `.text-eyebrow`, que é a exceção escrita do X07) e **`<11px=0`**. Se aparecer
> alguma coisa abaixo de 11 px, é regressão sua e o `npx vitest run` acusa.

## Entrega 4 — publicar

Você publica, porque a tela quebrada está no ar e não pode esperar as Tarefas R e S.

```bash
npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75
```

**Os três argumentos importam** — sem `--scope` a CLI responde "Not authorized" mesmo logada, e
sem `--archive=tgz` o envio morre com `fetch failed`. Está no `handoff-J.md` §7 e a Tarefa O
confirmou de novo hoje.

Confira o hash depois:

```bash
curl -s https://faceimob.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

contra o do `dist/index.html`. O que está no ar hoje é `index-oQLdfviq.js` (build da Tarefa O);
o seu tem de ser diferente dele e igual ao seu `dist/`.

**Se as Tarefas R ou S entregarem depois de você**, elas não republicam — quem republica é o
Alisson, com o mesmo comando. Diga isso no handoff.

## A armadilha que causou isto — leia antes de rodar git

Este branch tem **158 arquivos não commitados**, incluindo diretórios inteiros que só existem na
árvore de trabalho (`src/components/{shared,pipeline,engagement,dashboard,leads}/`,
`src/lib/engagement/`, `docs/prompts/`, `docs/design-system/`).

**Enquanto isso for verdade, `git checkout --` e `git restore` não são "desfazer" — são "apagar".**
E `git clean -fd` levaria a sprint inteira.

Aconteceu **duas vezes hoje**: com o `src/index.css` (Tarefa N §7, restaurado a duras penas) e com
o arquivo que você está consertando agora. As duas vezes foi um agente desfazendo uma alteração
temporária, que é a operação mais banal que existe.

**Regra desta tarefa:** se precisar de uma alteração temporária em qualquer arquivo, **copie o
arquivo antes** (`cp arquivo arquivo.bak`) e restaure a partir da cópia. Nunca por git.

E **não mexa em arquivo que não é seu**, nem "só para testar" — foi exatamente assim que a tela se
perdeu.

## Fora de escopo (anote, não faça)

- Os defeitos de perda de negócio (`19. REPROVADO`, motivo pré-selecionado) — **Tarefa R**.
- Os restos da varredura tipográfica e o transbordo do Checkpoint — **Tarefa S**.
- O `to_char(..., 'TMMonth')` que gera "July 2026" no fechamento automático de temporada
  (`handoff-O.md` §5.2). É migration, e migration não é desta rodada — mesmo que você esteja
  justamente na tela de temporada.
- Commitar. Se você achar que o repositório devia ser commitado (e devia), **escreva no handoff**;
  a decisão é do Alisson.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) ·
  `npx vitest run` (190 testes hoje) · `npm run build` verdes.
- `npx playwright test e2e/admin/gamificacao.spec.ts e2e/broker/gamificacao.spec.ts` — **5/5**.
- Suíte completa com o placar em números no handoff.
- `grep -c "Podium\|SectionCard\|PageHeader\|num(" src/pages/Gamification.tsx` maior que zero.
- Publicado, com o hash conferido nos dois lados.

## Entrega

Não commite. Escreva `docs/prompts/handoff-Q.md`: o que o arquivo restaurado tinha que o atual não
tinha; o que você precisou ajustar nele para casar com a árvore de hoje (e por quê); o placar dos
5 testes antes e depois; o placar da suíte completa; o que você viu na tela nos dois temas a
375 px; o hash publicado; e — se você encontrar sinal de mais algum arquivo que tenha perdido
alteração do mesmo jeito — **diga qual e como você percebeu**. Esse último item pode ser o mais
valioso do handoff.
