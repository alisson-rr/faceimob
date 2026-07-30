-- =============================================================================
-- 0014 · Quem estoura o prazo perde a vez
--
-- Achado no teste E2E da 0013 (docs/sprints/roteiro-teste-roleta.md, seção 5):
-- o lead vencido podia voltar na hora para o mesmo corretor que o ignorou.
--
-- A causa era a ordenação da fila. distribution_queue ordenava por
-- max(lead_assignments.assigned_at), e o corretor que perdeu o lead por timeout
-- continuava carregando o assigned_at daquele lead — 5 minutos atrás. Se todos
-- os outros elegíveis tinham recebido algo mais recente, ele seguia na frente e
-- recebia o mesmo lead de volta imediatamente.
--
-- Regra confirmada com o cliente em 30/07: o lead PODE voltar para o mesmo
-- corretor, desde que passe por toda a fila de novo.
--
-- A correção é tratar o timeout como vez consumida: a partir daqui a ordenação
-- usa o fim do turno, não o começo. Para uma atribuição encerrada por timeout, o
-- fim do turno é o released_at.
--
-- Só `timeout` conta. Os outros motivos de liberação não são falha do corretor:
--   manual / reassigned  — o gestor tirou o lead dele
--   checkout             — encerrou o turno (já sai da fila, sem check-in aberto)
--   sdr_handoff          — repasse do SDR, não atendimento humano perdido
-- Penalizar esses casos puniria o corretor por decisão de terceiro.
--
-- Efeito colateral pretendido: o corretor que ignora leads afunda na fila em vez
-- de recebê-los em looping. Combina com o bloqueio por 20 leads atrasados —
-- aquele barra o check-in, este reduz o dano antes de chegar ao bloqueio.
-- =============================================================================

-- A assinatura muda (nova coluna last_turn_at), e CREATE OR REPLACE não altera
-- o retorno de uma função. Sem CASCADE de propósito: se algo passar a depender
-- dela por SQL, o DROP falha e o problema aparece aqui, não em produção.
-- assign_lead() a chama de dentro de plpgsql, resolvido em tempo de execução.
drop function if exists public.distribution_queue(uuid);

create function public.distribution_queue(p_group_id uuid)
returns table (
  profile_id       uuid,
  full_name        text,
  queue_position   int,
  last_assigned_at timestamptz,
  last_turn_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      c.profile_id,
      p.full_name,
      -- Último lead recebido. Continua sendo o dado que a tela do corretor
      -- mostra ("seu último lead foi às ..."), então mantém o significado.
      (
        select max(la.assigned_at)
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_assigned_at,
      -- Fim da última vez na roleta. É a chave de ordenação: um lead perdido no
      -- prazo encerra a vez no released_at, não no assigned_at.
      (
        select max(
          case
            when la.release_reason = 'timeout' then la.released_at
            else la.assigned_at
          end
        )
        from public.lead_assignments la
        where la.profile_id = c.profile_id
      ) as last_turn_at
    from public.checkins c
    join public.profiles p on p.id = c.profile_id
    join public.distribution_group_members m
      on m.profile_id = c.profile_id and m.active
    join public.work_shifts s on s.id = c.shift_id
    where c.work_date = current_date
      and c.checked_out_at is null
      and m.group_id = p_group_id
      and p.status = 'active'
      and (now() at time zone 'America/Sao_Paulo')::time >= s.distribution_start
      and public.overdue_lead_count(c.profile_id)
          < (select s2.overdue_block_threshold from public.automation_settings s2 where s2.id)
  )
  select
    e.profile_id,
    e.full_name,
    row_number() over (order by e.last_turn_at asc nulls first, e.profile_id)::int
      as queue_position,
    e.last_assigned_at,
    e.last_turn_at
  from eligible e;
$$;

comment on function public.distribution_queue is
  'Fila ordenada da roleta de um grupo. Alimenta o indicador de posição na tela '
  'do corretor. Ordena por last_turn_at (fim da última vez na roleta), não por '
  'last_assigned_at: quem perde o lead por timeout encerra a vez no momento da '
  'liberação e vai para o fim da fila. O lead só volta para ele depois de a fila '
  'inteira ter tido a vez — regra confirmada com o cliente em 30/07.';

-- DROP levou os grants junto; restaurar os da 0005.
revoke all on function public.distribution_queue(uuid) from public, anon;
grant execute on function public.distribution_queue(uuid) to authenticated;
