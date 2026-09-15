-- =============================================================================
-- 0150 · Colunas da CCA pelo Status 2 e envio com mensagem em duas esteiras
--
-- Pedido do cliente de 14/09/2026 (decidido):
--   1. A CCA passa a ter as 19 colunas da lista do cliente, e cada coluna É um
--      Status 2. Mover o caso grava esse Status 2 no negócio; o Status 1 segue
--      sozinho pelo gatilho da 0149. Em 15/09 o cliente incluiu a síntese
--      "RETORNO À ESTEIRA ÁGIL", logo depois de PENDENTE: é devolução ao
--      comercial com a mecânica de PENDENTE (`pending_documents` reabre a
--      conferência do gerente e avisa o corretor) e grava "RET. ESTEIRA AGIL",
--      o rótulo que a 0077 já gravava na devolução.
--   2. O comercial envia por duas esteiras, as duas pelo gerente: ÁGIL (1º
--      envio) e ANÁLISE P/ VIRAR NEGÓCIO (2º envio, com crédito já aprovado).
--   3. Enviar exige mensagem (é o pedido); mover na CCA também, porque é o
--      aviso que chega ao corretor e ao gerente. As duas viram comentário no
--      negócio e nunca vão ao cliente final. A aprovação do gerente aceita
--      mensagem, sem exigir: o pedido não a cobra.
--   4. A CCA vê quantas vezes o cliente (CPF do titular) foi enviado em cada
--      esteira. Começa do zero: só conta envio feito daqui em diante.
--
-- DEPLOY CASADO COM O FRONT. Não há janela compatível: o envio muda de
-- assinatura e o caso deixa de mudar de coluna por PATCH. Com o front de
-- antes, esta migration derruba o envio ao gerente (PGRST202) e a
-- movimentação da CCA (42501). Aplicar junto com o front que chama
-- `submit_deal_for_manager_review(p_deal_id, p_message, p_esteira)` e
-- `move_cca_case`, e que tira da esteira os casos `cancelled`.
--
-- O que muda em comportamento existente:
--   · Os 7 estágios antigos ficam inativos (são histórico: casos cancelados
--     continuam apontando para "Distrato / Queda", fora da tela). "Enviado à
--     Construtora" só fica ativo se existir construtora EXTERNA ativa — a
--     homologação não tem nenhuma (41 internas, 0 casos em sent_to_developer,
--     medido em 15/09). Sem a coluna, o envio externo entra na primeira coluna
--     "em análise", com status sent_to_developer e o rótulo "ANÁLISE EXTERNA".
--   · Status, coluna, entrada e decisão do caso só mudam por `move_cca_case` ou
--     pelas funções do sistema, e a tela não cria nem apaga caso: apagar e
--     recriar era o atalho para decidir sem mensagem e sem passar pelo gerente.
--   · Coluna não se liga a "13. ESTEIRA AGIL", "15. ANÁLISE P/ VIRAR NEGÓCIO",
--     OFF, DISTRATO ou QUEDA: o gatilho da esteira grava como postgres e
--     passaria por cima das travas. "RET. ESTEIRA AGIL" pode (coluna RETORNO À
--     ESTEIRA ÁGIL): diz que o caso voltou ao comercial, e é isso que a coluna
--     de pendência faz. À mão no negócio ele continua recusado.
--   · O nome exibido de "RET. ESTEIRA AGIL" passa a "RETORNO À ESTEIRA ÁGIL",
--     só se ainda for o da semente (edição do admin fica). O texto gravado não
--     muda.
--   · `submit_deal_for_manager_review` troca de assinatura (mensagem e esteira).
--   · A esteira não reescreve o Status 2 de negócio perdido (o motivo da perda
--     fica) nem de mês fechado. DISTRATO, QUEDA e OFF seguem intocáveis. Em
--     negócio aberto, "REPROVADO" deixa de ser poupado: sair da coluna
--     REPROVADO precisa trocar o rótulo.
--   · O Status 2 fica travado durante a análise também quando é o da coluna
--     do caso, não só quando é rótulo do sistema.
--   · "esteira" e "aprovado" pontuam uma vez por negócio, entre temporadas: o
--     2º envio reabre o caso aprovado e pagaria os dois de novo.
--
-- De-para dos casos existentes (medido na homologação em 15/09, 7.560 casos):
-- coluna ATIVA de mesmo `cca_status` cujo Status 2 casa com o do negócio; senão
-- com `analysis->>'bubble_status2'` (os 4.409 negócios com Status 2 "OFF" da
-- importação têm o STATUS2 real ali); senão a primeira coluna ativa de mesmo
-- status. Exigir o mesmo status não perdeu nenhum casamento. Os 290 casos
-- `cancelled` não têm coluna e ficam no estágio antigo. Só `stage_id` muda.
-- A coluna RETORNO À ESTEIRA ÁGIL recebe 7 dos 1.443 casos em pendência, todos
-- pelo `bubble_status2` (nenhum negócio tem "RET. ESTEIRA AGIL" no Status 2);
-- são os únicos que saem de PENDENTE, que fica com 1.436.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Os Status 2 que só as colunas novas usam (grupo PROPOSTA, ativos)
-- -----------------------------------------------------------------------------
insert into public.deal_statuses (value, label, group_id, position, tone, active)
select v.value,
       v.value,
       g.id,
       coalesce((select max(s.position) from public.deal_statuses s where s.group_id = g.id), 0) + v.ord,
       v.tone,
       true
  from (values
    (1, 'EM ANÁLISE',                   'warning'),
    (2, 'VIROU NEGÓCIO COM PENDÊNCIAS', 'warning'),
    (3, 'ANÁLISE CEOPF',                'info'),
    (4, 'INCONFORME CEOPF',             'danger'),
    (5, 'APROVADO/AGUARDANDO AGENDA',   'info'),
    (6, 'ENTREVISTA AGENDADA',          'info')
  ) as v(ord, value, tone)
  join public.deal_status_groups g on g.code = 'PROPOSTA'
 where not exists (
   select 1 from public.deal_statuses s
    where public.deal_status_bare(s.value) = public.deal_status_bare(v.value)
 );

