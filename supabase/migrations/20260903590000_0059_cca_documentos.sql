-- =============================================================================
-- 0059 · Esteira CCA e documentos do negócio — fechar o laço de volta
--
-- Sete buracos medidos na auditoria de 02/09, todos na mesma fronteira
-- (corretor → gerente → CCA → construtora). Cada bloco explica o PORQUÊ.
--
-- 1. O laço de volta morria. Quando o CCA devolve o caso por falta de
--    documento, o gatilho da 0037 trocava o rótulo para "RET. ESTEIRA AGIL" e
--    parava aí: `deals.document_review_status` continuava 'approved', ninguém
--    era notificado e `submit_deal_for_manager_review` recusava o reenvio com
--    "A documentação deste negócio já foi aprovada" (0028:398). O corretor via
--    o rótulo mudar e não tinha ação nenhuma disponível. Decisão de 02/09: a
--    devolução do CCA REABRE a conferência do gerente — é o caminho que o
--    corretor já conhece, reaproveita a notificação e o motivo que já existem,
--    e evita um segundo fluxo de devolução com regra própria.
--
-- 2. A trava do rótulo do sistema valia para 7 dos 32 negócios. A 0037 só
--    recusava a escrita manual quando `document_review_status <> 'approved'`,
--    e 25 negócios estão aprovados: na maioria da base o rótulo continuava
--    digitável à mão. A garantia "só o sistema escreve" passa a valer sempre —
--    o gatilho da esteira é `security definer`, então escreve como `postgres` e
--    não esbarra na própria trava.
--
-- 3. O rótulo não era grudento. A 0037 recusava ESCREVER e não recusava
--    APAGAR: bastava escolher outro Status 2 e o "13. ESTEIRA AGIL" sumia com
--    o caso ainda em análise — e não dava para recolocar, porque o rótulo não
--    está no Select. Mesmo furo, pelo outro lado. Agora a troca é recusada
--    enquanto o caso estiver em `under_review`/`pending_documents`, com uma
--    exceção deliberada: rótulo de encerramento (DISTRATO/QUEDA/REPROVADO/OFF)
--    passa, senão o diálogo de perda ficaria impedido de encerrar o negócio.
--
-- 4. Aprovar não escrevia rótulo nenhum. 8 dos 12 casos (7 aprovados + 1
--    enviado à construtora) estavam com `status_detail` NULO: quem passou pela
--    esteira e foi aprovado aparecia no Status 2 como se nunca tivesse ido. O
--    gatilho passa a escrever "09. APROV. TOTAL" no desfecho 'approved' — a
--    tradução literal do que o analista escolheu na tela ("Aprovado"). Os
--    demais desfechos continuam de fora: 'rejected' e 'cancelled' encerram o
--    negócio e quem escreve o rótulo de encerramento é o diálogo de perda,
--    que também move a etapa; escrever só o rótulo deixaria a tela dizendo
--    "REPROVADO" com o negócio ainda no funil.
--
-- 5. Escrita livre no bucket de documentos. O `with_check` da policy
--    `deal_documents_storage` (0047) era só `bucket_id = 'deal-documents'`:
--    qualquer autenticado gravava objeto arbitrário na pasta de qualquer
--    negócio. Não era vazamento de leitura — a leitura já exigia `can_see_deal`
--    ou o papel `cca` —, mas era escrita livre no armazenamento de documento de
--    cliente. E, pelo mesmo motivo, o rollback do arquivo órfão não funcionava:
--    quando o insert em `deal_documents` era barrado pela RLS, o `storage.remove`
--    do cliente esbarrava numa policy que exige a linha que acabou de NÃO ser
--    criada, e o arquivo ficava no bucket para sempre.
--
-- 6. Documento errado não saía da tela. `deal_documents_delete` era só
--    `is_admin()`: num tipo com `allows_multiple` (que não versiona) o arquivo
--    errado ficava lá para sempre. Passa a aceitar também quem edita o negócio,
--    e só enquanto a conferência ainda é do corretor ('draft'/'returned') — a
--    partir do envio ao gerente o dossiê é prova e não se mexe. E apagar a
--    versão vigente de um tipo versionado deixava o dossiê sem vigente nenhum
--    (a FK zera `superseded_by`, ninguém zerava `superseded_at`): a v1 sumia da
--    lista padrão e o obrigatório voltava a travar o envio. Um gatilho reabre a
--    versão anterior.
--
-- 7. Retentativa automática morta. `dispatch_pending_submissions` só acordava o
--    worker com linha 'queued', mas o `submission-dispatch` processa
--    `in ('queued','failed')`: um envio que falhou ficava parado para sempre
--    até alguém clicar "Reenviar" na tela. O gatilho do cron passa a considerar
--    'failed' com tentativas abaixo do teto.
--
-- 8. Agenda de visita sempre vazia para o CCA. `deals`, `deal_clients`,
--    `deal_participants` e `deal_documents` liberam `has_role('cca')`;
--    `visits_select` não — o analista abria o negócio no /pipeline e via a
--    agenda vazia sem conseguir distinguir "não tem visita" de "não posso ver".
--
-- Fora daqui, e de propósito: `menu.cca` para diretoria e gerência em modo
-- leitura (bloco 0) — a escrita continua fechada por `cca.review`, então
-- liberar o menu não abre risco; e `cca_stages_write` mais `document_types_write`,
-- que usavam `has_any_role(admin,cca)` enquanto o resto da MESMA tela usa
-- `has_permission('cca.review')` — desligar a permissão deixava "Mover" e
-- "Enviar à construtora" com 42501 e "Gerenciar estágios" funcionando; e
-- concedê-la a um gerente mostrava "Tipos de documento" com o banco recusando.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Menu da esteira para quem cobra o número, sem abrir a escrita
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed) values
  ('director', 'menu.cca', true),
  ('manager',  'menu.cca', true)
