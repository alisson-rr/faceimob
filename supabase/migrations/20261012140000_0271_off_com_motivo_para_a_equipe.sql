-- =============================================================================
-- 0271 · OFF por corretor, gerente e diretor, com o motivo
--
-- Pedido de 12/10/2026: "OFF pode permitir a corretores, gerentes e diretores
-- mediante comentário do motivo". Até aqui o OFF era só de admin e sócio
-- (`deals.mark_off_distrato`, 0101/0231), e essa permissão também libera o
-- DISTRATO — por isso não dá para simplesmente entregá-la à equipe.
--
-- `marcar_off` é o caminho novo: quem edita o negócio e é corretor, gerente ou
-- diretor (ou admin/sócio) marca OFF informando o motivo, e a RPC grava o Status 2
-- e o comentário na mesma transação — não existe OFF sem motivo por aqui. O
-- DISTRATO e o OFF escrito direto na tabela continuam como estavam. Mês fechado
-- segue valendo para quem não é admin (`deals_guard_closed_month`).
-- =============================================================================

create or replace function public.marcar_off(p_deal_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_off    public.deal_statuses;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or not public.can_edit_deal(p_deal_id) then
    raise exception 'Negócio não encontrado ou fora do seu acesso.' using errcode = '42501';
  end if;

  if not public.has_permission('deals.edit_status_detail') then
    raise exception 'Seu perfil não pode alterar o Status 2.' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.has_any_role('broker', 'manager', 'director')) then
    raise exception 'Seu perfil não marca OFF.' using errcode = '42501';
  end if;

  if length(v_motivo) < 5 then
    raise exception 'Escreva o motivo do OFF (pelo menos 5 caracteres).' using errcode = 'P0001';
  end if;
  if length(v_motivo) > 2000 then
    raise exception 'Motivo longo demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_off from public.deal_statuses
   where public.deal_status_bare(value) = 'OFF' and active
   limit 1;
  if not found then
    raise exception 'OFF não está ativo no cadastro de Status 2.' using errcode = 'P0001';
  end if;

  if public.deal_status_bare(v_deal.status_detail) = 'OFF' then
    return;
  end if;

  -- Mês fechado: o gatilho cobra de quem não é admin; esta frase só explica antes.
  if not public.is_admin() and exists (select 1 from public.closed_months cm where cm.period = v_deal.month_base) then
    raise exception 'O mês % está fechado. Fale com o administrador para reabrir.',
      to_char(v_deal.month_base, 'MM/YYYY') using errcode = 'P0001';
  end if;

  perform set_config('faceimob.status_note', v_motivo, true);
  update public.deals set status_detail = v_off.value where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', 'OFF: ' || v_motivo);
end;
$$;

comment on function public.marcar_off(uuid, text) is
  'Marca OFF com motivo obrigatório: corretor, gerente e diretor do negócio, admin e sócio (0271). Grava Status 2 e comentário juntos.';

revoke all on function public.marcar_off(uuid, text) from public, anon;
grant execute on function public.marcar_off(uuid, text) to authenticated, service_role;
