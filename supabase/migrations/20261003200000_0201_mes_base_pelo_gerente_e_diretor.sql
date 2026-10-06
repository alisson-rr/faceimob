-- =============================================================================
-- 0201 — gerente e diretor alteram o mês-base do negócio, com motivo
--
-- Pedido do cliente em 03/10/2026: "permita que o gerente e o diretor alterem
-- o mês data base do card do pipeline pedindo um motivo e registrando nas
-- observações". Até aqui só o admin trocava (a tela travava o campo).
--
-- Uma porta só, com a regra no banco: admin, ou gerente/diretor que edita o
-- negócio (`can_edit_deal`: participante ou líder de quem participa). O motivo
-- é obrigatório e vira comentário do negócio (aba Comentários), com o de → para.
-- Mês fechado continua recusado pelo gatilho de fechamento, como em qualquer
-- gravação.
-- =============================================================================

create or replace function public.alterar_mes_base(p_deal_id uuid, p_mes date, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_mes    date := date_trunc('month', p_mes)::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if p_mes is null then
    raise exception 'Escolha o novo mês-base.' using errcode = '22023';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 1000 then
    raise exception 'Escreva o motivo da troca do mês-base (de 3 a 1000 caracteres).' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not (public.is_admin()
          or (public.has_any_role('manager', 'director') and public.can_edit_deal(p_deal_id))) then
    raise exception 'Só o administrador, o gerente ou o diretor do negócio altera o mês-base.' using errcode = '42501';
  end if;

  if v_deal.month_base = v_mes then
    raise exception 'O negócio já está nesse mês-base.' using errcode = '22023';
  end if;

  update public.deals set month_base = v_mes where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment',
          'MÊS-BASE ALTERADO de ' || coalesce(to_char(v_deal.month_base, 'MM/YYYY'), '—')
          || ' para ' || to_char(v_mes, 'MM/YYYY') || ': ' || v_motivo);
end;
$$;

revoke all on function public.alterar_mes_base(uuid, date, text) from public, anon;
grant execute on function public.alterar_mes_base(uuid, date, text) to authenticated;
comment on function public.alterar_mes_base(uuid, date, text) is
  'Troca o mês-base do negócio com motivo obrigatório, registrado como comentário. Admin, ou gerente/diretor que edita o negócio (0201).';