on conflict (role, permission) do update set allowed = excluded.allowed;

-- Um modelo de autorização só dentro da tela: tudo que escreve na esteira
-- passa por `cca.review`.
drop policy if exists cca_stages_write on public.cca_stages;
create policy cca_stages_write on public.cca_stages
  for all to authenticated
  using (public.has_permission('cca.review'))
  with check (public.has_permission('cca.review'));

-- Mesmo motivo, mesma tela: o catálogo de tipos de documento é editado ao lado
-- de "Gerenciar estágios", e o botão é liberado por `cca.review`. Enquanto a
-- policy fosse `has_any_role(admin,'cca')`, um gerente com `cca.review`
-- concedido na tela de Permissões via o botão, marcava "Obrigatório" e levava a
-- recusa do banco. `has_permission` já curto-circuita em admin e o papel `cca`
-- tem `cca.review` no seed: ninguém que escrevia antes perde acesso.
drop policy if exists document_types_write on public.document_types;
create policy document_types_write on public.document_types
  for all to authenticated
  using (public.has_permission('cca.review'))
  with check (public.has_permission('cca.review'));

-- -----------------------------------------------------------------------------
-- 1/2/3. O rótulo da esteira é do sistema — para escrever E para apagar
-- -----------------------------------------------------------------------------
create or replace function public.deals_guard_esteira_label()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new  text := public.deal_status_bare(new.status_detail);
  v_old  text := case when tg_op = 'UPDATE' then public.deal_status_bare(old.status_detail) else '' end;
  v_priv boolean := current_user in ('postgres', 'service_role');
