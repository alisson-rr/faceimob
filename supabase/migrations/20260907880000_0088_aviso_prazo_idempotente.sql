-- =============================================================================
-- 0088 — Aviso de lead perdido por prazo: um estouro, um aviso; a fila de saída
--        para de contar o sino e de esconder o que não foi entregue; e o aviso
--        deixa de prometer um destino que quem foi avisado não abre.
--
-- A 0065 e a 0083 fecharam o encanamento do requisito 10 (o gatilho grava as
-- duas linhas, o cron drena, o worker explica a recusa, a fila tem teto de
-- idade). Sobraram três defeitos medidos na homologação em 05/09/2026, todos do
-- mesmo tipo: "o que alguém lê está errado".
--
--  1. IDEMPOTÊNCIA NÃO É ESTRUTURAL. O gatilho `notify_lead_timeout` dispara em
--     `after update of released_at` SEM recorte de transição: qualquer segunda
--     escrita em `released_at` numa atribuição já fechada por timeout grava
--     OUTRO par de avisos para o mesmo estouro. Medido, e desfeito por rollback:
--     um `update lead_assignments set released_at = now()` numa linha que já
--     tinha `release_reason = 'timeout'` levou `lead_lost_timeout` de 718 para
--     720 linhas — duas cópias do mesmo fato, uma no sino do corretor e outra na
--     fila de WhatsApp.
--
--     Hoje nenhum caminho de produção faz isso: os cinco escritores de
--     `released_at` (`assign_lead`, `claim_lead`, `close_lead`, `reassign_lead`
--     e `release_expired_leads`) recortam por `released_at is null`. É
--     justamente por isso que o defeito é barato de fechar agora e caro depois —
--     a garantia depende de todo escritor futuro lembrar do recorte. Uma
--     cláusula `when` no gatilho move a garantia para o ponto por onde TODOS
--     passam.
--
--     `old.released_at is null and new.released_at is not null` é a transição
--     "fechou agora", a única em que o lead de fato acabou de estourar o prazo.
--     Reabrir a atribuição ou reescrever uma linha já fechada deixa de produzir
--     aviso.
--
--  2. A FILA DE SAÍDA CONTA O SINO E ESCONDE O DESCARTE. `notification_queue_health()`
--     (0082) agrega tudo com `sent_at is null` sem excluir `in_app` — e linha de
--     sino NUNCA recebe `sent_at`. O admin lia 891 mensagens represadas com a
--     fila de WhatsApp em ZERO. E o outro lado do mesmo recorte apagava o número
--     que importa: 788 mensagens de WhatsApp geradas, ZERO entregues, 788
--     descartadas sem entrega — nenhuma aparecia.
--
--  3. O AVISO PROMETE UM DESTINO FECHADO. O link `/leads?lead=<id>` só abre para
--     quem pode ver o lead — e o lead acabou de voltar para a roleta, sem dono.
--     Dos 352 avisos `lead_lost_timeout` do sino, 352 apontam para lead sem dono.
--
-- Idempotente: `drop trigger if exists` + `create trigger`, `create or replace`,
-- e um UPDATE de backfill que converge para zero linha.
-- Nenhuma mudança de schema — `types.ts` não precisa ser regerado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Um estouro de prazo, um aviso
--
-- A função não decide isso; o gatilho decide QUANDO chamá-la. Repetir o recorte
-- de transição dentro do corpo seria a mesma regra em dois lugares; na cláusula
-- `when` ela também evita a chamada de função quando não há o que fazer.
-- -----------------------------------------------------------------------------
drop trigger if exists notify_lead_timeout on public.lead_assignments;
create trigger notify_lead_timeout
  after update of released_at on public.lead_assignments
  for each row
  when (old.released_at is null and new.released_at is not null)
  execute function public.notify_lead_timeout();

