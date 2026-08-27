# Handoff H — Pipeline, modal de negócio e esteira CCA

26/08/2026 · branch `nova` · **nada commitado**.
Depende das Tarefas A (kit e tokens), B (engajamento), D (`dealStatus`), E (ciclo do
game) e F (`lib/tone`), todas entregues. Rodou em paralelo com G e K.

Republicado em **https://faceimob.vercel.app** (hash `index-B82JQr04.js`, conferido com
`curl` contra o `dist/index.html`).

---

## 1. O que era e o que ficou

`Pipeline.tsx` tinha **1375 linhas, 44 `useState` e 26 toasts**, com **dois editores
gravando o mesmo registro**. Virou composição:

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/pages/Pipeline.tsx` | 281 | composição + estado compartilhado (filtro, o que está aberto) |
| `src/pages/CcaPipeline.tsx` | 120 | composição da esteira (era 408) |
| `src/components/DealDetailModal.tsx` | 207 | casca do editor (era 577) |

Blocos novos em `src/components/pipeline/` (barril em `index.ts`):

| Arquivo | O quê |
|---|---|
| `DealFilters.tsx` | painel de filtros, sem estado próprio |
| `DealsToolbar.tsx` | busca, alternância tabela/kanban, régua de contadores |
| `DealsBoard.tsx` | os quatro estados da listagem (carregando / erro / vazio / conteúdo) |
| `DealsTable.tsx` · `DealsKanban.tsx` · `DealCard.tsx` | as duas visões |
| `CheckinQueueBar.tsx` | fila do dia + check-in/out |
| `CloseMonthDialog.tsx` · `LoseDealDialog.tsx` · `ScheduleVisitDialog.tsx` | diálogos de escrita |
| `PipelineAnalytics.tsx` | painel lateral de indicadores |
| `DealForm.tsx` · `DealCommentsPanel.tsx` · `DealCcaPanel.tsx` · `fields.tsx` | miolo do editor |
| `CcaBoard.tsx` · `CcaMoveDialog.tsx` · `CcaStageSettingsDialog.tsx` | esteira CCA |
| `data.ts` · `ccaData.ts` · `useDealActions.ts` | `useQuery` com chave estável e as escritas |
| `filters.ts` · `stages.ts` · `statuses.ts` · `review.ts` · `ccaStage.ts` · `csv.ts` | regra pura |

Maior arquivo hoje: 281 linhas (`Pipeline.tsx`) — os outros dois acima de 250 são
`DealForm.tsx` (264, um formulário de 40 campos) e `DealsTable.tsx` (217).

Os 44 `useState` viraram **9** no `Pipeline.tsx` (aba, filtro, painéis, e qual diálogo
está aberto); o resto é estado local do bloco ou `useQuery`.

---

## 2. A fonte única de etapa (F09, F10, F11)

**Escolhi `pipeline_stages`, a tabela.** É ela que tem o `id` que `can_enter_stage()`
autoriza — qualquer outra fonte seria um espelho que uma hora diverge. Os três lugares
que discordavam agora apontam para lá:

1. **Colunas do kanban e Select de etapa** — `listPipelineStages()` (já existia em
   `permissions.ts`), via `usePipelineStages()`.
2. **Linha da tabela** — `deal.stage_label`, novo campo de `LegacyDealRecord`.
   `listLegacyDeals` **já consultava** `pipeline_stages` e usava só o `code`; agora
   devolve `label` e `position` junto. Foi a sugestão da própria auditoria.
3. **`DEAL_STAGES` em `src/types/crm.ts`** continua, porque `SalesFunnelCard` e
   `aiAnalytics` (fora do meu escopo) dependem dele — mas o Pipeline **não o usa mais**.
   Virou espelho declarado, e `stages.test.ts` **lê `supabase/seed.sql` de verdade** e
   reprova se os rótulos ou a ordem divergirem.

Consequências concretas:

- **F09:** a coluna Status mostrava o literal `PROPOSTA {mês}` para todo negócio,
  inclusive fechado e perdido. Agora mostra a etapa real (ver a captura: "Fechado",
  "Perdido", "Em Análise").
- **F10:** `"08. VIROU NEGOCIO"` sem acento não batia com o catálogo e deixava o Select
  vazio. A etapa saiu da lista de Status 2 — são coisas diferentes e agora têm colunas
  diferentes. Além disso `statusChoices()` **sempre inclui o valor gravado**, mesmo fora
  do catálogo: nenhum Select abre em branco, e o primeiro clique não sobrescreve às cegas.
- **F11:** `tableStageLabels` foi apagado. `pipeline_stages.label` passou a ser lido.
- **Bônus:** a etapa `lost` existe no banco e não existia no front, então negócio perdido
  aparecia como "PROPOSTA" na tabela. Agora aparece "Perdido". `DealStage` **não** foi
  alargado com `'lost'` de propósito — `aiAnalytics.ts:4` tem `Record<DealStage, number>`
  e está fora do meu escopo; o catálogo é indexado por `code: string`.

`pipeline_stages.color` continua sendo hex (`#94a3b8`) e **não é usado**: hex não segue a
troca de tema. O tom vem de um mapa por `code` em `stages.ts`, com fallback `neutral` para
etapa que o admin criar depois.