begin
  -- Reenviar o formulário com o valor que já está lá não é escolha nova.
  if tg_op = 'UPDATE' and new.status_detail is not distinct from old.status_detail then
    return new;
  end if;

  if v_priv then
    return new;
  end if;

  -- (a) Escrever o rótulo à mão: nunca. Antes havia um escape para negócio com
  --     conferência aprovada, e é justamente o estado da maioria da base.
  if v_new in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL') then
    raise exception
      'O rótulo "%" é escrito pelo sistema quando o negócio entra na esteira. Aprove a conferência documental em vez de marcá-lo.',
      new.status_detail
      using errcode = '42501';
  end if;

  -- (b) Apagar o rótulo enquanto o caso ainda está na esteira: também não.
  --     Encerrar o negócio continua permitido — senão o diálogo de perda ficaria
  --     travado justamente no negócio que caiu durante a análise.
  if tg_op = 'UPDATE'
     and v_old in ('ESTEIRA AGIL', 'RET. ESTEIRA AGIL')
     and v_new not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF')
     and exists (
       select 1 from public.cca_cases c
       where c.deal_id = new.id
         and c.status in ('under_review', 'pending_documents')
     ) then
    -- `P0001` e não `42501`: `describeError` (src/lib/supabaseError.ts) só
    -- preserva a mensagem própria em `P0001`/`P0002` — com `42501` esta frase,
    -- escrita para o operador, virava "Você não tem permissão para esta ação."
    -- num negócio que ele TEM permissão de editar. A regra (a) continua em
    -- `42501` de propósito: aquele rótulo não está no Select, ninguém chega
    -- nela pela tela, e a 0037 já a documenta assim (supabase/tests/18).
    raise exception
      'O negócio está na esteira de crédito: o Status 2 volta a ser editável quando o CCA decidir o caso.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.deals_guard_esteira_label() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1/4. A esteira escreve o rótulo — e a devolução reabre a conferência
-- -----------------------------------------------------------------------------
create or replace function public.cca_cases_sync_esteira_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label  text;
  v_deal   public.deals;
  v_reason text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_label := case new.status
    when 'under_review'      then '13. ESTEIRA AGIL'
    when 'pending_documents' then 'RET. ESTEIRA AGIL'
    when 'approved'          then '09. APROV. TOTAL'
    else null
  end;

  if v_label is not null then
    update public.deals
       set status_detail = v_label
     where id = new.deal_id
       and status_detail is distinct from v_label
       and public.deal_status_bare(status_detail) not in ('DISTRATO', 'QUEDA', 'REPROVADO', 'OFF');
  end if;

  -- Devolução do CCA: o dossiê volta para a conferência do gerente. Sem isto o
  -- corretor recebia o rótulo "RET. ESTEIRA AGIL" e nenhuma ação: o negócio
  -- seguia 'approved' e `submit_deal_for_manager_review` recusava o reenvio.
  if new.status = 'pending_documents' then
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

-- O gatilho deixa de escutar só a COLUNA status: mover o caso gravando
-- `stage_id` junto continua funcionando, mas agora por garantia e não por
-- coincidência da ordem em que a tela monta o UPDATE.
drop trigger if exists cca_cases_sync_esteira_label on public.cca_cases;
create trigger cca_cases_sync_esteira_label
  after insert or update on public.cca_cases
  for each row execute function public.cca_cases_sync_esteira_label();

-- Retroalimenta quem foi aprovado antes deste gatilho existir. Só onde o
-- Status 2 está NULO: sobrescrever rótulo escolhido por alguém seria trocar um
-- fato por uma suposição.
update public.deals d
   set status_detail = '09. APROV. TOTAL'
  from public.cca_cases c
 where c.deal_id = d.id
   and c.status = 'approved'
   and d.status_detail is null;

