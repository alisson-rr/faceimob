-- =============================================================================
-- 0101 · A trava de etapa e de desfecho no tamanho que o cliente pediu
--
-- O QUE FOI PEDIDO, em 10/09/2026, ao pé da letra:
--   · "Status 1 - ta errado e é só o adm q faz" / "só adm e sócio editam
--     Status 1" → a ETAPA do negócio é decisão de administrador.
--   · "off e distrato é só adm" → dos rótulos do Status 2, EXATAMENTE dois.
--   · "Status 2 tirar os número, mas manter a ordem" → sobre o resto do
--     Status 2 ele não pediu permissão nenhuma; pediu rótulo sem prefixo.
--   · Onde ele escreve "administrador", o sócio está incluído — e desde a 0097
--     `is_admin()` é `has_any_role('admin','partner')`, então os dois passam
--     por construção em `can_enter_stage`, `can_exit_stage` e `has_permission`.
--
-- POR QUE A RODADA ANTERIOR ERROU O TAMANHO. A 0098 criou dois códigos novos
-- (`deals.edit_stage`, `deals.edit_status`) e a 0100 os cobrou no gatilho. Com
-- isso:
--   1. TODA mudança de etapa virou ato de administrador, e a matriz
--      `stage_permissions` — que já existe, que o cliente disse estar certa e
--      que o admin administra em Admin · Permissões → Etapas — ficou
--      NEUTRALIZADA: conceder a etapa na tela não produzia efeito nenhum,
--      porque o código novo negava antes.
--   2. TODO o Status 2 virou ato de administrador, quando só OFF e DISTRATO
--      foram pedidos.
--   Três fluxos legítimos, que gravam `stage_id` pelo token de quem clica (e
--   não por RPC `security definer`), passaram a cair em 42501:
--     · ScheduleVisitDialog — agendar visita move o negócio para "Visita
--       agendada"; o `updateDeal` vem ANTES do `scheduleVisit`, então a visita
--       também deixava de ser registrada;
--     · CcaMoveDialog — a analista aprova o caso e leva o negócio para
--       "Aprovado";
--     · LoseDealDialog — o corretor encerra o negócio (etapa "Perdido" +
--       `status_detail` + `lost_reason`). `supabase/tests/59_cca_documentos.sql`
--       documenta esse encerramento como exceção deliberada desde a 0059.
--
-- O DESENHO CERTO, que esta migration aplica:
--   (1) ETAPA → a matriz `stage_permissions` (`can_enter_stage` /
--       `can_exit_stage`), agora também no INSERT. Não existe mais
--       `deals.edit_stage`: duas fontes de verdade para a mesma regra é o que
--       fez a concessão da tela virar enfeite.
--   (2) DESFECHO → só OFF e DISTRATO, por `deals.mark_off_distrato` (o
--       `deals.edit_status` renomeado, agora dizendo o que faz).
--   (3) O resto do `status_detail` → livre, como sempre foi.
--
-- O QUE CADA REGRA PROTEGE. `deals_update` (0012) autoriza pela LINHA
-- (`created_by = auth.uid() or can_edit_deal(id)`) e policy no Postgres não
-- distingue COLUNA: sem gatilho, um participante do negócio manda
-- `PATCH /rest/v1/deals {"status_detail":"OFF"}` com o próprio token e tira o
-- negócio do VGV, do relatório e do ranking sem passar por administrador. A
-- regra (1) protege a ordem do funil — número que a diretoria olha; a (2)
-- protege o dinheiro. E o INSERT entra porque a 0100 o deixou de fora: hoje um
-- `POST /rest/v1/deals` com `stage_id` e `status_detail` escolhidos passa
-- direto, e um negócio que NASCE em OFF nunca precisou de administrador nenhum.
--
-- Idempotente: `create or replace`, `drop trigger if exists`, `on conflict` e
-- updates condicionados ao estado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A guarda de coluna, no tamanho certo
-- -----------------------------------------------------------------------------
-- Mesma função da 0100 (`create or replace`, mesma assinatura): migration
-- aplicada não se reescreve, então a 0100 continua no repositório contando a
-- história e esta troca a REGRA dentro dela.
create or replace function public.deals_guard_status_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_inicial     boolean;
  v_novo_status boolean;
  v_novo_motivo boolean;
