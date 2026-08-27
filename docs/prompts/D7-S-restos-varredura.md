# Tarefa S — Terminar a varredura: os 4 literais que sobraram e os 137 px que ninguém quis

> Contexto do agente: **limpo**. Tarefa de acabamento: quatro itens pequenos, todos já
> diagnosticados por outra pessoa. Roda **em paralelo com Q e R** — as três têm listas de arquivos
> que não se cruzam.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`,
  `.claude/rules/code-style.md`, `docs/design-system.md`, e — importante — `docs/prompts/handoff-N.md`
  §3, §6.1 e §6.2, que é de onde saem três dos quatro itens.
- **Você pode editar:** `src/components/NotificationBell.tsx`, `src/components/NotificationBell.test.ts`,
  `src/lib/type-scale.test.ts`, `src/pages/Checkpoint.tsx`, `src/components/shared/BrandMotif.tsx`,
  `src/pages/MetaAdsSetup.tsx`, e **criar** um arquivo novo em `src/lib/`.
- **NÃO toque em:** `src/pages/Gamification.tsx` (Tarefa **Q**) · `src/components/pipeline/**` e
  `src/lib/dealStatus.ts` (Tarefa **R**) · `e2e/**` · `supabase/**` · `package.json`.

## ⚠️ Antes de rodar qualquer git

Este branch tem **158 arquivos não commitados**. **`git checkout --` e `git restore` não são
"desfazer" aqui, são "apagar".** Hoje mesmo isso destruiu o `src/index.css` (recuperado a duras
penas, `handoff-N.md` §7) e o `src/pages/Gamification.tsx` (a Tarefa Q está restaurando de um
transcript agora). Se precisar de alteração temporária, **copie o arquivo antes** e restaure a
partir da cópia.

## Entrega 1 — os 4 literais do `NotificationBell` e a lista que não pode virar permanente

A Tarefa N tirou **142 tamanhos literais de 24 arquivos** e criou `src/lib/type-scale.test.ts`
para a regra passar a se cobrar sozinha. Sobraram exatamente quatro, e sobraram de propósito
porque o arquivo era da Tarefa M naquele momento:

```
src/components/NotificationBell.tsx:122  text-[9px]    ← badge de contagem de não-lidas
src/components/NotificationBell.tsx:139  text-[10px]
src/components/NotificationBell.tsx:162  text-[10px]
src/components/NotificationBell.tsx:163  text-[10px]
```

O piso decidido está escrito em `docs/design-system.md` §3: **12 px (`text-xs`), com uma exceção
— 11 px só em rótulo curto em CAIXA ALTA com `letter-spacing >= 0.1em`**, que é a `.text-eyebrow`
do kit. Selo não é caixa alta e não entra na exceção.

**O badge de contagem (`:122`) tem receita pronta** — a N deixou escrita em `handoff-N.md` §6.2:
é o caso do `<Badge size="sm">` que ela criou, com `absolute -top-1 -right-1 h-4 min-w-4 px-1`. A
12 px o contador fica maior; se apertar, `h-4 min-w-4` vira `h-5 min-w-5`. Confira na tela, não
no código.

**E então apague a linha do teste.** `src/lib/type-scale.test.ts` tem uma constante
`PENDENTE_DE_OUTRA_TAREFA` com **uma** entrada: `"components/NotificationBell.tsx"`. Ela falha nos
dois sentidos de propósito — literal fora da lista reprova, **e arquivo da lista que já foi limpo
também reprova**. Ou seja: quando você tirar os quatro literais, o teste fica vermelho até você
apagar a linha. É o comportamento certo, e a razão está escrita no teste: *lista que só cresce
vira licença permanente, que é exatamente como o piso se perdeu da primeira vez.*

Depois disso, o critério vale sem exceção:

```bash
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/   # tem de voltar vazio
```

## Entrega 2 — mudar `resolveLink` de casa

A Tarefa M endureceu o `resolveLink` do sino (ele virou lista branca: só caminho interno passa,
o resto cai em `/dashboard`) e deixou 4 testes cobrindo isso. Mas a função ficou exportada de
dentro de um componente, e o preço está escrito no `handoff-M.md` §3:

- precisou de um `// eslint-disable-next-line react-refresh/only-export-components`, senão o lint
  ia a 8 avisos e o critério era ≤ 7;
- o teste precisa de um `vi.mock` do cliente Supabase só para conseguir importar o módulo.

**A casa natural é `src/lib/`** — é onde moram `supabaseError`, `dealStatus`, `format`, `tone`.
Mover apaga o `disable` e dispensa o mock. A M não fez porque criar arquivo em `src/lib/` estava
fora da lista dela. Está dentro da sua.

Leve o teste junto e confirme que os 4 casos continuam passando. **Não afrouxe a validação no
caminho**: `//host`, `\\host`, `/\host`, `https://host`, `javascript:`, e caminho com tab/CR/LF
têm de continuar caindo no destino seguro. A tabela completa do que ele recusa está no
`handoff-M.md` §3 — leia antes de mexer, porque três desses casos são fáceis de perder numa
reescrita.

## Entrega 3 — 🟠 os 137 px de transbordo no Checkpoint a 375 px

Achado da Tarefa N (`handoff-N.md` §6.1), medido nos **dois temas**, e ela conferiu que o número é
**anterior** à varredura dela — não é tipografia. São duas causas, e o detalhe que importa é que
**consertar só uma deixa 123 px**:

```
culpado: div.flex items-center gap-2                                      [40..512]   ← 137 px de sobra
culpado: button…SelectTrigger…px-3.5 py-2                                 [346..512]
culpado: div.absolute -right-16 bottom-[12%] h-72 w-72 … bg-brand-blue/25 [90..498]
```

1. **`Checkpoint.tsx:145`** — o `<div className="flex items-center gap-2">` com 4 botões mais um
   `Select` de `w-56` **não quebra linha**, dentro de um `<header>` que é `flex-wrap`. A receita
   que a N deixou: `flex-wrap` no div interno e `w-full sm:w-56` no `SelectTrigger`. Confirme
   medindo, não aplique no escuro.
2. **O `BrandMotif`** (`-right-16`, chega a 498 px) vaza por falta de `overflow-hidden` no pai.

**Sobre o item 2, leia isto antes:** o transbordo do `main` do `AppLayout` foi deixado fora de
escopo nas duas últimas rodadas porque ninguém tinha um caso que quebrasse — mexer no shell sem
caso é mexer no escuro. **Agora existe o caso**, e é este. Mas o `BrandMotif` é do kit
(`src/components/shared/`) e aparece em mais telas: se você puser `overflow-hidden` no pai errado,
corta o motivo gráfico onde ele hoje funciona de propósito. **Confira as outras telas que usam
`BrandMotif` antes e depois**, nos dois temas, e diga quais você olhou.

**Medir como a N mediu**, para os números serem comparáveis: por código na página,
`scrollWidth === clientWidth` para transbordo, nos dois temas a 375 px. O alvo é `transbordo=0`
no Checkpoint sem estragar nenhuma outra tela. Capturas em `docs/design-system/` com prefixo
**`smoke-s-`** — não sobrescreva `smoke-j-*` nem `smoke-n-*`.

## Entrega 4 — 🟢 `bg-black/40` em `MetaAdsSetup.tsx:117`

`<pre className="text-xs bg-black/40 …">`. É paleta literal (regra 1 do design system, achado T03).
A N trocou o tamanho e deixou a cor, com um motivo bom: *mudar cor sem o teste de contraste medir
aquele par é chute*.

Então faça na ordem certa: escolha o token, e **confirme que o par entra no
`src/lib/theme-contrast.test.ts`** — que já lê o `index.css` e mede 73 pares nos dois temas. Se o
par que você usar não estiver coberto, ou você acrescenta, ou você diz no handoff que não está
coberto. Uma cor nova sem medição é o que a N recusou fazer; não faça por ela.

## Fora de escopo (anote, não faça)

- Restaurar a tela de Gamificação — **Tarefa Q**.
- Os defeitos de perda de negócio — **Tarefa R**.
- O pódio apertado do `PipelineTopRanking` a 375 px (cosmético, `handoff-J.md` §4.3).
- O calendário do Histórico do diário pintar de vermelho dia que tem checkpoint (`handoff-M.md`
  §5) — **não dá para consertar no front**, a RPC `public_daily_team` não devolve essa informação.
  É migration.
- Publicar. **Quem publica nesta rodada é a Tarefa Q**, e ela publica antes de você terminar
  porque a tela quebrada está no ar. Se você entregar depois, **não republique** — diga no handoff
  que o seu diff está fora do ar e que o Alisson republica com
  `npx vercel deploy --prod --yes --archive=tgz --scope alissons-projects-b1faee75`.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` (0 erros, e agora **6 avisos**, não 7 — a Entrega 2 apaga
  um) · `npx vitest run` (190 testes hoje) · `npm run build` verdes.
- `grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/` volta **vazio**.
- `PENDENTE_DE_OUTRA_TAREFA` no `type-scale.test.ts` volta **vazia**, e o teste continua verde.
- Checkpoint a 375 px com `transbordo=0` nos dois temas, **sem transbordo novo em nenhuma outra
  tela**.

## Entrega

Não commite. Escreva `docs/prompts/handoff-S.md`: como ficou o badge do sino a 12 px (com captura,
porque é o único item onde o número certo pode ficar feio); onde `resolveLink` mora agora e a
confirmação de que os casos recusados continuam recusados; o antes/depois medido do Checkpoint e
**quais telas você conferiu por causa do `BrandMotif`**; e se o par de cor do `MetaAdsSetup` entrou
ou não no teste de contraste.
