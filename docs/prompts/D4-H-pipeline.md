# Tarefa H — Telas: Pipeline + modal de negócio + CCA

> Contexto do agente: **limpo**. Uma sessão inteira — é o arquivo mais pesado do repo (1375 linhas, 44 `useState`, 26 toasts). As Tarefas A, B, C, D, E, F e I já foram entregues. As Tarefas **G e K rodam em paralelo** neste diretório — respeite a lista de arquivos à risca.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{code-style,typescript}.md`, **`docs/design-system.md`**, **`docs/prompts/handoff-B.md` §1–2** (celebração de venda), **`handoff-E.md` §1** (o mês-base agora vem do ciclo do game — o fechamento de mês é um ponto só) e as linhas A01, A02, A06, F02, F06, F09, F10, F11, F14, T03, T05, T13, T14, P09, P10, X01, X02, X03, X04, X07, X08 da tabela em `docs/auditoria-2026-08-21.md`.
- **Você SÓ pode editar:** `src/pages/Pipeline.tsx`, `src/pages/CcaPipeline.tsx`, `src/components/DealDetailModal.tsx`, `src/components/DealHistoryPanel.tsx`, `src/components/PipelineTopRanking.tsx`, arquivos **novos** em `src/components/pipeline/`, e `src/integrations/supabase/{crm,newSchema}.ts`.
- **NÃO toque em:** `Leads.tsx`, `Checkin.tsx`, `LeadDetailModal.tsx`, `LeadFunnel.tsx`, `LeadCounter.tsx`, `components/leads/**`, `leads.ts`, `checkin.ts` (agente G) · `DailyReport.tsx`, `supabase/**`, migrations (agente K) · `components/{dashboard,engagement,shared}/**`, `index.css`, `tailwind.config.ts`, `App.tsx`, `package.json`.
- Sem hex e sem paleta literal — só token. Kit em `@/components/shared`, formatação em `@/lib/format`, erro em `describeError` de `@/lib/supabaseError`, cor por construtora em **`developerColor` de `@/lib/tone`** (existe desde a Tarefa F).

## Regra que não pode ser quebrada
**Não adicione `celebrate("sale")` aqui.** O `EngagementLayer` já dispara a venda por realtime, agrupando INSERTs em `game_events` — inclusive quando a venda é rateada entre corretores. Uma chamada direta na tela faria o som tocar duas vezes e quebraria o agrupamento. Se algo precisar mudar no gatilho, **descreva no handoff**, não implemente.

## Entregas
1. **Decomposição do `Pipeline.tsx`.** Composição de componentes **novos** em `src/components/pipeline/` — a auditoria já indicou o corte: `DealFilters`, `DealsTable`, `DealsKanban`, `DealCard`, `CheckinQueueBar`, `CloseMonthDialog` — com barril `index.ts`. Nenhum arquivo acima de ~250 linhas. Os 44 `useState` viram estado local de cada bloco + `useQuery`.
2. **A02 — um editor só.** Hoje dois caminhos editam o mesmo registro: o diálogo inline (linhas 1240-1300) e o `DealDetailModal`. Fique com o `DealDetailModal`, usado também para **criar** (prop `deal` opcional). O diálogo inline sai.
3. **A01 — estados de verdade.** `catch` que só toasta faz `deals=[]` virar "Nenhum negócio encontrado"; o kanban não tem loading nem erro. Tudo por `useQuery` com chave estável (`["deals", ...]`): `LoadingState` na espera, erro em pt-BR com "Tentar de novo", `EmptyState` no vazio.
4. **F06 — participante por id, nunca por nome.** `SelectItem value={b.name}` mais `nameToId` por `find` quebra com homônimo e com renomeação. O valor do Select passa a ser o `id` do perfil; os filtros também. Confira os três lados: `crm.ts:103-106`, `newSchema.ts:568-569` e o Select da tabela.
5. **Rótulo de etapa: uma fonte só.** F10 — `"08. VIROU NEGOCIO"` sem acento não bate com `"08. VIROU NEGÓCIO"`, e isso derruba a cor para `bg-muted` e esvazia o Select. F11 — `DEAL_STAGES` (crm.ts) diverge de `tableStageLabels`, e `pipeline_stages.label` nunca é lido. Escolha **uma** fonte e faça os outros dois lugares apontarem para ela. F09 — o texto `PROPOSTA {statusDate}` está literal para todo negócio: mostre a etapa real.
6. **F14 — perder negócio pede confirmação.** O Switch em `scale-75` grava etapa perdida num clique, e a própria tela diz que não reabre. Vira ação explícita com `AlertDialog` e motivo. O `normalizeStatus` já entende `"17. DISTRATO"` e `"18. QUEDA"` (Tarefa D, `src/lib/dealStatus.ts`) — **use o helper, não recrie a comparação**.
7. **F02 — "Novo Lead" no Pipeline.** O botão não tem gate e insere direto em `leads`, mas a policy só permite gestores; e grava status enfileirado com `assigned_to` que a `assign_lead` sobrescreve, sem `source_id`. Ou o botão respeita a permissão e usa o caminho certo de criação, ou some da tela. Decida e justifique no handoff.
8. **X01/X02 — teclado e toque.**
   - Card do kanban: `tabIndex={0}`, `role="button"`, `onKeyDown` (Enter/Espaço abre; setas movem de coluna se der). O `onDrop` já valida por `canEnterStage` — reuse a mesma validação no caminho do teclado, não duplique a regra.
   - O Select de etapa do `DealDetailModal` está desabilitado por `!isAdmin`: libere por permissão, não por papel fixo.
   - CCA: os botões "Mover p/" estão em `opacity-0 group-hover:opacity-100` com `text-[8px]` — invisíveis no toque e no teclado. Troque por um `Select` "Mover para…" sempre visível.
9. **CCA — permissão e estado.** P09: `canAct = isAdmin || roles.includes('cca')` (papel é N:N — nunca comparar `role` com igualdade); `partner` tem `menu.cca` e não pode escrever. P10: estágio criado nasce em revisão e um "Aprovado" customizado não decide nem move — o editor de estágio ganha o Select de status. T14: o `CcaPipeline` **persiste `text-amber-400` no banco**; passe a gravar chave semântica (`warning`, `success`…) e leia com tolerância aos dois formatos. Como você não pode tocar `supabase/**`, **entregue o SQL do UPDATE de migração no handoff** para o agente K aplicar.
10. **Cor e tipografia.** T03: cerca de 70 literais `-300/-400` só neste arquivo, sem variante de tema — viram token. T05: o `DEV_COLORS` próprio do Pipeline sai; entra `developerColor` de `@/lib/tone`, senão a mesma construtora tem cor diferente da home. X07: piso de 12 px. X08: grades de modal ganham breakpoint. X03/X04: `aria-label` nos `size="icon"`, `useId` mais `htmlFor` nos cerca de 30 campos do `DealDetailModal`.
11. **Fechar o mês.** O `CloseMonthDialog` continua chamando `close_month_and_season`, que desde a Tarefa E aceita ser chamado **sem período** e usa o mês da temporada aberta. Deixe explícito na tela qual período será fechado antes de confirmar.

## Fora de escopo (anote no handoff, não faça)
- `A06` — `convertLeadToDeal` e `pickDeveloper` duplicados com o `Leads.tsx`. O agente **G é o dono** da versão nova (`src/components/leads/ConvertLeadDialog.tsx`). Se o arquivo já existir quando você começar, **importe**; se não existir, deixe a cópia do Pipeline como está e registre. Em nenhum caso edite arquivos de `components/leads/`.
- Qualquer migration. O SQL de que você precisar (T14) vai escrito no handoff.

## Critérios de aceite
- `npm run typecheck` · `npm run lint` (0 erros, no máximo os 7 avisos pré-existentes) · `npx vitest run` · `npm run build` verdes.
- Um teste em `src/` para a regra que você tocar e que tem risco real: a normalização de etapa (F10/F11) ou o participante por id (F06). Vitest, sem framework novo.
- Zero hex e zero paleta literal nos seus arquivos; nenhum `text-[8px]` ou `text-[9px]`.
- Capturas (Playwright) em `docs/design-system/pipeline-*.png` e `docs/design-system/cca-*.png`: 1280 px e 375 px, tema claro e escuro, tabela **e** kanban.
- **Republicar a URL do cliente:** `npm run build` e `npx vercel deploy --prod --yes` (CLI já logada; `handoff-C.md` §6). Se o G ou o K publicarem no meio, republique ao final. Confira o hash com `curl -s https://faceimob.vercel.app/` e compare com o do `dist/index.html`.

## Entrega
Não commite. Escreva `docs/prompts/handoff-H.md`: componentes novos, o que virou fonte única de etapa, a decisão sobre o "Novo Lead", o SQL do T14 para o agente K, o que ficou de fora, arquivos tocados, validações e deploy. Atualize a linha da Tarefa H em `docs/sprints/sprint-demo.md`.