begin
  -- NÃO pode ser `security definer`: dentro dela `current_user` seria sempre o
  -- dono da função e o gatilho nunca travaria ninguém (0100).
  --
  -- O escape é o mesmo da 0100, conferido lá um a um: cobre a esteira ágil
  -- (`review_deal_documents` → `submit_deal_for_analysis`, que grava
  -- `stage_id`), a conferência documental, `cca_cases_sync_esteira_label` (que
  -- grava os rótulos do sistema em `status_detail`), o fechamento e a
  -- reabertura de mês, os seeds e o import do Bubble. Toda função `security
  -- definer` cai aqui, porque dentro dela `current_user` é o dono.
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_novo_status := true;
    v_novo_motivo := true;
  else
    -- Valor igual não é escrita: `legacyDealFields`
    -- (src/integrations/supabase/newSchema.ts) reenvia `status_detail` e
    -- `lost_reason` em TODO salvamento do editor. Sem isto, corrigir o telefone
    -- do cliente num negócio já encerrado viraria 42501.
    v_novo_status := new.status_detail is distinct from old.status_detail;
    v_novo_motivo := new.lost_reason is distinct from old.lost_reason;
  end if;

  -- (1) ETAPA — a matriz que já existe, e nada além dela.
  --
  -- No UPDATE quem responde primeiro é `deals_guard_stage` (0020/0028), que
  -- cobra a MESMA dupla e vem antes na ordem alfabética dos gatilhos BEFORE.
  -- A repetição aqui não é decoração: `deals_guard_stage` só olha a matriz
  -- quando `auth.uid()` não é nulo e não cobre INSERT nenhum. As duas leem
  -- `stage_permissions`, então a fonte de verdade continua sendo uma só.
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    if not public.can_exit_stage(old.stage_id) then
      raise exception 'Seu papel não pode tirar um negócio desta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
    if not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode mover um negócio para esta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
  elsif tg_op = 'INSERT' then
    -- A etapa INICIAL do funil é o nascimento, não uma movimentação: é o que
    -- `DealDetailModal` (stages[0]) e `convert_lead_to_deal` usam para criar
    -- negócio. Cobrar a matriz nela tiraria do corretor a criação de negócio,
    -- que ninguém pediu. Qualquer OUTRA etapa escolhida no POST passa pela
    -- mesma regra do UPDATE — nascer em "Fechado" ou em "Aprovado" era o
    -- caminho aberto para pular o funil inteiro.
    select coalesce(s.is_initial, false) into v_inicial
      from public.pipeline_stages s where s.id = new.stage_id;

    if not coalesce(v_inicial, false)
       and not public.can_enter_stage(new.stage_id) then
      raise exception 'Seu papel não pode criar um negócio nesta etapa.'
        using errcode = '42501',
              hint = 'Matriz de etapas, em Admin · Permissões → Etapas.';
    end if;
  end if;

  -- (2) DESFECHO — só OFF e DISTRATO, e só quando o valor MUDA para eles.
  --
  -- `deal_status_bare` é a mesma normalização de `bareStatus`
  -- (src/lib/dealStatus.ts): sem prefixo numerado, aparado, caixa alta. É por
  -- ela que "17. DISTRATO" (o rótulo da tabela) e "DISTRATO" (o de um
  -- `status_detail` importado) são o mesmo rótulo.
  --
  -- Compara o INÍCIO do texto, e não o texto inteiro, porque `lost_reason`
  -- guarda a concatenação que o `LoseDealDialog` escreve — "17. DISTRATO —
  -- cliente desistiu". `\M` (fim de palavra) é o que impede "OFF" de casar
  -- dentro de "OFERTA" ou "OFFICE".
  --
  -- `outcome` fica de fora de propósito: o enum `deal_outcome` é
  -- open/won/lost/cancelled, nunca "OFF" nem "DISTRATO", e quem o escreve é
  -- `deals_guard_stage` a partir da etapa de destino — que a regra (1) já
  -- governa. Cobrá-lo aqui seria travar o valor que o próprio banco acabou de
  -- gravar, que foi metade do defeito da 0100.
  -- ponytail: sair de OFF/DISTRATO (reabrir o negócio) não é cobrado no banco —
  -- só `ReopenDealDialog` restringe, na tela; evoluir quando o cliente disser
  -- que apagar um distrato é a mesma decisão que marcá-lo.
  if ((v_novo_status and public.deal_status_bare(new.status_detail) ~ '^(OFF|DISTRATO)\M')
      or (v_novo_motivo and public.deal_status_bare(new.lost_reason) ~ '^(OFF|DISTRATO)\M'))
     and not public.has_permission('deals.mark_off_distrato') then
    raise exception
      'Só administrador e sócio marcam OFF e distrato. Os outros motivos de encerramento continuam sendo seus.'
      using errcode = '42501',
            hint = 'Permissão deals.mark_off_distrato, em Admin · Permissões.';
  end if;

  return new;
