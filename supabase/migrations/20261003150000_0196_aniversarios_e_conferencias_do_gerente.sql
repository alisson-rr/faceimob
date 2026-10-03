-- =============================================================================
-- 0196 — aniversariantes do dia e conferências que esperam o gerente
--
-- Pedido do cliente em 03/10/2026:
--   1. Parabéns ao aniversariante (popup com som no app e WhatsApp) e aviso a
--      todos de que hoje é aniversário de alguém. A data vem da ficha do
--      colaborador (`profiles.birth_date`, 0046). Para a equipe sai só nome e
--      foto de quem faz aniversário HOJE — nunca o ano nem a data de ninguém.
--   2. Popup do gerente: quantas análises ele tem para conferir e mandar ao
--      CCA. É a fila da conferência documental (0028): negócio com
--      `document_review_status = 'pending'` em que ele é o gerente.
-- =============================================================================

create or replace function public.aniversariantes_de_hoje()
returns table (profile_id uuid, nome text, avatar_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         coalesce(nullif(btrim(p.nickname), ''), p.full_name),
         p.avatar_url
    from public.profiles p
   where auth.uid() is not null
     and p.status = 'active'
     and p.birth_date is not null
     and to_char(p.birth_date, 'MM-DD') = to_char(public.current_work_date(), 'MM-DD')
   order by 2;
$$;

revoke all on function public.aniversariantes_de_hoje() from public, anon;
grant execute on function public.aniversariantes_de_hoje() to authenticated;
comment on function public.aniversariantes_de_hoje() is
  'Quem faz aniversário hoje (horário de Brasília): só nome e foto, sem a data (0196).';

-- WhatsApp e sino para o aniversariante, uma vez por dia. Roda no cron das 8h.
create or replace function public.parabenizar_aniversariantes()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int := 0;
  v_pessoa record;
begin
  for v_pessoa in
    select p.id, coalesce(nullif(btrim(p.nickname), ''), split_part(btrim(p.full_name), ' ', 1)) as nome
      from public.profiles p
     where p.status = 'active'
       and p.birth_date is not null
       and to_char(p.birth_date, 'MM-DD') = to_char(public.current_work_date(), 'MM-DD')
       and not exists (
         select 1 from public.notifications n
          where n.profile_id = p.id and n.kind = 'aniversario'
            and (n.created_at at time zone 'America/Sao_Paulo')::date = public.current_work_date()
       )
  loop
    insert into public.notifications (profile_id, kind, title, body, channel)
    values
      (v_pessoa.id, 'aniversario', '🎂 Feliz aniversário, ' || v_pessoa.nome || '!',
       'Hoje o dia é seu! Toda a família Faceimob deseja muita saúde, alegria e muitas vendas. 🎉🥳', 'in_app'),
      (v_pessoa.id, 'aniversario', '🎂 Feliz aniversário, ' || v_pessoa.nome || '!',
       'Hoje o dia é seu! Toda a família Faceimob deseja muita saúde, alegria e muitas vendas. 🎉🥳', 'whatsapp');
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.parabenizar_aniversariantes() from public, anon, authenticated;
grant execute on function public.parabenizar_aniversariantes() to service_role;

-- Análises que esperam a conferência do gerente que pergunta.
create or replace function public.minhas_conferencias_pendentes()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct d.id)::int
    from public.deals d
    join public.deal_participants dp on dp.deal_id = d.id and dp.role = 'manager'
   where auth.uid() is not null
     and dp.profile_id = auth.uid()
     and d.document_review_status = 'pending';
$$;

revoke all on function public.minhas_conferencias_pendentes() from public, anon;
grant execute on function public.minhas_conferencias_pendentes() to authenticated;
comment on function public.minhas_conferencias_pendentes() is
  'Negócios em conferência documental (pending) em que quem pergunta é o gerente — o popup do gerente (0196).';

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0196] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-aniversarios') then
      perform cron.unschedule('faceimob-aniversarios');
    end if;
    -- 8h em Brasília = 11h UTC.
    perform cron.schedule('faceimob-aniversarios', '0 11 * * *', $cmd$select public.parabenizar_aniversariantes();$cmd$);
  exception when others then
    raise warning '[0196] não foi possível agendar os parabéns: %', sqlerrm;
  end;
end
$do$;
