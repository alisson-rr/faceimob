-- 0334 — feriados (fixos e móveis pela Páscoa) e fim de semana livres de IP.
\set ON_ERROR_STOP on
begin;

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', label; end if;
  raise notice '  ok  %', label;
end;
$$;

select pg_temp.ok(public.pascoa(2026) = date '2026-04-05' and public.pascoa(2027) = date '2027-03-28',
  'Páscoa de 2026 e 2027');
select pg_temp.ok(public.feriado_nome(date '2026-02-16') = 'Carnaval'
  and public.feriado_nome(date '2026-02-17') = 'Carnaval'
  and public.feriado_nome(date '2026-04-03') = 'Sexta-feira Santa'
  and public.feriado_nome(date '2026-06-04') = 'Corpus Christi', 'feriados móveis de 2026');
select pg_temp.ok(public.feriado_nome(date '2026-11-20') = 'Consciência Negra'
  and public.feriado_nome(date '2026-09-20') = 'Revolução Farroupilha'
  and public.feriado_nome(date '2026-02-02') = 'Nossa Senhora dos Navegantes', 'feriados fixos, do RS e de Porto Alegre');
select pg_temp.ok(public.feriado_nome(date '2026-11-18') is null, 'dia útil comum não é feriado');

select pg_temp.ok(public.checkin_motivo_livre_automatico(date '2026-11-14') = 'Fim de semana'
  and public.checkin_motivo_livre_automatico(date '2026-11-20') = 'Consciência Negra'
  and public.checkin_motivo_livre_automatico(date '2026-11-18') is null, 'motivo do dia livre sozinho');
select pg_temp.ok((select count(*) from public.checkin_dias_livres_automaticos(date '2026-11-16', 7)) = 3,
  'semana de 16/11: Consciência Negra, sábado e domingo');

update public.automation_settings set checkin_ip_livre_feriado = false where id;
select pg_temp.ok(public.checkin_motivo_livre_automatico(date '2026-11-20') is null,
  'feriado desligado volta a cobrar o IP');

rollback;