---

## 3. Participante por id (F06)

Os três lados foram fechados:

- **`src/types/crm.ts`** — `PipelineDeal` ganhou `broker1_id…broker3_id`,
  `manager1_id…manager3_id`, `developer_id`, `project_id` e `stage_label`. O campo de
  nome continua, mas agora está marcado como **só exibição**.
- **`newSchema.ts:saveLegacyDeal`** — o `nameToId` com `people.find(p => p.name === nome)`
  **morreu**, e com ele o parâmetro `people` da função (só o Pipeline chamava).
  A gravação lê os `*_id`, com `dedupe`: a mesma pessoa em dois slots virava conflito no
  `upsert` de `deal_participants` e derrubava o salvamento inteiro.
- **Select e filtros** — `PersonField` grava `id`; `DealFilters` filtra por `id` de
  corretor, gerente **e construtora** (mesma classe de erro: renomear a construtora
  esvaziava o filtro).

Dois efeitos colaterais bons:

- O filtro de corretor agora acha o negócio em **qualquer slot** (1, 2 ou 3), não só no 1 —
  que é o que importa num negócio rateado.
- Sob RLS o corretor **não enxerga o perfil do gerente**, então "Gerente 1" chegava vazio
  na tela dele e o salvamento tirava o gerente do negócio. O `id` é visível mesmo quando o
  nome não é, e `PersonField` mostra uma entrada "fora da sua visibilidade" para não
  perder o vínculo.

Os quatro campos de 2º cliente e CPF **existiam na tela e não filtravam nada**. Agora
filtram, e o CPF casa com e sem pontuação.

---

## 4. A decisão sobre o "Novo Lead" (F02)

**Saiu da tela.** No lugar ficou um botão "Abrir tela de Leads" (`<Link to="/leads">`).

Por quê, e não "respeitar a permissão":

1. O caminho certo de criação (`createLead` + `reassignLead`) já tem dono: o
   `LeadFormDialog` da tela de Leads, entregue pelo agente G. Duplicar aqui recriaria o
   achado A06 num campo novo.
2. Não existe código de permissão para "criar lead" no catálogo `permissions` — só
   `menu.*`. Um gate correto exigiria migration, que é do agente K.
3. O botão antigo fazia três coisas erradas ao mesmo tempo: `insert` direto em `leads`
   (a policy `leads_insert` só aceita `admin/director/manager/marketing/sdr`, então o
   corretor levava 42501 num botão que a tela mostrava a ele), `status: 'queued'` com
   `assigned_to` que a `assign_lead` sobrescreve, e sem `source_id`.

A aba "Leads" do Pipeline continua mostrando o `LeadFunnel`, e a conversão em negócio
agora usa o **`ConvertLeadDialog` do agente G** — o arquivo já existia quando comecei, e
o handoff dele diz que é o superconjunto. Isso resolve o A06 sem eu tocar em
`components/leads/`.

---

## 5. Perder negócio pede confirmação (F14)

O `Switch` em `scale-75` da última coluna gravava `stage=lost` com o motivo fixo
"Arquivado manualmente" **em um clique** — e a própria tela avisava que não reabre.

Agora: botão nomeado (`aria-label="Perder o negócio de <cliente>"`) → `AlertDialog` com
**motivo obrigatório** (`17. DISTRATO`, `18. QUEDA`, `19. REPROVADO`, `OFF`) e observação
opcional. Passa pela mesma trava `can_enter_stage()` do arrastar.

A causa raiz era compartilhada, então a correção também é: **o Select de Status 2 da
tabela cai no mesmo diálogo** quando o valor escolhido normaliza para QUEDA/DISTRATO/OFF.
Antes, escolher "17. DISTRATO" ali encerrava o negócio sem perguntar nada. A comparação
usa `normalizeStatus` de `@/lib/dealStatus` (Tarefa D) — não recriei a regra.