-- O nome da coluna nova, também no Select do negócio e nos filtros. Só troca o
-- nome da semente da 0149 (label = value): reaplicar não desfaz edição do admin.
update public.deal_statuses
   set label = 'RETORNO À ESTEIRA ÁGIL'
 where value = 'RET. ESTEIRA AGIL'
   and label = 'RET. ESTEIRA AGIL';

-- -----------------------------------------------------------------------------
-- 2. As 19 colunas, na ordem do cliente
-- -----------------------------------------------------------------------------
alter table public.cca_stages
  add column if not exists deal_status_id uuid
    references public.deal_statuses(id) on delete set null;

comment on column public.cca_stages.deal_status_id is
  'Status 2 que a coluna grava no negócio quando o caso entra nela (0150). Nulo: a coluna segue o de-para antigo por status.';

insert into public.cca_stages (name, color, position, status, active, deal_status_id)
select c.name, c.color, c.pos, c.status::public.cca_status, true, ds.id
  from (values
    (1,  'EM ANÁLISE',                          'under_review',      'warning', 'EM ANÁLISE'),
    (2,  'PENDENTE',                            'pending_documents', 'danger',  '16. PENDENTE'),
    (3,  'RETORNO À ESTEIRA ÁGIL',              'pending_documents', 'danger',  'RET. ESTEIRA AGIL'),
    (4,  'EM PROCESSAMENTO',                    'under_review',      'warning', '12. EM PROCESSAMENTO'),
    (5,  'AGUARDANDO RETORNO AGÊNCIA',          'sent_to_agency',    'info',    '11. AG. RET. AGENCIA'),
    (6,  'APROVADO TOTAL',                      'approved',          'success', '09. APROV. TOTAL'),
    (7,  'APROVADO POTENCIAL',                  'approved',          'info',    'APROVADO POTENCIAL'),
    (8,  'APROVADO CONDICIONADO',               'approved',          'warning', '10. APROV. COND.'),
    (9,  'APROVADO TOTAL COM RESTRIÇÃO',        'approved',          'warning', 'APROV. TOT. RESTRIÇÃO'),
    (10, 'APROVADO CONDICIONADO COM RESTRIÇÃO', 'approved',          'warning', 'APROV. COND. RESTRIÇÃO'),
    (11, 'REPROVADO',                           'rejected',          'danger',  '19. REPROVADO'),
    (12, 'BACEN',                               'rejected',          'danger',  '20. BACEN'),
    (13, 'VIROU NEGÓCIO',                       'approved',          'success', '08. VIROU NEGÓCIO'),
    (14, 'VIROU NEGÓCIO COM PENDÊNCIAS',        'approved',          'warning', 'VIROU NEGÓCIO COM PENDÊNCIAS'),
    (15, 'ANÁLISE CEOPF',                       'approved',          'info',    'ANÁLISE CEOPF'),
    (16, 'INCONFORME CEOPF',                    'approved',          'danger',  'INCONFORME CEOPF'),
    (17, 'APROVADO/AGUARDANDO AGENDA',          'approved',          'info',    'APROVADO/AGUARDANDO AGENDA'),
    (18, 'ENTREVISTA AGENDADA',                 'approved',          'info',    'ENTREVISTA AGENDADA'),
    (19, 'ASSINADO BANCO',                      'approved',          'success', '02. ASS. BANCO')
  ) as c(pos, name, status, color, status2)
  left join public.deal_statuses ds on ds.value = c.status2
 where not exists (select 1 from public.cca_stages s where s.name = c.name);

-- Os antigos saem da tela e da ordem (posição 100+), sem apagar: são o estágio
-- gravado dos casos cancelados e do histórico. `active or position < 100` torna
-- o update idempotente. "Enviado à Construtora" fica, depois das 19, só se o
-- fluxo externo existir de fato.
update public.cca_stages s
   set active   = (s.name = 'Enviado à Construtora' and x.externa),
       position = case when s.name = 'Enviado à Construtora' and x.externa
                       then 20 else 100 + s.position end
  from (select exists (
          select 1 from public.developers d where d.flow = 'external' and d.active
        ) as externa) x
 where s.name in ('Pendência de Documentos', 'Em Análise', 'Enviado à Construtora',
                  'Enviado à Agência', 'Aprovado', 'Reprovado', 'Distrato / Queda')
   and (s.active or s.position < 100);

-- Coluna não se liga a rótulo de envio nem a desfecho reservado. Quem tem
-- `cca.review` cria e edita coluna (`cca_stages_write`, CcaStageSettingsDialog),
-- e o gatilho da esteira grava o Status 2 da coluna como postgres, por cima de
-- `deals_guard_status_columns` (OFF e DISTRATO só com
-- `deals.mark_off_distrato`) e de `deals_guard_esteira_label` (rótulos do
-- sistema). A ligação seria marcar desfecho ou forjar envio sem a permissão.
-- QUEDA entra pelo mesmo motivo: encerra o negócio. "RET. ESTEIRA AGIL" saiu
-- da lista em 15/09: é o Status 2 da coluna RETORNO À ESTEIRA ÁGIL, e dizer
-- que o caso voltou ao comercial é decisão da CCA, não envio do corretor.
-- Não é `security definer`: o escape depende de `current_user` (0101).
create or replace function public.cca_stages_guard_deal_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_value text;
  v_bare  text;
begin
  if current_user in ('postgres', 'service_role')
     or new.deal_status_id is null
     or (tg_op = 'UPDATE' and new.deal_status_id is not distinct from old.deal_status_id) then
    return new;
  end if;

  select ds.value into v_value from public.deal_statuses ds where ds.id = new.deal_status_id;
  v_bare := public.deal_status_bare(replace(v_value, chr(160), ' '));

  if v_bare in ('ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO', 'QUEDA')
     or v_bare ~ '^(OFF|DISTRATO)\M' then
    raise exception 'A coluna não pode gravar o Status 2 "%": ele é escrito pelo sistema ou encerra o negócio.', v_value
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.cca_stages_guard_deal_status() from public, anon, authenticated;

