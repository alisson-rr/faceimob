-- =============================================================================
-- 0040 · SDR: modelo padrão que a OpenAI conhece + contrato do handoff
--
-- `sdr_agents.model` nascia como 'claude-sonnet-5' (0008) e os dois agentes do
-- seed carregavam o mesmo valor. O único cliente de LLM do projeto é a API de
-- chat da OpenAI (`supabase/functions/_shared/sdrAgent.ts`), que recusa esse
-- nome: toda resposta da IA — Playground e WhatsApp — morria em erro, e na tela
-- o seletor "Modelo OpenAI" abria em branco porque o valor não está na lista.
--
-- Quem escolhe o modelo é a tela (lista fechada de modelos OpenAI) e a function
-- (`DEFAULT_OPENAI_MODEL`); o default do banco só precisa casar com eles. O
-- update corrige as linhas já gravadas; o seed 020 deixa de reintroduzir o
-- valor no `db:reset`.
--
-- `handoff_to_agent_id` existia desde a 0008 sem nenhum leitor. A partir daqui
-- a function passa a conversa ao agente alvo quando o agente atual emite
-- [QUALIFICADO]; o comentário de coluna registra o contrato para quem ler o
-- schema. Sem DDL além do default — nada muda para o código durante o deploy.
-- =============================================================================

alter table public.sdr_agents alter column model set default 'gpt-4o-mini';

update public.sdr_agents
   set model = 'gpt-4o-mini'
 where model = 'claude-sonnet-5';

comment on column public.sdr_agents.model is
  'Nome do modelo da API de chat da OpenAI. Default e fallback vivem em _shared/sdrAgent.ts (DEFAULT_OPENAI_MODEL).';

comment on column public.sdr_agents.handoff_to_agent_id is
  'Agente que assume a conversa quando este emite [QUALIFICADO]. Quem devolve o lead à roleta (sdr_handoff) é o último agente da cadeia. Lido em _shared/sdrAgent.ts.';