O Select de etapa do editor **não oferece "Perdido"**: escolher ali encerraria o negócio
no salvamento, sem motivo e sem confirmação.

---

## 6. Estados de verdade (A01) e permissões

- Tudo por `useQuery` com chave estável (`["deals"]`, `["pipeline","stages"]`, …).
  `LoadingState` na espera, erro em pt-BR por `describeError` com **"Tentar de novo"**, e
  `EmptyState` distinguindo **vazio por filtro** (com "Limpar filtros") de **vazio de
  verdade** (com "Adicionar negócio"). O mesmo na esteira CCA.
- **Sem atualização otimista.** Quando a escrita falhava, o card ficava na coluna nova com
  o banco recusando: a tela mentia até o próximo reload. Agora o `invalidate` é a verdade.
- **P09** — `canAct = isAdmin || roles.includes('cca')` na esteira. Papel é N:N; comparar
  `role` com igualdade negaria quem é CCA **e** gerente. Sem `canAct` some o "Mover
  para…", o "Enviar à construtora" e o "Gerenciar estágios", e aparece o selo "Somente
  leitura" — que é o caso do sócio, que tem `menu.cca` e não pode escrever.
- **P10** — o editor de estágio ganhou o Select de **desfecho** (`cca_status`). Todo
  estágio criado nascia `under_review`, então um "Aprovado" feito pelo usuário não
  decidia o caso nem movia o negócio no funil.
- **X01** — o Select de etapa do editor era `disabled={!isAdmin}`, escondendo do gerente o
  que o banco aceita. Agora **cada etapa** é oferecida conforme `can_enter_stage(stage.id)`,
  e a que não pode aparece marcada "(sem permissão)".
- A aba CCA do negócio tinha `role === "cca"` — mesmo erro, mesma correção.

---

## 7. SQL do T14 para o agente K

`cca_stages.color` guardava uma **classe do Tailwind** (`text-amber-400`, depois
`text-warning`): o banco passava a depender do nome de uma classe de front, classe montada
em runtime não entra no bundle sem safelist, e literal de paleta não acompanha a troca de
tema.

A tela **já grava chave semântica** (`warning`, `success`, `info`, `danger`, `highlight`,
`neutral`) e **lê os três formatos** — `ccaStageTone()` em `components/pipeline/ccaStage.ts`,
com teste. Ou seja: **o UPDATE abaixo é limpeza, não é bloqueio.** Nada quebra sem ele.

```sql
-- T14 — cca_stages.color passa a guardar chave semântica em vez de classe do
-- Tailwind. A tela tolera os três formatos (`warning`, `text-warning`,
-- `text-amber-400`); este UPDATE normaliza as linhas antigas.
update public.cca_stages
set color = case
  when color ~ '(amber|yellow|orange)'                     then 'warning'
  when color ~ '(green|emerald|lime|teal)'                 then 'success'
  when color ~ '(blue|sky|cyan|indigo)'                    then 'info'
  when color ~ '(red|rose|pink)'                           then 'danger'
  when color ~ '(purple|violet|fuchsia|chart-5)'           then 'highlight'
  when color ~ '(slate|gray|grey|zinc|neutral|stone|muted)' then 'neutral'
  when regexp_replace(color, '^(text|bg|border)-', '')
       in ('warning','success','info','danger','highlight','neutral')
    then regexp_replace(color, '^(text|bg|border)-', '')
  when regexp_replace(color, '^(text|bg|border)-', '') = 'destructive' then 'danger'
  when regexp_replace(color, '^(text|bg|border)-', '') = 'primary'     then 'info'
  else 'neutral'
end
where color is null
   or color not in ('warning','success','info','danger','highlight','neutral');

-- Conferência (esperado: só as seis chaves)
-- select distinct color from public.cca_stages;
```

O default da coluna continua `'#94a3b8'` (hex). Trocar para `'neutral'` é opcional e
também não bloqueia — a leitura devolve `neutral` para hex desconhecido.

---

## 8. Cor, tipografia e acessibilidade

- **T03** — os ~70 literais `-300/-400` do Pipeline **já tinham sido convertidos** por uma
  varredura anterior (Tarefa A/F). Confirmado: `grep` de hex e de paleta literal nos meus
  arquivos volta vazio, tirando as *strings de teste* do T14.
- **T05** — o `developerColors` próprio do Pipeline morreu; entra `developerColor` de
  `@/lib/tone`. A cor virou **bolinha** ao lado do nome, e não o nome pintado:
  `chart-*` é token de objeto gráfico (3:1), pintar texto com ele reprovaria no contraste
  que o resto da tela cumpre.