drop trigger if exists cca_stages_guard_deal_status on public.cca_stages;
create trigger cca_stages_guard_deal_status
  before insert or update of deal_status_id on public.cca_stages
  for each row execute function public.cca_stages_guard_deal_status();

-- -----------------------------------------------------------------------------
-- 3. De-para dos casos existentes: só `stage_id`
-- -----------------------------------------------------------------------------
-- Os dois gatilhos que reagem a um UPDATE só de coluna ficam desligados durante
-- o de-para: `cca_cases_set_updated_at` porque `updated_at` ordena a esteira
-- ("caso mexido por último no topo", ccaData.ts) e carimbar 7.270 casos com o
-- mesmo instante apagaria essa ordem; `cca_cases_sync_esteira_label` porque, na
-- versão desta migration, mudar de coluna reescreve o Status 2 — e a regra é não
-- tocar rótulo no de-para. Os outros gatilhos só agem quando `status` muda.
-- Dentro do DO: se o update falhar, o `disable` volta junto.
do $$
begin
  alter table public.cca_cases disable trigger cca_cases_set_updated_at;
  alter table public.cca_cases disable trigger cca_cases_sync_esteira_label;

  update public.cca_cases c
     set stage_id = m.stage_id
    from (
      select c2.id,
             coalesce(
               (select s.id
                  from public.cca_stages s
                  join public.deal_statuses ds on ds.id = s.deal_status_id
                 where s.active and s.status = c2.status
                   and public.deal_status_bare(ds.value) = public.deal_status_bare(d.status_detail)
                 order by s.position limit 1),
               (select s.id
                  from public.cca_stages s
                  join public.deal_statuses ds on ds.id = s.deal_status_id
                 where s.active and s.status = c2.status
                   and public.deal_status_bare(ds.value)
                       = public.deal_status_bare(c2.analysis ->> 'bubble_status2')
                 order by s.position limit 1),
               (select s.id
                  from public.cca_stages s
                 where s.active and s.status = c2.status
                 order by s.position limit 1)
             ) as stage_id
        from public.cca_cases c2
        join public.deals d on d.id = c2.deal_id
       where not exists (
         select 1 from public.cca_stages s where s.id = c2.stage_id and s.active
       )
    ) m
   where m.id = c.id
     and m.stage_id is not null;

  alter table public.cca_cases enable trigger cca_cases_set_updated_at;
  alter table public.cca_cases enable trigger cca_cases_sync_esteira_label;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Esteira do envio, protegida como o resto da conferência
-- -----------------------------------------------------------------------------
alter table public.deals
  add column if not exists review_esteira text
    constraint deals_review_esteira_check check (review_esteira in ('agil', 'virar'));

comment on column public.deals.review_esteira is
  'Esteira do último envio ao gerente: agil (1º envio) ou virar (análise p/ virar negócio, com crédito aprovado). Escrita só por submit_deal_for_manager_review (0150).';

-- Corpo da 0110 com `review_esteira` entre as colunas que só as RPCs escrevem:
-- é ela que decide o rótulo de entrada na CCA.
create or replace function public.deals_guard_document_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_review_status, 'draft') <> 'draft'
       or new.document_review_requested_at is not null
       or new.document_review_requested_by is not null
       or new.document_reviewed_at is not null
       or new.document_reviewed_by is not null
       or new.document_review_reason is not null
       or new.review_esteira is not null then
      raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (
    new.document_review_status is distinct from old.document_review_status
    or new.document_review_requested_at is distinct from old.document_review_requested_at
    or new.document_review_requested_by is distinct from old.document_review_requested_by
    or new.document_reviewed_at is distinct from old.document_reviewed_at
    or new.document_reviewed_by is distinct from old.document_reviewed_by
    or new.document_review_reason is distinct from old.document_review_reason
    or new.review_esteira is distinct from old.review_esteira
  ) then
    raise exception 'A conferência documental só pode ser alterada pelas ações próprias do fluxo.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. "15. ANÁLISE P/ VIRAR NEGÓCIO" vira rótulo do sistema
-- -----------------------------------------------------------------------------
-- Corpo da 0059. O 2º envio tem rótulo próprio, escrito pelo mesmo gatilho da
-- esteira: marcá-lo à mão diria que o negócio foi reenviado sem ter sido.
create or replace function public.deals_guard_esteira_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new     text := public.deal_status_bare(new.status_detail);
  v_old     text := case when tg_op = 'UPDATE' then public.deal_status_bare(old.status_detail) else '' end;
  v_priv    boolean := current_user in ('postgres', 'service_role');
  v_sistema constant text[] := array['ESTEIRA AGIL', 'RET. ESTEIRA AGIL', 'ANÁLISE P/ VIRAR NEGÓCIO'];
begin
  -- Reenviar o formulário com o valor que já está lá não é escolha nova.
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then
    return new;
  end if;

  if v_priv then
    return new;
  end if;

  -- (a) Escrever o rótulo à mão: nunca. `42501` de propósito — o rótulo não
  --     está no Select, ninguém chega aqui pela tela (supabase/tests/18).
  if v_new = any (v_sistema) then
    raise exception
      'O rótulo "%" é escrito pelo sistema quando o negócio entra na esteira. Aprove a conferência documental em vez de marcá-lo.',
      new.status_detail
      using errcode = '42501';
  end if;

  -- (b) Trocar o rótulo enquanto o caso ainda está na esteira: também não.
  --     Vale para o rótulo do sistema e para o Status 2 que a coluna do caso
  --     gravou ("12. EM PROCESSAMENTO", "16. PENDENTE"): desde que mover grava
  --     rótulo comum, travar só o do sistema soltava o Status 2 no primeiro
  --     movimento. Encerrar o negócio continua permitido. `P0001` porque a
  --     frase é para o operador ler (`describeError` só a preserva nesse código).
  if tg_op = 'UPDATE'
     and v_new not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF')
     and exists (
       select 1 from public.cca_cases c
         left join public.cca_stages s on s.id = c.stage_id
         left join public.deal_statuses ds on ds.id = s.deal_status_id
        where c.deal_id = new.id
          and c.status in ('under_review', 'pending_documents')
          and (v_old = any (v_sistema)
               or (ds.value is not null and public.deal_status_bare(ds.value) = v_old))
     ) then
    raise exception
      'O negócio está na esteira de crédito: o Status 2 volta a ser editável quando o CCA decidir o caso.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. O rótulo que o caso escreve no negócio
