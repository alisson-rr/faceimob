
## Diagnóstico

No banco já existe tudo o que precisamos, só falta a semântica correta:

- Tabela `deals` tem 2.066 registros importados via CSV, com `status` (Status 1) preenchido: **VENDA (426), PROPOSTA (312), DISTRATO (16), OFF (1.312)** e `month_base` no formato `MM/AAAA`. Nenhum valor **QUEDA** foi importado ainda.
- 40 deals estão sem `broker1_id` (sem correspondência de nome) e existem **4 corretores "fantasmas"** com nome numérico (ex.: `1715461816131x...`) — sobra da importação.
- Pipeline já tem um botão "Fechar mês" que move propostas para o mês seguinte, mas hoje ele funciona por `stage` (não por `status`) e não bloqueia edição das vendas antigas.
- Dashboard começa com filtro `"all"` (todos os meses) — usuário quer que abra no **mês corrente aberto**.

## O que vou implementar

### 1. Limpeza de dados (uma migração + um insert)
- Reatribuir para `NULL` os deals dos 4 brokers numerados e apagar esses brokers.
- Nenhum dado é perdido — os deals continuam visíveis, apenas sem corretor.

### 2. Semântica oficial de "Status 1"
Fonte única da verdade em `src/lib/dealStatus.ts`:

| Status 1  | Categoria no Dashboard | Regra                                         |
|-----------|------------------------|-----------------------------------------------|
| VENDA     | **Resultado**          | Conta no mês em que virou venda               |
| PROPOSTA  | **Produção**           | Conta no mês corrente; migra ao próximo no fechamento |
| QUEDA     | **Perda**              | Só válida no **mesmo mês** da venda           |
| DISTRATO  | **Perda**              | Válido em **mês posterior** à venda           |
| OFF       | (ignorado)             | Não conta em nenhuma categoria                |

Adiciono **QUEDA** como opção no seletor de Status 1 (Pipeline).

### 3. Dashboard
- Filtro de mês passa a abrir por padrão no **mês corrente aberto** (o mais recente não-fechado).
- Cards do topo passam a usar as categorias acima:
  - "Vendas do mês" = count(VENDA em `month_base` = mês selecionado)
  - "Produção" = count(PROPOSTA)
  - "Perdas" = count(QUEDA no mês) + count(DISTRATO cujo mês é posterior à venda daquele cliente)
  - VGV segue apenas VENDA.
- Tabelas por corretor/construtora também respeitam a nova semântica.

### 4. Fechamento de mês (Pipeline)
- Nova tabela `closed_months(month_base text primary key, closed_at, closed_by)` para marcar meses fechados. Só admin escreve.
- Ao fechar um mês:
  - VENDA e QUEDA daquele mês ficam **imutáveis** e viram "Resultado".
  - PROPOSTA daquele mês migra para o mês seguinte (`month_base` = próximo MM/AAAA, mantém o resto).
  - DISTRATO permanece onde foi lançado.
- Botão "Fechar mês" fica **admin-only** e usa `status` (não `stage`) para decidir o que migra.
- **Junho/2026 fica aberto** para o usuário testar o fechamento.

### 5. Corretores importados
- Manter o comportamento atual (deals sem match ficam com `broker1_id = NULL`).
- Nunca criar brokers com nome numérico daqui pra frente — o script de import já filtra, então mudança é só a limpeza retroativa do item 1.

## Arquivos

**Novos**
- `supabase/migrations/…_closed_months.sql` — tabela + RLS + índice em `deals(status, month_base)`
- `src/lib/dealStatus.ts` — enum, categorização, helpers `isResultado / isProducao / isPerda`
- `src/hooks/useClosedMonths.ts` — TanStack Query para meses fechados

**Editados**
- `src/pages/Dashboard.tsx` — default no mês corrente aberto + KPIs usando as categorias
- `src/pages/Pipeline.tsx` — adiciona "QUEDA" no seletor; fluxo de fechamento usa `status` e grava em `closed_months`
- Migração de dados (insert tool): remover brokers numerados

## Fora do escopo (agora)
- Migrar Pipeline/Leads para TanStack Query (fizemos só o Dashboard, seguimos depois).
- Notificações externas do fechamento — ficamos com o toast in-app existente.
