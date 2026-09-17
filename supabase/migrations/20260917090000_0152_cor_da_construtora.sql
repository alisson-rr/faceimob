-- =============================================================================
-- 0152 · Cor da construtora
--
-- Pedido do dono de 17/09/2026: o administrador escolhe a cor de cada
-- construtora na tela de construtoras, e o Pipeline pinta com ela a bolinha da
-- construtora no quadro e na tabela. Sem cor escolhida (`null`), a tela segue
-- com a cor derivada do nome, como antes.
--
-- Formato fechado em `#RRGGBB`: é o que o seletor de cor do navegador devolve,
-- e o valor vai direto para o `style` da bolinha. Qualquer outro texto é
-- recusado aqui, e não só na tela.
--
-- Sem policy nova: `developers_write` (0003, `has_any_role('admin','cca')`,
-- com o sócio junto desde a 0099) já é "quem pode editar construtora", e
-- `developers_select` já entrega a tabela inteira a todo autenticado.
-- =============================================================================

alter table public.developers add column if not exists color text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'developers_color_format') then
    alter table public.developers
      add constraint developers_color_format
      check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;

comment on column public.developers.color is
  'Cor da construtora no Pipeline, em #RRGGBB. Null = cor derivada do nome.';