- **X07** — piso de 12 px (`text-xs`). Zero `text-[8px]`, `text-[9px]`, `text-[10px]` e
  `text-[11px]` nos meus arquivos, incluindo `DealHistoryPanel`.
- **X08** — toda grade do editor é `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- **X02** — na esteira, "Mover p/" em `opacity-0 group-hover:opacity-100` com `text-[8px]`
  virou um `Select` "Mover para…" sempre visível.
- **X03** — `aria-label` em todo `size="icon"` (fechar, paginação, visita, perder, editar
  e excluir estágio).
- **X04** — todos os ~40 campos do editor com `useId` + `<Label htmlFor>`. Placeholder não
  é rótulo: some ao digitar, e o Select passa a mostrar o valor escolhido.
- **X01** — card do kanban com `role="button"`, `tabIndex={0}`, Enter/Espaço abre e
  **Shift+←/→ move de coluna** pelo mesmo `onMove` do `onDrop`. Seta sozinha não move de
  propósito: mover é gravação no banco e a seta é gesto de rolagem.
- A linha da tabela clicável (inalcançável por teclado) virou botão na célula do cliente.
- `window.confirm` da exclusão de estágio virou `AlertDialog`.

---

## 9. Fechar o mês

O `CloseMonthDialog` mostra **escrito, antes de confirmar**, qual período será fechado e
**de onde ele vem**: o mês do **ciclo aberto do game** (`game_seasons`), como a migration
`0032` estabeleceu — não o mês do relógio nem o que estivesse digitado no filtro. Sem
temporada aberta, cai no calendário e a tela diz isso. Chama `closeMonthAndSeason` com o
período explícito.

O botão "Fechar mês" desabilita quando esse período já está em `closed_months`.

---

## 10. Correções que apareceram na revisão

Cinco defeitos que eu mesmo teria introduzido, achados relendo o diff:

1. **Negócio novo sem participante trancava o criador para fora.** O direito de editar vem
   de estar em `deal_participants` (`can_edit_deal`); um negócio criado sem corretor nem
   gerente só seria reaberto por admin ou CCA. Agora o `broker1_id` nasce com o próprio
   usuário quando ele é corretor, e o salvamento exige ao menos um participante.
2. **Paginação da tabela** não voltava para a página 1 ao mudar o filtro.
3. **Status 2 de negócio encerrado** ficava editável: trocar o rótulo deixaria um
   "PROPOSTA" fora do funil. Desabilitado, com `title` explicando.
4. **Ordenação dos meses** era `sort()` de string — "12/2025" vinha depois de "01/2026".
   Agora usa `compareMonth`.
5. **Rolagem horizontal da PÁGINA na esteira CCA** (735 px a 375 px, 70 px a 1280 px): o
   transbordo das colunas escapava do `overflow-x-auto` e ia para o documento. `min-w-0`,
   `w-full`, `overflow-x-clip` e reproduzir a estrutura de flex do Pipeline **não
   resolveram**; `contain: paint` na faixa rolável resolve. Está comentado no
   `CcaBoard.tsx`. Era comportamento pré-existente, não regressão desta tarefa.

---

## 11. Testes

`src/components/pipeline/stages.test.ts` (12 casos) e `filters.test.ts` (12 casos),
Vitest, sem framework novo.

O de etapa **lê `supabase/seed.sql` de verdade** — mesmo padrão de
`theme-contrast.test.ts`, que lê `index.css`. Cobre: as nove etapas do seed,
`DEAL_STAGES` espelhando rótulo e ordem do banco, todo tom com classe literal, `lost` fora
do funil mas com rótulo resolvido, o acento de `08. VIROU NEGÓCIO`, `statusChoices` nunca
deixando o Select vazio, e a tolerância de `ccaStageTone` aos três formatos.

O de filtro é o **cenário do homônimo**: dois "João Silva" com `id` diferente, corretor em
slot 2 ou 3, e perfil renomeado continuando no filtro.

---

## 12. Fora de escopo (anotado, não feito)

- **A06** — resolvido *importando* o `ConvertLeadDialog` do agente G; nenhum arquivo de
  `components/leads/` foi tocado. Se o agente G mudar a assinatura
  (`{ lead, onClose, onConverted }`), o Pipeline acompanha.
- **A11** — `Broker` em `types/crm.ts` com `monthly_sales`/`monthly_vgv` mortos: o
  Pipeline parou de usar o tipo (usa `PersonRecord`), mas não apaguei o tipo, que não é meu.
- **Migration nenhuma.** O SQL do T14 está na §7.
- `pipeline_stages.color` (hex no banco) continua ignorado pelo front. Se um dia a tela de
  permissões quiser deixar o admin escolher a cor da etapa, vale o mesmo tratamento do
  T14: chave semântica em vez de hex.
- O `main` do `AppLayout` deixa transbordo horizontal escapar (§10.5). O `contain: paint`
  resolve caso a caso; a correção de raiz é no shell, que não é meu.

---

## 13. Arquivos tocados

**Editados:** `src/pages/Pipeline.tsx` · `src/pages/CcaPipeline.tsx` ·
`src/components/DealDetailModal.tsx` · `src/components/DealHistoryPanel.tsx` ·
`src/integrations/supabase/newSchema.ts` · `src/types/crm.ts`.

**Criados:** 24 arquivos em `src/components/pipeline/` (22 de código + 2 de teste).

> **Sobre `src/types/crm.ts`:** o prompt listava `src/integrations/supabase/crm.ts`, que
> não existe. `DEAL_STAGES` e `PipelineDeal` — e as linhas 103-106 que o prompt cita —
> estão em `src/types/crm.ts`. Editei esse, que é o arquivo que a tarefa descreve.

`PipelineTopRanking.tsx` estava na minha lista e **não precisou de mudança**: já usa o kit
e os tokens `gold/silver/bronze` desde a Tarefa B.

---

## 14. Validação

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npx vitest run
```

