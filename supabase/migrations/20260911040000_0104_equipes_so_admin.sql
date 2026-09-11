-- =============================================================================
-- 0104 · /equipes vira tela de administrador (e, por isso, de sócio)
--
-- Pedido do cliente (Douglas) em 10/09/2026, literal: "só adm e sócio" na tela
-- de Equipes. Vale aqui a regra da 0099: onde ele escreve "administrador", o
-- sócio está incluído — mesma permissão, sem exceção.
--
-- POR QUE PELA MATRIZ E NÃO POR UM `if` NA TELA. `menu.equipes` já é o gate da
-- rota: `ROUTE_PERMISSION` (src/lib/routePermissions.ts) manda `/equipes` para
-- este código e o `RequirePermission` (App.tsx) barra quem não o tem — o mesmo
-- código esconde o item da barra lateral. Um `if (!isAdmin)` dentro da página
-- seria a SEGUNDA fonte de verdade: o interruptor continuaria na tela de
-- Permissões, o admin o marcaria para o diretor, a linha gravaria `allowed` e
-- nada mudaria. É exatamente o defeito que a 0072 fechou com `menu.settings`.
--
-- ADMIN NÃO PRECISA DE LINHA: `has_permission()` (0002) curto-circuita em
-- `is_admin()`, e `is_admin()` é `has_any_role('admin','partner')` desde a
-- 0097/0099. Por isso o `not in ('admin','partner')` abaixo deixa os dois de
-- fora sem depender de nenhuma linha concedida.
--
-- QUEM PERDE: director, manager, broker e cca — as quatro concessões que a 0015
-- criou. Consequência assumida e conhecida: `/checkpoint` tem um botão "Ir para
-- Equipes" (src/pages/Checkpoint.tsx) que, para esses papéis, passa a cair no
-- bloco "Acesso não liberado" do guard. O botão é de outra frente; a alternativa
-- (deixar a tela aberta a eles) contraria o pedido.
--
-- `allowed = false` em vez de `delete`: a linha continua visível e desmarcada na
-- tela de Permissões, então o administrador vê que a concessão existe e está
-- desligada — e pode devolvê-la sem uma migration nova. `menu.equipes` continua
-- no catálogo `permissions` pelo mesmo motivo.
--
-- Idempotente: reexecutar regrava `false` sobre `false`.
-- =============================================================================

update public.role_permissions
   set allowed = false
 where permission = 'menu.equipes'
   and role not in ('admin', 'partner');

-- Verificação executável: se sobrar qualquer papel fora de admin/sócio com a
-- concessão ligada, a migration falha aqui em vez de deixar a tela aberta.
do $$
declare
  sobrou text;
begin
  select string_agg(role::text, ', ' order by role::text)
    into sobrou
    from public.role_permissions
   where permission = 'menu.equipes'
     and allowed
     and role not in ('admin', 'partner');

  if sobrou is not null then
    raise exception '0104: menu.equipes continua concedido a: %', sobrou;
  end if;
end;
$$;