-- -----------------------------------------------------------------------------
-- Ordem das regras:
--   (a) entrada na esteira (INSERT, ou `submitted_at` novo — só
--       `submit_deal_for_analysis` o escreve): o rótulo diz POR QUAL esteira;
--   (b) fora da entrada, mudou de coluna e a coluna tem Status 2: esse Status 2;
--   (c) sem ligação: o de-para antigo por status (0077);
--   (d) DISTRATO, QUEDA e OFF nunca são sobrescritos, nem o Status 2 de
--       negócio perdido, que é o motivo da perda. "19. REPROVADO" deixou de
--       ser poupado sempre porque a coluna REPROVADO o grava e o caso precisa
--       conseguir sair dela;
--   (e) mês fechado: o caso anda e o Status 2 fica, com a mesma exceção de
--       `deals_guard_closed_month` (admin). Toda troca de coluna grava rótulo,
--       e a recusa do mês derrubaria o `move_cca_case` inteiro.
-- A devolução (0077): caso chegando em pendência com a conferência aprovada
-- reabre a conferência do gerente — por mudança de status ou de coluna.
create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entrada boolean := tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at;
  v_label   text;
  v_deal    public.deals;
  v_reason  text;
begin
  if not v_entrada
     and new.status is not distinct from old.status
     and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  if v_entrada and new.status = 'under_review' then
    select case d.review_esteira
             when 'virar' then '15. ANÁLISE P/ VIRAR NEGÓCIO'
             else '13. ESTEIRA AGIL'
           end
      into v_label
      from public.deals d
     where d.id = new.deal_id;
  elsif not v_entrada and new.stage_id is distinct from old.stage_id then
    -- `not v_entrada`: a reentrada externa cai em EM ANÁLISE quando não há
    -- coluna da construtora, e o rótulo tem de ser o do fluxo (regra c), não
    -- o Status 2 da coluna.
    select ds.value into v_label
      from public.cca_stages s
      join public.deal_statuses ds on ds.id = s.deal_status_id
     where s.id = new.stage_id;
  end if;

  if v_label is null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    v_label := case new.status
      when 'under_review'      then '13. ESTEIRA AGIL'
      when 'pending_documents' then 'RET. ESTEIRA AGIL'
      when 'approved'          then '09. APROV. TOTAL'
      when 'sent_to_developer' then 'ANÁLISE EXTERNA'
      when 'sent_to_agency'    then 'ANÁLISE EXTERNA'
      else null
    end;
  end if;

  if v_label is not null then
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'OFF')
       and outcome not in ('lost', 'cancelled')
       and (public.is_admin()
            or not exists (select 1 from public.closed_months cm where cm.period = deals.month_base));
  end if;

  -- Entrar numa coluna de pendência também devolve, não só mudar o status:
  -- PENDENTE → RETORNO À ESTEIRA ÁGIL segue `pending_documents`, e os casos
  -- importados estão em pendência com a conferência aprovada (1.273 de 1.443 na
  -- homologação, 15/09) — sem reabrir, o corretor não reenvia por esteira nenhuma.
  if new.status = 'pending_documents'
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.stage_id is distinct from new.stage_id) then
    select * into v_deal from public.deals where id = new.deal_id for update;

    if found and v_deal.document_review_status = 'approved' then
      v_reason := 'Devolvido pela análise de crédito: '
                  || coalesce(nullif(btrim(new.decision_notes), ''), 'documentação pendente.');

      update public.deals
         set document_review_status   = 'returned',
             document_reviewed_at     = now(),
             document_reviewed_by     = auth.uid(),
             document_review_reason   = left(v_reason, 2000)
       where id = new.deal_id;

      insert into public.deal_history
        (deal_id, actor_id, kind, from_value, to_value, detail)
      values
        (new.deal_id, auth.uid(), 'document_review_returned', 'approved', 'returned',
         jsonb_build_object('reason', left(v_reason, 2000), 'source', 'cca'));

      insert into public.notifications (profile_id, kind, title, body, link, channel)
      select distinct dp.profile_id,
             'document_review_returned',
             'CCA devolveu o dossiê: ' || v_deal.code,
             left(v_reason, 2000),
             '/pipeline',
             'in_app'::notification_channel
      from public.deal_participants dp
      where dp.deal_id = new.deal_id and dp.role = 'broker';
    end if;
  end if;

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Avisos: a reentrada chega à CCA; o movimento avisa uma vez só
-- -----------------------------------------------------------------------------
-- A reentrada (`on conflict do update` de `submit_deal_for_analysis`) não é
-- INSERT, e a CCA não sabia que o dossiê voltou. `submitted_at` novo é o sinal:
-- no INSERT só o ramo de INSERT roda, então não há aviso dobrado.
create or replace function public.notify_cca_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.submitted_at is not distinct from old.submitted_at then
    return null;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select p.id,
         'cca_pending',
         'Dossiê novo na esteira de crédito',
         format(case when tg_op = 'INSERT'
                     then 'O negócio %s entrou na análise.'
                     else 'O negócio %s voltou para a análise.' end,
                coalesce(d.code, 'sem código')),
         '/cca',
         'in_app'
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
    left join public.deals d on d.id = new.deal_id
   where ur.role = 'cca';

  return null;
end;
$$;

drop trigger if exists notify_cca_case_created on public.cca_cases;
create trigger notify_cca_case_created
  after insert or update of submitted_at on public.cca_cases
  for each row execute function public.notify_cca_case_created();

