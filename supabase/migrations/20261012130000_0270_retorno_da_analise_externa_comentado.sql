-- =============================================================================
-- 0270 · Retorno da análise externa sempre com comentário
--
-- Pedido de 12/10/2026: na aba Negócio, Aprovado Condicionado e Aprovado Total
-- de um negócio em ANÁLISE EXTERNA são registrados à mão e "sempre mediante
-- comentário". A tela já exige o texto; aqui o banco também, para nenhum caminho
-- (outra tela, chamada direta) registrar a aprovação sem dizer de onde veio.
-- É a `move_deal_status` da 0177 com uma recusa a mais; o resto não muda.
-- =============================================================================

create or replace function public.move_deal_status(p_deal_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal  public.deals;
  v_to    public.deal_statuses;
  v_note  text := btrim(coalesce(p_note, ''));
  v_block text;
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

  select * into v_to from public.deal_statuses
   where public.deal_status_bare(value) = public.deal_status_bare(p_status) and active
   limit 1;
  if not found then
    raise exception 'Este Status 2 não está ativo no cadastro.' using errcode = 'P0001';
  end if;

  if public.deal_status_bare(v_to.value) is not distinct from public.deal_status_bare(v_deal.status_detail) then
    return;
  end if;

  -- A volta para a análise reabre a conferência e o caso da CCA: é o envio ao
  -- gerente, não uma troca de rótulo.
  if public.deal_status_bare(v_to.value) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO') then
    raise exception 'Para voltar à análise, use "Enviar para análise": o envio ao gerente leva a observação.'
      using errcode = 'P0001';
  end if;

  -- Encerrar pede o motivo e passa pelo diálogo de perda.
  if public.deal_status_bare(v_to.value) in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF') then
    raise exception 'Para encerrar o negócio, use "Perder negócio" com o motivo.' using errcode = 'P0001';
  end if;

  v_block := public.deal_status_move_block(v_deal.status_detail, v_to.value);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  -- 0270: o retorno da análise externa é sempre comentado, de qualquer perfil.
  if public.deal_status_bare(v_deal.status_detail) = 'ANÁLISE EXTERNA'
     and public.deal_status_bare(v_to.value) in ('APROV. TOTAL', 'APROV. COND.')
     and v_note = '' then
    raise exception 'Comente o retorno da análise externa para registrar a aprovação.' using errcode = 'P0001';
  end if;

  if v_to.requires_note and v_note = '' then
    raise exception 'Escreva a observação para mover para "%".', v_to.label using errcode = 'P0001';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Observação longa demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  -- 0177: a observação vai para o e-mail de movimentação, que sai do gatilho
  -- desta mesma troca — antes da linha do histórico logo abaixo.
  perform set_config('faceimob.status_note', v_note, true);
  update public.deals set status_detail = v_to.value where id = p_deal_id;

  if v_note <> '' then
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment', v_to.label || ': ' || v_note);
  end if;
end;
$$;

revoke all on function public.move_deal_status(uuid, text, text) from public, anon;
grant execute on function public.move_deal_status(uuid, text, text) to authenticated, service_role;
