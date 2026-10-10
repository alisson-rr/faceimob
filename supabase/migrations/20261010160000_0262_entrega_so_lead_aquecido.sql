-- =============================================================================
-- 0262 · Entrega só de lead aquecido
--
-- Pedido de 10/10/2026: "entregando os sem atividade perde o sentido de triar e
-- aquecer". Volta atrás na entrega por silêncio da 0260 e passa a exigir, por
-- agente, as respostas sem as quais o lead não é entregue:
--
--  * Cron `faceimob-sdr-sem-resposta` e `sdr_entregar_sem_resposta()` saem.
--    Conversa parada fica com o robô; se o lead voltar, a conversa continua.
--  * `sdr_agents.required_fields` (subconjunto de `collect_fields`): o
--    [QUALIFICADO] só vale com todas elas apuradas. A Ana nasce exigindo Renda,
--    FGTS e Região de interesse. A Luna não exige campo: o [QUALIFICADO] dela
--    já é "o modelo de trabalho faz sentido" (prompt da 0256).
-- =============================================================================

do $do$
begin
  if to_regprocedure('cron.unschedule(text)') is null then
    raise notice '[0262] cron ausente; nada a desagendar (ambiente de teste).';
    return;
  end if;
  begin
    if exists (select 1 from cron.job where jobname = 'faceimob-sdr-sem-resposta') then
      perform cron.unschedule('faceimob-sdr-sem-resposta');
    end if;
  exception when others then
    raise warning '[0262] não foi possível desagendar a entrega por silêncio: %', sqlerrm;
  end;
end
$do$;

drop function if exists public.sdr_entregar_sem_resposta();

alter table public.sdr_agents
  add column if not exists required_fields text[] not null default '{}';

alter table public.sdr_agents drop constraint if exists sdr_agents_required_fields_check;
alter table public.sdr_agents add constraint sdr_agents_required_fields_check
  check (required_fields <@ collect_fields);

comment on column public.sdr_agents.required_fields is
  'Respostas sem as quais o lead não é entregue (0262): o [QUALIFICADO] só vale com todas apuradas. Subconjunto de collect_fields.';

update public.sdr_agents
   set collect_fields = (
         select array_agg(distinct campo order by campo)
           from unnest(collect_fields || array['Renda', 'FGTS', 'Região de interesse']) campo
       ),
       required_fields = array['Renda', 'FGTS', 'Região de interesse']
 where upper(btrim(name)) = 'ANA' and cardinality(required_fields) = 0;
