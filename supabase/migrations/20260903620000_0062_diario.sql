-- =============================================================================
-- 0062 — Diário: validade do link, dono do link, metas reais e recusa uniforme
--
-- Sete defeitos da auditoria de 02/09, todos na mesma superfície (o link público
-- do Diário e do checkpoint da diretoria) e todos corrigidos no ponto
-- compartilhado, não em cada chamador:
--
--  1. VALIDADE QUE NUNCA ERA ESCRITA. `public_links.expires_at` existe desde a
--     0009 e as três RPCs a respeitam, mas `create_public_link` (0033) nunca a
--     preenchia: todo link criado pela tela nascia eterno. A validade dos quatro
--     links da homologação veio do seed, não do produto. Passa a nascer com 90
--     dias, e "renovar o PIN" de um link vencido volta a valer — antes o admin
--     via "PIN gerado" e o gerente continuava recusado (falso sucesso).
--
--  2. QUALQUER DIRETOR MEXIA NO LINK DE QUALQUER UM. `create_public_link`,
--     `set_public_link_pin` e as policies de update/delete checavam só o PAPEL
--     (`admin` ou `director`), nunca o dono. Um diretor trocava o PIN do link de
--     outro diretor — e assumia o link — ou apagava o link da equipe alheia. A
--     regra de dono passa a morar em `can_manage_public_link`, um lugar só, lido
--     pelas duas RPCs e pelas duas policies.
--
--  3. `set_public_link_pin` DAVA SUCESSO SEM GRAVAR. Fazia um UPDATE sem olhar
--     se alguma linha casou: com um `p_link_id` inexistente devolvia void e a
--     tela dizia "PIN gerado" para um PIN que não existe em lugar nenhum. E com
--     PIN nulo/vazio ZERAVA o `pin_hash`, reabrindo o link ao público — a tela
--     nunca chamava assim, mas a RPC estava exposta a qualquer diretor. Recusar
--     na RPC não bastava: `authenticated` tem UPDATE na tabela e a policy é por
--     LINHA, então o dono do link reabria o mesmo buraco por um PATCH direto no
--     PostgREST. Quem fecha as COLUNAS (PIN, validade, slug) é o gatilho da
--     seção 5b.
--
--  4. PIN NÃO NUMÉRICO ERA ACEITO E TRANCAVA TODO MUNDO. As duas telas públicas
--     filtram o campo com `replace(/\D/g,'')`: um PIN com letra, gravado por
--     chamada direta, NUNCA poderia ser digitado — o link ficava inacessível
--     sem nenhum erro. O servidor passa a exigir 6 a 10 dígitos, que é
--     exatamente o que a tela sabe gerar e o gerente sabe digitar.
--
--  5. METAS LITERAIS NA TELA DO DIÁRIO. `funnel_targets` tem meta por equipe
--     (12/45/55 e 11/42/52 na homologação) e por diretor (11,5/43/53), e o
--     Diário cobrava 10/40/50 fixos no código enquanto a diretoria cobrava a
--     meta do diretor. O mesmo número era medido por duas réguas. As duas RPCs
--     passam a devolver a meta vigente com o ESCOPO de onde ela veio, e a
--     precedência é uma só: equipe > diretor > global.
--
--  6. ENUMERAÇÃO DE SLUG NA DIRETORIA. `public_director_checkpoint` (0039)
--     respondia `{pin_required:true}` para slug existente e `null` para slug
--     inexistente — de fora, isso é um oráculo que confirma quais links existem,
--     e confirmar o slug é entregar metade do segredo (0033). A resposta passa a
--     ser igual nos DOIS estados, não só no primeiro: SEM PIN os dois pedem PIN,
--     COM PIN os dois recusam em NULL. Uniformizar só o caso sem PIN mudava o
--     oráculo de porta — bastava mandar um PIN qualquer para separar
--     `{pin_required:true}` (slug morto) de `null` (slug vivo, PIN errado), e a
--     varredura ainda saía de graça, porque slug inexistente nunca incrementa
--     `failed_attempts`.
--
--  7. SUPERFÍCIE ANÔNIMA SEM TETO. `public_daily_submit` percorria
--     `jsonb_array_elements(p_entries)` sem limite de tamanho e casteava
--     `(...)::uuid` / `::numeric` direto: um POST anônimo com dezenas de
--     milhares de elementos rodava o laço inteiro, e um jsonb malformado
--     estourava 22P02/22003 cru em vez da recusa em NULL que o resto do
--     contrato promete.
--
-- Mais duas correções de leitura, na mesma passada:
--
--  · O total do mês da equipe somava corretor que saiu e a lista por corretor só
--    mostrava o roster ativo: duas somas diferentes na mesma tela, sem aviso.
--    `public_daily_team` passa a devolver no roster também quem saiu MAS
--    lançou no mês, marcado `active:false` — as duas somas voltam a fechar.
--  · O acumulado do mês da diretoria filtrava `t.active`: desativar uma equipe
--    apagava retroativamente o que ela produziu. O mês é histórico e passa a
--    somar todas as equipes do diretor, com a contagem de quantas já foram
--    desativadas.
--
-- E uma regra de cobrança: sábado, domingo e HOJE saem das pendências. Ninguém
-- lança checkpoint no fim de semana e o dia corrente ainda está aberto para
-- preencher; uma lista que sempre acusa deixa de ser lida. A régua é a mesma
-- nas duas telas — sai daqui (`missing_days`) e o Diário público repete o mesmo
-- filtro no cliente (`monthMissingDays`).
--
-- O que NÃO muda: a superfície anônima continua sendo EXATAMENTE três RPCs
-- (`tests/06_anon_surface.sql` é o tripwire); a recusa continua sendo NULL e
-- nunca exceção (0034), para não desfazer o contador do lockout; as assinaturas
-- e os grants das três seguem iguais; link já existente continua valendo com o
-- slug e o PIN que tem hoje.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quando o PIN foi trocado
--
-- Não existia rastro nenhum de rotação: o admin não sabia se o PIN de um link é
-- de ontem ou de julho. Uma coluna basta — histórico completo seria uma tabela
-- para uma pergunta que ninguém faz ainda.
-- -----------------------------------------------------------------------------
alter table public.public_links
  add column if not exists pin_set_at timestamptz;