-- -----------------------------------------------------------------------------
-- 2. "Esperando envio" é só o que tem envio pendente — e o que saiu SEM entrega
--    aparece do lado, em vez de sumir
--
-- Duas correções na mesma leitura, porque as duas produzem o mesmo estrago (o
-- admin decidindo sobre a credencial a partir de um número que não descreve a
-- fila):
--
--  a) `in_app` sai da conta. É caixa de entrada, nunca recebe `sent_at`, e por
--     isso todo aviso do sino desde julho aparecia como "esperando envio" — 891
--     linhas na coluna "Esperando" com a fila de WhatsApp em ZERO, o inverso
--     exato do que aquele painel existe para dizer.
--
--  b) O descarte sem entrega entra. `expire_stale_outbound_notifications` (0083)
--     carimba `sent_at` na linha vencida, e o worker faz o mesmo no "perfil sem
--     telefone": nesta tabela `sent_at` significa "saiu da fila", não "chegou".
--     Com o recorte de (a) sozinho, essas linhas sumiriam da única tela que
--     responde "o canal de WhatsApp está entregando?" — 788 geradas, 788
--     descartadas, ZERO entregues, painel limpo. Pior: o aviso que a 0083 manda
--     ao admin ("Avisos descartados sem entrega") aponta para essa tela, e ela
--     responderia "Nenhuma notificação esperando envio".
--
--     Elas voltam como uma linha própria por canal, `<canal> · descartadas 24h`,
--     com `pendentes = 0` (é verdade: não esperam mais nada), a contagem em
--     "Com erro" e a última recusa em "Último motivo". A janela de 24 h é a
--     mesma da coluna "Falhas 24h" da tabela de jobs, logo acima na mesma aba.
--
-- O recorte fica na RPC, e não na tela, porque a mesma pergunta é feita pelo
-- painel Admin · Integrações e pelo `e2e/admin/crons.spec.ts`; corrigir só a
-- tela deixaria o teste medindo outra coisa. A pendência estava registrada no
-- cabeçalho da 0083. A assinatura NÃO muda — mesmas seis colunas, e a tela já
-- renderiza uma linha por `channel` devolvido.
-- -----------------------------------------------------------------------------
create or replace function public.notification_queue_health()
returns table (
  channel        text,
  pendentes      bigint,
  com_erro       bigint,
  mais_antiga    timestamptz,
  ultimo_erro    text,
  max_tentativas integer
)
language plpgsql
security definer
set search_path = public
as $$
-- Os parâmetros de saída se chamam como as colunas lidas (`channel`). Sem esta
-- diretiva o plpgsql resolveria o identificador para a variável e a consulta
-- falharia em tempo de execução, não de criação — erro que só apareceria com a
-- tela já publicada.
#variable_conflict use_column
begin
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para ver a fila de notificações.' using errcode = '42501';
  end if;

  return query
  with saida as (
    select n.channel::text  as canal,
           n.sent_at is null as esperando,
           n.created_at,
           n.last_error,
           n.attempts
      from public.notifications n
     where n.channel <> 'in_app'
       and (
         n.sent_at is null
         or (n.last_error is not null and n.sent_at > now() - interval '24 hours')
       )
  )
  select case when s.esperando then s.canal else s.canal || ' · descartadas 24h' end,
         count(*) filter (where s.esperando)                    as pendentes,
         count(*) filter (where s.last_error is not null)       as com_erro,
         min(s.created_at)                                      as mais_antiga,
         -- Só o texto do erro. Título, corpo e destinatário ficam de fora: a
         -- tela precisa saber o que trava a fila, não ler a mensagem de ninguém.
         (array_agg(s.last_error order by s.created_at desc)
            filter (where s.last_error is not null))[1]         as ultimo_erro,
         coalesce(max(s.attempts), 0)                           as max_tentativas
    from saida s
   group by 1
   order by 1;
end;
$$;

comment on function public.notification_queue_health() is
  'Fila de SAÍDA por canal (whatsapp, email): o que ainda espera e, numa linha "<canal> · descartadas 24h", o que saiu da fila SEM entrega nas últimas 24 h. Exclui in_app, que é caixa de entrada e nunca recebe sent_at. Exige settings.integrations.';

revoke all on function public.notification_queue_health() from public, anon;
grant execute on function public.notification_queue_health() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. O aviso de prazo para de prometer um destino que quem foi avisado não abre
--
-- O gatilho gravava `link = '/leads?lead=<id>'`, copiado de
-- `notify_lead_assigned` — onde funciona, porque lá o lead É do corretor. Aqui é
-- o oposto: o lead acabou de voltar para a roleta, `assigned_to` é nulo, e a
-- policy `leads_select` (0044) só mostra lead sem dono a quem tem
-- `leads.view_queue` — permissão de director, manager e marketing, NÃO de
-- corretor. Medido: dos 352 avisos `lead_lost_timeout` do sino, 352 apontam para
-- lead sem dono; nenhum abre para quem foi avisado. O corretor clicava e recebia
-- o toast "Lead indisponível" — um erro no lugar de um fato esperado.
--
-- O destino passa a ser a lista dele. QUAL lead já está no título desde a 0065
-- ("Lead devolvido à fila: <nome>"), que era a razão de existir do parâmetro.
-- `notify_lead_assigned` não muda: lá o link cumpre o que promete.
-- -----------------------------------------------------------------------------
create or replace function public.notify_lead_timeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notify boolean;
  v_nome   text;
  v_titulo text;
  v_corpo  text := 'Você não iniciou o atendimento no prazo e o lead voltou para a roleta.';
begin
  if new.release_reason is distinct from 'timeout' then
    return null;
  end if;

  select notify_on_timeout into v_notify from public.automation_settings where id;
  if not coalesce(v_notify, true) then
    return null;
  end if;

  select coalesce(l.full_name, 'sem nome') into v_nome
    from public.leads l where l.id = new.lead_id;

  v_titulo := 'Lead devolvido à fila: ' || v_nome;

  -- DUAS linhas, uma por canal, como na 0011. A `in_app` é o que o sino mostra;
  -- a `whatsapp` é o que o `notify-dispatch` entrega. Gravar só a primeira
  -- deixaria o item 10 da ata de 14/07 (avisar POR WHATSAPP que o lead se
  -- perdeu) sem produtor nenhum. Duas linhas não duplicam a caixa do corretor —
  -- a policy expõe só `in_app` ao cliente.
  insert into public.notifications (profile_id, kind, title, body, link, channel)
  values
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, '/leads', 'in_app'),
    (new.profile_id, 'lead_lost_timeout', v_titulo, v_corpo, '/leads', 'whatsapp');

  return null;
end;
$$;

comment on function public.notify_lead_timeout() is
  'Avisa o corretor que o lead voltou à roleta por prazo: uma linha in_app (o sino) e uma whatsapp (a fila que o notify-dispatch entrega). O gatilho só dispara na transição released_at nulo -> preenchido, para o mesmo estouro não render dois avisos. O link é /leads, e não o lead: ele volta a ficar sem dono e a RLS não o mostra a quem foi avisado.';

-- Os avisos já gravados carregam a mesma promessa quebrada e o sino os mostra
-- hoje. Recorte por `kind`: `notify_lead_assigned` usa o mesmo formato de link e
-- lá ele funciona.
update public.notifications
   set link = '/leads'
 where kind = 'lead_lost_timeout'
   and link like '/leads?lead=%';