```bash
npm run build
```

`typecheck` limpo · `lint` com **0 erros e 7 avisos**, todos pré-existentes
(`react-refresh/only-export-components` em `ui/*`, `AuthContext`, `ComparativeFunnel`,
`UpdateNotifier`) · **176 testes passando** em 11 arquivos · build em ~10 s.

Armadilha confirmada na prática: `npx tsc --noEmit` na raiz sai 0 sem olhar arquivo nenhum.
Só `npm run typecheck` vale.

---

## 15. Capturas

`docs/design-system/pipeline-*.png` e `cca-*.png` — 16 arquivos, `deviceScaleFactor: 2`:

| Arquivo | O quê |
|---|---|
| `pipeline-tabela-{dark,light}-{1280,375}` | tabela nos dois temas e nas duas larguras |
| `pipeline-kanban-{dark,light}-{1280,375}` | kanban idem |
| `pipeline-filtros-{dark,light}-1280` | painel de filtros aberto |
| `pipeline-negocio-{dark,light}-1280` | editor de negócio (criação) |
| `cca-{dark,light}-{1280,375}` | esteira CCA |

**Como foram feitas — leia antes de tirar conclusão dos números.** Não há
`SUPABASE_SERVICE_ROLE_KEY` no ambiente, então não dá para cunhar sessão real; e anônimo o
RLS devolve `[]` em tudo, o que renderiza só estado de erro. Sessão encenada no
`localStorage` e PostgREST respondido por interceptação do Playwright.

**Diferente da Tarefa F, os dados são SINTÉTICOS**, não um despejo da homologação: as
capturas existem para mostrar o desenho, e um despejo traria nome, e-mail e telefone de
pessoas reais para dentro do repositório. Os nomes das capturas não existem em banco
nenhum. As nove etapas, sim, são as do `supabase/seed.sql`.

Verificado junto com a captura, nas 16 combinações: **nenhuma barra de rolagem horizontal**
(`scrollWidth <= clientWidth`) e **nenhum erro no console**.

O script e as fixtures ficaram no scratchpad da sessão (`shots.mjs`, `fixtures.mjs`),
fora do repositório.

---

## 16. O que o próximo precisa saber

- **Não adicione `celebrate("sale")` no Pipeline.** O `EngagementLayer` já dispara a venda
  por realtime a partir de `game_events` e agrupa os INSERTs de uma venda rateada entre
  corretores. Chamar na tela tocaria o som duas vezes e quebraria o agrupamento. Está
  escrito no cabeçalho do `Pipeline.tsx`.
- **Escrita de negócio passa por `saveLegacyDeal`**, que agora recebe **só o formulário**
  (o parâmetro `people` saiu). Quem chamar com nomes em vez de `*_id` grava um negócio sem
  participante — e perde o acesso a ele.
- **Etapa nova no banco** aparece sozinha no kanban, no Select e no filtro, com tom
  `neutral`. Para dar cor própria, uma linha em `TONE_BY_CODE` (`stages.ts`).
- **Status 2 novo** entra em `FACEIMOB_STATUSES` (`statuses.ts`) com o tom. Se ele
  significar perda, `normalizeStatus` precisa reconhecê-lo (`lib/dealStatus.ts`) para cair
  na confirmação em vez de gravar direto.