comment on column public.public_links.pin_set_at is
  'Quando o PIN atual foi gravado. Null = PIN anterior à 0062 (ou link sem PIN).';

-- A tela de administração só precisa saber SE existe PIN (para escrever "Gerar"
-- ou "Renovar" no botão e para acusar link aberto), e pedia `select *` — o
-- bcrypt do PIN chegava ao navegador de todo admin e diretor. Com a coluna
-- calculada, a consulta pede colunas nomeadas e o hash não sai do servidor. O
-- grant de tabela é por papel, não por coluna: isto é a tela deixando de pedir,
-- somada à policy de dono acima, não uma barreira sozinha.
alter table public.public_links
  add column if not exists has_pin boolean
  generated always as (pin_hash is not null) stored;

comment on column public.public_links.has_pin is
  'Espelho de `pin_hash is not null`, para a tela não precisar ler o hash.';

-- -----------------------------------------------------------------------------
-- 2. Dono do link — a regra que faltava
--
-- `admin` administra tudo. `director` administra o PRÓPRIO link de diretoria e
-- os links das equipes que estão sob ele (`teams.director_id`). Equipe sem
-- diretor definido só o admin resolve — é o mesmo buraco que a tela "Nova
-- equipe" abria ao inserir só nome e slug, e que ela passa a fechar pedindo o
-- diretor.
--
-- SECURITY DEFINER porque lê `teams` para decidir, e a policy de `teams` não é
-- assunto de quem administra link. STABLE: é consultada por linha na policy.
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_public_link(
  p_team_id     uuid,
  p_director_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or (
        public.has_any_role('director')
        and (
          (p_director_id is not null and p_director_id = auth.uid())
          or (p_team_id is not null and exists (
                select 1 from public.teams t
                where t.id = p_team_id and t.director_id = auth.uid()
              ))
        )
      );
$$;

comment on function public.can_manage_public_link(uuid, uuid) is
  'Dono do link público: admin sempre; diretor só o próprio link e as equipes sob ele.';

revoke all on function public.can_manage_public_link(uuid, uuid) from public, anon;
grant execute on function public.can_manage_public_link(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Criação de link: nasce com dono conferido, PIN numérico e validade
-- -----------------------------------------------------------------------------
create or replace function public.create_public_link(
  p_kind        text,
  p_pin         text,
  p_team_id     uuid default null,
  p_director_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text := replace(gen_random_uuid()::text, '-', '');
  v_id   uuid;
  v_pin  text := btrim(p_pin);
begin
  if not public.has_any_role('admin','director') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  if p_kind not in ('daily_team','director_checkpoint') then
    raise exception 'Tipo de link inválido: %', p_kind using errcode = '22023';
  end if;

  -- A regra que dá nome à 0033. Vale para os dois tipos: o link de equipe
  -- expõe a escala e os números do dia, o de diretoria expõe a operação inteira.
  if v_pin is null or v_pin = '' then
    raise exception 'Link público exige PIN.' using errcode = '22023';
  end if;

  -- 6 dígitos é o que a tela gera; abaixo disso o lockout não compensa.
  if length(v_pin) < 6 then
    raise exception 'PIN precisa de ao menos 6 caracteres.' using errcode = '22023';
  end if;

  -- Só dígitos, no comprimento que o campo público aceita (`maxLength={10}` e
  -- `replace(/\D/g,'')` nas duas telas). Um PIN com letra seria gravado, e
  -- depois seria impossível de digitar: o link ficaria fechado para sempre sem
  -- nenhuma mensagem de erro.
  if v_pin !~ '^[0-9]{6,10}$' then
    raise exception 'PIN deve ter de 6 a 10 dígitos numéricos.' using errcode = '22023';
  end if;

  -- Link sem dono não resolve nada: `public_daily_team` não acha a equipe e
  -- `public_director_checkpoint` não acha o diretor. Recusar na criação é mais
  -- barato que descobrir na tela pública.
  if p_kind = 'daily_team' and p_team_id is null then
    raise exception 'Link de diário exige a equipe.' using errcode = '22023';
  end if;
  if p_kind = 'director_checkpoint' and p_director_id is null then
    raise exception 'Link de diretoria exige o diretor.' using errcode = '22023';
  end if;

  if not public.can_manage_public_link(p_team_id, p_director_id) then
    raise exception 'Sem permissão para administrar este link.' using errcode = '42501';
  end if;

  -- Dono já tem link ativo? Troca o PIN dele em vez de criar um segundo.
  -- `public_links` não tem unicidade por (kind, dono) — dois cliques rápidos no
  -- botão "Criar link" deixariam duas URLs válidas, e a tela só mostra uma.
  select id into v_id
  from public.public_links
  where kind = p_kind
    and active
    and ((p_kind = 'daily_team'          and team_id     = p_team_id)
      or (p_kind = 'director_checkpoint' and director_id = p_director_id))
  order by created_at desc
  limit 1;

  if v_id is not null then
    update public.public_links
       set pin_hash        = extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
           pin_set_at      = now(),
           failed_attempts = 0,
           locked_until    = null,
           -- Vencido volta a valer; ainda válido não perde o prazo que tem. Sem
           -- isto, "Criar link" num link vencido devolvia sucesso e o gerente
           -- continuava recusado pelas três RPCs.
           expires_at      = case
             when expires_at is null or expires_at <= now() then now() + interval '90 days'
             else expires_at
           end
     where id = v_id
    returning slug into v_slug;
  else
    insert into public.public_links (
      kind, team_id, director_id, slug, pin_hash, pin_set_at,
      active, expires_at, created_by
    )
    values (
      p_kind,
      p_team_id,
      p_director_id,
      v_slug,
      extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
      now(),
      true,
      -- Validade obrigatória: link público sem prazo e sem revogação nunca
      -- fecha depois de vazar. 90 dias com renovação de um clique na tela.
      now() + interval '90 days',
      auth.uid()
    )
    returning id into v_id;
  end if;

  -- O PIN em claro não volta: quem chamou já o tem, e devolver seria convite
  -- para ele aparecer em log de rede.
  return jsonb_build_object(
    'id',   v_id,
    'slug', v_slug,
    'expires_at', (select expires_at from public.public_links where id = v_id)
  );
end;
$$;

comment on function public.create_public_link(text, text, uuid, uuid) is
  'Único caminho de criação de link público: slug sorteado, PIN numérico obrigatório, validade de 90 dias e dono conferido.';

revoke all on function public.create_public_link(text, text, uuid, uuid) from public, anon;
grant execute on function public.create_public_link(text, text, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Troca de PIN: confere dono, confere que gravou, e não reabre o link
-- -----------------------------------------------------------------------------
create or replace function public.set_public_link_pin(p_link_id uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.public_links;
  v_pin  text := btrim(p_pin);
begin
  if not public.has_any_role('admin','director') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  -- Era um UPDATE cego: id inexistente devolvia void, e a tela comemorava
  -- "PIN gerado" para um PIN que não foi gravado em lugar nenhum.
  select * into v_link from public.public_links where id = p_link_id;
  if not found then
    raise exception 'Link público não encontrado.' using errcode = 'P0002';
  end if;

  if not public.can_manage_public_link(v_link.team_id, v_link.director_id) then
    raise exception 'Sem permissão para administrar este link.' using errcode = '42501';
  end if;

  -- PIN vazio ZERAVA o hash e reabria o link ao público. Quem quer fechar o
  -- link o desativa (`active = false`); tirar o PIN nunca foi um caso de uso.
  -- A recusa aqui fecha só a RPC — o UPDATE direto pelo PostgREST é fechado
  -- pelo gatilho da seção 5b, que é o que torna a promessa verdadeira.
  if v_pin is null or v_pin = '' then
    raise exception 'PIN é obrigatório. Para fechar o link, desative-o.' using errcode = '22023';
  end if;

  if length(v_pin) < 6 then
    raise exception 'PIN precisa de ao menos 6 caracteres.' using errcode = '22023';
  end if;

  if v_pin !~ '^[0-9]{6,10}$' then
    raise exception 'PIN deve ter de 6 a 10 dígitos numéricos.' using errcode = '22023';
  end if;

  update public.public_links
     set pin_hash        = extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
         pin_set_at      = now(),
         -- PIN novo destrava o link (0033): trocar o segredo é o que torna as
         -- tentativas anteriores irrelevantes.
         failed_attempts = 0,
         locked_until    = null,
         expires_at      = case
           when expires_at is null or expires_at <= now() then now() + interval '90 days'
           else expires_at
         end
   where id = p_link_id;
end;
$$;

comment on function public.set_public_link_pin(uuid, text) is
  'Troca o PIN de um link público. Confere dono, exige 6-10 dígitos, destrava o lockout e revalida link vencido.';

-- -----------------------------------------------------------------------------
-- 5. Policies por dono — nos TRÊS verbos, não em dois
--
-- A criação já sai por RPC (0033: sem policy de insert, ninguém insere). Select,
-- update e delete continuavam globais para admin/diretor — um diretor apagava o
-- link público de outro e, na LEITURA, baixava para o navegador dele o `slug` e
-- o `pin_hash` do link de todas as equipes da empresa. O slug é, pela 0033,
-- metade do segredo, e bcrypt de custo 10 sobre 10^6 PINs é quebrável offline:
-- deixar só o update e o delete por dono seria trancar a porta e deixar a
-- janela aberta, ainda mais agora que o item 10 abre esta tela para o diretor.
-- Mesma função das RPCs, para que "quem administra" seja uma resposta só.
-- -----------------------------------------------------------------------------
drop policy if exists public_links_select on public.public_links;
create policy public_links_select on public.public_links
  for select to authenticated
  using (public.can_manage_public_link(team_id, director_id));

drop policy if exists public_links_update on public.public_links;
create policy public_links_update on public.public_links
  for update to authenticated
  using (public.can_manage_public_link(team_id, director_id))
  with check (public.can_manage_public_link(team_id, director_id));

drop policy if exists public_links_delete on public.public_links;
create policy public_links_delete on public.public_links
  for delete to authenticated
  using (public.can_manage_public_link(team_id, director_id));

-- -----------------------------------------------------------------------------
-- 5b. O que a policy de LINHA não protege: a COLUNA
--
-- A seção 4 fecha o "PIN vazio reabre o link" só na RPC, e o caminho continuava
-- aberto pelo PostgREST: `authenticated` tem UPDATE na tabela inteira (grant
-- uniforme da 0023) e a policy acima decide por linha, não por coluna. O DONO do
-- link — o diretor no link dele, o admin em qualquer um — podia mandar
-- `PATCH /rest/v1/public_links?id=eq.<id>` com `{"pin_hash": null}` e reabrir ao
-- público o link que a RPC recusa reabrir, ou com `{"expires_at": null}` e
-- apagar a validade de 90 dias que é o item 1 desta migration.
--
-- Gatilho e não `revoke update (...)`: a tela renova a validade com um PATCH
-- legítimo em `expires_at` (é o botão "Renovar validade"), e revogar a coluna
-- mataria o botão junto com o buraco. O gatilho recusa só o que nunca é caso de
-- uso — zerar o PIN, tornar o link eterno de novo, trocar o slug sorteado — e
-- deixa passar a renovação, a desativação e o destravamento.
--
-- Vale para toda origem, inclusive as RPCs SECURITY DEFINER desta migration:
-- nenhuma delas grava `pin_hash` nulo, `expires_at` nulo ou slug novo.
-- -----------------------------------------------------------------------------
-- Sem SECURITY DEFINER (ao contrário dos guards da 0061): este não lê tabela
-- nem chama `is_admin()` — compara `old` com `new` e recusa. A regra vale para
-- todo mundo justamente por não depender de quem chamou.
create or replace function public.public_links_guard_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.pin_hash is not null and new.pin_hash is null then
    raise exception 'O PIN não pode ser removido. Para fechar o link, desative-o.'
      using errcode = '22023';
  end if;

  if old.expires_at is not null and new.expires_at is null then
    raise exception 'Link público não volta a ser eterno: renove a validade ou desative o link.'
      using errcode = '22023';
  end if;

  -- O slug é sorteado na criação (0033) e é metade do segredo: trocá-lo por um
  -- valor escolhido derruba a URL já entregue e devolve o slug adivinhável.
  if new.slug is distinct from old.slug then
    raise exception 'O slug é sorteado na criação e não muda. Desative o link e crie outro.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.public_links_guard_columns() is
  'Colunas que nenhum UPDATE pode mexer: zerar o PIN, apagar a validade ou trocar o slug de um link público.';

drop trigger if exists public_links_guard_columns on public.public_links;
create trigger public_links_guard_columns
  before update on public.public_links
  for each row execute function public.public_links_guard_columns();

-- -----------------------------------------------------------------------------
-- 6. Métrica do Diário lida da fronteira anônima
--
-- `(v_entry ->> 'leads')::numeric` estourava 22P02 para "abc" e 22003 para um
-- número gigante — exceção crua num contrato que promete recusa em NULL. Aqui a
-- leitura é total: o que não for número vira 0, e o teto é o mesmo da tela.
--
-- NÃO arredonda para o passo de 0,5 de propósito: a 0038 decidiu que fora do
-- passo o cliente vê "fora do valor permitido" (23514) em vez de um
-- arredondamento silencioso, e essa decisão continua valendo.
-- -----------------------------------------------------------------------------
create or replace function private.daily_metric(p_entry jsonb, p_key text)
returns numeric
language sql
immutable
as $$
  select case
    when p_entry ->> p_key ~ '^[0-9]+(\.[0-9]+)?$'
      then least((p_entry ->> p_key)::numeric, 9999)
    else 0
  end;
$$;

comment on function private.daily_metric(jsonb, text) is
  'Lê uma métrica do lançamento anônimo do Diário: não-número vira 0, teto 9999. Evita 22P02/22003 crus na superfície pública.';

revoke all on function private.daily_metric(jsonb, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Lançamento: teto de tamanho e jsonb malformado viram recusa, não exceção
-- -----------------------------------------------------------------------------
create or replace function public.public_daily_submit(
  p_slug      text,
  p_pin       text,
  p_entries   jsonb,
  p_notes     text default null,
  p_filled_by text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link      public.public_links;
  v_report_id uuid;
  v_entry     jsonb;
  v_profile   text;
  v_count     int := 0;
  -- Fronteira anônima: corta espaço e tamanho antes de gravar. Vazio vira NULL.
  v_notes     text := nullif(left(btrim(p_notes), 2000), '');
  v_filled_by text := nullif(left(btrim(p_filled_by), 120), '');
begin
  v_link := private.resolve_public_link(p_slug, p_pin);

  -- Recusa é NULL, nunca exceção (0034): exceção faria rollback do contador do
  -- lockout que o resolvedor acabou de gravar.
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  -- Teto do laço. A tela manda exatamente uma linha por corretor da escala, e
  -- nenhuma equipe real chega perto de 200 — quem bate neste limite é um POST
  -- direto. Recusa em NULL para não abrir um caso novo no contrato.
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 200 then
    return null;
  end if;

  -- O formulário é o estado inteiro do dia: reenviar sem notas limpa as notas.
  insert into public.daily_reports (team_id, report_date, submitted_at, notes, filled_by_name)
  values (v_link.team_id, current_date, now(), v_notes, v_filled_by)
  on conflict (team_id, report_date) do update
    set submitted_at   = now(),
        notes          = excluded.notes,
        filled_by_name = excluded.filled_by_name
  returning id into v_report_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_profile := coalesce(v_entry ->> 'profile_id', '');

    -- `::uuid` de um texto qualquer estourava 22P02 cru. Malformado é linha
    -- ignorada, o mesmo tratamento de corretor que não é da equipe.
    if v_profile !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      continue;
    end if;

    -- Só aceita corretor que realmente pertence à equipe deste link.
    if not exists (
      select 1 from public.team_members tm
      where tm.team_id = v_link.team_id
        and tm.profile_id = v_profile::uuid
        and tm.left_at is null
    ) then
      continue;
    end if;

    insert into public.daily_entries (
      report_id, profile_id, leads, calls, doc_collections,
      visits_scheduled, visits_done, analyses_sent, analyses_approved, sales
    )
    values (
      v_report_id,
      v_profile::uuid,
      private.daily_metric(v_entry, 'leads'),
      private.daily_metric(v_entry, 'calls'),
      private.daily_metric(v_entry, 'doc_collections'),
      private.daily_metric(v_entry, 'visits_scheduled'),
      private.daily_metric(v_entry, 'visits_done'),
      private.daily_metric(v_entry, 'analyses_sent'),
      private.daily_metric(v_entry, 'analyses_approved'),
      private.daily_metric(v_entry, 'sales')
    )
    on conflict (report_id, profile_id) do update set
      leads             = excluded.leads,
      calls             = excluded.calls,
      doc_collections   = excluded.doc_collections,
      visits_scheduled  = excluded.visits_scheduled,
      visits_done       = excluded.visits_done,
      analyses_sent     = excluded.analyses_sent,
      analyses_approved = excluded.analyses_approved,
      sales             = excluded.sales;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('report_id', v_report_id, 'saved', v_count);
end;
$$;

comment on function public.public_daily_submit(text, text, jsonb, text, text) is
  'Lançamento do Diário pelo link público, com notas, gerente, teto de 200 linhas e leitura tolerante do jsonb. Recusa devolve NULL (nunca exceção).';

grant execute on function public.public_daily_submit(text, text, jsonb, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Leitura do Diário: metas de verdade, validade do link e quem saiu no mês
-- -----------------------------------------------------------------------------
create or replace function public.public_daily_team(p_slug text, p_pin text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.public_links;
  v_out  jsonb;
begin
  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  select jsonb_build_object(
    'team_id',    t.id,
    'team_name',  t.name,
    'has_pin',    v_link.pin_hash is not null,
    -- Quem preenche precisa saber que o link vence, e quando: link vencido cai
    -- na mesma recusa NULL de slug inexistente, sem explicação nenhuma.
    'expires_at', v_link.expires_at,
    -- O banco roda em UTC e `public_daily_submit` grava em `current_date`: a
    -- tela precisa saber qual chave de `month` é "hoje" para o banco.
    'today_date', current_date,
    -- Meta vigente com o escopo de onde veio. Precedência equipe > diretor >
    -- global, a mesma de `public_director_checkpoint` — antes a tela do Diário
    -- cobrava 10/40/50 literais enquanto a diretoria cobrava a meta do diretor.
    'targets', (
      select jsonb_build_object(
        'scope',                    ft.scope,
        'lead_to_analysis_pct',     ft.lead_to_analysis_pct,
        'analysis_to_approval_pct', ft.analysis_to_approval_pct,
        'approval_to_sale_pct',     ft.approval_to_sale_pct
      )
      from public.funnel_targets ft
      where ft.effective_from <= current_date
        and (
             (ft.scope = 'team'     and ft.team_id     = t.id)
          or (ft.scope = 'director' and ft.director_id = t.director_id)
          or  ft.scope = 'global'
        )
      order by case ft.scope when 'team' then 0 when 'director' then 1 else 2 end,
               ft.effective_from desc
      limit 1
    ),
    -- Escala. Quem saiu (ou teve o perfil desativado) entra marcado
    -- `active:false` SE lançou alguma coisa no mês: sem isso o total do mês
    -- somava a produção dele e a lista por corretor não o mostrava — duas somas
    -- diferentes na mesma tela, sem aviso nenhum.
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', s.id,
               'full_name',  s.full_name,
               'active',     s.is_active
             ) order by s.is_active desc, s.full_name)
      from (
        -- `group by` porque um corretor pode ter mais de uma passagem pela
        -- mesma equipe (saiu e voltou): sem isso ele apareceria duas vezes.
        select p.id, p.full_name,
               bool_or(tm.left_at is null) and p.status = 'active' as is_active
        from public.team_members tm
        join public.profiles p on p.id = tm.profile_id
        where tm.team_id = t.id
        group by p.id, p.full_name, p.status
      ) s
      where s.is_active
         or exists (
              select 1
              from public.daily_entries e
              join public.daily_reports r on r.id = e.report_id
              where r.team_id = t.id
                and r.report_date >= date_trunc('month', current_date)::date
                and r.report_date <= current_date
                and e.profile_id = s.id
            )
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id',        e.profile_id,
               'leads',             e.leads,
               'calls',             e.calls,
               'doc_collections',   e.doc_collections,
               'visits_scheduled',  e.visits_scheduled,
               'visits_done',       e.visits_done,
               'analyses_sent',     e.analyses_sent,
               'analyses_approved', e.analyses_approved,
               'sales',             e.sales
             ))
      from public.daily_entries e
      join public.daily_reports r on r.id = e.report_id
      where r.team_id = t.id and r.report_date = current_date
    ), '[]'::jsonb),
    'month', coalesce((
      select jsonb_object_agg(
               r.report_date::text,
               jsonb_build_object(
                 'filled_by', r.filled_by_name,
                 'notes',     r.notes,
                 'entries', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'profile_id',        e.profile_id,
                            'leads',             e.leads,
                            'calls',             e.calls,
                            'doc_collections',   e.doc_collections,
                            'visits_scheduled',  e.visits_scheduled,
                            'visits_done',       e.visits_done,
                            'analyses_sent',     e.analyses_sent,
                            'analyses_approved', e.analyses_approved,
                            'sales',             e.sales
                          ))
                   from public.daily_entries e
                   where e.report_id = r.id
                 ), '[]'::jsonb)
               ))
      from public.daily_reports r
      where r.team_id = t.id
        and r.report_date >= date_trunc('month', current_date)::date
        and r.report_date <= current_date
    ), '{}'::jsonb)
  )
  into v_out
  from public.teams t
  where t.id = v_link.team_id;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