end;
$$;

-- O NOME importa: gatilho BEFORE dispara em ordem alfabética, e
-- `deals_guard_status_columns` vem depois de `deals_guard_closed_month` (0010),
-- `deals_guard_document_review` (0028), `deals_guard_esteira_label` (0037/0059)
-- e `deals_guard_stage` (0006/0020/0028). A recusa MAIS ESPECÍFICA continua
-- chegando primeiro. Recriado (e não só substituído) porque a 0100 o declarou
-- `before update` e agora ele precisa do INSERT.
drop trigger if exists deals_guard_status_columns on public.deals;
create trigger deals_guard_status_columns
  before insert or update on public.deals
  for each row execute function public.deals_guard_status_columns();

revoke all on function public.deals_guard_status_columns() from public, anon, authenticated;

comment on function public.deals_guard_status_columns() is
  'Etapa pela matriz stage_permissions (can_enter/can_exit), no INSERT e no UPDATE; OFF e DISTRATO só com deals.mark_off_distrato. O resto do Status 2 é livre. postgres e service_role passam; valor igual não conta como escrita.';

-- -----------------------------------------------------------------------------
-- 2. Catálogo: um código a menos e um renomeado
-- -----------------------------------------------------------------------------
-- `deals.edit_stage` SAI. A autorização de etapa é a matriz `stage_permissions`
-- — manter os dois seria manter duas respostas para a mesma pergunta, e foi
-- exatamente por isso que a concessão feita na tela deixou de valer.
--
-- `deals.edit_status` vira `deals.mark_off_distrato`, com rótulo e descrição
-- dizendo o que ele realmente decide. Renomear e não criar do zero: as linhas
-- de `role_permissions` que o administrador já tiver concedido seguem junto.
insert into public.permissions (code, label, category, description) values
  (
    'deals.mark_off_distrato',
    'Marcar OFF e distrato',
    'negocios',
    'Os DOIS desfechos que o cliente reservou ao administrador e ao sócio em 10/09/2026: marcar um negócio como OFF ou DISTRATO tira o negócio do funil, do VGV e do ranking. O resto do "Status da venda (Status 2)" continua livre para quem edita o negócio, e a etapa (Status 1) não passa por aqui — quem decide etapa é a matriz de etapas.'
  )
on conflict (code) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description;

insert into public.role_permissions (role, permission, allowed)
select rp.role, 'deals.mark_off_distrato', rp.allowed
  from public.role_permissions rp
 where rp.permission = 'deals.edit_status'
on conflict (role, permission) do nothing;

-- Redundantes para a autorização (`has_permission` curto-circuita em
-- `is_admin()`, que desde a 0097 é admin OU sócio) e necessárias para a tela:
-- sem elas Admin · Permissões mostra um interruptor desligado que mesmo assim
-- funciona. Mesma razão da 0092 e da 0098.
insert into public.role_permissions (role, permission, allowed) values
  ('admin',   'deals.mark_off_distrato', true),
  ('partner', 'deals.mark_off_distrato', true)
on conflict (role, permission) do nothing;