-- Corpo da 0143. Dentro de `move_cca_case` quem avisa é a RPC, com a mensagem
-- do analista e a coluna; este aviso genérico seria o segundo do mesmo fato.
create or replace function public.notify_cca_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator      uuid := auth.uid();
  v_ator_nome text;
  v_code      text;
  -- Mesmos rótulos de src/components/pipeline/ccaStage.ts.
  v_rotulo    constant jsonb := '{
    "pending_documents": "Aguardando documentos",
    "under_review": "Em análise",
    "sent_to_developer": "Enviado à construtora",
    "sent_to_agency": "Enviado à agência",
    "approved": "Aprovado",
    "rejected": "Reprovado",
    "cancelled": "Cancelado"
  }';
begin
  if v_ator is null or current_setting('faceimob.cca_move', true) = 'on' then
    return null;
  end if;

  select d.code into v_code from public.deals d where d.id = new.deal_id;
  select full_name into v_ator_nome from public.profiles where id = v_ator;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'cca_status_changed',
         format('Crédito %s: %s',
                coalesce(v_code, 'negócio sem código'),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         format('%s moveu a análise de crédito de "%s" para "%s".',
                coalesce(v_ator_nome, 'Alguém'),
                coalesce(v_rotulo ->> old.status::text, old.status::text),
                coalesce(v_rotulo ->> new.status::text, new.status::text)),
         '/pipeline',
         'in_app'
    from (
      select distinct dp0.profile_id
        from public.deal_participants dp0
       where dp0.deal_id = new.deal_id and dp0.role = 'broker'
    ) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> v_ator
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = dp.profile_id
          and n.kind = 'document_review_returned'
          and n.title = 'CCA devolveu o dossiê: ' || v_code
          and n.created_at >= now()
     );

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Status e coluna do caso não mudam por PATCH
-- -----------------------------------------------------------------------------
-- Não é `security definer`: `current_user` precisa ser quem chamou. As funções
-- do sistema (`move_cca_case`, `submit_deal_for_analysis`,
-- `developer_submissions_advance_case`) são `security definer` e rodam como
-- postgres, então passam. A gravação só de `analysis` pela tela continua livre.
-- `submitted_at` é o sinal de entrada na esteira (rótulo de envio e aviso à
-- CCA): regravá-lo por PATCH forjava um envio e repetia o aviso. `decided_at`
-- é da decisão que a RPC grava, e `deal_id` trocaria o caso de negócio.
create or replace function public.cca_cases_guard_move()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.stage_id is distinct from old.stage_id
     or new.submitted_at is distinct from old.submitted_at
     or new.decided_at is distinct from old.decided_at
     or new.deal_id is distinct from old.deal_id then
    raise exception 'O caso só muda de coluna pela ação "Mover" da esteira do CCA, com mensagem.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.cca_cases_guard_move() from public, anon, authenticated;

drop trigger if exists cca_cases_guard_move on public.cca_cases;
create trigger cca_cases_guard_move
  before update on public.cca_cases
  for each row execute function public.cca_cases_guard_move();

-- A tela não cria nem apaga caso: quem cria é `submit_deal_for_analysis`. Com a
-- policy ALL, apagar e recriar o caso já na coluna escolhida decidia sem
-- mensagem, sem aviso e sem passar pelo gerente, e o cascade levava junto o
-- histórico de `cca_case_events`. Excluir o negócio continua levando o caso: a
-- ação referencial não passa por grant nem por RLS. O nome da policy fica, porque
-- a tela o cita.
drop policy if exists cca_cases_write on public.cca_cases;
create policy cca_cases_write on public.cca_cases
  for update to authenticated
  using ((select public.has_permission('cca.review')))
  with check (public.has_permission('cca.review'));

revoke insert, delete on public.cca_cases from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Envio ao gerente: mensagem obrigatória e esteira
-- -----------------------------------------------------------------------------
-- Corpo da 0047 com três mudanças: mensagem obrigatória (vira comentário e vai
-- no aviso ao gerente); `p_esteira = 'virar'` só com crédito aprovado na CCA,
-- e é o único caso em que o dossiê já aprovado pode voltar ao gerente; e o
-- evento `esteira_sent`, que alimenta o contador da CCA.
drop function if exists public.submit_deal_for_manager_review(uuid);

create or replace function public.submit_deal_for_manager_review(
  p_deal_id uuid,
  p_message text,
  p_esteira text default 'agil'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals;
  v_previous text;
  v_missing  text;
  v_message  text := btrim(coalesce(p_message, ''));
  v_esteira  text := coalesce(p_esteira, 'agil');
  v_texto    text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if v_esteira not in ('agil', 'virar') then
    raise exception 'Esteira de envio desconhecida: use "agil" ou "virar".' using errcode = 'P0001';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem do envio: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'broker'
  ) then
    raise exception 'Somente um corretor vinculado ao negócio pode solicitar a conferência.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status = 'pending' then
    raise exception 'A documentação já aguarda conferência do gerente.'
      using errcode = 'P0001';
  end if;

  if v_esteira = 'virar' then
    -- Também o 2º envio que a CCA devolveu (caso em pendência, esteira virar):
    -- sem isto o reenvio só saía como ágil e contava como 1º envio.
    if not exists (
      select 1 from public.cca_cases c
      where c.deal_id = p_deal_id
        and (c.status = 'approved'
             or (c.status = 'pending_documents' and v_deal.review_esteira = 'virar'))
    ) then
      raise exception 'A análise p/ virar negócio é o 2º envio: só vale para negócio com crédito aprovado na CCA.'
        using errcode = 'P0001';
    end if;
  elsif v_deal.document_review_status = 'approved' then
    raise exception 'A documentação deste negócio já foi aprovada.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'manager'
  ) then
    raise exception 'Vincule ao menos um gerente ao negócio antes de enviar.'
      using errcode = 'P0001';
  end if;

  -- A aprovação do gerente entra no CCA na mesma transação e o CCA exige
  -- construtora; sem esta trava a falha só apareceria no clique do gerente.
  if v_deal.developer_id is null then
    raise exception 'Defina a construtora na aba Detalhes antes de enviar ao gerente.'
      using errcode = 'P0001';
  end if;

  select string_agg(dt.label, ', ' order by dt.sort_order) into v_missing
  from public.document_types dt
  where dt.active and dt.required_for_conversion
    and not exists (
      select 1 from public.deal_documents dd
      where dd.deal_id = p_deal_id
        and dd.document_type_id = dt.id
        and dd.superseded_at is null
    );

  if v_missing is not null then
    raise exception 'Faltam documentos obrigatórios: %', v_missing using errcode = 'P0001';
  end if;

  v_previous := v_deal.document_review_status;
  v_texto := case v_esteira
               when 'virar' then 'ENVIO ANÁLISE P/ VIRAR NEGÓCIO: '
               else 'ENVIO ESTEIRA ÁGIL: '
             end || v_message;

  update public.deals
  set document_review_status = 'pending',
      document_review_requested_at = now(),
      document_review_requested_by = auth.uid(),
      document_reviewed_at = null,
      document_reviewed_by = null,
      document_review_reason = null,
      review_esteira = v_esteira
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_requested', v_previous, 'pending');

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment', v_texto);

  insert into public.deal_history (deal_id, actor_id, kind, detail)
  values (p_deal_id, auth.uid(), 'esteira_sent', jsonb_build_object('esteira', v_esteira));

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_requested',
         'Documentos para conferir: ' || v_deal.code,
         left(v_texto, 2000),
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'manager';

  return jsonb_build_object('status', 'pending', 'esteira', v_esteira);
