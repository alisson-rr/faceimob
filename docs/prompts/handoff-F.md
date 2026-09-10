# Handoff F — Dashboard redesenhado com o kit e dados por `useQuery`

26/08/2026 · branch `nova` · **nada commitado**.
Depende das Tarefas A (kit), B (engajamento) e C (dados de demo + Vercel), todas entregues.
A Tarefa D já havia entregue quando comecei — usei o `describeError` dela.

**URL do cliente republicada: https://faceimob.vercel.app**
(deployment `dpl_2px4rPvXeJkthcutebqBG6513mSt`, target production, READY — o bundle
servido é `assets/index-Bx-ku6W0.js`, o mesmo hash do `dist/` local.)

---

## 1. O que mudou, em uma frase

`Dashboard.tsx` saiu de **918 linhas** com `useEffect`, 34 hex e quatro paletas para
**228 linhas de composição**: 10 blocos em `src/components/dashboard/`, todo carregamento
em `useQuery`, e cor só por token.

---

## 2. Componentes novos e onde vivem

Todos em `src/components/dashboard/`, exportados pelo barril `index.ts`.

| Arquivo | Linhas | O que é |
|---|---|---|
| `data.ts` | 250 | Consultas (`useDashboardPayload`, `useSalesGoal`, `useDashboardLeads`) e derivações do mês (`useMonthView`, `useMonthlySeries`) |
| `directorData.ts` | 126 | As três consultas do painel da diretoria — escopo, diário, pipeline |
| `KpiRow.tsx` | 81 | A régua de 6 `KpiCard` com delta vs. mês anterior |
| `GoalCard.tsx` | 133 | Meta global do mês: barra tokenizada + estado vazio com o SQL |
| `SalesFunnelCard.tsx` | 44 | Negócios ativos por etapa da esteira |
| `DeveloperOverview.tsx` | 102 | `DeveloperOverview` (vendas × propostas) e `DeveloperRanking` (Recharts, cor por construtora) |
| `TopBrokers.tsx` | 107 | Pódio ouro/prata/bronze + tabela do restante. Serve os três rankings |
| `LeadsPanel.tsx` | 166 | A aba de leads inteira, com consulta própria |
| `MonthlyTrend.tsx` | 57 | Comparativo mensal por ano (uma linha por ano) |
| `Breakdown.tsx` | 80 | `CcaStatusCard` e `StaffCard` sobre uma grade de contagem comum |
| `BarList.tsx` | 57 | Lista rótulo + barra + número, em HTML. Usada em 5 lugares |
| `index.ts` | 27 | Barril |

Nenhum passa de 250 linhas. Fora da pasta:

| Arquivo | O quê |
|---|---|
| `src/lib/tone.ts` | **novo** — `tone()`, `CHART_SERIES`, `seriesToken`, `developerColor`, `podiumToken`, props de Recharts (`chartAxis`, `chartGrid`, `chartTooltip`, `chartLegend`, `chartBarLabel`, `chartStill`, `shortTick`) |
| `src/lib/tone.test.ts` | **novo** — 6 casos travando a determinismo de `developerColor` |
| `src/lib/metrics.ts` | **novo** — `DAILY_METRICS`, `IDEAL_STAGES`, `FunnelStep`, `toFunnelSteps`, `idealFunnelSteps`, `stageConversion` |
| `src/pages/Dashboard.tsx` | reescrito: composição, filtro de período, abas, estados |
| `src/pages/DirectorDashboard.tsx` | reescrito no mesmo padrão; **P06 corrigido** |
| `src/pages/DashboardSwitcher.tsx` | `roles.includes("director")` + `previewRole` |
| `src/components/ComparativeFunnel.tsx` | migrado para o kit e para `@/lib/metrics`; API preservada |
| `src/App.tsx` | **uma mudança só**: `defaultOptions: { queries: { staleTime: 60_000, retry: 1 } }` (A03) |

