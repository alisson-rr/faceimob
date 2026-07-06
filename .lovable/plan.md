# Link público do Diretor — Checkpoint Semanal

Hoje só existe link público por **equipe** (`/daily/:slug`). Vou adicionar um link público **por diretor** que mostra o card "Checkpoint Semanal" (o mesmo que aparece no /checkpoint hoje) com todos os gerentes daquele diretor.

## O que será feito

1. **Nova edge function `director-weekly` (pública, service role)**
   - Recebe `{ slug, week_start? }`.
   - Resolve o diretor: acha em `brokers` (role=director, active) cujo `slug(name)` bate com o parâmetro.
   - Lista managers com `director_id = <dir>` e teams com `manager_id in (...)`.
   - Agrega `daily_team_reports` + `daily_broker_entries` para a semana (seg–dom).
   - Lê `checkpoint_targets` (global/por team).
   - Retorna `{ director:{name}, week:{start,end}, teams:[{id,name,aggr,targets}] }`.
   - Não expõe dados de outros diretores.

2. **Nova página pública `src/pages/PublicDirectorCheckpoint.tsx`**
   - Rota `/diretor/:slug` (fora do `RequireAuth`).
   - Header idêntico ao `/checkpoint` (navegação de semana + Hoje).
   - Renderiza o `DirectorFunnelCard` (extraído do `Checkpoint.tsx`) com a lista de gerentes/teams do diretor.
   - Botão "Ver gerentes" abre o modal com os `TeamCheckpointCard`s (mesma UI que já existe).

3. **Refatoração pequena em `src/pages/Checkpoint.tsx`**
   - Extrair `DirectorFunnelCard` e `TeamCheckpointCard` para `src/components/checkpoint/DirectorFunnelCard.tsx` e `TeamCheckpointCard.tsx` para reuso na página pública. Sem mudança visual.

4. **Link público em `src/pages/AdminDailyTeams.tsx`**
   - Nova seção "Diretores" listando cada diretor com URL `https://crm-faceimob.com.br/diretor/<slug>` e botão copiar (mesmo padrão dos links de equipe).

## Detalhes técnicos

- Slug: mesma `slugify` usada em `AdminDailyTeams.tsx` aplicada em `broker.name`.
- Edge function fica em `supabase/functions/director-weekly/index.ts`, registrada em `supabase/config.toml` com `verify_jwt = false`.
- Página pública não precisa de PIN — dados agregados de leitura.
- Rotas em `src/App.tsx`: adicionar `<Route path="/diretor/:slug" element={<PublicDirectorCheckpoint />} />` antes do `RequireAuth`.

## Arquivos afetados

- `supabase/functions/director-weekly/index.ts` (novo)
- `supabase/config.toml` (registrar função pública)
- `src/components/checkpoint/DirectorFunnelCard.tsx` (novo, extraído)
- `src/components/checkpoint/TeamCheckpointCard.tsx` (novo, extraído)
- `src/pages/Checkpoint.tsx` (usar componentes extraídos)
- `src/pages/PublicDirectorCheckpoint.tsx` (novo)
- `src/App.tsx` (rota pública)
- `src/pages/AdminDailyTeams.tsx` (lista de links de diretores)
