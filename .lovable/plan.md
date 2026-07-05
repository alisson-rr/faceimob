## 1. Links (`/links`) e IPs (`/admin-allowed-ips`) — compactar
- Reduzir KPIs do topo para altura ~64px (números menores, ícones menores, cards mais estreitos).
- Trocar grid de cards para **linhas horizontais densas** (uma linha por equipe / IP), no estilo tabela-card:
  - Links: uma linha com [nome da equipe · slug · PIN · último preenchimento · badges de status · botões copiar/QR/regenerar] alinhados horizontalmente. Mais itens visíveis na dobra.
  - IPs: uma linha com [IP · label · último uso · ativo/desativado · ações] em coluna densa.
- Manter responsivo (empilha em mobile).

## 2. Permissões (`/admin-permissions`) — 2 níveis
Estrutura atual: role × módulo (allow/deny). Expandir para:

**Nível 1 — Itens de menu** (o que já existe, apenas renomear a seção "Acesso ao menu"):
Dashboard, Pipeline, Leads, Equipes, Checkpoint, Links, IPs, Marketing, Gamificação, Configurações, etc.

**Nível 2 — Funcionalidades por menu** (nova seção "Funcionalidades por módulo"):
Uma aba por menu principal. Para o **Pipeline**, listar:
- Ver etapas: checkbox por `deal_stage` (incompleto, documentacao, analise, aprovado, contrato, closed, etc.) por role.
- Ações: criar deal, editar Status 1, fechar mês, exportar.
- Persistido em nova tabela `stage_permissions` (já existe) — usar/expandir.

Nova tabela se necessário: `feature_permissions(role, module, feature_key, allowed bool)`.

## 3. Dashboard do Diretor (nova tela inicial quando `role='director'`)
Rota `/director-dashboard` e redirect do `/` para diretor.

Layout:
- Header: nome do diretor + seletor de equipe (todas as equipes cujos gerentes têm `director_id = broker(auth.uid()).id`).
- KPIs compactos: Leads, Docs, Análises Enviadas, Aprovações, Vendas (agregados do mês corrente, todas as equipes do diretor).
- Grid por equipe: card com mini-funil de cada equipe.
- **Funil visual comparativo** (dois funis lado a lado):

```text
   DAILY (declarado)          PIPELINE (real)
   ┌──────────────┐           ┌──────────────┐
   │ Leads 100%   │ 250       │ Leads 100%   │ 240
   │  Análise 10% │  25       │  Análise 10% │  22
   │  Aprov. 40%  │  10       │  Aprov. 40%  │   9
   │  Venda 50%   │   5       │  Venda 50%   │   4
   └──────────────┘           └──────────────┘
```

- Fonte Daily: `daily_broker_entries` (leads, coleta_docs, analises, aprovados, vendas) agregado por equipes do diretor no mês.
- Fonte Pipeline: `deals` do mês (`month_base`) filtrado por `broker1_id ∈ corretores das equipes do diretor`:
  - Leads: `leads` table (mesmo escopo)
  - Análise enviada: `stage IN ('analise_credito', 'documentacao_completa')`
  - Aprovado: `stage = 'approved'`
  - Venda: `status = 'VENDA'`
- Cada etapa mostra: valor absoluto + % vs leads + meta (10/40/50) com badge verde/vermelho.
- Match usuário: usar `broker.user_id` para ligar Daily entries (via `broker_id`) e Pipeline deals (via `broker1_id`).

## 4. Detalhes técnicos
- Novos arquivos: `src/pages/DirectorDashboard.tsx`, componente `<ComparativeFunnel />`.
- Editar `src/App.tsx` para rota + redirect por role.
- Editar `src/pages/Links.tsx`, `src/pages/AdminAllowedIps.tsx`, `src/pages/AdminPermissions.tsx`.
- Migration: adicionar `feature_permissions` se necessário; expandir `stage_permissions` com policies read/write.
- Sem mudanças em edge functions.