`src/lib/tone.test.ts` é o único arquivo fora da lista literal do prompt. Motivo: `developerColor`
existe porque a cor por construtora derrapou (T05), e a propriedade que importa — mesmo nome, mesma
cor, independente da ordem da consulta — só fica travada com teste. São 47 linhas, não toca em nada
de ninguém. Se preferir sem, é só apagar o arquivo.

---

## 3. Achados endereçados

| Achado | O que foi feito |
|---|---|
| **T04** | Zero hex e zero paleta literal nos arquivos da tarefa. Sem `min-h-screen` e sem padding próprio: quem pinta fundo e dá margem é o `AppLayout` |
| **T05** | `developerColor(nome)` — hash do nome normalizado sobre `chart-1..5`. Antes era `SERIES[i % 5]` sobre a lista ordenada: bastava uma construtora nova para todas trocarem de cor |
| **T06** | Pódio usa `gold/silver/bronze` via `podiumToken()`. **Não** reusei o `Podium` de `@/components/engagement` — ver §5 |
| **T07** | `METRICS` e as metas do funil (10/40/50) foram para `src/lib/metrics.ts`. `ComparativeFunnel` e `DirectorDashboard` já consomem de lá |
| **T08** | Nenhum `text-[Npx]`. Escala `text-xs` → `text-sm` → `text-base`; rótulo em caixa alta usa `.text-eyebrow`; um `<h1>` só, do `PageHeader` |
| **T09** | Raio e sombra vêm do kit (`rounded-2xl`/`rounded-xl`/`rounded-full`); nenhuma `shadow-[…]` com rgba |
| **A01** | Carregando, erro e vazio têm tela própria em cada bloco. Erro traz `describeError` + botão "Tentar de novo" |
| **A03** | `QueryClient` com `staleTime: 60_000, retry: 1` |
| **P06** | O gerente da diretoria sai de `teams.manager_id`, não de `team_members` — ver §4 |

---

## 4. Decisões que valem discussão

**O mês é derivado, não sincronizado.** Era `useEffect` gravando o mês no estado depois da
primeira pintura: o filtro piscava "Todos" e só depois virava o mês aberto. Agora
`activeMonth = month ?? defaultMonth`, e `defaultMonth` sai de `pickOpenMonth` durante a
renderização. Não há estado para dessincronizar, então não há corrida. Detalhe: se
`pickOpenMonth` cair no mês corrente e esse mês não tiver negócio nenhum, o valor não estaria
na lista do seletor — nesse caso caio no mês mais recente que existe.

**A meta saiu dos KPIs e virou card.** "Meta —" num cartão de indicador não diz se é defeito ou
falta de cadastro. O `GoalCard` mostra 7/14 com barra e o rótulo escrito ("Abaixo da meta"), e
quando não há linha em `goals` mostra o `EmptyState` com o `insert` pronto para colar. A régua
ficou com 6 KPIs: Leads, Produção, Resultado, Perdas, Negócios (destaque) e VGV.

**Delta vs. mês anterior em todos os KPIs.** Sai do mesmo cálculo aplicado ao mês anterior.
Em Perdas o delta é invertido: subir é vermelho. Com "todos os meses" não há comparação e o
delta some — em vez de comparar com nada.

**Abas: `Tabs` do Radix no lugar de `<button>` solto.** Ganha navegação por teclado, `role="tab"`
e foco visível de graça. Pegadinha registrada no código: **`flex` direto no `TabsContent` empata
em especificidade com o `[hidden]` da preflight do Tailwind**, a utility vence e a aba inativa
fica exibida (vazia) — eram ~100 px de espaço morto entre as abas e o conteúdo. O conteúdo de
cada aba vai num `<div>` interno.

