-- =============================================================================
-- 0071 — O anexo do lead: gravar, promover e o mês que o diretor está olhando
--
-- Dois achados da rodada de E2E de 02/09, cada um provado por reprodução no
-- banco de homologação (transação + rollback), não por leitura de código.
--
-- 1. ANEXAR ARQUIVO A UM LEAD NUNCA FUNCIONOU PARA USUÁRIO LOGADO. A policy
--    `lead_attachments_storage` (0012) exige, no `using`, que já exista a linha
--    de `lead_attachments` com aquele caminho — e a linha só nasce DEPOIS do
--    upload (`uploadLeadAttachment`, src/integrations/supabase/leads.ts): sem o
--    arquivo no bucket não há `storage_path` para gravar, e gravar a linha
--    antes deixaria registro apontando para arquivo que pode não subir.
--
--    O `with_check` sozinho bastaria — mas o Storage não faz um INSERT simples:
--    toda gravação passa por `UpsertObject`
--    (`insert ... on conflict (name, bucket_id) do update ... returning *`), e
--    nessa forma o Postgres também cobra o `using` da policy de UPDATE/ALL
--    sobre a linha proposta. Medido no alvo: `insert` puro passa; o MESMO
--    `insert` com `on conflict do update` responde 42501 — que é o
--    "new row violates row-level security policy" (HTTP 400, statusCode 403)
--    que o corretor recebia em toda tentativa de anexar.
--
--    O conserto é o mesmo que a 0059 aplicou ao bucket do negócio: o primeiro
--    segmento do caminho identifica o dono (`<lead_id>/<arquivo>`), então a
--    autorização sai do prefixo e não da linha que ainda não existe. De quebra
--    volta a funcionar o `storage.remove` de rollback do arquivo órfão (o
--    `delete` também passa pelo `using`).
--
--    E, já que a regra deixa de depender da linha, o `with_check` deixa de ser
--    `bucket_id = 'lead-attachments'` e nada mais — que era escrita livre: com
--    `x-upsert`, qualquer autenticado sobrescrevia qualquer anexo de qualquer
--    lead. Passa a cobrar `can_write_lead` do lead do prefixo, a MESMA
--    expressão que `lead_attachments_insert` (0041) cobra na tabela.
--
--    O ramo da LINHA ganha, explícito, o `can_see_lead` que hoje só vale por
--    tabela de fora. NÃO é buraco aberto: medido no alvo (transação com
--    `set local role authenticated` e o JWT de cada corretor), o `exists` sobre
--    `public.lead_attachments` dentro da policy do bucket já é filtrado pela RLS
--    da PRÓPRIA `lead_attachments` — com a policy da 0012, o dono do lead lê o
--    caminho `seed/leads/003/...` e um corretor de outra equipe não lê. Só que a
--    equivalência depende de `lead_attachments_select` continuar sendo
--    exatamente `can_see_lead(lead_id)` e nada mais: basta alguém acrescentar um
--    ramo de papel lá (a `lead_attachments_delete` vizinha já tem
--    `admin`/`cca`) para o bucket afrouxar junto, em silêncio — e como a policy
--    é FOR ALL, esse `using` governa leitura E exclusão. A gêmea da 0059
--    qualifica o ramo equivalente com `can_see_deal` pelo mesmo motivo. Um
--    predicado redundante hoje, local, vale mais que uma dependência implícita
--    entre duas policies em schemas diferentes.
--
-- 2. O "RESUMO DO MÊS" DO CHECKPOINT MOSTRAVA O MÊS ANTERIOR NO COMEÇO DE TODO
--    MÊS. `public_director_checkpoint` (0062) ancorava o mês no PRIMEIRO dia da
--    semana navegada. Em 02/09/2026 a semana corrente começa em 31/08, então o
--    diretor via "Resumo do mês (agosto), de 01/08 a 31/08" — e tudo o que as
--    equipes lançaram em 01 e 02/09 sumia do acumulado, sem sumir do funil da
--    semana logo acima, na MESMA tela. Vale para os primeiros dias de todo mês
--    que não começa numa segunda-feira.
--
--    O Diário (`public_daily_team`, 0062) já conta o mês a partir de
--    `date_trunc('month', current_date)`, e o harness SQL já cobrava a mesma
--    régua aqui ("o mês vai do dia 1 até hoje", supabase/tests/
--    10_public_daily_flows.sql) — assert que só falha nos dias em que a semana
--    atravessa o mês, e que ninguém viu porque ele precisa de Docker. Eram duas
--    telas medindo o mesmo dia com meses diferentes.
--
--    Correção mínima: na semana em que HOJE está, o mês é o de hoje; em
--    qualquer outra semana navegada nada muda — inclusive a semana futura, que
--    continua ancorada no próprio começo e volta zerada (o outro assert do
--    mesmo harness).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bucket lead-attachments: autorização pelo prefixo, não pela linha futura
--
-- `public.deal_id_of_object` (0059) devolve o primeiro segmento do caminho
-- quando ele é um uuid, e NULL para qualquer outro formato — o nome fala em
-- "deal" por ter nascido no bucket do negócio, mas a conta é a do prefixo e
-- serve igual aqui. Caminho fora do padrão (os `seed/leads/...` do catálogo)
-- continua legível pelo ramo da linha, para quem enxerga o lead dela — o que a
-- RLS de `lead_attachments` já impunha e agora está escrito aqui também.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage do Supabase ausente - policy de bucket ignorada (ambiente de teste)';
    return;
  end if;

  execute 'drop policy if exists lead_attachments_storage on storage.objects';
  execute $p$
    create policy lead_attachments_storage on storage.objects
      for all to authenticated
      using (
        bucket_id = 'lead-attachments'
        and (
          (
            public.deal_id_of_object(storage.objects.name) is not null
            and public.can_see_lead(public.deal_id_of_object(storage.objects.name))
          )
          or exists (
            select 1 from public.lead_attachments a
            where a.storage_path = storage.objects.name
              and public.can_see_lead(a.lead_id)
          )
        )
      )
      with check (
        bucket_id = 'lead-attachments'
        and public.deal_id_of_object(storage.objects.name) is not null
        and public.can_write_lead(public.deal_id_of_object(storage.objects.name))
      )
  $p$;
