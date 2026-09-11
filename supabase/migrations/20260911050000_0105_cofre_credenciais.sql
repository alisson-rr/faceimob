-- =============================================================================
-- 0105 · Cofre de credenciais da operação + senha de acesso do colaborador
--
-- O QUE FOI PEDIDO, em 10/09/2026: uma aba em Equipes para "registrar várias
-- login/senhas (nome do que / login / senha / colocar link)" — e-mail, pipeline,
-- painel de construtora — que "só administrador e sócio podem ver", mais "poder
-- ver a senha/editar de alguma forma" do corretor. Onde o cliente escreve
-- administrador, o SÓCIO está incluído; desde a 0097 `is_admin()` já responde
-- pelos dois, então todo gate aqui é `is_admin()` e nenhum lugar repete
-- `partner` na mão.
--
-- O LIMITE QUE NÃO SE CONTORNA, e que a tela precisa dizer em voz alta: o
-- Supabase Auth guarda HASH de senha. A senha que o corretor usa hoje não pode
-- ser lida por ninguém — nem pelo dono do banco. O que existe é o outro
-- caminho: o administrador DEFINE uma senha nova, a edge function
-- `provision-broker-user` a aplica no Auth e a grava aqui na mesma chamada, e a
-- partir daí ela é consultável. Antes disso, o cofre não tem o que mostrar.
--
-- POR QUE NÃO HÁ CIFRA NOVA AQUI. O projeto já tem um cofre — `private.
-- integration_credentials` (0011), lido por `supabase/functions/_shared/
-- secrets.ts` — e o mecanismo dele é ISOLAMENTO, não criptografia de aplicação:
-- o schema `private` não está nos schemas expostos pelo PostgREST (não há
-- `[api] schemas` no config.toml, então vale o padrão `public, graphql_public`),
-- logo não existe endpoint REST para a tabela, e toda leitura passa por função
-- `security definer` que confere o papel. Inventar aqui um `pgp_sym_encrypt`
-- exigiria guardar a chave — e o único lugar disponível seria o próprio banco,
-- ao lado do dado cifrado. Isso não protege de nada e cria um SEGUNDO mecanismo
-- de segredo para alguém manter. O que protege de verdade já está em pé:
-- isolamento de schema, RPC com `is_admin()` e auditoria de quem revelou.
-- ponytail: segredo em claro na coluna, protegido por isolamento + RPC;
-- evoluir para `supabase_vault` quando houver KMS/chave fora do Postgres.
--
-- O DESENHO, em três peças:
--   1. `private.operation_credentials` — a tabela. Nunca em `public`, nunca
--      alcançável pelo PostgREST.
--   2. LISTAR e REVELAR são operações DIFERENTES. `list_operation_credentials`
--      devolve rótulo, login e link e NÃO devolve segredo nenhum: é o que a
--      tela pinta, e o valor não trafega para o browser só por alguém ter
--      aberto a aba. `reveal_operation_credential` devolve UM segredo por
--      chamada — e deixa linha em `public.credential_reveal_log` antes de
--      devolver.
--   3. `store_broker_password` é a porta da edge function (service_role), no
--      mesmo formato da 0016: o browser não a alcança nem por engano.
--
-- QUEM NÃO É ADMIN NÃO CHEGA NEM À MESA: `authenticated` não tem USAGE em
-- `private` (0001/0023 deixaram o schema fechado; só `service_role` recebeu
-- usage na 0011). O `is_admin()` dentro das RPCs é a segunda trava, para o dia
-- em que alguém conceder usage por engano numa migration futura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A tabela
--
-- `profile_id` separa os dois usos sem inventar um enum: nulo = credencial da
-- operação (e-mail da empresa, pipeline, painel da construtora); preenchido =
-- senha de acesso ao SISTEMA daquela pessoa. `on delete cascade` de propósito:
-- senha de conta apagada é segredo vivo sem dono — a auditoria de quem revelou
-- sobrevive em `credential_reveal_log`, que guarda o rótulo como texto.
--
-- Os `check` são a fronteira real: a RPC recusa antes com mensagem em pt-BR,
-- mas quem escrever direto pela service role também esbarra neles.
-- O check do link é o mesmo de `useful_links` (0063) — sem `http(s)://` o card
-- vira link relativo e navega dentro do CRM.
-- -----------------------------------------------------------------------------
create table if not exists private.operation_credentials (
  id               uuid primary key default gen_random_uuid(),
  label            text not null check (length(btrim(label)) between 1 and 120),
  login            text not null check (length(btrim(login)) between 1 and 200),
  secret           text not null check (length(secret) between 1 and 500),
  link             text check (
                     link is null
                     or (length(link) <= 500 and link ~* '^https?://[^[:space:]]+$')
                   ),
  profile_id       uuid references public.profiles(id) on delete cascade,
  created_by       uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table private.operation_credentials is
  'Cofre de logins/senhas da operação (0105). Vive em private: o PostgREST não expõe o schema, então não há endpoint REST. Leitura só por list_/reveal_operation_credential, que conferem is_admin(). profile_id preenchido = senha de acesso ao sistema daquela pessoa, gravada por store_broker_password junto com a troca no Auth.';

comment on column private.operation_credentials.secret is
  'Senha/token em claro. A proteção é o isolamento do schema + RPC com is_admin(), o mesmo mecanismo de private.integration_credentials (0011) — não há cifra de aplicação, e cifrar com chave guardada no próprio banco não acrescentaria nada.';

-- Uma senha de sistema por pessoa: guardar a anterior seria manter viva uma
-- credencial que já não vale e que ninguém vai revogar.
create unique index if not exists operation_credentials_profile_uniq
  on private.operation_credentials (profile_id)
  where profile_id is not null;

-- Duas linhas com o mesmo par rótulo+login são a mesma credencial cadastrada
-- duas vezes — e aí ninguém sabe qual está valendo. 23505 vira
-- "Já existe um registro com esses dados" em `describeError`.
create unique index if not exists operation_credentials_label_login_uniq
  on private.operation_credentials (label, login)
  where profile_id is null;

-- -----------------------------------------------------------------------------
-- 2. Auditoria de quem revelou
--
-- Mesmo estilo de `access_provision_log` (0061/0079): tabela em `public` para o
-- admin conseguir LER pela API (a de lá é a única auditoria deste projeto que
-- alguém abre na tela), escrita apenas pela função `security definer`, e o
-- rótulo guardado como TEXTO porque as fks são `on delete set null`/`cascade` —
-- a pergunta "quem viu essa senha" costuma vir depois de a credencial ter sido
-- apagada e de a pessoa ter saído.
-- -----------------------------------------------------------------------------
create table if not exists public.credential_reveal_log (
  id               uuid primary key default gen_random_uuid(),
  credential_id    uuid,
  credential_label text not null,
  actor_id         uuid references public.profiles(id) on delete set null,
  actor_email      text,
  created_at       timestamptz not null default now()
);

comment on table public.credential_reveal_log is
  'Uma linha por segredo revelado do cofre da operação (0105). Escrita só por reveal_operation_credential, na mesma transação da leitura: falhou o registro, ninguém vê o segredo. Leitura só de admin/sócio.';

create index if not exists credential_reveal_log_recente_idx
  on public.credential_reveal_log (created_at desc);

alter table public.credential_reveal_log enable row level security;

drop policy if exists credential_reveal_log_admin_read on public.credential_reveal_log;
create policy credential_reveal_log_admin_read on public.credential_reveal_log
  for select to authenticated
  using (public.is_admin());

-- A 0023 deixa `alter default privileges` concedendo tabela nova de `public` a
-- `anon` também; aqui isso não faz sentido e o RLS já negaria — revogar deixa a
-- intenção escrita. Mesmo recorte da 0061.
revoke all on public.credential_reveal_log from anon;
grant select on public.credential_reveal_log to authenticated;
grant select, insert on public.credential_reveal_log to service_role;

-- `access_provision_log` ganha o ato novo: definir senha é provisionamento de
-- acesso como criar conta ou trocar e-mail, e a trilha de Equipes já lê essa
-- tabela. Sem isto o insert da edge function estouraria no check da 0079.
alter table public.access_provision_log
  drop constraint if exists access_provision_log_action_check;
alter table public.access_provision_log
  add constraint access_provision_log_action_check
  check (action in ('create', 'reset', 'denied', 'revoked', 'restored', 'password'));

-- -----------------------------------------------------------------------------
-- 3. Listar — sem segredo nenhum
--
-- O valor não trafega para o browser por alguém abrir a aba; só pelo botão
-- "revelar", um item por vez, com linha de auditoria.
-- -----------------------------------------------------------------------------
create or replace function public.list_operation_credentials()
returns table (
  id               uuid,
  label            text,
  login            text,
  link             text,
  profile_id       uuid,
  profile_name     text,
  created_by_email text,
  created_at       timestamptz,
  updated_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores e sócios veem o cofre da operação.'
      using errcode = '42501';
  end if;

  return query
  select c.id, c.label, c.login, c.link, c.profile_id, p.full_name,
         c.created_by_email, c.created_at, c.updated_at
  from private.operation_credentials c
  left join public.profiles p on p.id = c.profile_id
  order by (c.profile_id is not null), c.label, c.login;
end;
$$;

comment on function public.list_operation_credentials() is
  'Cofre da operação SEM os segredos: rótulo, login e link. Só admin/sócio. Revelar é reveal_operation_credential, um item por chamada e com auditoria.';

-- -----------------------------------------------------------------------------
-- 4. Gravar e editar
--
-- `p_id` nulo insere; preenchido edita. Validação com nome de campo aqui, e não
-- só nos `check` da tabela: 23514 chega na tela como "um dos campos está fora
-- do valor permitido" (`describeError`), que não diz QUAL.
--
-- LINHA DE PESSOA NÃO SE EDITA POR AQUI, e essa é a regra que importa: mudar só
-- o `secret` de uma senha de sistema faria o cofre afirmar uma senha que o Auth
-- não tem — o administrador leria daqui um valor que não entra em lugar nenhum.
-- Senha de pessoa muda pelo botão "Definir senha", que troca o Auth e o cofre na
-- mesma chamada.
-- -----------------------------------------------------------------------------
create or replace function public.set_operation_credential(
  p_label  text,
  p_login  text,
  p_secret text,
  p_link   text default null,
  p_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_label   text := btrim(coalesce(p_label, ''));
  v_login   text := btrim(coalesce(p_login, ''));
  v_secret  text := coalesce(p_secret, '');
  v_link    text := nullif(btrim(coalesce(p_link, '')), '');
  v_pessoa  uuid;
  v_id      uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores e sócios mexem no cofre da operação.'
      using errcode = '42501';
  end if;

  if v_label = '' or length(v_label) > 120 then
    raise exception 'O nome do acesso precisa ter de 1 a 120 caracteres.' using errcode = 'P0001';
  end if;
  if v_login = '' or length(v_login) > 200 then
    raise exception 'O login precisa ter de 1 a 200 caracteres.' using errcode = 'P0001';
  end if;
  if v_secret = '' or length(v_secret) > 500 then
    raise exception 'A senha precisa ter de 1 a 500 caracteres.' using errcode = 'P0001';
  end if;
  if v_link is not null and (length(v_link) > 500 or v_link !~* '^https?://[^[:space:]]+$') then
    raise exception 'O link precisa começar com http:// ou https:// e não pode ter espaços.'
      using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into private.operation_credentials
      (label, login, secret, link, created_by, created_by_email)
    values
      (v_label, v_login, v_secret, v_link, auth.uid(),
       (select pr.email from public.profiles pr where pr.id = auth.uid()))
    returning id into v_id;
    return v_id;
  end if;

  select c.profile_id into v_pessoa
  from private.operation_credentials c
  where c.id = p_id;
  -- `found` e não `v_pessoa is null`: linha da operação tem profile_id nulo.
  if not found then
    raise exception 'Credencial não encontrada.' using errcode = 'P0002';
  end if;
  if v_pessoa is not null then
    raise exception 'Senha de acesso ao sistema muda pelo botão "Definir senha": o login e o cofre mudam juntos.'
      using errcode = 'P0001';
  end if;

  update private.operation_credentials
     set label      = v_label,
         login      = v_login,
         secret     = v_secret,
         link       = v_link,
         updated_at = now()
   where id = p_id
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.set_operation_credential(text, text, text, text, uuid) is
  'Grava (p_id nulo) ou edita uma credencial do cofre da operação. Só admin/sócio. Recusa editar linha de pessoa: senha de sistema muda por provision-broker-user, que troca Auth e cofre juntos.';

-- -----------------------------------------------------------------------------
-- 5. Revelar — um item por chamada, e o registro vem ANTES do valor
--
-- A auditoria e a leitura estão na mesma transação de propósito: se o insert
-- falhar, a função inteira falha e ninguém vê o segredo. Auditoria que o
-- caminho de sucesso pode pular não é auditoria.
-- -----------------------------------------------------------------------------
create or replace function public.reveal_operation_credential(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_secret text;
  v_label  text;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores e sócios revelam credenciais do cofre.'
      using errcode = '42501';
  end if;

  select c.secret, c.label into v_secret, v_label
  from private.operation_credentials c
  where c.id = p_id;

  if not found then
    raise exception 'Credencial não encontrada.' using errcode = 'P0002';
  end if;

  insert into public.credential_reveal_log
    (credential_id, credential_label, actor_id, actor_email)
  values
    (p_id, v_label, auth.uid(),
     (select pr.email from public.profiles pr where pr.id = auth.uid()));

  return v_secret;
end;
$$;

comment on function public.reveal_operation_credential(uuid) is
  'Devolve UM segredo do cofre e registra quem revelou em credential_reveal_log na mesma transação. Só admin/sócio.';

-- -----------------------------------------------------------------------------
-- 6. Apagar
--
-- O caminho de tirar do ar uma credencial que vazou ou que não vale mais. Sem
-- ele, "apagar" seria console do banco — foi exatamente o buraco que a 0082
-- fechou no cofre de integrações.
-- -----------------------------------------------------------------------------
create or replace function public.delete_operation_credential(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_afetadas int;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores e sócios mexem no cofre da operação.'
      using errcode = '42501';
  end if;

  delete from private.operation_credentials where id = p_id;
  get diagnostics v_afetadas = row_count;
  -- `false` = não havia linha. A tela distingue isso de uma recusa (42501).
  return v_afetadas > 0;
end;
$$;

comment on function public.delete_operation_credential(uuid) is
  'Apaga uma credencial do cofre da operação. Só admin/sócio. Apagar a linha de uma pessoa não mexe na senha dela no Auth — só faz o cofre esquecê-la.';

-- -----------------------------------------------------------------------------
-- 7. A porta da edge function
--
-- Mesma dupla trava da 0016, e pelo mesmo motivo: 1) `grant execute` só para
-- service_role, então anon/authenticated levam permission denied do próprio
-- Postgres; 2) checagem explícita de `auth.role()`, que sobrevive a alguém
-- conceder execute por engano numa migration futura.
--
-- `p_actor_id`/`p_actor_email` vêm da function porque sob service_role
-- `auth.uid()` é nulo — e "quem cadastrou" é metade do valor da auditoria. A
-- function já conferiu que o chamador é admin ou sócio antes de chegar aqui.
-- -----------------------------------------------------------------------------
create or replace function public.store_broker_password(
  p_profile_id  uuid,
  p_login       text,
  p_secret      text,
  p_actor_id    uuid default null,
  p_actor_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_login  text := btrim(coalesce(p_login, ''));
  v_secret text := coalesce(p_secret, '');
  v_nome   text;
  v_id     uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role grava senha de acesso no cofre.' using errcode = '42501';
  end if;

  if v_login = '' or length(v_login) > 200 then
    raise exception 'Login inválido.' using errcode = 'P0001';
  end if;
  if v_secret = '' or length(v_secret) > 500 then
    raise exception 'Senha inválida.' using errcode = 'P0001';
  end if;

  select pr.full_name into v_nome from public.profiles pr where pr.id = p_profile_id;
  if v_nome is null then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;

  insert into private.operation_credentials
    (label, login, secret, profile_id, created_by, created_by_email)
  values
    ('Acesso ao sistema · ' || left(v_nome, 90), v_login, v_secret,
     p_profile_id, p_actor_id, p_actor_email)
  -- `created_by` passa a ser QUEM DEFINIU a senha que está valendo, não quem
  -- cadastrou a linha primeiro: é essa a pergunta que se faz depois.
  on conflict (profile_id) where profile_id is not null do update
    set label            = excluded.label,
        login            = excluded.login,
        secret           = excluded.secret,
        created_by       = excluded.created_by,
        created_by_email = excluded.created_by_email,
        updated_at       = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.store_broker_password(uuid, text, text, uuid, text) is
  'Guarda no cofre a senha que provision-broker-user acabou de aplicar no Auth. Exclusiva de service_role; nunca chamar do browser.';

-- -----------------------------------------------------------------------------
-- 8. Grants
--
-- `alter default privileges` da 0023/0019 já concede execute de função nova de
-- `public` a `authenticated` (e revoga de `anon`). Explicitar mantém a intenção
-- legível e cobre o dia em que o default mudar.
-- -----------------------------------------------------------------------------
revoke all on function public.list_operation_credentials()                         from public, anon;
revoke all on function public.set_operation_credential(text, text, text, text, uuid) from public, anon;
revoke all on function public.reveal_operation_credential(uuid)                    from public, anon;
revoke all on function public.delete_operation_credential(uuid)                    from public, anon;

grant execute on function public.list_operation_credentials()                         to authenticated;
grant execute on function public.set_operation_credential(text, text, text, text, uuid) to authenticated;
grant execute on function public.reveal_operation_credential(uuid)                    to authenticated;
grant execute on function public.delete_operation_credential(uuid)                    to authenticated;

revoke all on function public.store_broker_password(uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.store_broker_password(uuid, text, text, uuid, text)
  to service_role;
