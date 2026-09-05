-- =============================================================================
-- 0037 · "ESTEIRA AGIL" é rótulo do sistema, não escolha
--
-- `deals.status_detail` é texto livre. O catálogo de Status 2 oferecia
-- "13. ESTEIRA AGIL" e "RET. ESTEIRA AGIL" no Select, e qualquer pessoa que
-- edita o negócio marcava os dois sem conferência do gerente, sem caso no CCA
-- e sem pontuação — a tela dizia em verde que foi, sem ter ido.
--
-- "Esteira Ágil" é a entrada do negócio na análise de crédito: o mesmo momento
-- em que `cca_cases.status` vira 'under_review' e o jogo pontua 'esteira'
-- (0010). A partir daqui o banco escreve o rótulo nesse momento, troca para
-- "RET. ESTEIRA AGIL" quando o CCA devolve o caso, e recusa a escrita manual.
-- Decisão de 01/09/2026, caminho (a): quem precisar do rótulo aprova a
-- conferência primeiro.
-- =============================================================================

-- Mesma normalização de `bare()` em src/lib/dealStatus.ts — sem prefixo
-- numerado, aparado, caixa alta. Os dois lados precisam concordar, senão um
-- "esteira agil" importado sem número escaparia da trava.
create or replace function public.deal_status_bare(p_label text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(upper(btrim(coalesce(p_label, ''))), '^\d+\.\s*', '');
$$;

revoke all on function public.deal_status_bare(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Trava: o rótulo de esteira só entra à mão com a conferência aprovada.
--
-- Cobre INSERT também: o formulário de criação e a importação gravam
-- `status_detail` no nascimento do negócio, e um negócio nasce em 'draft'.
-- `postgres` e `service_role` passam (semente, serviço e as RPCs security
-- definer da 0028), como em `deals_guard_document_review`.
-- -----------------------------------------------------------------------------
create or replace function public.deals_guard_esteira_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Reenviar o formulário com o valor que já está lá não é escolha nova.
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then
    return new;
  end if;

  if public.deal_status_bare(new.status_detail) in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL')
     and coalesce(new.document_review_status, 'draft') <> 'approved'
     and current_user not in ('postgres', 'service_role') then
    raise exception
      'O rótulo "%" é escrito pelo sistema quando o negócio entra na esteira. Aprove a conferência documental em vez de marcá-lo.',
      new.status_detail
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger deals_guard_esteira_label
  before insert or update of status_detail on public.deals
  for each row execute function public.deals_guard_esteira_label();

revoke all on function public.deals_guard_esteira_label() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Lado positivo: a esteira escreve o rótulo.
--
-- 'under_review' é a entrada (o que `submit_deal_for_analysis` grava e o que
-- pontua 'esteira'). O enum `cca_status` não tem 'returned': o único estado
-- que significa "voltou da esteira" é 'pending_documents', para onde a tela do
-- CCA move o caso quando falta documento. 'rejected' e 'cancelled' são
-- desfechos, não retornos — o negócio recebe o rótulo de encerramento pelo
-- diálogo de perda, e esse rótulo não é sobrescrito aqui.
--
-- Security definer: quem move o caso é o analista do CCA, que não edita
-- `deals`; o trigger escreve com o privilégio do dono, como `cca_cases_log`.
--
-- ponytail: o update passa por `deals_guard_closed_month`, então mover o caso
-- de um negócio de mês FECHADO falha para quem não é admin. Hoje não acontece:
-- `close_month_and_season` empurra todo negócio aberto para o mês seguinte, e
-- só negócio já ganho/perdido fica no mês fechado; evoluir quando o CCA
-- precisar mexer em caso de negócio encerrado.
-- -----------------------------------------------------------------------------
create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'under_review' then
      return null;
    end if;
    v_label := '13. ESTEIRA AGIL';
  elsif new.status = 'under_review' and old.status is distinct from 'under_review' then
    v_label := '13. ESTEIRA AGIL';
  elsif new.status = 'pending_documents' and old.status is distinct from 'pending_documents' then
    v_label := 'RET. ESTEIRA AGIL';
  else
    return null;
  end if;

  update public.deals
     set status_detail = v_label
   where id = new.deal_id
     and status_detail is distinct from v_label
     and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF');

  return null;
end;
$$;

create trigger cca_cases_sync_esteira_label
  after insert or update of status on public.cca_cases
  for each row execute function public.cca_cases_sync_esteira_label();

revoke all on function public.cca_cases_sync_esteira_label() from public, anon, authenticated;

comment on function public.deals_guard_esteira_label() is
  'Recusa "13. ESTEIRA AGIL"/"RET. ESTEIRA AGIL" escolhidos à mão sem conferência aprovada; postgres e service_role passam.';
comment on function public.cca_cases_sync_esteira_label() is
  'Escreve o rótulo de esteira em deals.status_detail quando o caso entra (under_review) ou volta (pending_documents).';