end;
$$;

comment on function public.submit_deal_for_manager_review(uuid, text, text) is
  'Corretor envia o dossiê ao gerente com mensagem obrigatória, pela esteira agil (1º envio) ou virar (2º envio, só com crédito aprovado na CCA). Grava comentário, evento esteira_sent e avisa os gerentes com a mensagem (0150).';

revoke all on function public.submit_deal_for_manager_review(uuid, text, text) from public, anon;
grant execute on function public.submit_deal_for_manager_review(uuid, text, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. Conferência do gerente: mensagem também na aprovação
-- -----------------------------------------------------------------------------
-- Corpo da 0028. A aprovação aceita mensagem, sem exigir (o pedido só a cobra
-- no envio): quando vem, vira comentário no negócio e segue no aviso ao
-- corretor. A devolução continua como era.
create or replace function public.review_deal_documents(
  p_deal_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_reason text := nullif(btrim(p_reason), '');
  v_submit jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.deal_participants dp
    where dp.deal_id = p_deal_id
      and dp.profile_id = auth.uid()
      and dp.role = 'manager'
  ) then
    raise exception 'Somente um gerente vinculado ao negócio pode conferir os documentos.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status <> 'pending' then
    raise exception 'A documentação não está aguardando conferência.' using errcode = 'P0001';
  end if;

  if v_reason is null and not coalesce(p_approve, false) then
    raise exception 'Informe o motivo da devolução.' using errcode = 'P0001';
  end if;

  if length(v_reason) > 2000 then
    raise exception 'Mensagem longa demais (máx. 2000 caracteres).' using errcode = 'P0001';
  end if;

  if not coalesce(p_approve, false) then
    update public.deals
    set document_review_status = 'returned',
        document_reviewed_at = now(),
        document_reviewed_by = auth.uid(),
        document_review_reason = v_reason
    where id = p_deal_id;

    insert into public.deal_history
      (deal_id, actor_id, kind, from_value, to_value, detail)
    values
      (p_deal_id, auth.uid(), 'document_review_returned', 'pending', 'returned',
       jsonb_build_object('reason', v_reason));

    insert into public.notifications (profile_id, kind, title, body, link, channel)
    select distinct dp.profile_id,
           'document_review_returned',
           'Documentos devolvidos: ' || v_deal.code,
           v_reason,
           '/pipeline',
           'in_app'::notification_channel
    from public.deal_participants dp
    where dp.deal_id = p_deal_id and dp.role = 'broker';

    return jsonb_build_object('status', 'returned', 'reason', v_reason);
  end if;

  update public.deals
  set document_review_status = 'approved',
      document_reviewed_at = now(),
      document_reviewed_by = auth.uid(),
      document_review_reason = null
  where id = p_deal_id;

  insert into public.deal_history
    (deal_id, actor_id, kind, from_value, to_value)
  values
    (p_deal_id, auth.uid(), 'document_review_approved', 'pending', 'approved');

  if v_reason is not null then
    insert into public.deal_history (deal_id, actor_id, kind, to_value)
    values (p_deal_id, auth.uid(), 'comment', 'APROVADO PELO GERENTE: ' || v_reason);
  end if;

  v_submit := public.submit_deal_for_analysis(p_deal_id);

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select distinct dp.profile_id,
         'document_review_approved',
         'Documentos aprovados: ' || v_deal.code,
         left('A conferência foi aprovada e o negócio seguiu para análise.'
              || coalesce(' ' || v_reason, ''), 2000),
         '/pipeline',
         'in_app'::notification_channel
  from public.deal_participants dp
  where dp.deal_id = p_deal_id and dp.role = 'broker';

  return jsonb_build_object('status', 'approved', 'submission', v_submit);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Entrada na CCA
-- -----------------------------------------------------------------------------
-- Corpo da 0077 com duas mudanças:
--   · o envio externo sem coluna "Enviado à Construtora" ativa entra na primeira
--     coluna "em análise" (antes nascia sem estágio e a tela o jogava na
--     primeira coluna qualquer);
--   · o negócio só é PUXADO para "Em análise" se estiver aberto e ainda antes
--     dela. O 2º envio sai de "Aprovado" ou "Contrato", e voltar atrás desfazia
--     o andamento do funil.
create or replace function public.submit_deal_for_analysis(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal           public.deals;
  v_dev            public.developers;
  v_docs           uuid[];
  v_client         text;
  v_case_id        uuid;
  v_sub_id         uuid;
  v_stage          uuid;
  v_analysis_stage uuid;
  v_analysis_pos   int;
  v_result         jsonb;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if auth.uid() is not null
     and not public.is_admin()
     and not exists (
       select 1 from public.deal_participants dp
       where dp.deal_id = p_deal_id
         and dp.profile_id = auth.uid()
         and dp.role = 'manager'
     ) then
    raise exception 'Somente um gerente vinculado ao negócio pode enviá-lo ao CCA.'
      using errcode = '42501';
  end if;

  if v_deal.document_review_status <> 'approved' then
    raise exception 'A documentação ainda não foi aprovada pelo gerente.'
      using errcode = 'P0001';
  end if;

  if v_deal.developer_id is null then
    raise exception 'Defina a construtora antes de enviar para análise.'
      using errcode = 'P0001';
  end if;

  select * into v_dev from public.developers where id = v_deal.developer_id;

  select coalesce(array_agg(d.id order by d.created_at), '{}') into v_docs
  from public.deal_documents d
  where d.deal_id = p_deal_id and d.superseded_at is null;

  if array_length(v_docs, 1) is null then
    raise exception 'Nenhum documento anexado ao negócio.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_types dt
    where dt.active and dt.required_for_conversion
      and not exists (
        select 1 from public.deal_documents dd
        where dd.deal_id = p_deal_id
          and dd.document_type_id = dt.id
          and dd.superseded_at is null
      )
  ) then
    raise exception 'Faltam documentos obrigatórios: %',
      (select string_agg(dt.label, ', ' order by dt.sort_order)
       from public.document_types dt
       where dt.active and dt.required_for_conversion
         and not exists (
           select 1 from public.deal_documents dd
           where dd.deal_id = p_deal_id
             and dd.document_type_id = dt.id
             and dd.superseded_at is null
         ))
      using errcode = 'P0001';
  end if;

  select c.full_name into v_client
  from public.deal_clients c where c.deal_id = p_deal_id and c.ordinal = 1;

  if v_dev.flow = 'internal' then
    select id into v_stage from public.cca_stages
     where status = 'under_review' and active order by position limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'under_review', v_stage, now())
    on conflict (deal_id) do update
      set status = 'under_review',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'under_review');

    v_result := jsonb_build_object('flow', 'internal', 'case_id', v_case_id);
  else
    select id into v_stage from public.cca_stages
     where active and status in ('sent_to_developer', 'under_review')
     order by (status = 'sent_to_developer') desc, position
     limit 1;

    insert into public.cca_cases (deal_id, status, stage_id, submitted_at)
    values (p_deal_id, 'sent_to_developer', v_stage, now())
    on conflict (deal_id) do update
      set status = 'sent_to_developer',
          stage_id = coalesce(excluded.stage_id, cca_cases.stage_id),
          submitted_at = now(),
          decided_at = null
    returning id into v_case_id;

    insert into public.cca_case_events (case_id, actor_id, kind, to_value)
    values (v_case_id, auth.uid(), 'submitted', 'sent_to_developer');

    insert into public.developer_submissions
      (deal_id, developer_id, to_email, subject, body, document_ids, requested_by)
    values (
      p_deal_id,
      v_dev.id,
      v_dev.submission_email,
      format('[%s] Documentação - %s', v_deal.code, coalesce(v_client, 'cliente')),
      format('Segue documentação do negócio %s (unidade %s).',
             v_deal.code, coalesce(v_deal.unit, '-')),
      v_docs,
      auth.uid()
    )
    returning id into v_sub_id;

    insert into public.deal_history (deal_id, actor_id, kind, detail)
    values (p_deal_id, auth.uid(), 'sent_to_developer',
            jsonb_build_object('submission_id', v_sub_id, 'developer', v_dev.name));

    v_result := jsonb_build_object(
      'flow', 'external', 'submission_id', v_sub_id, 'case_id', v_case_id);
  end if;

  select id, position into v_analysis_stage, v_analysis_pos
  from public.pipeline_stages
  where code = 'under_analysis' and active;

  if v_analysis_stage is null then
    raise exception 'A etapa Em análise não está configurada.' using errcode = 'P0001';
  end if;

  if v_deal.outcome = 'open' and exists (
    select 1 from public.pipeline_stages s
    where s.id = v_deal.stage_id and s.position < v_analysis_pos
  ) then
    update public.deals set stage_id = v_analysis_stage where id = p_deal_id;
  end if;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Mover o caso de coluna, com mensagem
