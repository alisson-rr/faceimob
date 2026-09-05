-- =============================================================================
-- 0066 — o dia operacional do check-in volta a ser o de São Paulo, e a contagem
--        de leads atrasados de um colega deixa de ser consultável do navegador
--
-- 1. A CORREÇÃO DE FUSO DA 0057 FOI DESFEITA POR ORDEM DE ARQUIVO
--
-- A 0057 trocou `current_date` (UTC) por `public.current_work_date()`
-- (America/Sao_Paulo) em `perform_checkin`, `perform_checkout`,
-- `auto_checkout_expired` e `distribution_queue`. A 0065 — escrita depois, para
-- outro assunto — precisou de `create or replace` em `perform_checkin` (para
-- exigir `menu.checkin`) e em `perform_checkout` (para fechar UM turno, não o
-- dia) e reintroduziu `current_date` nas duas.
--
-- As migrations são aplicadas em ordem de nome (`scripts/validate-schema.sh` e
-- o remoto), e `20260903650000` vem depois de `20260903570000`: no estado atual
-- da árvore quem vale é a 0065. E o resultado é pior do que antes da 0057,
-- porque agora as duas metades discordam entre si — `current_work_date()`
-- devolve a data de São Paulo e a gravação usa a de UTC.
--
-- Efeito, todo dia entre 21:00 e 00:00 em Brasília (o turno Noite vai até
-- 21:30): o corretor bate ponto, a linha nasce com `work_date` de AMANHÃ, e
-- `listTodayCheckins` (tela) e `distribution_queue` procuram por HOJE. A
-- presença some da tela, o botão "Fazer check-in" reabilita, o corretor não
-- entra na fila de distribuição e — como a unique é
-- (profile_id, work_date, shift_id) — o `on conflict` não dispara e um SEGUNDO
-- check-in do mesmo turno é gravado.
--
-- Esta migration reaplica as DUAS funções com o que a 0065 acrescentou
-- (`has_permission('menu.checkin')` e o fechamento de um turno só) e o dia
-- operacional da 0057. É o ponto compartilhado: nenhuma tela precisa mudar.
--
-- Se a 0065 for corrigida na origem, esta migration continua correta e
-- idempotente — ela apenas repete a mesma definição.
--
-- 2. `overdue_lead_count` RESPONDIA SOBRE QUALQUER PERFIL
--
-- A 0057 fechou `checkin_eligibility(who)` e `ip_is_allowed(candidate, who)`
-- com `can_probe_profile()`. Ficou de fora a função irmã que produz o número:
-- `public.overdue_lead_count(who)` (0005) é SECURITY DEFINER, aceita qualquer
-- `who`, não tem guarda e recebeu `execute` no bloco em massa da 0023
-- (`grant execute on all functions in schema public to authenticated`), que não
-- a inclui na lista de revogações. Um corretor logado fazia
-- `POST /rest/v1/rpc/overdue_lead_count {"who":"<uuid do colega>"}` e recebia
-- exatamente a contagem que a 0057 diz ter vedado.
--
-- A vedação é por PRIVILÉGIO, não por guarda dentro da função: ela é chamada em
-- `distribution_queue` para TODOS os membros do grupo e um `raise` para perfil
-- fora da visibilidade quebraria a fila do próprio corretor. Nenhuma tela a
-- chama direto (não há `.rpc("overdue_lead_count")` em `src/` nem em
-- `supabase/functions/`), e as chamadoras são SECURITY DEFINER — executam como
-- o dono, que não depende do grant de quem chamou.
--
-- Idempotente: só `create or replace`, `revoke` e `grant`.
-- =============================================================================

-- 1. Check-in: permissão de menu (0065) + dia operacional de São Paulo (0057) --

create or replace function public.perform_checkin(client_ip inet default null)
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_who      uuid := auth.uid();
  v_shift    uuid;
  v_ok       boolean;
  v_reason   text;
  v_row      public.checkins;
begin
  if v_who is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 0065: o menu de Check-in é de director, manager, broker e partner. Sem esta
  -- checagem, cca/sdr/marketing batiam ponto pela edge function e entravam na
  -- roleta apesar de a tela não existir para eles. `has_permission` já devolve
  -- verdadeiro para admin.
  if not public.has_permission('menu.checkin') then
    raise exception 'Seu perfil não faz check-in na roleta.' using errcode = '42501';
  end if;

  v_shift := public.current_shift();
  if v_shift is null then
    raise exception 'Fora da janela de check-in.' using errcode = 'P0001';
  end if;

  select e.allowed, e.reason into v_ok, v_reason
  from public.checkin_eligibility(v_who) e;

  if not v_ok then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  -- A trava de loja é por IP; sem IP identificado não há trava (0020).
  if client_ip is null then
    raise exception 'IP não identificado — faça o check-in pelo aplicativo.'
      using errcode = 'P0001';
  end if;

  if not public.ip_is_allowed(client_ip, v_who) then
    raise exception 'IP % não autorizado para check-in.', host(client_ip)
      using errcode = 'P0001';
  end if;

  -- 0057: `current_work_date()`, nunca `current_date`. O banco roda em UTC e às
  -- 21:00 em São Paulo o `current_date` já é o dia seguinte.
  insert into public.checkins (profile_id, shift_id, work_date, ip_address)
  values (v_who, v_shift, public.current_work_date(), client_ip)
  on conflict (profile_id, work_date, shift_id) do update
    set checked_out_at = null,
        auto_checkout  = false,
        ip_address     = coalesce(excluded.ip_address, public.checkins.ip_address)
  returning * into v_row;

  return v_row;
end;
$$;

-- 2. Check-out: um turno por chamada (0065) + dia operacional (0057) ----------

create or replace function public.perform_checkout()
returns public.checkins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.checkins;
  v_shift uuid := public.current_shift();
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- Prefere o turno vigente; fora de qualquer janela (quem esqueceu o ponto
  -- aberto e fecha depois) fecha o mais recente. Um por chamada: o UPDATE
  -- antigo casava por `profile_id + work_date` e derrubava manhã e tarde juntas.
  select c.id into v_id
    from public.checkins c
   where c.profile_id = auth.uid()
     and c.work_date = public.current_work_date()
     and c.checked_out_at is null
   order by (c.shift_id = v_shift) desc, c.checked_in_at desc
   limit 1;

  if v_id is null then
    raise exception 'Nenhum check-in aberto hoje.' using errcode = 'P0002';
  end if;

  update public.checkins
     set checked_out_at = now()
   where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

-- 3. A contagem de atrasados sai do alcance do navegador ---------------------

revoke execute on function public.overdue_lead_count(uuid) from public, anon, authenticated;
grant  execute on function public.overdue_lead_count(uuid) to service_role;

comment on function public.overdue_lead_count(uuid) is
  'Leads vencidos de um perfil. NÃO é RPC de tela: responde sobre qualquer `who` sem guarda de visibilidade e por isso só executa por service_role. Quem precisa do número na interface chama checkin_eligibility(), que passa por can_probe_profile().';