-- -----------------------------------------------------------------------------
-- 5. Bucket deal-documents: escrita só na pasta de negócio que a pessoa acessa
--
-- O caminho gravado pelo cliente é `<deal_id>/<timestamp>-<nome>`, então o
-- primeiro segmento identifica o negócio. A regra por prefixo também é o que
-- permite o rollback do arquivo órfão: quando o insert em `deal_documents` é
-- barrado, não existe linha para a regra antiga casar e o arquivo ficava.
--
-- ESCREVER usa `can_edit_deal`, a MESMA expressão que `deal_documents_insert`
-- (0006) cobra na tabela — e não `can_see_deal`, que começa em `can_read_all()`
-- e deixaria diretor e sócio (papéis de leitura) gravando objeto arbitrário na
-- pasta de qualquer negócio, com a linha recusada e o arquivo no bucket. LER
-- continua em `can_see_deal` mais o papel `cca`. `can_edit_deal` já inclui
-- `has_permission('cca.review')`, então o analista continua coberto sem um ramo
-- só dele.
--
-- A exceção do anexo promovido: `promoteLeadAttachments` copia o objeto do lead
-- para cá com a MESMA chave (`<lead_id>/...`, src/integrations/supabase/leads.ts),
-- então o primeiro segmento é o id do LEAD e `can_edit_deal` é falso por
-- construção — sem este ramo toda conversão com anexo passaria a falhar. O ramo
-- exige a linha em `lead_attachments` com aquele caminho exato **e** com o
-- prefixo apontando para o PRÓPRIO lead da linha.
--
-- Os dois lados dessa conjunção importam. `lead_attachments.storage_path` é
-- `text not null unique` sem vínculo nenhum com `lead_id` (0005:195), e
-- `lead_attachments_insert` (0041) só cobra `uploaded_by = auth.uid()` e
-- `can_see_lead(lead_id)`: exigir apenas "existe a linha" deixava qualquer
-- corretor inserir, no PRÓPRIO lead, uma linha com
-- `storage_path = '<deal_id_alheio>/x.pdf'` — caminho de escolha livre dele — e
-- gravar (ou, com `x-upsert`, sobrescrever) objeto na pasta de um negócio que
-- não edita. Era o mesmo furo que este bloco diz fechar, reaberto pelo escape.
-- Casando `a.lead_id` com `deal_id_of_object(name)` o prefixo deixa de ser
-- escolha do atacante: só passa a chave que o próprio lead já carrega, que é
-- exatamente a que `promoteLeadAttachments` copia.
-- ponytail: o certo é a cópia gravar `<deal_id>/<nome>` e atualizar
-- `deal_documents.storage_path`; evoluir quando `promoteLeadAttachments` puder
-- ser tocado (arquivo de outra frente) e então este ramo sai.
-- -----------------------------------------------------------------------------
-- Primeiro segmento do caminho, quando ele é um uuid. Devolve NULL para
-- qualquer outro formato: o `is not null` da policy é o que transforma
-- "caminho fora do padrão" em recusa, em vez de deixar `can_see_deal(null)`
-- responder `true` para quem enxerga a base inteira.
create or replace function public.deal_id_of_object(p_name text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(split_part(coalesce(p_name, ''), '/', 1), '')::uuid
  where split_part(coalesce(p_name, ''), '/', 1)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

grant execute on function public.deal_id_of_object(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage do Supabase ausente - policy de bucket ignorada (ambiente de teste)';
    return;
  end if;

  execute 'drop policy if exists deal_documents_storage on storage.objects';
  execute $p$
    create policy deal_documents_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'deal-documents'
        and (
          public.has_role('cca')
          or exists (
            select 1 from public.deal_documents d
            where d.storage_path = storage.objects.name
              and public.can_see_deal(d.deal_id)
          )
          or (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_see_deal(public.deal_id_of_object(storage.objects.name))
          )
        )
      )
      with check (
        bucket_id = 'deal-documents'
        and public.deal_id_of_object(storage.objects.name) is not null
        and (
          public.can_edit_deal(public.deal_id_of_object(storage.objects.name))
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and a.lead_id = public.deal_id_of_object(storage.objects.name)
          )
        )
      )
  $p$;
exception
  when insufficient_privilege then
    raise notice 'sem privilégio para recriar a policy do bucket - ignorado';
end
$$;

-- Teto de servidor: 25 MB por arquivo. A validação de extensão e tamanho no
-- cliente é conveniência; esta é a que vale.
--
-- ponytail: `allowed_mime_types` fica NULO de propósito — o navegador manda
-- content-type vazio para vários PDFs e ZIPs gerados por scanner, e uma lista
-- fechada aqui recusaria o envio sem mensagem legível. Evoluir quando o
-- cliente passar a mandar content-type explícito em 100% dos envios.
--
-- O `do` condicionado à coluna existe porque `scripts/validate-schema.sh` roda
-- as migrations contra um `storage.buckets` reduzido (`supabase/tests/
-- 00_supabase_stubs.sql`), sem as colunas de limite — mesmo padrão da 0056.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    execute $sql$
      update storage.buckets set file_size_limit = 26214400 where id = 'deal-documents'
    $sql$;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Excluir documento errado enquanto o dossiê ainda é do corretor
