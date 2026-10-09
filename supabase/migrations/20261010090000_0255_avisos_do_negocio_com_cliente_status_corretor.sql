-- =============================================================================
-- 0255 · Avisos de negócio dizem cliente, Status 2 e corretor, e abrem o card
--
-- Pedido de 10/10/2026: "ajuste os links das notificações para levar
-- exatamente ao card do negócio notificado e torne as mensagens mais amigáveis
-- (qual cliente, qual status e qual corretor)". O push da CCA chegava como
-- "Dossiê novo na esteira de crédito · O negócio BUB-1790717604419x6280…
-- voltou para a análise".
--
-- Três causas, todas no caminho comum do aviso (`notifications`, BEFORE
-- INSERT), e não em cada uma das ~15 funções que avisam:
--   1. `texto_com_nome_do_cliente` (0184) só reconhecia código `NEG-0000`. Os
--      negócios migrados do Bubble têm código `BUB-…`, e o aviso mostrava o
--      código cru no lugar do cliente.
--   2. `notifications_link_do_negocio` (0231) só completava o link exato
--      '/pipeline' ou '/cca'. '/pipeline?conferencia=pendente' (aviso de
--      conferência) ficava sem o negócio, e o "Abrir card" caía na lista.
--   3. Nenhum aviso dizia o corretor nem o Status 2 do negócio.
--
-- Agora: o código de qualquer prefixo vira o nome do cliente; o link de
-- '/pipeline' e '/cca', com ou sem parâmetros, ganha `negocio=<id>`; e o aviso
-- de UM negócio abre o corpo com "Corretor … · Status …". O aviso de dossiê
-- novo para a CCA ganha título com o cliente e link direto para o card.
-- =============================================================================

-- 1. Código de qualquer prefixo → nome do cliente ------------------------------
create or replace function public.texto_com_nome_do_cliente(p_texto text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_texto  text := p_texto;
  v_codigo text;
  v_nome   text;
begin
  if p_texto is null then
    return null;
  end if;
  -- 0255: `NEG-0001` (CRM) e `BUB-1790717604419x628…` (migrados do Bubble).
  for v_codigo in
    select distinct m[1] from regexp_matches(p_texto, '\m([A-Z]{2,5}-[0-9][0-9A-Za-z]*)', 'g') as m
  loop
    select nullif(btrim(c.full_name), '') into v_nome
      from public.deals d
      join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
     where d.code = v_codigo;
    if v_nome is not null then
      v_texto := replace(v_texto, v_codigo, v_nome);
    end if;
  end loop;
  return v_texto;
end;
$$;

revoke all on function public.texto_com_nome_do_cliente(text) from public, anon, authenticated;

-- 2. Link do negócio também com parâmetros ------------------------------------
create or replace function public.notifications_link_do_negocio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id text := current_setting('faceimob.negocio_da_transacao', true);
begin
  if new.link ~ '^/(pipeline|cca)(\?|$)'
     and new.link !~ '[?&]negocio='
     and v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.link := new.link || case when position('?' in new.link) > 0 then '&' else '?' end
                || 'negocio=' || v_id;
  end if;
  return new;
end;
$$;
revoke all on function public.notifications_link_do_negocio() from public, anon, authenticated;

-- 3. Corretor e Status 2 no corpo do aviso de negócio ---------------------------
-- Roda depois do link (gatilhos BEFORE vão em ordem alfabética: `link_do_negocio`
-- antes de `nome_do_cliente`), então o negócio já está no link.
create or replace function public.contexto_do_negocio(p_deal_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(concat_ws(' · ',
           'Corretor ' || (select string_agg(nullif(btrim(p.full_name), ''), ', ' order by dp.ordinal, p.full_name)
                             from public.deal_participants dp
                             join public.profiles p on p.id = dp.profile_id
                            where dp.deal_id = d.id and dp.role = 'broker'),
           'Status ' || nullif(public.deal_status_bare(d.status_detail), '')), '')
    from public.deals d
   where d.id = p_deal_id;
$$;

revoke all on function public.contexto_do_negocio(uuid) from public, anon, authenticated;

create or replace function public.notifications_nome_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Padrão exato de uuid: um cast que falhasse derrubaria o aviso inteiro.
  v_id       uuid := substring(new.link from '[?&]negocio=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid;
  v_contexto text;
begin
  new.title := public.texto_com_nome_do_cliente(new.title);
  new.body := public.texto_com_nome_do_cliente(new.body);

  if v_id is not null then
    v_contexto := public.contexto_do_negocio(v_id);
    if v_contexto is not null and position(v_contexto in coalesce(new.body, '')) = 0 then
      new.body := left(v_contexto || coalesce(E'\n' || nullif(new.body, ''), ''), 2000);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_nome_do_cliente() from public, anon, authenticated;

-- 4. Dossiê novo para a CCA: cliente no título e link direto ----------------------
create or replace function public.notify_cca_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente text;
begin
  if tg_op = 'UPDATE' and new.submitted_at is not distinct from old.submitted_at then
    return null;
  end if;

  select coalesce(nullif(btrim(c.full_name), ''), d.code, 'negócio sem nome')
    into v_cliente
    from public.deals d
    left join public.deal_clients c on c.deal_id = d.id and c.ordinal = 1
   where d.id = new.deal_id;

  insert into public.notifications (profile_id, kind, title, body, link, channel)
  select p.id,
         'cca_pending',
         case when tg_op = 'INSERT' then 'Dossiê novo na esteira: ' else 'Dossiê voltou para a esteira: ' end
           || coalesce(v_cliente, 'negócio sem nome'),
         case when tg_op = 'INSERT'
              then 'Chegou para a análise de crédito.'
              else 'Voltou para a análise de crédito.' end,
         '/cca?negocio=' || new.deal_id,
         'in_app'
    from public.user_roles ur
    join public.profiles p on p.id = ur.profile_id and p.status = 'active'
   where ur.role = 'cca';

  return null;
end;
$$;

revoke all on function public.notify_cca_case_created() from public, anon, authenticated;
