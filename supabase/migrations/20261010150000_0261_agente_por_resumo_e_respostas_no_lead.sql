-- =============================================================================
-- 0261 · Agente montado por resumo; respostas coletadas no card do lead
--
-- Pedido de 10/10/2026: "no agente quero escrever de forma resumida o que ele
-- tem que fazer e perguntar e as respostas que tem que trazer, e a IA gerar o
-- prompt; as respostas coletadas vão para o card do lead".
--
--  * `sdr_agents.brief`: o resumo escrito por quem configura. O botão "Gerar
--    prompt" da aba Agentes manda o resumo à IA e o texto volta para revisão
--    no campo do prompt — nada é salvo sem a pessoa ver.
--  * `sdr_agents.collect_fields`: as respostas que o agente tem de trazer. A
--    cada turno o agente devolve o que já apurou numa tag escondida do lead, e
--    o turno grava em `sdr_conversations.collected` (coluna da 0008, até aqui
--    sem uso). O card do lead lê dali — o corretor do lead já lê a conversa
--    pela `sdr_conversations_select`.
--  * A Luna nasce com os campos do roteiro dela, para o card já mostrar as
--    respostas sem regerar o prompt.
-- =============================================================================

alter table public.sdr_agents
  add column if not exists brief text,
  add column if not exists collect_fields text[] not null default '{}';

alter table public.sdr_agents drop constraint if exists sdr_agents_collect_fields_check;
alter table public.sdr_agents add constraint sdr_agents_collect_fields_check
  check (cardinality(collect_fields) <= 30 and coalesce(length(brief), 0) <= 6000);

comment on column public.sdr_agents.brief is
  'Resumo do que o agente faz, pergunta e entrega (0261). Base do "Gerar prompt"; o prompt que vale é system_prompt.';
comment on column public.sdr_agents.collect_fields is
  'Respostas que o agente tem de trazer (0261). Gravadas a cada turno em sdr_conversations.collected e mostradas no card do lead.';

update public.sdr_agents
   set collect_fields = array['Nome', 'Unidade', 'Bairro', 'Cidade', 'Período integral',
                              'Experiência em vendas', 'Experiência imobiliária', 'CRECI', 'Veículo próprio']
 where name = 'Luna' and cardinality(collect_fields) = 0;
