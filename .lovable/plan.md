
## 1. Limpeza de navegação e menu
- Remover completamente `Norteador` (rota, sidebar, arquivo `src/pages/Norteador.tsx`).
- Em `Settings.tsx`: remover as abas `Construtoras`, `Resultados`, `Gamificação`, `Links`, `Norteador`.
- Sidebar: garantir que `Links` e `Gamificação` estão como itens do menu principal (não mais dentro de Configurações). `Links` visível a todos; edição/insert restrita a `admin`.
- `Construtoras`: já existe no menu → apenas remover da tela de Configurações.

## 2. Página Links (`/links`)
- Substituir o mock por CRUD real ligado a nova tabela `useful_links(id, title, url, category, sort_order, created_by, timestamps)`.
- Todos autenticados fazem SELECT. Apenas `admin` faz INSERT/UPDATE/DELETE (RLS via `private.has_role`).
- UI: lista em linhas densas + botão "Novo Link" / "Editar" / "Excluir" só aparece para admin. Sempre com botão **Salvar** explícito no modal.

## 3. Marketing — Uploads Leadfy + Controle de Aporte
- Otimizar layout do upload Leadfy (drag-and-drop compacto, preview de linhas, botão salvar destacado).
- Novo módulo **Aporte de Mídia**:
  - Tabela `marketing_investments(id, invested_at date, amount numeric, developer text, channel text?, note text, created_by, timestamps)`.
  - Formulário inline: data + valor + construtora (select das construtoras existentes) + botão **Salvar**.
  - Popup/badge no header do Marketing com **total do mês atual** (soma de `amount` do mês corrente). Clique abre modal com lista dos aportes do mês, agrupados por construtora.
  - KPI "Investimento" da tela passa a somar `marketing_investments` do mês + spend das campanhas (fallback mock).

## 4. Equipes — Metas Gerente / Diretor / Ano
- Adicionar em `brokers` (já usado para todos os níveis) colunas: `monthly_goal numeric`, `yearly_goal numeric` (VGV meta anual).
- UI Equipes: em cada card de gerente e de diretor, campo editável de **meta mensal** e **meta anual** + botão **Salvar**.
- Meta do diretor (mensal e anual) = **soma automática** das metas dos gerentes sob ele (read-only, calculada no frontend a partir de `brokers.director_id`).
- Painel do diretor mostra:
  - Meta anual do diretor (soma dos gerentes).
  - VGV realizado no ano (soma de `deals.deal_value` do ano onde `status='VENDA'` para brokers das equipes dele).
  - **Falta para meta anual** = meta − realizado.
  - **Meta mensal restante** = falta / meses restantes até dezembro.
- Mesmo bloco por gerente (meta anual vs realizado do ano das vendas da equipe).

## 5. Resultados VGV por ano/mês (fora de Settings)
- Nova página `/resultados` (item de menu apenas para admin/diretor) OU aba dentro de Gamificação — decidir por página dedicada.
- Estrutura: accordion por ano → 12 meses → inputs `vendas` (qtd) e `vgv` (R$) + botão **Salvar** por linha.
- Tabela nova `annual_results(id, year int, month int 1-12, sales_count int, vgv numeric, unique(year,month))`. Admin escreve, todos leem.

## 6. Gamificação — Dica de Ouro & Recados
- Manter página `/gamification` como está para todos.
- Nova aba **Admin** (só visível a admin) com CRUD de:
  - `gold_tips(id, content text, active bool, created_by, timestamps)` — 1 dica de ouro ativa por vez (destaque no topo da Gamificação).
  - `important_notices(id, title, message, pinned bool, active bool, timestamps)` — banner de recados no topo da Gamificação para todos.
- Ambas com botão **Salvar** explícito.

## 7. Banco de dados (uma migration)
Novas tabelas em `public`, todas com GRANT + RLS + `private.has_role`:
- `useful_links` — SELECT authenticated; INSERT/UPDATE/DELETE admin.
- `marketing_investments` — SELECT authenticated; INSERT/UPDATE/DELETE admin+director.
- `annual_results` — SELECT authenticated; write admin.
- `gold_tips`, `important_notices` — SELECT authenticated; write admin.
- ALTER `brokers` ADD `monthly_goal numeric`, `yearly_goal numeric`.

## 8. Arquivos afetados
- Deletar: `src/pages/Norteador.tsx`.
- Editar: `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/Settings.tsx`, `src/pages/Links.tsx`, `src/pages/Marketing.tsx`, `src/pages/Equipes.tsx`, `src/pages/Gamification.tsx`, `src/pages/DirectorDashboard.tsx`.
- Criar: `src/pages/Resultados.tsx`, `src/components/MarketingInvestmentModal.tsx`, `src/components/GoalEditor.tsx`.
- 1 migration SQL.

## Riscos
- Volume grande em uma entrega → alguns detalhes de UI podem precisar de ajuste depois.
- Metas de diretor read-only: se um gerente ainda não tem meta cadastrada, a soma será parcial (mostrar aviso).
- Aportes por construtora exigem lista consistente com `cca_developers` — vou usar essa tabela como fonte.
