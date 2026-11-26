-- =============================================================================
-- 0362 · Meta: painel atualizado duas vezes por dia, 08:00 e 18:00
--
-- Pedido de 25/11/2026: "atualize esse painel 2x ao dia, às 08 e às 18:00".
-- Os jobs são os da 0333 (criados pelo usuário da migration); `cron.schedule`
-- com o mesmo nome troca o horário do job existente.
--   · faceimob-meta-sync-diaria  08:00 e 18:00 (11:00 e 21:00 UTC)
--   · faceimob-meta-anuncios     08:05 e 18:05, logo depois dos números
--   · faceimob-meta-resumo-0830  continua às 08:30 (já com os números das 08:00)
-- =============================================================================

do $do$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice '[0362] cron.schedule ausente; nada agendado (ambiente de teste).';
    return;
  end if;
  begin
    perform cron.schedule('faceimob-meta-sync-diaria', '0 11,21 * * *', $cmd$select public.dispatch_meta_sync();$cmd$);
    perform cron.schedule('faceimob-meta-anuncios', '5 11,21 * * *', $cmd$select public.dispatch_meta_sync_modo('anuncios');$cmd$);
  exception when others then
    raise exception '[0362] não consegui reagendar a sincronização da Meta: %', sqlerrm;
  end;
end
$do$;
