-- =============================================================================
-- 0080 — Diário: a guarda anônima que parou de guardar, o PIN sem rastro e o
--        vencimento que ninguém avisa
--
-- Cinco achados da auditoria de 06/09 na MESMA superfície (o link público do
-- Diário e do checkpoint da diretoria). Todos corrigidos no ponto compartilhado:
--
--  1. O INVARIANTE DA SUPERFÍCIE ANÔNIMA ESTÁ FALSO NO BANCO. `tests/06` promete
--     "exatamente três RPCs executáveis por anon" e a homologação tem DEZ: as 3
--     mais `deal_documents_reopen_previous`, `deal_id_of_object`,
--     `deals_guard_value`, `distribution_groups_protect_general`,
--     `public_links_guard_columns`, `sdr_agents_no_handoff_cycle` e
--     `user_roles_guard_last_admin`. Seis são funções de gatilho (o PostgREST
--     não as expõe), mas `deal_id_of_object(text)` devolve uuid e É chamável por
--     POST /rest/v1/rpc/ sem sessão. O laço de revoke da 0019 alcançou só o que
--     existia em 08/08; as sete nasceram nas migrations 0059+ com o grant
--     `=X` (PUBLIC) que o Supabase dá por default. Nenhuma vaza dado hoje — o
--     problema é a guarda ter parado de guardar, e o tripwire não ter disparado
--     porque o harness SQL precisa de Docker e não roda contra o remoto.
--
--  2. `pin_hash` DEPENDIA SÓ DA RLS. `anon` e `authenticated` têm SELECT e
--     UPDATE de TABELA em `public_links` (grant uniforme da 0023), então o
--     bcrypt do PIN e o slug estavam a uma policy de distância do navegador —
--     e `anon` não tem policy nenhuma nessa tabela, ou seja, o grant existia
--     para nada. `anon` perde o grant aqui; para `authenticated` a separação
--     por COLUNA esbarra num invariante de outro teste (ver seção 2).
--
--  3. O GATILHO DE COLUNA NÃO OLHAVA O PIN NOVO. A 0062 fechou "zerar o PIN",
--     "apagar a validade" e "trocar o slug", mas um PATCH direto podia gravar
--     em `pin_hash` um PIN EM CLARO (que nenhuma tela sabe usar, porque as três
--     RPCs comparam com `crypt()`) e deixar `pin_set_at` mentindo. O formato de
--     6-10 dígitos e o carimbo só valiam pela RPC. E o gatilho era `before
--     update`: um INSERT direto (seed, script de suporte, E2E) entrava com o
--     PIN em claro sem esbarrar em nada.
--
--  4. O PIN NÃO TINHA RASTRO NENHUM. Ele aparece uma vez num toast e é copiado
--     para a área de transferência — correto, é o único jeito de não gravar o
--     segredo. Só que ninguém registra QUE ele foi trocado: o gerente do outro
--     lado descobre que o código mudou quando o link para de aceitar o antigo.
--     Aqui nasce o registro (nunca o segredo): trocou o PIN, o gerente e o
--     diretor da equipe recebem a notificação de que existe código novo.
--
--  5. O AVISO DE VENCIMENTO NÃO CHEGA A QUEM USA O LINK. `notify_expiring_
--     public_links` (0062) notifica admins e diretores — nunca o gerente, que é
--     exatamente quem abre o Diário todo dia. E mandava todo mundo para
--     `/admin/daily-teams`, rota que o gerente não tem permissão de abrir
--     (`menu.admin_daily_teams` é de admin e diretor): notificação que leva a
--     "acesso não liberado" é a versão em notificação do botão que o banco
--     recusa.
--
--  6. O ERRO DE ONTEM FICAVA CONGELADO. `public_daily_submit` não recebia data e
--     gravava sempre em `current_date`; a tela abria o dia anterior em leitura e
--     desligava o Salvar, e não existe tela de administração que edite daily
--     passado. A diretoria cobrava em cima de um número que ninguém conseguia
--     arrumar. Passa a existir uma janela de DOIS dias, pelo mesmo link e com o
--     mesmo lockout (seção 7).
--
-- Mais duas correções de leitura, na mesma passada:
--
--  · O CHECKPOINT DA DIRETORIA NÃO DIZIA QUANDO O LINK VENCE. Só o Diário da
--    equipe avisa; o diretor descobria pelo mesmo "PIN incorreto" de sempre.
--    A RPC passa a devolver `expires_at`, como `public_daily_team` já fazia.
--
--  · DUAS DEFINIÇÕES DE "DIA PREENCHIDO". A pendência da diretoria olhava só se
--    existe linha em `daily_reports`; um relatório SEM NENHUMA ENTRADA (é o que
--    sobra quando o envio não casa nenhum corretor da equipe) limpava a
--    cobrança sem ter registrado nada. Passa a valer a régua do dia com
--    lançamento: dia preenchido é dia com pelo menos uma linha em
--    `daily_entries`. O Diário público aplica a MESMA régua no cliente.
--
-- O que NÃO muda: a superfície anônima continua sendo exatamente três RPCs pelo
-- NOME (`public_daily_team`, `public_daily_submit`, `public_director_checkpoint`
-- — nenhuma quarta função ganha EXECUTE para `anon`); a recusa de acesso
-- continua sendo NULL e nunca exceção (0034), para não desfazer o contador do
-- lockout; e a assinatura de 5 argumentos de `public_daily_submit` segue viva,
-- com o mesmo comportamento, ao lado da de 6 que recebe a data (seção 7).
--
-- Idempotente: laços por catálogo, `create or replace`, `drop trigger if
-- exists` e grants que podem ser reemitidos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A superfície anônima volta a ser exatamente três RPCs
--
-- Mesmo laço da 0019, repetido: ele revoga o grant `=X` (PUBLIC) que alcança
-- `anon` por herança. `authenticated` NÃO é tocado — as sete funções têm grant
-- próprio (`authenticated=X`), e função de gatilho não precisa de EXECUTE para
-- disparar (o privilégio é conferido na criação do trigger, não a cada linha).
--
-- ponytail: laço em vez de `event trigger` no `ddl_command_end`. O trigger seria
-- a guarda permanente, mas exige superusuário — `postgres` na Supabase não é — e
-- ainda revogaria `anon` de um `create or replace` das próprias três RPCs se uma
-- migration futura esquecesse de reemitir o grant. Evoluir quando o projeto
-- tiver um papel com superusuário OU quando o harness SQL passar a rodar contra
-- o remoto em todo deploy (hoje `tests/06` só roda com Docker local, que é por
-- isso que o tripwire ficou 30 dias sem disparar).
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in
        ('public_daily_team', 'public_daily_submit', 'public_director_checkpoint')
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
  end loop;
