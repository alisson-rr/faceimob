-- =============================================================================
-- 0100 · Etapa e status da venda travados na COLUNA, não só na tela
--
-- A 0098 registrou a decisão do cliente de 10/09/2026 — "Status 1" (etapa) e
-- "Status 2" (status da venda) são de administrador e sócio — e admitiu o
-- próprio limite com todas as letras: a trava era de TELA. `deals_update`
-- (0012) autoriza pela LINHA (`created_by = auth.uid() or can_edit_deal(id)`)
-- e policy no Postgres não distingue COLUNA. Um corretor PARTICIPANTE do
-- negócio, com o próprio token e sem abrir o navegador do sistema, fazia
--
--   PATCH /rest/v1/deals?id=eq.<uuid>
--   {"stage_id":"<lost>","status_detail":"OFF","outcome":"lost"}
--
-- e tirava o negócio do VGV, do relatório e do ranking sem passar por
-- administrador nenhum. Esconder o Select não fecha a API.
--
-- Molde: `deals_guard_value` (0061). Gatilho, e não policy — a condição é de
-- COLUNA, e redefinir `deals_update` apagaria a regra de quem alcança a linha.
--
-- Os códigos são os da 0098, não papéis escritos à mão: `has_permission()`
-- curto-circuita em `is_admin()`, que desde a 0097 é `has_any_role('admin',
-- 'partner')`. Administrador e sócio passam por construção — "sempre que eu
-- falar administrador, eu tô falando sobre o sócio também" — e, se algum fluxo
-- precisar do poder, o administrador concede o código em Admin · Permissões sem
-- migration nova. Efeito colateral bem-vindo: os dois códigos deixam de ser
-- "aplicada na tela" e passam a valer no banco.
--
-- -----------------------------------------------------------------------------
-- QUEM PASSA, e por quê. Escrita legítima do PRÓPRIO SISTEMA não pode cair aqui.
--
-- 1. `postgres` e `service_role` — mesmo par de `deals_guard_esteira_label`
--    (0037) e `deals_guard_document_review` (0028). Cobre semente, seeds,
--    `validate-schema.sh`, qualquer serviço com a service key e TODA função
--    `security definer` (dentro delas `current_user` é o dono da função).
--    Nominalmente, as que mexem nas colunas travadas:
--      · `review_deal_documents` (0028) → `submit_deal_for_analysis`
--        (0028/0077): aprovar a conferência documental grava
--        `stage_id = <under_analysis>`. É o gerente quem aprova, e ele não tem
--        `deals.edit_stage` — sem esta liberação, a esteira inteira parava.
--      · `cca_cases_sync_esteira_label` (0037, reescrita na 0059 e na 0077):
--        escreve em `status_detail` os rótulos do sistema "13. ESTEIRA AGIL",
--        "RET. ESTEIRA AGIL", "09. APROV. TOTAL" e "ANÁLISE EXTERNA" quando o
--        caso entra na esteira, volta dela ou sai para a construtora.
--      · `close_month_and_season` (0021/0032) e a reabertura de mês: mexem em
--        `month_base` e em `closed_months`, nenhuma das colunas travadas — mas
--        passariam de qualquer forma, e é isso que garante que fechar e reabrir
--        mês continua sendo ato do banco.
--
-- 2. Valor igual não é escrita — `is distinct from` nas quatro colunas.
--    `legacyDealFields` (src/integrations/supabase/newSchema.ts) reenvia
--    `stage_id` e `status_detail` em TODO salvamento do editor de negócio. Sem
--    isto, corrigir o telefone do cliente viraria 42501 para o corretor.
--
-- 3. INSERT fica de fora — o gatilho é BEFORE UPDATE. `convert_lead_to_deal`
--    (0006) e o "Criar negócio" nascem escolhendo `stage_id` e, às vezes,
--    `status_detail`. Travar o nascimento tiraria a criação de negócio do
--    corretor, que ninguém pediu.
--
-- 4. `outcome` só é cobrado quando `stage_id` NÃO muda. `deals_guard_stage`
--    (0006) copia o desfecho da etapa de destino no MESMO comando; cobrar os
--    dois juntos recusaria a mudança de etapa legítima por um valor que o
--    próprio banco acabou de escrever. Trocar `outcome` sozinho — o PATCH que
--    tira o negócio do relatório sem mexer no funil — continua barrado.
--
-- -----------------------------------------------------------------------------
-- ATENÇÃO, e é o motivo de esta migration nascer marcada: dois fluxos LEGÍTIMOS
-- mudam `stage_id` pelo token do próprio usuário, fora de RPC `security
-- definer`, e portanto passam a falhar com 42501 para quem não tem
-- `deals.edit_stage`:
--
--   · src/components/pipeline/ScheduleVisitDialog.tsx — o corretor agenda a
--     visita e o negócio ANDA para "Visita agendada". Pior: o `updateDeal` vem
--     ANTES do `scheduleVisit`, então a visita também deixa de ser registrada.
--   · src/components/pipeline/CcaMoveDialog.tsx — a analista do CCA aprova o
--     caso e leva o negócio para "Aprovado" no funil comercial.
--
-- Nenhum dos dois foi liberado aqui de propósito: conceder `deals.edit_stage` a
-- `broker` ou a `cca` por migration reabriria, em silêncio, exatamente o que o
-- cliente mandou fechar, e a 0098 registra "NINGUÉM MAIS RECEBE" como decisão
-- dele. As duas saídas, nesta ordem:
--   (a) o administrador concede o código ao papel em Admin · Permissões — um
--       clique, reversível, sem deploy; ou
--   (b) as duas escritas viram RPC `security definer` (o próprio docblock do
--       `CcaMoveDialog` já propõe isso), e aí passam pela liberação nº 1.
--
-- ponytail: fluxo (a) é o paliativo e (b) é o conserto; evoluir para (b) quando
-- o cliente disser se agendar visita continua andando com a etapa.
-- =============================================================================