-- -----------------------------------------------------------------------------
-- A mensagem vai para `decision_notes` (o cartão já a mostra), vira comentário
-- no negócio e segue no aviso a corretores e gerentes. Quem já recebeu "CCA
-- devolveu o dossiê" pelo mesmo movimento (gatilho da esteira, com a mesma
-- mensagem) não recebe o segundo aviso — mesmo dedupe da 0143.
create or replace function public.move_cca_case(p_case_id uuid, p_stage_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case      public.cca_cases;
  v_stage     public.cca_stages;
  v_message   text := btrim(coalesce(p_message, ''));
  v_code      text;
  v_ator_nome text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não move casos na esteira do CCA.' using errcode = '42501';
  end if;

  if v_message = '' then
    raise exception 'Escreva a mensagem da movimentação: ela fica registrada no negócio e avisa a equipe.'
      using errcode = 'P0001';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Mensagem longa demais (máx. 4000 caracteres).' using errcode = 'P0001';
  end if;

  select * into v_stage from public.cca_stages where id = p_stage_id and active;
  if not found then
    raise exception 'Coluna da esteira não encontrada ou desativada.' using errcode = 'P0001';
  end if;

  select * into v_case from public.cca_cases where id = p_case_id for update;
  if not found then
    raise exception 'Caso não encontrado.' using errcode = 'P0002';
  end if;

  perform set_config('faceimob.cca_move', 'on', true);

  update public.cca_cases
     set stage_id       = v_stage.id,
         status         = v_stage.status,
         decision_notes = v_message,
         -- Entre colunas do mesmo desfecho a data da decisão é a original.
         decided_at     = case
                            when v_stage.status not in ('approved', 'rejected') then null
                            when v_stage.status = v_case.status then coalesce(v_case.decided_at, now())
                            else now()
                          end
   where id = p_case_id;

  perform set_config('faceimob.cca_move', '', true);

  select d.code into v_code from public.deals d where d.id = v_case.deal_id;
  select p.full_name into v_ator_nome from public.profiles p where p.id = auth.uid();

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (v_case.deal_id, auth.uid(), 'comment',
          'STATUS: ' || v_stage.name || ' — ' || v_message);

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select dp.profile_id,
         'cca_status_changed',
         format('Crédito %s: %s', coalesce(v_code, 'negócio sem código'), v_stage.name),
         left(format('%s moveu para "%s": %s',
                     coalesce(v_ator_nome, 'Alguém'), v_stage.name, v_message), 2000),
         '/pipeline',
         'in_app'
    from (
      select distinct dp0.profile_id
        from public.deal_participants dp0
       where dp0.deal_id = v_case.deal_id and dp0.role in ('broker', 'manager')
    ) dp
    join public.profiles p on p.id = dp.profile_id and p.status = 'active'
   where dp.profile_id <> auth.uid()
     and not exists (
       select 1 from public.notifications n
        where n.profile_id = dp.profile_id
          and n.kind = 'document_review_returned'
          and n.title = 'CCA devolveu o dossiê: ' || v_code
          and n.created_at >= now()
     );

  return jsonb_build_object(
    'case_id', v_case.id,
    'deal_id', v_case.deal_id,
    'stage_id', v_stage.id,
    'status', v_stage.status);
end;
$$;

comment on function public.move_cca_case(uuid, uuid, text) is
  'Move o caso para uma coluna ativa da CCA com mensagem obrigatória: grava status e Status 2 (pela coluna), comentário no negócio e avisa corretores e gerentes. Única porta para mudar status/coluna com o token do usuário (0150).';

revoke all on function public.move_cca_case(uuid, uuid, text) from public, anon;
grant execute on function public.move_cca_case(uuid, uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 13. Quantas vezes o cliente foi enviado, por esteira
-- -----------------------------------------------------------------------------
-- A chave é o CPF do titular só com dígitos; sem CPF, o próprio negócio (o id
-- nunca colide com CPF). Soma por chave primeiro e junta depois: um join por
-- "mesmo CPF OU mesmo negócio" viraria laço de 7.500 × 7.500.
create or replace function public.cca_send_counts()
returns table(deal_id uuid, agil int, virar int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('cca.review') then
    raise exception 'Seu perfil não vê os envios da esteira do CCA.' using errcode = '42501';
  end if;

  return query
  with titular as (
    select d.id as negocio,
           coalesce(nullif(regexp_replace(coalesce(dc.cpf, ''), '\D', '', 'g'), ''), d.id::text) as chave
      from public.deals d
      left join public.deal_clients dc on dc.deal_id = d.id and dc.ordinal = 1
  ),
  por_chave as (
    select t.chave,
           count(*) filter (where h.detail ->> 'esteira' = 'agil')::int  as n_agil,
           count(*) filter (where h.detail ->> 'esteira' = 'virar')::int as n_virar
      from public.deal_history h
      join titular t on t.negocio = h.deal_id
     where h.kind = 'esteira_sent'
     group by t.chave
  )
  select c.deal_id, coalesce(pc.n_agil, 0), coalesce(pc.n_virar, 0)
    from public.cca_cases c
    join titular t on t.negocio = c.deal_id
    left join por_chave pc on pc.chave = t.chave;
end;
$$;

comment on function public.cca_send_counts() is
  'Para cada negócio com caso na CCA, quantos envios ao gerente (agil e virar) têm todos os negócios do mesmo CPF de titular; sem CPF, só o próprio negócio. Exige cca.review (0150).';

revoke all on function public.cca_send_counts() from public, anon;
grant execute on function public.cca_send_counts() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 14. "esteira" e "aprovado" pontuam uma vez por negócio
-- -----------------------------------------------------------------------------
-- Corpo da 0142. O 2º envio reabre o caso aprovado (approved → under_review →
-- approved), e o dedupe de `game_events` é por temporada: numa temporada nova o
-- mesmo crédito pagava "esteira" e "aprovado" de novo. Mesma ideia da guarda de
-- "venda" da 0142, sem desconto: nenhum evento anula esses dois. Quem sai do
-- rateio perde o evento da temporada aberta (0142) e volta a poder ganhá-lo. A
-- busca parte das temporadas para cair no `game_events_dedupe_idx`.
create or replace function public.cca_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_broker   uuid;
  v_aprovado boolean := false;
  v_esteira  boolean := false;
begin
  -- `sent_to_developer` conta como entrada na esteira: é o status em que o
  -- fluxo EXTERNO cria o caso (0077).
  if tg_op = 'INSERT' then
    v_aprovado := (new.status = 'approved');
    v_esteira  := (new.status in ('under_review', 'sent_to_developer'));
  else
    v_aprovado := (new.status = 'approved' and old.status is distinct from 'approved');
    v_esteira  := (new.status in ('under_review', 'sent_to_developer')
                   and old.status not in ('under_review', 'sent_to_developer'));
  end if;

  if not (v_aprovado or v_esteira) then
    return null;
  end if;

  for v_broker in
    select profile_id from public.deal_participants
    where deal_id = new.deal_id and role = 'broker'
  loop
    if v_aprovado and not exists (
      select 1 from public.game_seasons s
        join public.game_events e
          on e.season_id = s.id and e.profile_id = v_broker and e.event_code = 'aprovado'
         and e.ref_type = 'deal' and e.ref_id = new.deal_id
    ) then
      perform public.award_game_points(v_broker, 'aprovado', 'deal', new.deal_id, now());
    end if;

    if v_esteira and not exists (
      select 1 from public.game_seasons s
        join public.game_events e
          on e.season_id = s.id and e.profile_id = v_broker and e.event_code = 'esteira'
         and e.ref_type = 'deal' and e.ref_id = new.deal_id
    ) then
      perform public.award_game_points(v_broker, 'esteira', 'deal', new.deal_id, now());
    end if;
  end loop;

  return null;
end;
$$;