end;
$$;

-- Reemitido: a 0019 já o tinha feito, e é ele que faz a função NOVA nascer sem
-- EXECUTE para anon. Vale por papel criador, então repetir aqui não custa nada
-- e cobre o caso de o registro ter sido perdido num reset.
alter default privileges in schema public revoke execute on functions from public, anon;

-- -----------------------------------------------------------------------------
-- 2. `anon` sai de `public_links`
--
-- Não existe UMA policy de `public_links` para `anon` — a 0062 escreveu as três
-- `to authenticated` —, então o grant de tabela do Supabase estava lá sem
-- nenhum caminho de uso: só a RLS separava o bcrypt do PIN e o slug (que a 0033
-- trata como metade do segredo) de uma requisição sem sessão. As três RPCs
-- públicas são SECURITY DEFINER e não dependem do privilégio de quem chama, e é
-- por isso que tirar tudo de `anon` não fecha nada que funcione.
--
-- ponytail: `authenticated` fica com o grant de TABELA. Trocá-lo por grant de
-- COLUNA (que é o que tiraria `pin_hash` do alcance do PostgREST) reprova o
-- tripwire `tests/06_anon_surface.sql:106-111`, que exige `has_table_privilege
-- ('authenticated', <tabela>, 'SELECT'/'INSERT')` em TODA tabela de `public` —
-- é a regressão da 0023, "banco novo tem que abrir". Para o usuário logado a
-- separação continua sendo a RLS de dono (0062), a tela pedindo colunas
-- nomeadas sem `pin_hash`, e o gatilho da seção 3. Evoluir quando o dono do
-- `tests/06` abrir exceção para `public_links` (a pendência traz o diff).
-- -----------------------------------------------------------------------------
revoke all on table public.public_links from anon;

