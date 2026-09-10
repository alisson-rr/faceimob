-- =============================================================================
-- 0092 · Extrair a planilha do Pipeline vira permissão
--
-- O botão "Extrair" era de todo mundo que abre o Pipeline. O arquivo que ele
-- gera não é uma lista de negócios: leva VGV, percentual de rateio e VGV POR
-- CORRETOR do recorte inteiro — ou seja, a folha de comissão da operação num
-- arquivo que atravessa WhatsApp sem deixar rastro. Corretor, SDR e marketing
-- enxergam o Pipeline (`menu.pipeline`) e levavam isso junto.
--
-- Pedido do cliente em 05/09/2026: só administrador e sócio extraem.
--
-- Permissão na matriz, e não lista de papéis no código, porque é assim que o
-- resto do sistema faz (`role_permissions`, 0015) e porque quem administra
-- permissões já tem a tela para mudar isso sem deploy. `has_permission()`
-- curto-circuita em admin, então a linha de admin abaixo é redundante para a
-- autorização — ela existe para a tela de Permissões mostrar o estado real em
-- vez de um interruptor desligado que mesmo assim funciona.
--
-- LIMITE CONHECIDO, e é deliberado: a trava é de TELA. Não existe endpoint de
-- exportação — a planilha é montada no navegador a partir dos negócios que o
-- RLS já entregou. Quem tem o dado na tela consegue copiá-lo de outras formas;
-- o que esta permissão remove é o caminho de um clique. Fechar de verdade
-- exigiria gerar a planilha no servidor, e aí a conversa é outra.
--
-- Idempotente: `on conflict do nothing` nas duas tabelas.
-- =============================================================================

insert into public.permissions (code, label, category, description)
values (
  'pipeline.export',
  'Extrair planilha do Pipeline',
  'negocios',
  'Baixar o recorte filtrado em .xlsx, com VGV, percentual de rateio e VGV por corretor. É a folha de comissão da operação.'
)
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
values
  ('admin', 'pipeline.export', true),
  ('partner', 'pipeline.export', true)
on conflict (role, permission) do nothing;

-- Enquanto estamos aqui: o rótulo do menu do CCA ficou para trás. A tela se
-- chama "Esteira CCA" desde 04/09/2026 (h1, menu lateral e roteiro da
-- demonstração), e a matriz de permissões continuava anunciando "CCA Pipeline"
-- — quem administra permissões procurava por um nome que não existe mais.
update public.permissions
   set label = 'Esteira CCA'
 where code = 'menu.cca'
   and label <> 'Esteira CCA';