create or replace function public.deals_guard_status_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- NÃO pode ser `security definer`: dentro dela `current_user` seria sempre o
  -- dono da função e o gatilho nunca travaria ninguém.
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id
     and not public.has_permission('deals.edit_stage') then
    raise exception
      'Só administrador e sócio mudam a etapa do negócio (Status 1).'
      using errcode = '42501',
            hint = 'Permissão deals.edit_stage, em Admin · Permissões.';
  end if;

  if (new.status_detail is distinct from old.status_detail
      or new.lost_reason is distinct from old.lost_reason
      or (new.outcome is distinct from old.outcome
          and new.stage_id is not distinct from old.stage_id))
     and not public.has_permission('deals.edit_status') then
    raise exception
      'Só administrador e sócio mudam o status da venda (Status 2), o motivo da perda e o desfecho do negócio.'
      using errcode = '42501',
            hint = 'Permissão deals.edit_status, em Admin · Permissões.';
  end if;

  return new;
end;
$$;

-- O NOME importa: gatilho BEFORE dispara em ordem alfabética, e
-- `deals_guard_status_columns` vem depois de `deals_guard_closed_month` (0010),
-- `deals_guard_document_review` (0028), `deals_guard_esteira_label` (0037) e
-- `deals_guard_stage` (0006/0020). Assim a recusa MAIS ESPECÍFICA continua
-- chegando primeiro — "o mês está fechado", "a documentação não foi aprovada",
-- "seu papel não pode sair desta etapa" são acionáveis; "só administrador e
-- sócio" não é. Este gatilho só fala quando a escrita passaria.
drop trigger if exists deals_guard_status_columns on public.deals;
create trigger deals_guard_status_columns
  before update on public.deals
  for each row execute function public.deals_guard_status_columns();

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

comment on function public.deals_guard_status_columns() is
  'Recusa mudar stage_id sem deals.edit_stage e status_detail/lost_reason/outcome sem deals.edit_status (0098). postgres e service_role passam, INSERT não é coberto e valor igual não conta como escrita.';