-- -----------------------------------------------------------------------------
-- 3. O gatilho passa a olhar o PIN novo — no UPDATE e no INSERT
--
-- Quem barra o PATCH de `pin_hash` vindo de `authenticated` é ESTE gatilho, não
-- a seção 2: lá o revoke é só de `anon`, e `authenticated` mantém o grant de
-- TABELA (ver a nota ponytail acima) com a policy `public_links_update`
-- liberando o dono. O gatilho é a única guarda que vale para todos os caminhos
-- — PostgREST, `service_role`, seed e script de suporte. Duas regras, as duas
-- sobre a MESMA linha:
--
--   · PIN novo tem que ser hash bcrypt. Gravar o PIN em claro aqui não "quase
--     funciona": as três RPCs comparam com `extensions.crypt()`, então o link
--     ficaria fechado para todo mundo, sem erro nenhum, até alguém reparar.
--   · `pin_set_at` acompanha o hash. Era escrito só pelas duas RPCs, e um
--     update por fora deixava a tela dizendo "trocado em <data antiga>" sobre
--     um PIN de hoje.
--
-- O gatilho passa a valer no INSERT também. Enquanto era `before update`
-- (0062), um INSERT direto com o PIN em claro entrava sem erro nenhum e
-- produzia exatamente o link fechado para todo mundo em silêncio que a regra
-- de cima existe para impedir — e insert direto é caminho de verdade: é o que
-- o seed e os E2E fazem. As duas regras de "não apague" (`old.<col> is not
-- null`) são falsas no INSERT e passam sozinhas; a do slug precisa do
-- `tg_op = 'UPDATE'`, porque em INSERT `old` é NULL e `new.slug is distinct
-- from null` recusaria toda criação de link.
-- -----------------------------------------------------------------------------
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
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception 'O slug é sorteado na criação e não muda. Desative o link e crie outro.'
      using errcode = '22023';
  end if;

  -- `new.pin_hash is not null` de guarda: link SEM PIN continua sendo um estado
  -- legítimo (0033), e sem esta condição o INSERT de um link aberto ganharia um
  -- `pin_set_at` de hoje sobre um PIN que não existe — a tela de administração
  -- diria "PIN trocado em <hoje>" para um link que nunca teve código.
  if new.pin_hash is not null
     and (tg_op = 'INSERT' or new.pin_hash is distinct from old.pin_hash) then
    -- `$2a$`, `$2b$` e `$2y$`: os prefixos que `gen_salt('bf')` produz e que
    -- `crypt()` sabe conferir. Qualquer outra coisa é PIN em claro.
    if new.pin_hash !~ '^\$2[aby]\$' then
      raise exception 'PIN precisa ser gravado como hash bcrypt — use set_public_link_pin.'
        using errcode = '22023';
    end if;
    -- Carimbo do lado de cá: quem trocou o hash trocou o PIN, tenha ou não
    -- passado pela RPC.
    new.pin_set_at := now();
  end if;

  return new;
end;
$$;

comment on function public.public_links_guard_columns() is
  'Colunas que nenhum UPDATE pode mexer (zerar o PIN, apagar a validade, trocar o slug) e PIN novo obrigatoriamente em bcrypt, no INSERT e no UPDATE, com pin_set_at carimbado.';

-- O gatilho da 0062 era `before update`; recriado aqui para valer no INSERT
-- também. `drop trigger if exists` + `create` mantém a migration idempotente.
drop trigger if exists public_links_guard_columns on public.public_links;
create trigger public_links_guard_columns
  before insert or update on public.public_links
  for each row execute function public.public_links_guard_columns();

-- -----------------------------------------------------------------------------
-- 4. Rastro da troca de PIN — o registro, nunca o segredo
--
-- O PIN em claro continua existindo só no toast da tela: gravá-lo em
-- `notifications` seria desfazer a 0062, que tirou o PIN em claro do banco. O
-- que faltava era o REGISTRO de que houve troca, para quem usa o link.
--
-- Gatilho e não chamada dentro das duas RPCs: `create_public_link` e
-- `set_public_link_pin` são dois caminhos para o mesmo fato, e ainda existem o
-- seed e o suporte. Um lugar só cobre todos.
--
-- Canal `in_app`: e-mail e WhatsApp dependem de credencial que o projeto ainda
-- não tem (Brevo/Meta). Quando ela chegar, o despacho já lê `notifications`
-- (0017/0065) e este aviso viaja junto sem nenhuma mudança aqui.
-- -----------------------------------------------------------------------------
create or replace function public.public_links_notify_pin_rotation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed boolean;
  v_label   text;
