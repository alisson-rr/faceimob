-- =============================================================================
-- 0098 · Etapa e status da venda viram permissão de administrador
--
-- Revisão do cliente em 10/09/2026, três itens do mesmo assunto: a etapa do
-- negócio ("Status 1"), a edição da proposta e a marcação de OFF e DISTRATO
-- passam a ser só do administrador e do sócio. Extrair a planilha já era
-- (0092) e não é tocado aqui.
--
-- "Administrador" no pedido inclui o sócio, e desde a 0097 o banco já responde
-- assim: `is_admin()` é `has_any_role('admin', 'partner')`, e `has_permission()`
-- curto-circuita nele. As linhas de `partner` abaixo são, por isso, redundantes
-- para a autorização — existem para a tela de Admin · Permissões mostrar o
-- estado real em vez de um interruptor desligado que mesmo assim funciona
-- (mesma razão da 0092), e para a decisão do cliente continuar registrada caso
-- a 0097 seja revertida.
--
-- POR QUE DOIS CÓDIGOS E NÃO UM. São dois campos com histórias diferentes: a
-- etapa é governada pela matriz `stage_permissions` (quem entra e quem sai de
-- cada etapa), que continua valendo e que o cliente disse estar correta; o
-- status da venda não tinha trava nenhuma. Um código só juntaria as duas
-- decisões num interruptor, e quem administrar permissões amanhã não teria como
-- soltar uma sem soltar a outra.
--
-- NINGUÉM MAIS RECEBE. Código novo sem linha em `role_permissions` é negado
-- (`has_permission()` só encontra o que foi concedido), então não há o que
-- remover de corretor, gerente, diretor, CCA, SDR ou marketing: eles nascem
-- sem os dois.
--
-- LIMITE CONHECIDO, e é preciso dizer com todas as letras: a trava é de TELA.
-- `deals_update` (0012) autoriza pela LINHA — `created_by = auth.uid() or
-- can_edit_deal(id)` — e nenhum gatilho olha `stage_id`, `status_detail`,
-- `outcome` ou `lost_reason`. Quem participa do negócio continua podendo gravar
-- os três campos por fora do navegador. Fechar de verdade é um gatilho de
-- coluna no molde de `deals_guard_value` (0061), que não entra aqui porque
-- mudar a escrita de `deals` não foi pedido nesta rodada.
--
-- Idempotente: `on conflict` nas duas tabelas.
-- =============================================================================

insert into public.permissions (code, label, category, description) values
  (
    'deals.edit_stage',
    'Editar a etapa do negócio',
    'negocios',
    'O campo "Etapa (Status 1)" do negócio. A matriz de etapas continua decidindo de onde se pode sair e para onde se pode ir.'
  ),
  (
    'deals.edit_status',
    'Editar o status da venda',
    'negocios',
    'O campo "Status da venda (Status 2)" e a confirmação de perda — é por ele que um negócio vira proposta, OFF ou distrato.'
  )
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

insert into public.role_permissions (role, permission, allowed) values
  ('admin',   'deals.edit_stage',  true),
  ('partner', 'deals.edit_stage',  true),
  ('admin',   'deals.edit_status', true),
  ('partner', 'deals.edit_status', true)
on conflict (role, permission) do nothing;
