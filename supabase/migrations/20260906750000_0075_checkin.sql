-- =============================================================================
-- 0075 — a trava antifraude do check-in volta a valer para quem lidera equipe,
--        turno sobreposto deixa de ser aceito em silêncio e faixa de IP deixa
--        de entrar duas vezes
--
-- 1. GERENTE/DIRETOR PULAVA A TRAVA DE IP E O BLOQUEIO POR ATRASO
--
-- `checkins_manage` (0004) é `for all` com
-- `is_admin() or manages_profile(profile_id)`, e `manages_profile(self)` é
-- VERDADEIRO para quem é membro de uma equipe que lidera — 3 perfis na
-- homologação hoje (consulta, não leitura de código). Como `authenticated` tem
-- o privilégio de tabela (0023), esses perfis gravavam a própria presença com
--
--     POST /rest/v1/checkins {"profile_id":"<eu>","shift_id":"<turno>"}
--
-- sem passar por `perform_checkin` — ou seja, sem trava de IP (ata 14/07), sem
-- `checkin_eligibility()` e sem janela de turno. O mesmo caminho gravava a
-- presença de QUALQUER corretor da equipe dele. A policy existia "para o caso de
-- correção manual pelo gestor" e virou a porta dos fundos da própria regra que
-- o resto do módulo defende.
--
-- A correção é estreitar a policy para `is_admin()`. Consequências, explícitas:
--
--   · gerente e diretor perdem a escrita direta em `checkins`. Consertar ponto
--     esquecido passa a ser ato de administrador — que é quem já configura
--     turno, faixa de IP e limite de atraso;
--   · o próprio gerente que esqueceu de bater ponto NÃO se libera sozinho. Era
--     exatamente esse o furo: presença concedida a si mesmo, de qualquer
--     endereço, sem rastro;
--   · a correção do admin continua distinguível do ponto real no dado: a
--     RPC exige IP identificado (0020/0057), então `checkins.ip_address is null`
--     marca a linha que nasceu de correção manual.
--
-- 2. `anon` TINHA PRIVILÉGIO DE TABELA EM checkins/work_shifts/allowed_ips
--
-- A 0023 concedeu os quatro verbos em bloco para `anon` e a 0019 fechou a
-- superfície anônima por RLS, não por privilégio. Numa tabela antifraude o
-- privilégio de tabela é a última linha que sobra se uma policy for afrouxada
-- por engano — e a superfície anônima do produto são exatamente três RPCs
-- (`public_daily_team`, `public_daily_submit`, `public_director_checkpoint`),
-- todas SECURITY DEFINER, que não dependem de grant nenhum para `anon`.
--
-- 3. TURNO SOBREPOSTO ERA RESOLVIDO POR SORTE
--
-- `current_shift()` faz `order by position limit 1`: com dois turnos ativos
-- cobrindo o mesmo horário, o corretor bate ponto no de menor `position` sem
-- nada dizer, e descobre pelo horário de check-out errado. A tela também não
-- validava a ordem dos horários — salvar check-out antes da distribuição caía
-- no CHECK `work_shifts_window_order` e virava "Um dos campos está fora do valor
-- permitido", sem dizer qual campo — nem explicava que turno atravessando a
-- meia-noite não é suportado (o CHECK exige `distribution_start < checkout_time`
-- e `auto_checkout_expired` compara `::time >`).
--
-- O gatilho abaixo levanta P0001 com a frase pronta em pt-BR. `describeError`
-- (src/lib/supabaseError.ts) repassa P0001 intacto, então a mensagem chega ao
-- admin pela tela que já existe, sem mudar uma linha de front.
--
-- A regra de sobreposição só vale para escrita vinda da tela (`current_user =
-- 'authenticated'`, o papel que o PostgREST assume em toda requisição do
-- navegador). O harness SQL, a suíte E2E (service_role) e o cron criam de
-- propósito um turno 00:00–23:59 para tornar `current_shift()` determinístico —
-- é fixture, não configuração da operação.
--
-- 4. A MESMA FAIXA DE IP ENTRAVA DUAS VEZES
--
-- Não havia unique em `allowed_ips`: duplo clique ou duas pessoas cadastrando
-- criavam linhas idênticas, e desativar uma delas não desativava a outra — o
-- admin desativa a faixa, vê "inativo" na lista e o check-in continua liberado
-- pela gêmea. A chave é (ip_range, team_id), com o `team_id` nulo (faixa global)
-- normalizado, porque em índice unique NULL nunca colide com NULL.
--
-- 5. UMA FAIXA /0 LIBERA A INTERNET INTEIRA
--
-- A homologação tinha `0.0.0.0/0` desativada, rotulada "desligar antes de
-- produção": um clique no selo da lista reabria o check-in para qualquer
-- endereço do mundo. Faixa com máscara /0 passa a ser recusada na gravação, e a
-- linha existente sai — deixá-la como armadilha desarmada só adia o clique.
--
-- Idempotente: `drop policy if exists`, `create or replace`, `create index if
-- not exists`, e as limpezas de dado são condicionais ao estado que corrigem.
-- =============================================================================

-- 1. Escrita direta em `checkins` é ato de administrador ----------------------

drop policy if exists checkins_manage on public.checkins;

create policy checkins_admin on public.checkins
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on policy checkins_admin on public.checkins is
  'Correção manual de presença. Só admin: manages_profile(self) é verdadeiro para quem lidera a própria equipe, e a policy anterior deixava gerente e diretor gravarem a própria presença sem trava de IP nem checkin_eligibility(). Ponto de verdade continua sendo perform_checkin(), que exige IP identificado — linha com ip_address nulo é correção manual.';