begin
  v_changed := new.pin_hash is not null
               and (tg_op = 'INSERT' or new.pin_hash is distinct from old.pin_hash);

  if not v_changed or not new.active then
    return new;
  end if;

  select coalesce(t.name, p.full_name, 'sem dono')
    into v_label
  from (select 1) x
  left join public.teams    t on t.id = new.team_id
  left join public.profiles p on p.id = new.director_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select
    dest.profile_id,
    'public_link_pin_rotated',
    case when tg_op = 'INSERT' then 'Link público criado' else 'PIN do link foi trocado' end,
    -- Sem data no texto: `notifications.created_at` já carimba o momento e a
    -- tela o mostra no fuso de quem lê. `to_char(now())` aqui escreveria UTC.
    case when tg_op = 'INSERT'
         then format('Foi criado um link público com PIN para %s. Peça o código a quem administra o link.', v_label)
         else format('O PIN do link de %s foi trocado. O código anterior parou de funcionar — peça o novo a quem administra o link.', v_label)
    end,
    -- Link só para quem tem a rota: `menu.admin_daily_teams` é de admin e
    -- diretor. Mandar o gerente para lá seria um clique em "acesso não liberado".
    case when dest.is_owner then '/admin/daily-teams' else null end,
    'in_app'
  from (
    select d.profile_id, bool_or(d.is_owner) as is_owner
    from (
      select new.director_id as profile_id, true as is_owner
      union all
      select t.director_id, true from public.teams t where t.id = new.team_id
      union all
      select t.manager_id, false from public.teams t where t.id = new.team_id
    ) d
    where d.profile_id is not null
    group by d.profile_id
  ) dest
  where exists (select 1 from public.profiles pr where pr.id = dest.profile_id);

  return new;
end;
$$;

comment on function public.public_links_notify_pin_rotation() is
  'Avisa gerente e diretor da equipe (ou o diretor dono) que o PIN do link mudou. Registra o fato, nunca o PIN.';

revoke all on function public.public_links_notify_pin_rotation() from public, anon, authenticated;

drop trigger if exists public_links_notify_pin_rotation on public.public_links;
create trigger public_links_notify_pin_rotation
  after insert or update on public.public_links
  for each row execute function public.public_links_notify_pin_rotation();

-- -----------------------------------------------------------------------------
-- 5. O aviso de vencimento chega a quem usa o link
--
-- Acrescenta o GERENTE da equipe à lista de destinatários e separa o texto por
-- papel: quem administra recebe o caminho da renovação, quem só usa o link
-- recebe o pedido. O `not exists` continua sendo a idempotência (um aviso por
-- link por destinatário a cada 8 dias), então o job pode rodar todo dia.
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
    format('O link %s (%s) vence em %s. %s',
           pl.slug,
           coalesce(t.name, p.full_name, 'sem dono'),
           to_char(pl.expires_at, 'DD/MM/YYYY'),
           case when dest.is_owner
                then 'Renove a validade em Admin · Diário.'
                else 'Depois dessa data ele para de abrir e a tela vai dizer só “PIN incorreto”: peça a renovação à administração.'
           end),
    case when dest.is_owner then '/admin/daily-teams' else null end,
    'in_app'
  from public.public_links pl
  left join public.teams    t on t.id = pl.team_id
  left join public.profiles p on p.id = pl.director_id
  cross join lateral (
    select d.profile_id, bool_or(d.is_owner) as is_owner
    from (
      select ur.profile_id, true as is_owner from public.user_roles ur where ur.role = 'admin'
      union all
      select pl.director_id, true
      union all
      select t.director_id, true
      union all
      -- Quem abre o Diário todo dia nunca era avisado: descobria o vencimento
      -- pelo mesmo "PIN incorreto" de PIN errado.
      select t.manager_id, false
    ) d
    where d.profile_id is not null
    group by d.profile_id
  ) dest
  where pl.active
    and pl.expires_at is not null
    and pl.expires_at > now()
    and pl.expires_at <= now() + interval '7 days'
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
  'Avisa admin, diretor dono e GERENTE da equipe, uma vez por link a cada 8 dias, quando o link público vence em até 7 dias.';

revoke all on function public.notify_expiring_public_links() from public, anon, authenticated;

-- O job da 0062 (08:25, diário) continua valendo — só o corpo da função mudou.
-- Reagendar aqui trocaria o `jobid` sem necessidade.