exception
  when insufficient_privilege then
    raise notice 'sem privilégio para recriar a policy do bucket - ignorado';
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Checkpoint da diretoria: o mês segue o dia que o diretor está olhando
--
-- Corpo idêntico ao da 0062, menos a âncora do mês (e o comentário dela).
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

  -- O mês acompanha a semana navegada — mas, na semana em que HOJE está, ele
  -- acompanha HOJE. Ancorar sempre no primeiro dia da semana fazia o cartão
  -- "Resumo do mês" mostrar o mês ANTERIOR nos primeiros dias de todo mês que
  -- não começa numa segunda: em 02/09 (semana de 31/08 a 06/09) o diretor lia
  -- "mês de agosto, de 01/08 a 31/08" e o que as equipes lançaram em 01 e
  -- 02/09 sumia do acumulado — sem sumir do funil da SEMANA, logo acima, na
  -- mesma tela. É também a régua do Diário (`public_daily_team` conta a partir
  -- de `date_trunc('month', current_date)`) e a que o harness já cobrava em
  -- `supabase/tests/10_public_daily_flows.sql` ("o mês vai do dia 1 até hoje").
  --
  -- Fora da semana corrente nada muda: semana passada continua trazendo o mês
  -- dela e semana futura continua ancorada no próprio começo, o que mantém o
  -- intervalo vazio (`v_month_end` fica em `current_date`) e o mês futuro
  -- zerado.
  v_month_start := date_trunc(
    'month',
    case when current_date between v_start and v_end then current_date else v_start end
  )::date;
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
  'Funil da semana por equipe (com gerente, meta da equipe e link do Diário), pendências em dia útil e acumulado do mês de todas as equipes do diretor — o mês é o de hoje na semana corrente e o da semana navegada nas demais. Slug desconhecido responde igual a slug conhecido: pede PIN quando não veio PIN, recusa em NULL quando veio.';

grant execute on function public.public_director_checkpoint(text, date, text) to anon, authenticated;
