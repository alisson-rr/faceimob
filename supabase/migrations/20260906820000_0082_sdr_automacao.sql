-- =============================================================================
-- 0082 · SDR e cofre: três buracos que só o console do banco resolvia
--
-- 1. QUEM FALOU EM CADA TURNO
--    `sdr_conversations.agent_id` guarda só o agente ATUAL. Quando a cadeia
--    troca de agente (`handoff_to_agent_id`), a coluna é sobrescrita e a
--    passagem anterior desaparece — a aba Conversas mostra "Qualificador" numa
--    conversa que começou no orquestrador, e ninguém consegue auditar por onde
--    o lead passou. `sdr_messages.agent_id` grava o autor de cada resposta, que
--    é o único lugar onde a cadeia sobrevive ao próximo handoff.
--    Nulo nas mensagens do lead e nas linhas antigas: histórico não é
--    reconstruível e inventar um agente para ele seria pior que o "—".
--
-- 2. REVOGAR CREDENCIAL
--    O cofre só tinha `set_integration_secret`. Chave vazada exigia abrir o
--    console do Postgres: a coluna `active` já existia e nenhuma RPC a
--    alcançava. `private.get_integration_secret` filtra por `active`, então
--    desligar a linha corta o acesso na próxima leitura sem redeploy — e o
--    segredo é apagado junto, porque manter o valor de uma chave revogada é
--    guardar um risco sem uso.
--
--    Consequência de seguir por aqui: revogar é irreversível pela tela (o valor
--    não volta); quem revogar por engano precisa colar a credencial de novo.
--    A alternativa — só desativar, mantendo o texto — deixaria uma chave
--    vazada guardada no banco, que é exatamente o cenário que motivou a RPC.
--
-- 3. VER A FILA REPRESADA
--    `notifications` tem RLS de dono (`profile_id = auth.uid()` e só `in_app`),
--    então NENHUM administrador enxerga as mensagens de WhatsApp esperando
--    credencial — hoje 312 linhas com `last_error` gravado pelo cron. O admin
--    descobria pelo banco. A RPC agrega por canal, sem devolver corpo nem
--    destinatário: quantas esperam, desde quando e qual o último erro.
--
-- Idempotente: roda de novo sem efeito colateral.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Agente que escreveu cada mensagem
-- -----------------------------------------------------------------------------
alter table public.sdr_messages
  add column if not exists agent_id uuid references public.sdr_agents(id) on delete set null;

comment on column public.sdr_messages.agent_id is
  'Agente que produziu esta resposta. Nulo na mensagem do lead, na do operador humano e no histórico anterior à 0082. É por aqui que a aba Conversas remonta a cadeia de agentes — sdr_conversations.agent_id só guarda o último.';

create index if not exists sdr_messages_agent_idx
  on public.sdr_messages (agent_id)
  where agent_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Revogar credencial do cofre
-- -----------------------------------------------------------------------------
create or replace function public.revoke_integration_secret(p_provider text, p_label text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_afetadas int;
begin
  -- Mesma porta de `set_integration_secret`: quem grava é quem revoga.
  if not public.has_permission('settings.integrations') then
    raise exception 'Sem permissão para gerenciar integrações.' using errcode = '42501';
  end if;

  update private.integration_credentials
     set secret     = null,
         active     = false,
         updated_by = auth.uid(),
         updated_at = now()
   where provider = p_provider
     and label    = p_label;

  get diagnostics v_afetadas = row_count;
  -- `false` = não havia linha para revogar. A tela distingue isso de uma
  -- recusa por permissão, que chega como 42501.
  return v_afetadas > 0;
end;
$$;

revoke all on function public.revoke_integration_secret(text, text) from public;
grant execute on function public.revoke_integration_secret(text, text) to authenticated;

comment on function public.revoke_integration_secret(text, text) is
  'Apaga o segredo e marca a credencial como inativa. private.get_integration_secret filtra por active, então a próxima leitura de uma edge function já não encontra o valor (instâncias aquecidas podem manter o cache por alguns minutos).';

-- -----------------------------------------------------------------------------
-- 3. Fila de notificações por canal
-- -----------------------------------------------------------------------------
create or replace function public.notification_queue_health()
returns table (
  channel      text,
  pendentes    bigint,
  com_erro     bigint,
  mais_antiga  timestamptz,
  ultimo_erro  text,
  max_tentativas int
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
  select n.channel::text,
         count(*)                                             as pendentes,
         count(*) filter (where n.last_error is not null)      as com_erro,
         min(n.created_at)                                     as mais_antiga,
         -- Só o texto do erro. Título, corpo e destinatário ficam de fora: a
         -- tela precisa saber o que trava a fila, não ler a mensagem de ninguém.
         (array_agg(n.last_error order by n.created_at desc)
            filter (where n.last_error is not null))[1]        as ultimo_erro,
         coalesce(max(n.attempts), 0)                          as max_tentativas
    from public.notifications n
   where n.sent_at is null
   group by n.channel
   order by 1;
end;
$$;

revoke all on function public.notification_queue_health() from public;
grant execute on function public.notification_queue_health() to authenticated;

comment on function public.notification_queue_health() is
  'Quantas notificações esperam envio por canal, desde quando e com qual erro. Existe porque a RLS de notifications é de dono e nenhum admin via a fila de WhatsApp represada por falta de credencial.';
