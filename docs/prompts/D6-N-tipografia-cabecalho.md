# Tarefa N — O piso de 12 px vazou pelo kit, e o cabeçalho corta o sino a 375 px

> Contexto do agente: **limpo**. Roda **em paralelo com M, O e P**. Trabalho de varredura: muitos arquivos, diff raso em cada um. O risco aqui não é quebrar nada — é fazer o mesmo remendo 40 vezes em vez de consertar a origem uma vez.

## Contexto

- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/code-style.md`, `docs/design-system.md` (o kit) e `docs/prompts/handoff-J.md` §3.3, §3.4 e §4 (a varredura que mediu isto).
- **Você pode editar:** `src/index.css`, `src/components/RoleSwitcher.tsx`, `src/components/layout/{AppLayout,AppSidebar}.tsx`, `src/components/shared/**`, `docs/design-system.md`, e os componentes com tamanho literal listados no item 2 — **menos `src/pages/DailyReport.tsx`**.
- **NÃO toque em:** `src/pages/DailyReport.tsx`, `src/components/UpdateNotifier.tsx`, `src/components/NotificationBell.tsx` — **são da Tarefa M**, que está aberta agora. O badge `text-[9px]` do `NotificationBell` é a única exceção que você **não** conserta; anote no handoff e a M leva. · `package.json` (Tarefa **O**) · `e2e/**` (Tarefa **P**) · `supabase/**`.
- Sem hex, sem paleta literal, sem tamanho em pixel literal. Tudo por token e por escala do Tailwind.

## O achado, medido

A Tarefa J mediu por código as 6 telas × 2 temas × 2 larguras — 24 combinações. Resultado: **toda tela tem de 7 a 17 elementos em 11 px e pelo menos 1 em 10 px**. Os handoffs G e H declaram "piso de 12 px, zero `text-[Npx]`" e **isso é verdade nos arquivos deles** — o piso vazou pela classe do kit que eles passaram a usar no lugar dos literais.

Não é regressão de ninguém. É um requisito que nunca foi decidido de verdade.

## Entrega 1 — decidir o piso, uma vez, na origem

`src/index.css:234` define `.text-eyebrow { font-size: 0.6875rem }` — **11 px**. É a classe de rótulo em caixa alta que G, H e F adotaram: seções do menu lateral ("Menu principal", "Administração", "Sistema"), rótulos das seções do editor de negócio, `1º`/`2440 pts` do `PipelineTopRanking`.

**Escolha um caminho e escreva a decisão em `docs/design-system.md` e em `docs/sprints/decisoes.md`:**

- **(a) Subir `.text-eyebrow` para `0.75rem` (12 px).** O X07 continua valendo como está escrito. Custo: os rótulos crescem 9% em todo lugar onde a classe aparece — confira que nada estoura, principalmente o menu lateral encolhido e o cabeçalho do kanban.
- **(b) Redefinir o X07** para admitir 11 px **apenas** em rótulo curto, em caixa alta, com `letter-spacing` aumentado — que é o caso de uso real da classe, e é legível de um jeito que texto corrido de 11 px não é. Custo: o requisito deixa de ser verificável por um número só, e precisa de uma frase que diga onde vale a exceção.

**Recomendo (b) e digo por quê:** a classe existe justamente para o caso que a exceção descreve, e (a) infla todo rótulo de seção do app por um número que ninguém verificou contra o desenho. Mas (b) só vale se a exceção ficar escrita e verificável — senão vira licença para 11 px em qualquer lugar, e o problema volta em três sprints. **Se escolher (b), a exceção precisa do item 3.**

## Entrega 2 — a varredura dos tamanhos literais

Estes são os arquivos com `text-[8px]`, `text-[9px]`, `text-[10px]` ou `text-[11px]` hoje. A lista é do `grep`, não de estimativa — confirme antes de editar, porque M, O e P estão mexendo no repositório em paralelo:

```bash
grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/
```

Casos conhecidos: `BrokerEditModal.tsx` (7), `CampaignPerformancePanel.tsx`, `DealDocumentUpload.tsx`, `RoleSwitcher.tsx` (3), `pages/Login.tsx` (o divisor "ou"), `TaskPanel.tsx`, `VisitPanel.tsx`, `AdminDailyTeams.tsx` (4), `pages/Checkpoint.tsx`, `DeveloperSubmissionDialog.tsx`, `pipeline/CcaBoard.tsx`.

**Duas regras que evitam o remendo repetido:**

1. **Badge é um caso só.** A maior parte dos `text-[9px]` está em `<Badge>` — `AdminDailyTeams`, `TaskPanel`, `VisitPanel`, `Checkpoint`, `DeveloperSubmissionDialog`. Isso não são 12 decisões, é **uma**: ou o `Badge` do kit ganha uma variante compacta com tamanho decidido, ou todos passam a usar a escala normal. Conserte em `src/components/ui/badge.tsx` e apague os literais dos chamadores — não troque `text-[9px]` por `text-xs` doze vezes.
2. **`CcaBoard.tsx:22` tem um comentário que explica o `text-[8px]`** ("`opacity-0 group-hover:opacity-100`: invisíveis no toque"). Leia antes de mexer — pode ser código já morto que a Tarefa H substituiu pelo Select "Mover para…", e nesse caso o certo é **apagar**, não redimensionar.

## Entrega 3 — deixar uma verificação que segure isto

O piso volta na próxima tela nova se nada o cobrar. O repositório já tem o formato certo: `src/lib/theme-contrast.test.ts` **lê o `index.css` e reprova par de cor abaixo do mínimo** — está no `npx vitest run` e é verde hoje.

Faça o análogo: um teste que varre `src/**/*.tsx` e reprova tamanho literal abaixo do piso, **com a lista de exceções da sua decisão do item 1 escrita no próprio teste**. Sem framework novo, sem fixture; o mesmo feitio do que já existe.

É a única entrega desta tarefa que sobrevive a você.

## Entrega 4 — o cabeçalho a 375 px

**O que acontece:** a 375 px, em qualquer tela autenticada, o sino aparece pela metade. Na Esteira CCA — cujo título é mais longo — **o sino some**. Ver `docs/design-system/smoke-j-dashboard-light-375.png` e `smoke-j-cca-dark-375.png`.

**Causa provável (do handoff-J §3.4, confirme antes de aceitar):** `RoleSwitcher.tsx:59` tem `w-[150px]` no `SelectTrigger` — largura fixa que não encolhe. O que sobra do cabeçalho é cortado, e o título variável decide quanto sobra.

**Consequência real:** no celular não dá para chegar às notificações. O sino é um dos extras do roteiro do cliente.

Conserte o **arranjo do cabeçalho**, não só a largura do Select: um `w-[150px]` no meio de uma linha que também tem título variável e sino vai encostar de novo assim que alguém criar uma tela com título maior. O que precisa ficar acessível a 375 px, em ordem: o sino, o avatar, e depois o seletor de papel — que pode encolher para ícone, ou sair do cabeçalho no estreito.

**Não use o `hidden sm:inline` como resposta geral.** Ele já esconde o "pré-visualizando" (`:76`), e esconder o aviso de que você está vendo como outra pessoa é pior no celular do que na tela grande, não melhor. Se algo tem de sumir no estreito, que seja o rótulo do papel, não o aviso do modo de pré-visualização.

## Como medir (o mesmo método da J, para os números serem comparáveis)

A J mediu **por código na página**, não a olho: `scrollWidth === clientWidth` para transbordo, e leitura de `getComputedStyle` para tamanho de fonte, nas 24 combinações. Ela achou **zero transbordo horizontal** e **zero erro de console** — esse é o estado que você tem de preservar, não só o que você melhora.

Refaça a medição depois das suas mudanças e ponha o antes/depois no handoff. Capturas novas vão em `docs/design-system/` com prefixo próprio (`smoke-n-`); **não sobrescreva as `smoke-j-*`**, que são a linha de base.

## Fora de escopo (anote, não faça)

- O transbordo horizontal do `main` do `AppLayout` (handoff-H §10.5). A J conferiu: **não reproduz mais**, porque o `contain: paint` do `CcaBoard` resolve caso a caso. Continua sendo dívida de shell — mas mexer no `main` sem um caso que quebre é mexer no escuro.
- O pódio apertado do `PipelineTopRanking` a 375 px (cosmético, handoff-J §4.3), a menos que sobre tempo.
- Contraste: já é coberto por `theme-contrast.test.ts`, que está verde.

## Critérios de aceite

- `npm run typecheck` · `npm run lint` · `npx vitest run` · `npm run build` verdes.
- `grep -rn 'text-\[\(8\|9\|10\|11\)px\]' src/` volta **só** com o que a sua decisão do item 1 admite explicitamente, mais `DailyReport.tsx` e `NotificationBell.tsx` (da Tarefa M).
- O teste do item 3 existe e **reprova de verdade** — prove: acrescente um literal proibido num arquivo, veja o teste ficar vermelho, desfaça.
- 375 px: sino e avatar alcançáveis nas 6 telas, nos dois temas. Sem transbordo horizontal novo, sem erro de console novo.
- **Não publique** — a Tarefa O publica por último nesta rodada.

## Entrega

Não commite. Escreva `docs/prompts/handoff-N.md`: qual caminho do item 1 você escolheu e o que isso passa a permitir; quantos literais sumiram e quantos ficaram (e por quê); o que mudou no `Badge` do kit; o antes/depois da medição a 375 px; e a prova de que o teste do item 3 reprova.