comment on function public.public_daily_team(text, text) is
  'Equipe, escala (com quem saiu mas lançou no mês), meta vigente, validade do link, checkpoint de hoje e o mês dia a dia. NULL em qualquer recusa.';

grant execute on function public.public_daily_team(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Checkpoint da diretoria: recusa uniforme, meta por equipe e mês completo
-- -----------------------------------------------------------------------------
create or replace function public.public_director_checkpoint(
  p_slug       text,
  p_week_start date default null,
  p_pin        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate   public.public_links;
  v_link        public.public_links;
  v_start       date;
  v_end         date;
  v_month_start date;
  v_month_end   date;
  v_out         jsonb;
begin
  select * into v_candidate
  from public.public_links
  where slug = p_slug
    and kind = 'director_checkpoint'
    and active
    and (expires_at is null or expires_at > now());

  -- Slug desconhecido (ou inativo, ou vencido) responde IGUAL a slug conhecido
  -- e vivo, nos DOIS estados — senão a uniformização só troca de porta:
  --
  --   sem PIN   → os dois devolvem `{pin_required:true}`;
  --   com PIN   → os dois devolvem `null`, a recusa padrão do contrato (0034).
  --
  -- Responder `{pin_required:true}` a um PIN enviado era o oráculo de novo: com
  -- um chute qualquer no campo, `{pin_required:true}` significava "slug não
  -- existe" e `null` significava "slug existe e está vivo, PIN errado". E
  -- enumerar assim não custava nada, porque slug inexistente não passa por
  -- `private.resolve_public_link` e portanto nunca conta tentativa nem trava.
  if not found then
    if p_pin is null or btrim(p_pin) = '' then
      return jsonb_build_object('pin_required', true);
    end if;
    return null;
  end if;

  if v_candidate.pin_hash is not null and (p_pin is null or btrim(p_pin) = '') then
    return jsonb_build_object('pin_required', true);
  end if;

  v_link := private.resolve_public_link(p_slug, p_pin);
  if v_link.id is null or v_link.kind <> 'director_checkpoint' then
    return null;
  end if;

  v_start := coalesce(p_week_start, date_trunc('week', current_date)::date);
  v_end   := v_start + 6;

  -- O mês acompanha a semana navegada. Semana futura: intervalo vazio, zeros.
  v_month_start := date_trunc('month', v_start)::date;
  v_month_end   := least((v_month_start + interval '1 month')::date - 1, current_date);

  select jsonb_build_object(
    'director',   (select p.full_name from public.profiles p where p.id = v_link.director_id),
    'week_start', v_start,
    'week_end',   v_end,
    'targets', (
      select jsonb_build_object(
        'scope',                    ft.scope,
        'lead_to_analysis_pct',     ft.lead_to_analysis_pct,
        'analysis_to_approval_pct', ft.analysis_to_approval_pct,
        'approval_to_sale_pct',     ft.approval_to_sale_pct
      )
      from public.funnel_targets ft
      where ft.effective_from <= current_date
        and ((ft.scope = 'director' and ft.director_id = v_link.director_id)
          or  ft.scope = 'global')
      order by (ft.scope = 'director') desc, ft.effective_from desc
      limit 1
    ),
    'month', jsonb_build_object(
      'start', v_month_start,
      'end',   v_month_end,
      -- Sem `t.active`: desativar uma equipe no meio do mês apagava
      -- retroativamente o que ela produziu. O mês é histórico.
      'inactive_teams', (
        select count(*)
        from public.teams t2
        where t2.director_id = v_link.director_id
          and not t2.active
          and exists (
            select 1 from public.daily_reports r2
            where r2.team_id = t2.id
              and r2.report_date between v_month_start and v_month_end
          )
      ),
      'totals', (
        select jsonb_build_object(
          'leads',             coalesce(sum(e.leads), 0),
          'calls',             coalesce(sum(e.calls), 0),
          'doc_collections',   coalesce(sum(e.doc_collections), 0),
          'visits_scheduled',  coalesce(sum(e.visits_scheduled), 0),
          'visits_done',       coalesce(sum(e.visits_done), 0),
          'analyses_sent',     coalesce(sum(e.analyses_sent), 0),
          'analyses_approved', coalesce(sum(e.analyses_approved), 0),
          'sales',             coalesce(sum(e.sales), 0)
        )
        from public.teams t
        join public.daily_reports r
          on r.team_id = t.id and r.report_date between v_month_start and v_month_end
        join public.daily_entries e on e.report_id = r.id
        where t.director_id = v_link.director_id
      )
    ),
    'teams', coalesce((
      select jsonb_agg(team_block order by team_name)
      from (
        select
          t.name as team_name,
          jsonb_build_object(
            'team_id',      t.id,
            'team_name',    t.name,
            'manager_name', (select p.full_name from public.profiles p where p.id = t.manager_id),
            -- Meta DA EQUIPE quando existir. `funnel_targets.team_id` está no
            -- banco e populado desde o seed, e não era lido por ninguém: a tela
            -- media todas as equipes do diretor com a mesma régua.
            'targets', (
              select jsonb_build_object(
                'scope',                    ft.scope,
                'lead_to_analysis_pct',     ft.lead_to_analysis_pct,
                'analysis_to_approval_pct', ft.analysis_to_approval_pct,
                'approval_to_sale_pct',     ft.approval_to_sale_pct
              )
              from public.funnel_targets ft
              where ft.effective_from <= current_date
                and (
                     (ft.scope = 'team'     and ft.team_id     = t.id)
                  or (ft.scope = 'director' and ft.director_id = v_link.director_id)
                  or  ft.scope = 'global'
                )
              order by case ft.scope when 'team' then 0 when 'director' then 1 else 2 end,
                       ft.effective_from desc
              limit 1
            ),
            'daily_slug', (
              select pl.slug
              from public.public_links pl
              where pl.kind = 'daily_team'
                and pl.team_id = t.id
                and pl.active
                and (pl.expires_at is null or pl.expires_at > now())
              order by pl.created_at desc
              limit 1
            ),
            'totals', jsonb_build_object(
              'leads',             coalesce(sum(e.leads), 0),
              'calls',             coalesce(sum(e.calls), 0),
              'doc_collections',   coalesce(sum(e.doc_collections), 0),
              'visits_scheduled',  coalesce(sum(e.visits_scheduled), 0),
              'visits_done',       coalesce(sum(e.visits_done), 0),
              'analyses_sent',     coalesce(sum(e.analyses_sent), 0),
              'analyses_approved', coalesce(sum(e.analyses_approved), 0),
              'sales',             coalesce(sum(e.sales), 0)
            ),
            'missing_days', (
              select coalesce(jsonb_agg(d::date order by d), '[]'::jsonb)
              -- `current_date - 1`: HOJE não é pendência, ainda está aberto
              -- para preencher. Com `current_date` a reunião de segunda às 8h
              -- acusava todas as equipes de não ter lançado um dia que nem
              -- acabou. É a mesma régua do Diário (`monthMissingDays`, que
              -- filtra `iso < todayStr`) — duas telas cobrando o mesmo dia com
              -- réguas diferentes é o defeito, não a solução.
              from generate_series(v_start, least(v_end, current_date - 1), interval '1 day') d
              -- Sábado e domingo fora: ninguém lança checkpoint no fim de
              -- semana, e uma cobrança que sempre acusa deixa de ser lida.
              where extract(isodow from d) < 6
                and not exists (
                  select 1 from public.daily_reports r2
                  where r2.team_id = t.id and r2.report_date = d::date
                )
            )
          ) as team_block
        from public.teams t
        left join public.daily_reports r
          on r.team_id = t.id and r.report_date between v_start and v_end
        left join public.daily_entries e on e.report_id = r.id
        where t.director_id = v_link.director_id and t.active
        group by t.id, t.name, t.manager_id
      ) s
    ), '[]'::jsonb)
  ) into v_out;

  update public.public_links set last_seen_at = now() where id = v_link.id;

  return v_out;
end;
$$;

comment on function public.public_director_checkpoint(text, date, text) is
  'Funil da semana por equipe (com gerente, meta da equipe e link do Diário), pendências em dia útil e acumulado do mês de todas as equipes do diretor. Slug desconhecido responde igual a slug conhecido: pede PIN quando não veio PIN, recusa em NULL quando veio.';

grant execute on function public.public_director_checkpoint(text, date, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. O diretor administra os próprios links
--
-- A policy de `public_links` e a `create_public_link` sempre aceitaram diretor;
-- só a rota barrava. Agora que o dono é conferido no banco, liberar a tela não
-- amplia nada: o diretor vê e mexe apenas no que já podia.
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed)
values ('director', 'menu.admin_daily_teams', true)
on conflict (role, permission) do update set allowed = true;

-- -----------------------------------------------------------------------------
-- 11. Aviso de vencimento
--
-- A checagem de validade é feita na leitura (as três RPCs), que é o lugar certo
-- — um job que "expira" seria uma segunda fonte de verdade. O que faltava era
-- AVISAR: hoje o link simplesmente para de abrir e o gerente liga reclamando.
--
-- Notifica quem administra o link (admins e o diretor dono) uma vez por link,
-- na janela dos 7 dias antes do vencimento. Idempotente pelo `not exists`: o
-- job roda todo dia e não repete o aviso do mesmo link.
-- -----------------------------------------------------------------------------
create or replace function public.notify_expiring_public_links()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select
    dest.profile_id,
    'public_link_expiring',
    'Link público vence em breve',
    format('O link %s (%s) vence em %s. Renove a validade em Admin · Diário.',
           pl.slug,
           coalesce(t.name, p.full_name, 'sem dono'),
           to_char(pl.expires_at, 'DD/MM/YYYY')),
    '/admin/daily-teams',
    'in_app'
  from public.public_links pl
  left join public.teams    t on t.id = pl.team_id
  left join public.profiles p on p.id = pl.director_id
  cross join lateral (
    select ur.profile_id from public.user_roles ur where ur.role = 'admin'
    union
    select pl.director_id where pl.director_id is not null
    union
    select t.director_id  where t.director_id  is not null
  ) dest(profile_id)
  where pl.active
    and pl.expires_at is not null
    and pl.expires_at > now()
    and pl.expires_at <= now() + interval '7 days'
    and dest.profile_id is not null
    and exists (select 1 from public.profiles pr where pr.id = dest.profile_id)
    and not exists (
      select 1 from public.notifications n
      where n.profile_id = dest.profile_id
        and n.kind = 'public_link_expiring'
        and n.body like '%' || pl.slug || '%'
        and n.created_at > now() - interval '8 days'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_expiring_public_links() is
  'Avisa admin e diretor dono, uma vez por link, quando o link público vence em até 7 dias.';

revoke all on function public.notify_expiring_public_links() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'faceimob-public-link-expiry') then
    perform cron.unschedule('faceimob-public-link-expiry');
  end if;

  begin
    perform cron.schedule(
      'faceimob-public-link-expiry',
      '25 8 * * *',
      $cmd$select public.notify_expiring_public_links();$cmd$
    );
    raise notice '[0062] aviso de vencimento de link público agendado para 08:25.';
  exception
    when others then
      raise warning '[0062] não foi possível agendar o aviso de vencimento: %', sqlerrm;
  end;
end
$do$;
