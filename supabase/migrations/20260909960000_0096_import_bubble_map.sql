-- =============================================================================
-- 0096 · Pré-requisitos de schema da importação Bubble → Supabase
--
-- Três objetos, um propósito: a fase 1 de `docs/importacao/PLANO.md` não começa
-- sem eles. Nenhum toca dado de negócio existente.
--
-- 1. `import_bubble_map` — o de-para de procedência (decisão N-06).
--    Sem ele, todo aceite da carga é `count(*)` de tabela, que soma seed + demo
--    + import e reprova uma carga correta (R-02). Com ele, cada conferência é
--    `join import_bubble_map`.
--
--    A PK é de TRÊS colunas porque o mesmo `bubble_id` de `pipelines` vira
--    linha em `deals` E em `cca_cases` (R-01): uma PK `(entidade, bubble_id)`
--    proibiria o segundo destino, e `create table if not exists` faria a
--    segunda tentativa de DDL virar no-op silencioso.
--
--    RLS não é formalidade aqui. A 0023 (linhas 65-66) mantém
--    `alter default privileges in schema public grant select, insert, update,
--    delete on tables to anon, authenticated, service_role`, então a tabela
--    nasce gravável por anônimo: sem `enable row level security` o
--    `scripts/validate-schema.sh:110-123` sai com código 1, e um anônimo
--    reescreveria o de-para de curadoria antes da próxima rodada de carga.
--
-- 2. `team_members_import_key` — a chave de idempotência que falta (R-05).
--    O unique existente (`team_members_one_active`, 0002:183-184) é PARCIAL:
--    só cobre `left_at is null`. Dos 267 vínculos do legado, 179 são de
--    vínculo já encerrado e hoje não têm trava nenhuma — reexecutar o passo
--    insere +179 linhas sem erro, sem conflito e sem log, duplicando o
--    histórico de desempenho que a 0002:168-170 existe para guardar. Com esta
--    chave o passo usa `on conflict (profile_id, team_id, joined_at) do
--    nothing` e a reexecução é inócua.
--
-- 3. Um estágio de CCA para `cancelled` (decisão N-19). O enum `cca_status`
--    tem os 7 valores desde a 0001:74-83, mas o `seed.sql:81-94` só criou 6
--    estágios. Os 290 casos de `DISTRATO`/`QUEDA` entrariam com `stage_id`
--    nulo e a tela cairia no fallback, exibindo-os na primeira coluna
--    ("Pendência de Documentos") como trabalho pendente que não existe.
--
-- Idempotente: `if not exists` nos três objetos, `drop policy if exists` antes
-- da policy, e o mesmo `where not exists` por `status` que o `seed.sql` usa —
-- `cca_stages` não tem unique em `status`, então `on conflict` não se aplica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. De-para Bubble → Supabase
-- -----------------------------------------------------------------------------
create table if not exists public.import_bubble_map (
  entidade       text        not null,
  bubble_id      text        not null,
  tabela_destino text        not null,
  -- Sem FK: o destino é polimórfico (profiles, teams, deals, cca_cases, …) e
  -- nenhuma FK cobre mais de uma tabela. Quem grava responde pelo uuid — e o
  -- NOT NULL é contrato, não zelo: linha do de-para sem destino real faz
  -- `lerMapa` devolver um bubble_id "já importado" que não existe no banco, e a
  -- reexecução pula o registro para sempre (R-02). Não há caso de "linha vista
  -- mas não importada": quem grava valida o uuid ANTES de enviar o lote.
  registro_id    uuid        not null,
  importado_em   timestamptz not null default now(),

  primary key (entidade, bubble_id, tabela_destino)
);

comment on table public.import_bubble_map is
  'De-para da carga do legado Bubble (0096). Uma linha por (entidade de origem, unique id do Bubble, tabela de destino) — a chave é tripla porque o mesmo registro do Bubble vira linha em mais de uma tabela daqui. Todo aceite da importação é escopado por esta tabela, nunca por count(*) do destino.';

-- Consulta inversa: "de onde veio esta linha?". Usada na curadoria e no
-- relatório de carga, que partem do registro do FACEIMOB, não do id do Bubble.
create index if not exists import_bubble_map_alvo_idx
  on public.import_bubble_map (tabela_destino, registro_id);

alter table public.import_bubble_map enable row level security;

-- Curadoria de importação é administração, não operação: um corretor apontando
-- `registro_id` para o próprio perfil se atribuiria negócios do legado inteiros
-- na próxima reexecução. Uma policy `for all` cobre os quatro comandos.
drop policy if exists import_bubble_map_admin on public.import_bubble_map;
create policy import_bubble_map_admin on public.import_bubble_map
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- A RLS acima já barra o anônimo (não há policy `to anon`), mas o de-para
-- decide de quem é cada negócio importado: o grant também é fechado, como a
-- 0083 fez com `whatsapp_inbound_messages`. `authenticated` mantém os grants
-- default — quem filtra é a policy, e `tests/06_anon_surface.sql:115-131` cobra
-- SELECT e INSERT de `authenticated` em toda tabela de `public`.
revoke all on public.import_bubble_map from anon;

-- -----------------------------------------------------------------------------
-- 2. Idempotência de team_members (R-05)
-- -----------------------------------------------------------------------------
-- Se este CREATE falhar por duplicata, há vínculo repetido no destino ANTES da
-- carga: investigar a origem em vez de afrouxar a chave.
create unique index if not exists team_members_import_key
  on public.team_members (profile_id, team_id, joined_at);

-- -----------------------------------------------------------------------------
-- 3. Estágio de CCA para os casos cancelados (N-19)
-- -----------------------------------------------------------------------------
-- `color` guarda CHAVE SEMÂNTICA, não hex: `ccaStageTone`
-- (src/components/pipeline/ccaStage.ts:63-76) só entende `warning`/`success`/
-- `info`/`danger`/`highlight`/`neutral`, o token `text-*` e as famílias de
-- paleta legadas. `neutral` e não `danger` porque nesta esteira o vermelho é o
-- vocabulário de "Reprovado" (crédito negado); distrato e queda encerram o caso
-- sem decisão de crédito e não pedem ação do analista.
insert into public.cca_stages (name, color, position, status)
select v.name, v.color, v.position, v.status::cca_status
from (values ('Distrato / Queda', 'neutral', 7, 'cancelled')) as v(name, color, position, status)
where not exists (
  select 1 from public.cca_stages cs where cs.status = v.status::cca_status
);