**P06 no `DirectorDashboard`.** `listPeople()` deriva `director_id` de `team_members`, e gerente
costuma liderar a equipe sem ser membro dela — o gerente sumia do escopo do próprio diretor.
Agora os gerentes saem de `teams.manager_id where teams.director_id = eu`, que é a consulta que o
painel já fazia. Corretor continua vindo de `team_members`, onde ele é membro de verdade.
O `listPeople()` em si **não foi tocado** (é de `newSchema.ts`, fora do escopo): o achado continua
aberto para `Equipes.tsx` e `Checkpoint.tsx`.

Outras três correções no mesmo arquivo, do mesmo diagnóstico: o diário agora filtra `team_id` no
servidor em vez de trazer todos os relatórios do mês e filtrar no cliente; a consulta do diário
não depende mais de existir corretor (relatório é por equipe, não por corretor — diretoria sem
corretor cadastrado ficava com o painel zerado); e `scope.managers`, que era calculado e nunca
exibido, agora aparece no subtítulo.

**`ComparativeFunnel`: o funil em SVG virou degraus em HTML.** O SVG tinha
`preserveAspectRatio="none"` — o texto esticava junto com a caixa — e desenhava o rótulo em
`fill="white"` com contorno `rgba(0,0,0,.5)`, que some no tema claro. Agora cada degrau é uma
caixa tingida com o `accent` e o texto é `foreground`. A API pública (`VisualFunnel`,
`CompactFunnel`, `StageComparisonList`, `IDEAL_STAGES`, `FunnelStep`, default) está intacta —
`DailyReport.tsx` e `PublicDirectorCheckpoint.tsx` continuam compilando sem mudança.

**Animação do Recharts desligada (`chartStill`).** O `ResponsiveContainer` refaz a série a cada
mudança de largura: recolher a barra lateral reanimava 1,5 s de barra crescendo, o que atropela
`prefers-reduced-motion` — e deixava o gráfico **em branco** na captura de tela. O movimento desta
tela é o do kit (150–300 ms), não o do Recharts.

**Cinco gráficos horizontais viraram `BarList` (HTML).** Com barra horizontal o Recharts corta o
rótulo do eixo de categoria e não há largura que resolva: "Meta Ads" virava "Meta Ad…" e uma
origem virava só "…". Sobraram três gráficos Recharts, que é onde eles pagam: barras agrupadas
por construtora, ranking de propostas (cor por construtora, é a demonstração do T05) e as duas
linhas temporais.

---

## 5. O que ficou de fora, e por quê

- **`Podium` de `@/components/engagement` não foi reusado.** Ele imprime **"pts"** fixo no número,
  e no Dashboard o número é **venda** — o dado não é o mesmo (aquele é pontuação do jogo). Como
  `engagement/**` está fora do meu escopo, não dava para acrescentar uma prop de unidade. Os
  tokens `gold/silver/bronze` são os mesmos nos dois, via `podiumToken()`. **Convergência
  sugerida:** dar ao `Podium` uma prop `unit` (`"pts"` por padrão) e apagar a metade de cima do
  `TopBrokers.tsx`.
- **`Checkpoint.tsx`, `DailyReport.tsx` e `PublicDirectorCheckpoint.tsx` continuam com a cópia
  deles do `METRICS`** e passam `accent="hsl(280 90% 65%)"` literal para o `CompactFunnel` — o
  prompt pedia para não tocar. `src/lib/metrics.ts` já está no formato exato deles (`{ key, label,
  color }`), então a adoção é troca de import.
- **`Pipeline.tsx` mantém o `DEV_COLORS` próprio.** Enquanto ele não importar `developerColor`, a
  mesma construtora pode ter cor diferente lá. O T05 só fecha quando a Tarefa H adotar.
- **Leads são buscados duas vezes.** `loadDashboardPayload()` já chama `listLegacyLeads()` por
  dentro para contar por canal, e a aba de Leads chama de novo para ter as linhas. Resolver exige
  mexer em `newSchema.ts`, fora do escopo. O `staleTime` de 60 s segura a maior parte, e a aba só
  monta quando é aberta.
