## Objetivo
Substituir o "BI Diário" pelo módulo **Checkpoint**, que mede o funil semanal (seg→dom) de cada equipe com metas percentuais, permite editar o nome da equipe na página Equipes e libera acesso ao diretor apenas das equipes dos seus gerentes.

## 1. Banco de dados

**Nova coluna** em `teams`:
- `display_name TEXT` — nome customizado da equipe (fallback: nome do gerente).

**Novos campos** em `daily_broker_entries` (já existe com leads/atendimentos/propostas/visitas/análises/aprovados/vendas):
- `ligacoes INT DEFAULT 0`
- `coleta_docs INT DEFAULT 0`
- `analise_enviada INT` — se distinto de `analises`; senão reusar `analises` como "enviada".

Decisão: reusar `analises` como "Análise enviada", `aprovados` como "Análise aprovada", `vendas` como "Venda". Adicionar apenas `ligacoes` e `coleta_docs`.

**Nova tabela** `checkpoint_targets` (metas percentuais globais/por equipe, editáveis por admin):
- `team_id UUID NULL` (NULL = default global), `analise_enviada_pct NUMERIC DEFAULT 10`, `aprovada_pct NUMERIC DEFAULT 40`, `venda_pct NUMERIC DEFAULT 50`.
- RLS: leitura autenticada; escrita admin.

## 2. Página Equipes (`src/pages/Equipes.tsx`)
- Ao lado de cada gerente na coluna "Gerentes", campo inline editável **"Nome da equipe"** (admin/diretor). Persiste em `teams.display_name` (upsert por `manager_id`).
- Se vazio, exibe `Equipe {nome do gerente}`.

## 3. Formulário público (`/daily/:teamId/:slug`, `DailyReport.tsx`)
- Trocar/renomear campos visíveis para os 6 do Checkpoint: **Leads, Ligações, Coleta docs, Análise enviada, Análise aprovada, Venda**.
- Cabeçalho usa `teams.display_name` quando existir.
- Edge function `submit-daily-report` aceita os 2 novos campos (`ligacoes`, `coleta_docs`).

## 4. Novo módulo Checkpoint (`src/pages/Checkpoint.tsx`)
Substitui `/bi-diario` no menu (mantém rota antiga como redirect).

Layout:
- Seletor de **semana** (padrão: semana corrente seg→dom) com navegação « »
- Filtro de equipe (admin vê todas; diretor vê só equipes dos seus gerentes; gerente vê a sua).
- Card por equipe com:
  - Funil horizontal: Leads → Análise enviada → Aprovada → Venda mostrando valor absoluto + % vs Leads.
  - Barras auxiliares: Ligações e Coleta docs (contadores, sem %).
  - Metas: `enviada ≥ 10%`, `aprovada ≥ 40% das enviadas`, `venda ≥ 50% das aprovadas`.
  - Badge vermelho "Abaixo do ideal" em cada etapa que não bateu a meta.

## 5. Permissões
- Admin: todas as equipes.
- Diretor: filtra `teams` cujo `manager` tem `director_id = auth.uid()` (via broker.user_id).
- Gerente: sua equipe.
- Corretor: bloqueado no menu.

## 6. Navegação
- Sidebar: item "BI Diário" → **Checkpoint**, ícone `Target`.
- Rota nova `/checkpoint`, redirect de `/bi-diario`.

## Detalhes técnicos
- Semana = ISO seg-dom via `date-fns` (`startOfWeek(d,{weekStartsOn:1})` / `endOfWeek`).
- Agregação client-side sobre `daily_team_reports` + `daily_broker_entries` filtrado por `report_date` no range e `team_id IN (equipes visíveis)`.
- `checkpoint_targets` lidas uma vez; merge global+específica.
- Alertas: componente `<FunnelStep />` com estado `ok|warn` conforme `actualPct < targetPct`.
- Sem mudança em tipos gerados até o usuário aprovar a migration.
