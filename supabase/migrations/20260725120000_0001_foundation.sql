-- =============================================================================
-- 0001 · Fundação
-- Extensões, schema privado, enums do domínio e helpers genéricos.
-- Base para todas as migrations seguintes. Nada aqui depende de auth.users.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Schema privado: NÃO exposto pelo PostgREST (fora de db.schemas).
-- Guarda segredos de integração e funções que jamais devem ser chamáveis
-- pelo client, mesmo com JWT válido.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Papéis. Um usuário pode acumular vários (diretor que também atua como
-- gerente e corretor) — ver user_roles em 0002.
create type app_role as enum (
  'admin',      -- acesso total ao sistema e às configurações
  'director',   -- diretoria: visibilidade total sobre suas equipes
  'manager',    -- gerente: visibilidade sobre a própria equipe
  'broker',     -- corretor: visibilidade apenas sobre o que é seu
  'cca',        -- centro de análise de crédito
  'sdr',        -- pré-atendimento (humano ou supervisor da IA)
  'marketing',  -- gestão de campanhas e aportes
  'partner'     -- sócio: leitura ampla, sem edição
);

-- Ciclo de vida do lead até virar (ou não) negócio.
create type lead_status as enum (
  'queued',      -- na roleta, ainda sem corretor
  'assigned',    -- atribuído, aguardando primeira ação
  'attending',   -- corretor clicou em atender (trava de tempo ativa)
  'in_progress', -- em relacionamento
  'converted',   -- virou negócio
  'lost',        -- perdido
  'discarded'    -- descartado (duplicado, inválido, spam)
);

-- Temperatura/etapa do relacionamento, independente do status operacional.
create type lead_funnel_stage as enum (
  'new',
  'first_contact',
  'no_response',
  'warm',
  'hot',
  'gathering_docs',
  'scheduled_visit',
  'qualified'
);

-- Motivo pelo qual o lead saiu da mão de um corretor.
create type lead_release_reason as enum (
  'timeout',       -- estourou a trava de atendimento (roleta devolveu à fila)
  'manual',        -- devolvido manualmente
  'reassigned',    -- realocado por gerente/admin
  'checkout',      -- corretor saiu do turno
  'sdr_handoff'    -- IA de SDR concluiu a qualificação e repassou
);

-- Fluxo de análise da construtora.
create type developer_flow as enum (
  'internal',   -- analisado pelo CCA da própria empresa
  'external'    -- documentos enviados por e-mail à construtora
);

-- Situação da análise de crédito (CCA).
create type cca_status as enum (
  'pending_documents',
  'under_review',
  'sent_to_developer',
  'sent_to_agency',
  'approved',
  'rejected',
  'cancelled'
);

-- Situação da visita.
create type visit_result as enum ('scheduled', 'completed', 'no_show', 'cancelled');

-- Situação do negócio no funil comercial. Os estágios visíveis do pipeline são
-- configuráveis em pipeline_stages; este enum registra o desfecho macro, usado
-- por relatórios e gamificação, que não pode depender de linhas editáveis.
create type deal_outcome as enum ('open', 'won', 'lost', 'cancelled');

-- Canais por onde uma notificação pode sair.
create type notification_channel as enum ('in_app', 'whatsapp', 'email', 'push');

-- Situação de uma tarefa/atividade.
create type task_status as enum ('open', 'done', 'cancelled');

-- Situação de um disparo de remarketing.
create type broadcast_status as enum ('draft', 'scheduled', 'running', 'paused', 'done', 'failed');

-- Autor de uma mensagem de conversa com o SDR.
create type message_author as enum ('lead', 'agent', 'broker', 'system');

-- -----------------------------------------------------------------------------
-- Helpers genéricos
-- -----------------------------------------------------------------------------

-- Mantém updated_at coerente sem depender da aplicação.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger BEFORE UPDATE: carimba updated_at. Anexar a toda tabela com essa coluna.';

-- Normaliza telefone para E.164 sem máscara (dígitos apenas, com DDI 55 quando
-- o número vier no formato brasileiro). Usado para casar leads vindos de
-- webhooks da Meta/WhatsApp com registros já existentes.
create or replace function public.normalize_phone(raw text)
returns text
language sql
immutable
as $$
  with digits as (
    select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d
  )
  select case
    when d = '' then null
    when length(d) in (10, 11) then '55' || d          -- DDD + número, sem DDI
    when length(d) in (12, 13) and left(d, 2) = '55' then d
    else d
  end
  from digits;
$$;

comment on function public.normalize_phone is
  'Reduz um telefone a dígitos com DDI 55 implícito. Base do dedupe de leads.';

-- Primeiro dia do mês de uma data — a granularidade de todo período do sistema
-- (aportes de marketing, metas, mês-base de negócio).
create or replace function public.month_start(d date)
returns date
language sql
immutable
as $$
  select date_trunc('month', d)::date;
$$;

-- unaccent exigiria a extensão homônima, que nem todo projeto habilita.
-- Esta tradução cobre o português e mantém slugify() sem dependência externa.
create or replace function public.unaccent_fallback(txt text)
returns text
language sql
immutable
as $$
  select translate(
    txt,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

-- Gera slug a partir de um texto livre. Usado nos links públicos de equipe e
-- diretoria, que precisam ser estáveis e legíveis.
create or replace function public.slugify(txt text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      lower(public.unaccent_fallback(coalesce(txt, ''))),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;