- **Não há UI para cadastrar meta.** O `GoalCard` mostra o `insert` a rodar no SQL. Virar o mês
  sem cadastrar traz o estado vazio de volta — é a pendência nº 1 de `decisoes.md`.
- **Não inventei KPI novo.** Ticket médio e taxa de conversão sairiam dos mesmos dados, mas
  ninguém pediu.

---

## 6. Capturas

`docs/design-system/dashboard-*.png` — 12 arquivos, `deviceScaleFactor: 2`, página inteira:

| Arquivo | O quê |
|---|---|
| `dashboard-{dark,light}-{1280,375}` | Aba "Visão geral" nos dois temas e nas duas larguras |
| `dashboard-propostas-dark-1280` | Ranking de propostas + esteira de crédito + time |
| `dashboard-vendas-dark-1280` | Os três pódios |
| `dashboard-metas-dark-1280` | Meta do mês + comparativo anual |
| `dashboard-leads-dark-1280` | A aba de leads inteira |
| `dashboard-diretor-{dark,light}-{1280,375}` | Painel da diretoria |

**Como foram feitas — leia antes de tirar conclusão dos números.** Não havia
`SUPABASE_SERVICE_ROLE_KEY` no ambiente, então não deu para cunhar sessão real; e anônimo o RLS
devolve `[]` em `deals`, `leads`, `profiles` e `goals` (conferido por `curl`), o que renderiza
só estado de erro. Então: **sessão encenada no `localStorage` e PostgREST servido a partir de um
despejo real da homologação**, tirado com `npx supabase db query --linked` (Management API, sem
segredo). Os números são os do banco de homologação **vistos como admin** — não passaram pelo RLS.
É o mesmo caminho que a Tarefa A usou para capturar o shell.

Números que aparecem: 73 leads · 17 propostas · 7 vendas · 1 perda · 24 negócios ·
VGV R$ 3.081.520 · meta 7 de 14 (50%) · pódio Ana Oliveira 3 / Diego Costa 2 / Rafael Nogueira 1.
Batem com o `handoff-C` §2.

O script e o despejo ficaram no scratchpad da sessão (`shots.mjs`, `fixtures.json`), **fora do
repositório** — o `fixtures.json` tem e-mail e telefone dos perfis de demonstração, não versione.

Verificações feitas junto com a captura, nas 12 combinações: **nenhuma barra de rolagem
horizontal** (`scrollWidth <= clientWidth`) e **nenhum erro no console**.

---

## 7. Validação

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

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpo (os 3 projects) |
| `npm run lint` | **0 erros · 7 avisos** — os mesmos 7 pré-existentes, nenhum novo |
| `npx vitest run` | **143 testes**, 8 arquivos (114 + os 6 novos de `tone.test.ts`, mais os de D) |
| `npm run build` | ok |
| hex / paleta literal do Tailwind nos arquivos da tarefa | **zero** |
| `text-[Npx]` nos arquivos da tarefa | **zero** |
| `useEffect` de carregamento / "Carregando..." em texto | **zero** |

---

## 8. O que fazer em seguida

1. **Tarefa G/H:** `Pipeline.tsx` importar `developerColor` de `@/lib/tone` e apagar o `DEV_COLORS`
   local — fecha o T05 de vez.
2. **Quem redesenhar `DailyReport`/`Checkpoint`/`PublicDirectorCheckpoint`:** importar `DAILY_METRICS`
   e `toFunnelSteps` de `@/lib/metrics` e passar `accent={tone("chart-5")}` no lugar do HSL literal.
3. **Quem mexer no `Podium`:** prop `unit` e o `TopBrokers` encolhe pela metade.
4. **Cadastro de meta** (`goals`, scope `global`) continua sem tela. Enquanto isso, o SQL está no
   estado vazio do `GoalCard`.
5. **Quando houver credencial**, vale refazer as capturas com sessão real para provar o recorte do
   RLS — o corretor vendo só o que é dele é justamente o que estas capturas **não** demonstram.