-- Uma execução AGORA, na aplicação da migration.
--
-- O job `faceimob-public-link-expiry` está ativo desde a 0062 e `cron.job_run_
-- details` não tem UMA linha para ele: a função nunca rodou, e como os links
-- vivos vencem fora da janela de 7 dias, mesmo uma execução que estourasse não
-- deixaria rastro nenhum — a falha passaria despercebida indefinidamente.
-- Rodar aqui faz o `db push` FALHAR se o corpo estiver quebrado, que é a única
-- forma de o erro aparecer para alguém. Idempotente pelo `not exists` de 8 dias
-- da própria função, então reaplicar não duplica aviso.
do $$
declare
  v_n integer;
begin
  v_n := public.notify_expiring_public_links();
  raise notice '0080: notify_expiring_public_links() emitiu % aviso(s)', v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Checkpoint da diretoria: validade do link e a régua do dia preenchido
--
-- Duas mudanças no corpo, nada na assinatura nem nos grants:
--
--   · `expires_at` no payload — o Diário da equipe já avisa o vencimento desde a
--     0062 e o diretor não tinha aviso nenhum.
--   · `missing_days` passa a exigir LANÇAMENTO, não só linha de relatório. Um
--     `daily_reports` sem nenhuma `daily_entries` (o que sobra quando o envio
--     não casa nenhum corretor da equipe) limpava a cobrança sem ter registrado
--     nada da operação. É a mesma régua que o Diário público aplica no cliente.
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

  -- O mês acompanha a semana navegada — mas, na semana em que HOJE está, ele
  -- acompanha HOJE. É a correção da 0071, repetida aqui de propósito: este
  -- `create or replace` reescreve a função inteira, e partir do texto da 0062
  -- (que ancorava sempre no primeiro dia da semana) desfazia a 0071 em
  -- silêncio. Ancorar na semana fazia o cartão "Resumo do mês" mostrar o mês
  -- ANTERIOR nos primeiros dias de todo mês que não começa numa segunda: em
  -- 02/09 (semana de 31/08) o diretor lia "agosto, de 01/08 a 31/08" e o que as
  -- equipes lançaram em 01 e 02/09 sumia do acumulado — sem sumir do funil da
  -- SEMANA logo acima, na mesma tela. É também a régua do Diário
  -- (`public_daily_team` conta de `date_trunc('month', current_date)`) e a que
  -- `supabase/tests/10_public_daily_flows.sql` já cobrava.
  --
  -- Fora da semana corrente nada muda: semana passada traz o mês dela e semana
  -- futura continua ancorada no próprio começo, o que mantém o intervalo vazio
  -- (`v_month_end` fica em `current_date`) e o mês futuro zerado.
  v_month_start := date_trunc(
    'month',
    case when current_date between v_start and v_end then current_date else v_start end
  )::date;
  v_month_end   := least((v_month_start + interval '1 month')::date - 1, current_date);

  select jsonb_build_object(
    'director',   (select p.full_name from public.profiles p where p.id = v_link.director_id),
    'week_start', v_start,
    'week_end',   v_end,
    -- O diretor precisa saber que o link dele vence, e quando: link vencido cai
    -- na mesma recusa NULL de PIN errado, sem explicação nenhuma. Era o único
    -- lado da superfície pública sem este aviso.
    'expires_at', v_link.expires_at,
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
            -- Meta DA EQUIPE quando existir; senão a do diretor, senão a global.
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
              -- para preencher.
              from generate_series(v_start, least(v_end, current_date - 1), interval '1 day') d
              -- Sábado e domingo fora: ninguém lança checkpoint no fim de semana.
              where extract(isodow from d) < 6
                and not exists (
                  -- Dia preenchido é dia com LANÇAMENTO. Relatório sem nenhuma
                  -- entrada limpava a cobrança sem registrar nada — e o Diário,
                  -- que conta por lançamento, seguia mostrando o dia vazio.
                  select 1
                  from public.daily_reports r2
                  join public.daily_entries e2 on e2.report_id = r2.id
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
  'Funil da semana por equipe (com gerente, meta da equipe e link do Diário), validade do link, pendências em dia útil COM lançamento e acumulado do mês de todas as equipes do diretor. Slug desconhecido responde igual a slug conhecido.';

grant execute on function public.public_director_checkpoint(text, date, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Corrigir o checkpoint de até 2 dias atrás pelo próprio link
--
-- `public_daily_submit` não recebia data e gravava sempre em `current_date`: o
-- gerente que errou ontem não tinha como arrumar, a tela abria o passado em
-- leitura e desligava o Salvar, e não existe tela de administração que edite
-- daily passado. Na prática o número errado ficava congelado e a diretoria
-- cobrava em cima dele.
--
-- Janela de DOIS dias, não "o mês inteiro": o Diário é registro de rotina, e um
-- link público que reescreve trinta dias para trás é uma URL vazada capaz de
-- reescrever o mês. Fora da janela a resposta é explícita
-- (`{"error":"date_out_of_window"}`), NÃO o NULL da recusa de acesso — senão a
-- tela diria "PIN incorreto" para quem digitou o PIN certo.
--
-- DUAS assinaturas, uma implementação:
--
--   · a de 5 argumentos (0038) continua existindo, com o mesmo comportamento,
--     porque é a assinatura que `tests/06_anon_surface.sql` cobra e a que o
--     harness chama;
--   · a de 6 é a que recebe a data, e `p_date` NÃO tem default de propósito:
--     com default as duas seriam candidatas a uma chamada de 5 argumentos e o
--     Postgres recusaria por ambiguidade ("function is not unique") — o
--     PostgREST devolveria PGRST203 e o Diário inteiro pararia de gravar.
--
-- A de 5 é um invólucro: a regra (resolver o link, o teto de 200 linhas, a
-- leitura tolerante do jsonb, o upsert) vive num lugar só.
-- -----------------------------------------------------------------------------
create or replace function public.public_daily_submit(
  p_slug      text,
  p_pin       text,
  p_entries   jsonb,
  p_notes     text,
  p_filled_by text,
  p_date      date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_link      public.public_links;
  v_report_id uuid;
  v_entry     jsonb;
  v_profile   text;
  v_count     int := 0;
  v_date      date := coalesce(p_date, current_date);
  -- Fronteira anônima: corta espaço e tamanho antes de gravar. Vazio vira NULL.
  v_notes     text := nullif(left(btrim(p_notes), 2000), '');
  v_filled_by text := nullif(left(btrim(p_filled_by), 120), '');
begin
  v_link := private.resolve_public_link(p_slug, p_pin);

  -- Recusa de ACESSO é NULL, nunca exceção (0034): exceção faria rollback do
  -- contador do lockout que o resolvedor acabou de gravar.
  if v_link.id is null or v_link.kind <> 'daily_team' then
    return null;
  end if;

  -- Data fora da janela NÃO é recusa de acesso: devolver NULL aqui faria a tela
  -- acusar "PIN incorreto" de quem acertou o PIN. E a checagem mora aqui, e não
  -- só na tela, porque a tela não é a fronteira.
  if v_date > current_date or v_date < current_date - 2 then
    return jsonb_build_object(
      'error',         'date_out_of_window',
      'max_days_back', 2,
      'today',         current_date
    );
  end if;

  -- Teto do laço. A tela manda uma linha por corretor da escala, e nenhuma
  -- equipe real chega perto de 200 — quem bate neste limite é um POST direto.
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 200 then
    return null;
  end if;

  -- O formulário é o estado inteiro do dia: reenviar sem notas limpa as notas.
  insert into public.daily_reports (team_id, report_date, submitted_at, notes, filled_by_name)
  values (v_link.team_id, v_date, now(), v_notes, v_filled_by)
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

  return jsonb_build_object('report_id', v_report_id, 'saved', v_count, 'report_date', v_date);
end;
$fn$;

comment on function public.public_daily_submit(text, text, jsonb, text, text, date) is
  'Lançamento do Diário pelo link público, com data (hoje ou até 2 dias atrás). Recusa de acesso devolve NULL; data fora da janela devolve {"error":"date_out_of_window"}.';

grant execute on function public.public_daily_submit(text, text, jsonb, text, text, date) to anon, authenticated;

-- A assinatura da 0038 continua valendo, agora como invólucro: o corpo mora num
-- lugar só. Os 6 argumentos são passados EXPLICITAMENTE — com 5 o Postgres teria
-- duas candidatas e recusaria a chamada.
create or replace function public.public_daily_submit(
  p_slug      text,
  p_pin       text,
  p_entries   jsonb,
  p_notes     text default null,
  p_filled_by text default null
)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $fn$
  select public.public_daily_submit(p_slug, p_pin, p_entries, p_notes, p_filled_by, current_date);
$fn$;

comment on function public.public_daily_submit(text, text, jsonb, text, text) is
  'Lançamento do Diário de HOJE pelo link público (assinatura da 0038). Invólucro da versão com data.';

grant execute on function public.public_daily_submit(text, text, jsonb, text, text) to anon, authenticated;
