# Tarefa R — Um dos quatro motivos de perda não encerra o negócio

> Contexto do agente: **limpo**. Tarefa curta e cirúrgica. Roda **em paralelo com Q e S** — as
> três têm listas de arquivos que não se cruzam.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`,
  `.claude/rules/code-style.md`, e `docs/prompts/handoff-P.md` §2 e §7.2/§7.3 — foi a Tarefa P que
  achou isto ao escrever o primeiro teste de perda de negócio que este projeto teve.
- **Você pode editar:** `src/components/pipeline/**`, `src/lib/dealStatus.ts`,
  `src/lib/dealStatus.test.ts`, e `e2e/admin/perder-negocio.spec.ts`.
- **NÃO toque em:** `src/pages/Gamification.tsx` (Tarefa **Q**) · `src/components/NotificationBell.tsx`,
  `src/pages/Checkpoint.tsx`, `src/components/shared/BrandMotif.tsx`, `src/lib/type-scale.test.ts`
  (Tarefa **S**) · `supabase/**` · `package.json` · o resto de `e2e/**`.
- Erro de banco é `describeError`/`dbError` de `@/lib/supabaseError`. Sem hex, sem paleta literal,
  **sem `text-[Npx]`** — a Tarefa N acabou de fazer o `type-scale.test.ts` reprovar isso.

## ⚠️ Antes de rodar qualquer git

Este branch tem **158 arquivos não commitados**, incluindo o diretório inteiro
`src/components/pipeline/` — que é justamente o seu. **`git checkout --` e `git restore` não são
"desfazer" aqui, são "apagar".** Hoje mesmo dois arquivos foram perdidos assim (o `src/index.css`
e o `src/pages/Gamification.tsx`, que a Tarefa Q está restaurando de um transcript agora).

Se precisar de alteração temporária, **copie o arquivo antes** e restaure a partir da cópia.

## Entrega 1 — 🟠 "19. REPROVADO" grava o status e deixa o negócio vivo

**Onde:** `src/components/pipeline/useDealActions.ts:68-72` e
`src/components/pipeline/LoseDealDialog.tsx:20`.

**Reproduzir:** Pipeline → tabela → Status 2 de qualquer negócio → escolher "19. REPROVADO".

**O que acontece:** o negócio recebe `status_detail = "19. REPROVADO"` **direto no banco, sem
confirmação nenhuma**, com `lost_reason = null`, e **continua ativo no funil e no VGV**.

**A causa, conferida:**

```ts
// useDealActions.ts
const outcome = normalizeStatus(status);
if (outcome === "QUEDA" || outcome === "DISTRATO" || outcome === "OFF") {
  onNeedsLossConfirmation(deal, status);
  return;
}
```

```ts
// dealStatus.ts — normalizeStatus
const u = s.toString().trim().toUpperCase().replace(/^\d+\.\s*/, "");
if (u === "VENDA" || u === "PROPOSTA" || u === "QUEDA" || u === "DISTRATO" || u === "OFF") {
  return u as Status1;
}
return null;
```

`"19. REPROVADO"` perde o prefixo e vira `"REPROVADO"`, que **não está em `Status1`** — então
`normalizeStatus` devolve `null` e o `if` não pega. Cai no `update` direto.

**O que torna isso um defeito e não uma escolha:**

```ts
// LoseDealDialog.tsx:20
const LOSS_REASONS = ["17. DISTRATO", "18. QUEDA", "19. REPROVADO", "OFF"];
```

"19. REPROVADO" **é um dos quatro motivos de perda que a própria tela oferece**. Escolhido dentro
do diálogo, ele encerra o negócio. Escolhido no Select da tabela, não encerra nada. **O mesmo
motivo, dois resultados.**

**Onde corrigir — pense antes de escolher:** há dois pontos possíveis e eles não são equivalentes.

- **Em `normalizeStatus`**, acrescentando `REPROVADO` a `Status1`. Alcança de uma vez todos os
  chamadores — e são vários: `isPerda`, `isResultado`, `isProducao`, o funil, o cálculo de VGV, o
  ranking. **É o ponto compartilhado mais estreito se, e somente se, "reprovado" for de fato uma
  perda para todos eles.** Consequência: negócios que já estão com `status_detail = "19. REPROVADO"`
  no banco passam a contar como perdidos retroativamente em toda leitura. Isso pode ser a correção
  — ou pode ser uma mudança de número que a diretoria vê sem aviso.
- **No `if` do `changeStatus`**, comparando contra a lista `LOSS_REASONS` em vez de contra três
  constantes soltas. Alcança só o caminho da tabela, não mexe em como o resto do sistema lê os
  dados já gravados.

**Decida com evidência, não por gosto.** Consulte o banco de homologação: quantos negócios estão
com `"19. REPROVADO"` hoje e como eles aparecem no funil e no VGV. Escreva no handoff qual
caminho você escolheu, **quantas linhas do banco a escolha afeta**, e o que teria acontecido no
outro caminho.

**A duplicação que sobra de qualquer jeito:** a lista de motivos de perda está escrita duas vezes
— `LOSS_REASONS` no diálogo e as três constantes no `if`. Duas listas para a mesma regra é como
esse buraco nasceu. Sobrar uma só é o objetivo, onde quer que ela fique.

## Entrega 2 — 🟡 "Motivo obrigatório" é, na prática, "motivo pré-selecionado"

**Onde:** `src/components/pipeline/LoseDealDialog.tsx:44-46`.

```ts
presetStatus && normalizeStatus(presetStatus) ? presetStatus : LOSS_REASONS[0],
```

O Select de motivo nasce em `LOSS_REASONS[0]` = **"17. DISTRATO"**, que é o rótulo mais forte da
lista. Quem abre a confirmação e aperta "Encerrar negócio" sem olhar grava um distrato.

O campo cumpre "sempre grava algum motivo" — que é o que os testes cobram — mas não cumpre "quem
encerrou escolheu o motivo". São coisas diferentes, e a segunda é a que o diálogo promete.

**O que fazer:** nascer sem valor quando não houver `presetStatus`, e o botão "Encerrar negócio"
fica desabilitado até haver escolha. Quando vier `presetStatus` (a perda veio do Select da tabela,
onde a pessoa já escolheu), **mantenha o pré-preenchimento** — ali a escolha já foi feita e pedir
de novo é atrito à toa.

Cuide para não quebrar o que a Tarefa P acabou de cobrir: `e2e/admin/perder-negocio.spec.ts` tem
um teste chamado *"perder pelo Status 2 da tabela passa pela mesma confirmação"* que depende
justamente do motivo vir pré-escolhido nesse caminho.

## Entrega 3 — os testes

**Unidade** (`src/lib/dealStatus.test.ts`, que já existe): se você mexeu em `normalizeStatus`,
cubra o caso novo e cubra também o que **não** deve mudar. O arquivo já tem o feitio; siga.

**E2E** (`e2e/admin/perder-negocio.spec.ts`, da Tarefa P — 4 testes, todos verdes hoje): acrescente
o caso que faltava, que é o defeito da Entrega 1. Ele tem de cobrar **no banco**, não só na tela:
escolher "19. REPROVADO" no Select da tabela abre a confirmação, e sem confirmar `deals` não muda.

Siga o feitio do arquivo — a P deixou os quatro testes conferindo `deals`, `lost_reason` e a
saída do negócio da conta de ativos. Leia antes de escrever.

## Fora de escopo (anote, não faça)

- Restaurar a tela de Gamificação — **Tarefa Q**.
- Os restos da varredura tipográfica e o Checkpoint a 375 px — **Tarefa S**.
- O modal do `NewLeadNotifier` que deixa a página `aria-hidden` (`handoff-P.md` §7.4).
- Publicar. **Quem publica nesta rodada é a Tarefa Q**, e ela publica antes de você terminar
  porque a tela quebrada está no ar. Se você entregar depois, **não republique** — diga no handoff
  que o seu diff está fora do ar e que o Alisson republica com
  `npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75`.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) ·
  `npx vitest run` (190 testes hoje, mais os seus) · `npm run build` verdes.
- `npx playwright test e2e/admin/perder-negocio.spec.ts` — os 4 da P mais o seu, todos verdes.
- A decisão da Entrega 1 escrita no handoff, com o número de linhas do banco que ela afeta.
- Uma única lista de motivos de perda no código.

## Entrega

Não commite. Escreva `docs/prompts/handoff-R.md`: onde você corrigiu o desvio da confirmação e
**por que ali e não no outro ponto**, com o que você viu no banco; o que muda para negócio já
gravado; como o diálogo se comporta agora nos dois caminhos de entrada (tabela e botão); e
qualquer outro rótulo do Status 2 que você tenha encontrado caindo no mesmo buraco — a lista de
status tem 19 itens numerados e só cinco viram `Status1`.