-- -----------------------------------------------------------------------------
drop policy if exists deal_documents_delete on public.deal_documents;
create policy deal_documents_delete on public.deal_documents
  for delete to authenticated
  using (
    public.is_admin()
    or (
      public.can_edit_deal(deal_id)
      and exists (
        select 1 from public.deals d
        where d.id = deal_documents.deal_id
          and coalesce(d.document_review_status, 'draft') in ('draft', 'returned')
      )
    )
  );

-- Apagar a versão VIGENTE reabre a anterior.
--
-- `superseded_by` é `on delete set null` (0006:267), mas `superseded_at` não é
-- limpo por ninguém: apagando a v2, a v1 continuava marcada como substituída e
-- o tipo ficava SEM documento vigente. A aba Anexos lista por padrão só o
-- vigente, então a linha some da tela com o arquivo ainda no bucket; e
-- `missingRequiredTypes` conta só vigente, então um tipo obrigatório voltava a
-- aparecer como pendente e travava o envio ao gerente. Como o botão Excluir só
-- aparece na linha vigente (`DealDocumentUpload`), esse era o caminho normal.
--
-- O conserto fica no banco, e não no cliente, porque a exclusão também sai do
-- admin e de SQL — e porque a regra de "quem é o vigente" já mora aqui, nos
-- gatilhos `deal_documents_enforce_single`/`_supersede`.
create or replace function public.deal_documents_reopen_previous()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Tipo com `allows_multiple` nunca marca substituído, e sobra vigente em
  -- qualquer exclusão parcial: nos dois casos não há o que reabrir.
  if exists (
    select 1 from public.deal_documents
     where deal_id = old.deal_id
       and document_type_id = old.document_type_id
       and superseded_at is null
  ) then
    return null;
  end if;

  -- Não depende de `superseded_by`: a FK já o zerou (e a ordem entre o gatilho
  -- da FK e este não é contrato). A versão mais alta que restou é o vigente.
  update public.deal_documents
     set superseded_at = null, superseded_by = null
   where id = (
     select id from public.deal_documents
      where deal_id = old.deal_id
        and document_type_id = old.document_type_id
      order by version desc, created_at desc
      limit 1
   );
  return null;
end;
$$;

drop trigger if exists deal_documents_reopen_previous on public.deal_documents;
create trigger deal_documents_reopen_previous
  after delete on public.deal_documents
  for each row execute function public.deal_documents_reopen_previous();

-- -----------------------------------------------------------------------------
-- 7. O cron volta a acordar o worker para envio que falhou
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_pending_submissions()
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select secret into v_url from private.integration_credentials
   where provider = 'supabase' and label = 'functions_url' and active;
  select secret into v_key from private.integration_credentials
   where provider = 'supabase' and label = 'service_role_key' and active;

  if v_url is null or v_key is null then
    raise warning 'dispatch_pending_submissions: cadastre functions_url e service_role_key em Integrações.';
    return;
  end if;

  -- O `submission-dispatch` repesca `failed` e `sending` parados há mais de 10
  -- minutos, com menos de 5 tentativas; acordar o worker só por 'queued'
  -- anulava essa repesca — a falha (e o envio preso em 'sending') ficava parada
  -- para sempre até alguém clicar "Reenviar" na tela. A condição aqui espelha a
  -- da função de borda: mudou lá, muda aqui.
  if not exists (
    select 1 from public.developer_submissions
    where status = 'queued'
       or (status in ('failed', 'sending')
           and attempts < 5
           and updated_at < now() - interval '10 minutes')
  ) then
    return;
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/submission-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. O analista de CCA passa a ver a visita agendada do negócio
--
-- `deals`, `deal_clients`, `deal_participants` e `deal_documents` liberam
-- `has_role('cca')`; `visits_select` não. O analista abre o negócio no
-- /pipeline e a agenda aparece SEMPRE vazia — sem distinguir "não tem visita"
-- de "não posso ver", que é a pior das duas leituras possíveis.
--
-- Só visita ligada a negócio: visita solta é agenda pessoal do corretor e não é
-- assunto do crédito.
-- -----------------------------------------------------------------------------
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits
  for select to authenticated
  using (
    broker_id in (select public.auth_visible_profiles())
    or (deal_id is not null and (public.can_see_deal(deal_id) or public.has_role('cca')))
  );
