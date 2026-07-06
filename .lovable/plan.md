# Funil de Leads — Novo fluxo

## Estágios do funil (colunas)

1. **Novo Lead** (Roleta) — permanece 5 min; timer visível; após ação vai p/ Primeiro Contato
2. **Primeiro Contato** — qualquer ação do corretor (clicar WhatsApp, comentar, editar) move automático
3. **Sem Resposta / Follow** — botão manual + regra automática se >24h sem interação
4. **Lead Morno**
5. **Lead Quente**
6. **Juntando Doc** — permite anexar documentos
7. **Converter** — cria linha `Incompleto` no Pipeline (deals) e carrega os anexos

## Front (Kanban de Leads)

Substitui a aba Leads atual do Pipeline por um Kanban de 7 colunas.
Cada card na coluna mostra apenas:
- Nome do lead
- Origem (badge)
- Corretor
- Hora de chegada (relativa: "há 3 min") + timer especial nos 5 min iniciais
- Ordenação: mais novo → mais antigo

## Card detalhado (modal ao clicar)

- Dados do lead (nome, tel, email, whatsapp, origem)
- Respostas do formulário (todos os `field_data` do Meta) — hoje já gravamos parte em `notes`; passaremos a salvar em `form_answers jsonb`
- Comentários (thread)
- Botão WhatsApp (abre `https://wa.me/<telefone>?text=Olá <nome>`)
- Anexos (upload direto, ficam vinculados ao lead e migram para o Deal ao converter)
- Histórico automático (timeline): chegada, mudança de estágio, comentário, anexo, tentativa de contato
- Aviso de inatividade: badge vermelho se >24h sem movimento

## Backend

Migração cria:

- Colunas em `public.leads`: `funnel_stage` (enum), `form_answers jsonb`, `first_contact_at timestamptz`, `last_activity_at timestamptz`
- `public.lead_history` (id, lead_id, event_type, description, actor_name, created_at)
- `public.lead_comments` (id, lead_id, author_name, message, created_at)
- `public.lead_attachments` (id, lead_id, file_path, file_name, mime, size, created_at)
- Bucket privado `lead-attachments` com RLS
- Trigger em `leads` que grava histórico automático de mudança de estágio e atualiza `last_activity_at`
- Enum `lead_funnel_stage`: new, first_contact, no_response, warm, hot, gathering_docs, converted

Edge function `meta-ads-webhook` passa a salvar o objeto inteiro do formulário em `form_answers` (além do fallback em `notes`).

## Conversão para Pipeline

Ao clicar "Converter": cria `deals` em estágio `incomplete` com dados do lead, marca lead como `converted`, e copia os `lead_attachments` para o deal (via nova tabela `deal_attachments` reaproveitando o mesmo bucket).

## Arquivos afetados

- `supabase/migrations/*` — schema + bucket + policies + trigger
- `supabase/functions/meta-ads-webhook/index.ts` — grava `form_answers`
- `src/pages/Pipeline.tsx` — aba Leads vira Kanban do funil
- `src/components/LeadCard.tsx` (novo) — card compacto
- `src/components/LeadDetailModal.tsx` (novo) — modal com abas Dados / Formulário / Comentários / Anexos / Histórico
- `src/types/crm.ts` — tipos do funil