-- 2. `anon` não tem o que fazer nas tabelas do ponto --------------------------

revoke select, insert, update, delete on public.checkins    from anon;
revoke select, insert, update, delete on public.work_shifts from anon;
revoke select, insert, update, delete on public.allowed_ips from anon;

-- 3. Turno: ordem dos horários, meia-noite e sobreposição ---------------------

create or replace function public.work_shifts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_presencas int;
  v_conflito  text;
begin
  if tg_op = 'DELETE' then
    -- A FK de `checkins.shift_id` é `on delete restrict` e devolve 23503, que a
    -- tela traduz para "Existe outro registro ligado a este" — sem dizer que o
    -- vínculo são presenças e sem oferecer a saída (desativar).
    select count(*) into v_presencas from public.checkins c where c.shift_id = old.id;
    if v_presencas > 0 then
      raise exception
        'O turno "%" tem % presença(s) registrada(s) e não pode ser excluído. Desative o turno em vez de excluir — o histórico de ponto depende dele.',
        old.label, v_presencas using errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.checkin_start > new.distribution_start then
    raise exception
      'No turno "%", a distribuição (%) não pode começar antes do check-in (%). Corrija o campo "Início da distribuição".',
      new.label, to_char(new.distribution_start, 'HH24:MI'), to_char(new.checkin_start, 'HH24:MI')
      using errcode = 'P0001';
  end if;

  if new.distribution_start >= new.checkout_time then
    raise exception
      'No turno "%", o check-out (%) tem de ser depois do início da distribuição (%). Turno que atravessa a meia-noite não é suportado: divida em dois turnos (ex.: 22:00–23:59 e 00:00–02:00).',
      new.label, to_char(new.checkout_time, 'HH24:MI'), to_char(new.distribution_start, 'HH24:MI')
      using errcode = 'P0001';
  end if;

  -- Sobreposição: só para escrita vinda da tela.
  --
  -- O discriminador é `current_user`, e não `auth.uid()`: o PostgREST troca o
  -- papel para `authenticated` (ou `anon`) em toda requisição do navegador,
  -- enquanto o harness SQL, a suíte E2E (service_role) e o cron rodam como
  -- outro papel — e o harness deixa `request.jwt.claims` preenchido entre os
  -- blocos, o que faria `auth.uid()` parecer um usuário de tela.
  --
  -- O turno 00:00–23:59 que os testes montam é fixture para tornar
  -- `current_shift()` determinístico, não configuração da operação.
  if new.active and current_user = 'authenticated' then
    select s.label into v_conflito
      from public.work_shifts s
     where s.id <> new.id
       and s.active
       and s.checkin_start < new.checkout_time
       and new.checkin_start < s.checkout_time
     order by s.position
     limit 1;

    if v_conflito is not null then
      raise exception
        'O turno "%" (%–%) se sobrepõe ao turno "%". Turnos sobrepostos fazem o corretor bater ponto no turno de menor ordem sem aviso, e o check-out automático acontece no horário errado.',
        new.label, to_char(new.checkin_start, 'HH24:MI'), to_char(new.checkout_time, 'HH24:MI'), v_conflito
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.work_shifts_guard is
  'Recusa turno com horários fora de ordem, turno atravessando a meia-noite e turno sobreposto a outro ativo, sempre com mensagem pt-BR em P0001 (que describeError repassa intacta). A regra de sobreposição só vale para o papel authenticated (a tela); harness, suíte E2E e cron montam turno 24h como fixture.';

drop trigger if exists work_shifts_guard on public.work_shifts;
create trigger work_shifts_guard
  before insert or update or delete on public.work_shifts
  for each row execute function public.work_shifts_guard();

-- 4. Uma faixa de IP por (endereço, equipe) -----------------------------------

-- Sobreviva a mais antiga; se qualquer gêmea estava ativa, a sobrevivente fica
-- ativa — desativar a duplicata não pode virar reabertura silenciosa do IP.
with ranked as (
  select id,
         row_number() over (
           partition by ip_range, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
           order by created_at, id
         ) as n,
         bool_or(active) over (
           partition by ip_range, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
         ) as alguma_ativa
    from public.allowed_ips
)
update public.allowed_ips a
   set active = true
  from ranked r
 where r.id = a.id and r.n = 1 and r.alguma_ativa and not a.active;

with ranked as (
  select id,
         row_number() over (
           partition by ip_range, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
           order by created_at, id
         ) as n
    from public.allowed_ips
)
delete from public.allowed_ips a
 using ranked r
 where r.id = a.id and r.n > 1;

create unique index if not exists allowed_ips_range_team_uidx
  on public.allowed_ips (ip_range, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 5. Faixa /0 (a internet inteira) não entra ----------------------------------

delete from public.allowed_ips where masklen(ip_range) = 0;

create or replace function public.allowed_ips_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if masklen(new.ip_range) = 0 then
    raise exception
      'A faixa % libera o check-in para qualquer endereço da internet e anula a trava antifraude. Cadastre a faixa real da unidade (ex.: 200.150.10.0/24) ou use a liberação individual de IP para quem não tem endereço fixo.',
      new.ip_range::text using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.allowed_ips_guard is
  'Recusa faixa com máscara /0 (0.0.0.0/0, ::/0) na criação e na reativação. A homologação mantinha uma dessas desativada, e um clique no selo da lista reabria o check-in para o mundo inteiro.';

drop trigger if exists allowed_ips_guard on public.allowed_ips;
create trigger allowed_ips_guard
  before insert or update on public.allowed_ips
  for each row execute function public.allowed_ips_guard();