-- `role_permissions.permission` referencia `permissions(code)` com
-- `on delete cascade`: apagar o código leva junto as concessões antigas.
delete from public.permissions where code in ('deals.edit_stage', 'deals.edit_status');

-- -----------------------------------------------------------------------------
-- 3. Matriz de etapas: o ESTADO INICIAL que atende o pedido sem quebrar fluxo
-- -----------------------------------------------------------------------------
-- Isto é só o ESTADO INICIAL. A matriz é administrada em Admin · Permissões →
-- Etapas, e é esse o propósito dela: o cliente reajusta cada casa por clique,
-- sem migration e sem deploy. Nenhuma linha aqui é definitiva.
--
-- ENTRAR é o que o cliente pediu para fechar: "Status 1 tá errado" é negócio
-- parando na etapa errada, e quem decide para ONDE o negócio vai passa a ser o
-- administrador — exceto onde um fluxo legítimo exige o contrário.
--
-- SAIR não é mexido, de propósito. Encerrar o negócio e agendar visita exigem
-- tirar o negócio da etapa em que ele está, seja ela qual for; tirar o "sair"
-- travaria os dois sem atender pedido nenhum — é a mesma largura demais que
-- esta migration está desfazendo.
--
-- ATENÇÃO ao banco NOVO: `pipeline_stages` é populada por `supabase/seed.sql`,
-- que roda DEPOIS de todas as migrations (é a ordem do `db reset` e a do
-- `validate-schema.sh`). Num banco limpo os joins abaixo não casam nada e esta
-- seção é no-op: quem entrega a matriz ali é o seed. Em homologação, onde as
-- etapas existem, ela aplica. É a mesma armadilha registrada na 0052 e na
-- 0061 §7.

-- Administrador e sócio entram e saem de tudo.
insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, r.role, true, true
  from public.pipeline_stages s
 cross join (values ('admin'::app_role), ('partner')) as r(role)
on conflict (stage_id, role) do update
  set can_enter = true, can_exit = true;

-- As casas que os fluxos legítimos exigem — as três que a 0100 quebrou, mais a
-- aprovação da conferência documental, que é do gerente:
--   · broker  → "Visita agendada" (ScheduleVisitDialog) e "Perdido"
--               (LoseDealDialog);
--   · manager/director → "Visita agendada", "Em análise" (aprovar a conferência
--               leva o negócio para a esteira, por `submit_deal_for_analysis`,
--               que roda com `auth.uid()` do gerente e é cobrado pela matriz) e
--               "Perdido";
--   · cca     → a faixa de crédito ("Em análise", "Aprovado", "Contrato",
--               CcaMoveDialog) e "Perdido".
-- `do update` só em `can_enter`: `can_exit` fica como está.
insert into public.stage_permissions (stage_id, role, can_enter, can_exit)
select s.id, m.role::app_role, true, true
  from (values
    ('visit_scheduled', 'broker'),
    ('lost',            'broker'),
    ('visit_scheduled', 'manager'),
    ('under_analysis',  'manager'),
    ('lost',            'manager'),
    ('visit_scheduled', 'director'),
    ('under_analysis',  'director'),
    ('lost',            'director'),
    ('under_analysis',  'cca'),
    ('approved',        'cca'),
    ('contract',        'cca'),
    ('lost',            'cca')
  ) as m(stage_code, role)
  join public.pipeline_stages s on s.code = m.stage_code
on conflict (stage_id, role) do update
  set can_enter = true;

-- Todo o resto perde o ENTRAR. Quem não é admin nem sócio só põe negócio nas
-- etapas listadas acima.
update public.stage_permissions sp
   set can_enter = false
  from public.pipeline_stages ps
 where ps.id = sp.stage_id
   and sp.can_enter
   and sp.role not in ('admin', 'partner')
   and not (sp.role = 'broker'
            and ps.code in ('visit_scheduled', 'lost'))
   and not (sp.role in ('manager', 'director')
            and ps.code in ('visit_scheduled', 'under_analysis', 'lost'))
   and not (sp.role = 'cca'
            and ps.code in ('under_analysis', 'approved', 'contract', 'lost'));
