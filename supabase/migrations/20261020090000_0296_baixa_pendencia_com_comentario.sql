-- =============================================================================
-- 0296 · Baixa da pendência do contrato exige o comentário do que foi sanado
--
-- Pedido de 20/10/2026: a pendência foi sanada e o negócio segue em contrato;
-- o selo sai por um botão na aba Negócio, só para CCA, admin e sócio, com
-- comentário OBRIGATÓRIO do que foi sanado. Antes (0286) o comentário era
-- opcional. Mesma função, mesma assinatura; só a regra do comentário muda.
-- =============================================================================

create or replace function public.baixar_pendencia_contrato(p_deal_id uuid, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := auth.uid();
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_deal public.deals;
  v_nome text;
begin
  if v_ator is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_role('cca')) then
    raise exception 'Só o CCA ou o administrador dá baixa na pendência do contrato.' using errcode = '42501';
  end if;
  if v_comentario is null then
    raise exception 'Escreva o que foi sanado para dar baixa na pendência.' using errcode = 'P0001';
  end if;
  if length(v_comentario) > 500 then
    raise exception 'Comentário longo demais (máx. 500).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;
  if not v_deal.contract_has_pending_issue then
    raise exception 'Este negócio não tem pendência no contrato.' using errcode = 'P0001';
  end if;

  perform set_config('faceimob.baixa_pendencia', p_deal_id::text, true);
  update public.deals set contract_has_pending_issue = false where id = p_deal_id;
  perform set_config('faceimob.baixa_pendencia', '', true);

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, v_ator, 'contract_pending_cleared', v_comentario);

  select full_name into v_nome from public.profiles where id = v_ator;
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'cca_contract_pending_cleared',
         format('Pendência do contrato baixada: %s', v_deal.code),
         format('%s deu baixa na pendência do contrato.%s', coalesce(v_nome, 'O CCA'),
                coalesce(' ' || v_comentario, '')),
         '/pipeline?negocio=' || p_deal_id,
         'in_app'
    from (select distinct profile_id from public.deal_participants where deal_id = p_deal_id) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> v_ator;
end;
$$;
