-- =============================================================================
-- 0332 · Renda informal trava na CCA · CCA corrige o nome do proponente
--
-- Pedido de 12/11/2026:
--  1. "Bloquear a edição de dados da renda informal no pipe pelo comercial
--     enquanto estiver com o CCA." Com o CCA = o mesmo "em análise na CCA" que
--     já barra o reenvio (0309): caso em análise, na agência ou na construtora,
--     e Status 2 que não é PENDENTE (pendência é devolução para correção). CCA
--     (`cca.review`) e admin continuam editando.
--  2. "Permita que o CCA ajuste o nome dos proponentes, pois às vezes o
--     corretor erra ao digitar." O cadastro do negócio trava para quem não é
--     admin em mês fechado (`useDealWriteLock`), e é justamente onde o CCA
--     trabalha. Uma função própria corrige só o nome, em qualquer fase, e
--     deixa no histórico de quem para quem.
-- =============================================================================

create or replace function public.deal_com_cca(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.cca_cases c join public.deals d on d.id = c.deal_id
     where c.deal_id = p_deal_id
       and c.status in ('under_review', 'sent_to_agency', 'sent_to_developer')
       and public.deal_status_bare(d.status_detail) not like 'PENDENTE%');
$$;
revoke all on function public.deal_com_cca(uuid) from public, anon;
grant execute on function public.deal_com_cca(uuid) to authenticated, service_role;

create or replace function public.deal_clients_trava_renda_na_cca()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() or public.has_permission('cca.review') then
    return new;
  end if;
  if (new.has_informal_income, new.activity_segment, new.activity_form, new.activity_duration,
      new.disclosure_form, new.declares_income_tax, new.monthly_income, new.income_notes)
     is distinct from
     (old.has_informal_income, old.activity_segment, old.activity_form, old.activity_duration,
      old.disclosure_form, old.declares_income_tax, old.monthly_income, old.income_notes)
     and public.deal_com_cca(new.deal_id) then
    raise exception 'A renda informal está em análise na CCA: só o CCA altera até a decisão.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.deal_clients_trava_renda_na_cca() from public, anon, authenticated;

drop trigger if exists deal_clients_trava_renda_na_cca on public.deal_clients;
create trigger deal_clients_trava_renda_na_cca
  before update on public.deal_clients
  for each row execute function public.deal_clients_trava_renda_na_cca();

create or replace function public.cca_corrigir_nome_proponente(p_deal_id uuid, p_ordinal int, p_nome text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome  text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_antes text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not (public.is_admin() or public.has_permission('cca.review')) then
    raise exception 'Só o CCA corrige o nome do proponente.' using errcode = '42501';
  end if;
  if length(v_nome) not between 2 and 160 then
    raise exception 'Informe o nome do proponente (2 a 160 caracteres).' using errcode = 'P0001';
  end if;

  select full_name into v_antes from public.deal_clients
   where deal_id = p_deal_id and ordinal = p_ordinal for update;
  if not found then
    raise exception 'Proponente não encontrado.' using errcode = 'P0002';
  end if;
  if v_antes is not distinct from v_nome then
    return;
  end if;

  update public.deal_clients set full_name = v_nome
   where deal_id = p_deal_id and ordinal = p_ordinal;
  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment',
          format('NOME DO %sº PROPONENTE CORRIGIDO PELO CCA: %s → %s', p_ordinal, coalesce(v_antes, '—'), v_nome));
end;
$$;
revoke all on function public.cca_corrigir_nome_proponente(uuid, int, text) from public, anon;
grant execute on function public.cca_corrigir_nome_proponente(uuid, int, text) to authenticated;
