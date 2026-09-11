-- =============================================================================
-- 0099 · "Administrador" passa a significar "administrador OU sócio" na RAIZ
--
-- Decisão do cliente (Douglas) em 10/09/2026, literal: "sempre que eu falar
-- administrador, eu tô falando sobre o sócio também. os dois têm o mesmo nível
-- de permissão. Ponto."
--
-- O QUE FICOU FALTANDO NA 0097. Ela redefiniu `is_admin()` como
-- `has_any_role('admin', 'partner')` e cobriu os gates que perguntam por
-- `is_admin()`. Ela mesma anotou o limite: os gates escritos como
-- `has_any_role('admin', <outro papel>)` continuavam barrando o sócio — 93
-- linhas nas migrations em 10/09/2026 (`grep -rn "has_any_role('admin'"
-- supabase/migrations/ | wc -l`). O efeito foi medido tela a tela: o front, que
-- desde a 0097 responde `isAdmin = true` para o sócio, OFERECE o botão e o
-- banco recusa com 42501 — aporte de mídia (/data), novo lead e importação de
-- planilha (/leads), campanha e aporte (/marketing), resultado anual
-- (/resultados), negócio novo (/pipeline) e desligamento de corretor
-- (/equipes, que gravava a ficha como desligada e deixava o acesso aberto —
-- dado inconsistente, o pior dos sete).
--
-- POR QUE AQUI E NÃO NOS 93 GATES. Acrescentar `'partner'` a cada chamada é 93
-- chances de esquecer uma, e a esquecida vira exatamente o defeito de hoje: uma
-- tela só recusando o sócio, descoberta na frente do cliente. `has_any_role` é
-- o ponto por onde TODAS elas passam. Uma função, uma regra, e o gate novo que
-- alguém escrever amanhã já nasce certo.
--
-- NINGUÉM É PROMOVIDO — mesma escolha da 0097, pelo motivo da 0094: a pessoa
-- continua com `partner` e só com `partner` em `user_roles`, nada entra no
-- `role_change_log` e reverter é reescrever uma função, não caçar linhas
-- concedidas por engano.
--
-- O QUE O SÓCIO PASSA A PODER, dito com todas as letras: tudo que o
-- administrador pode. Além do que a 0097 já abriu (papéis, matriz de
-- permissões, fechamento de mês, exclusão), agora também cadastrar e editar
-- lead, importar planilha de leads, lançar aporte de mídia e campanha, gravar
-- resultado anual, cadastrar negócio no pipeline, mexer na esteira de CCA, na
-- automação de SDR e no diário. Quem quiser um sócio que só acompanha deve
-- receber `director`, que é o papel de leitura ampla sem administrar
-- (`can_read_all()`).
--
-- CONSEQUÊNCIA: as asserções de `supabase/tests/` que cobram "sócio não edita /
-- não apaga / é somente leitura" (levantadas na 0094: 15 asserções em 12
-- arquivos) afirmam o contrário do que o banco faz a partir daqui e precisam
-- ser reescritas junto com esta decisão. Elas não são tocadas nesta migration.
--
-- Idempotente: `create or replace` nas duas funções.
-- =============================================================================

-- ── 1. `has_any_role`: pedir 'admin' passa a aceitar o sócio ────────────────
-- Assinatura, `security definer`, `stable` e `search_path` idênticos aos da
-- 0002: só o predicado muda. O `or` é fechado em 'admin' de propósito — quem
-- pede `has_any_role('director')` continua querendo diretor e só diretor.
--
-- Não há recursão com `is_admin()` (0097): ela chama esta função, esta não
-- chama ninguém.
create or replace function public.has_any_role(variadic targets app_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and (
        ur.role = any(targets)
        or ('admin' = any(targets) and ur.role = 'partner')
      )
  );
$$;

comment on function public.has_any_role(variadic app_role[]) is
  'Verdadeiro se o usuário tem algum dos papéis pedidos. Pedir ''admin'' aceita TAMBÉM ''partner'' (0099): decisão do cliente em 10/09/2026 de que administrador e sócio têm o mesmo nível de permissão. Não promove ninguém — `partner` continua sendo `partner` em `user_roles`.';

-- ── 2. `auth_effective_role`: o papel EFETIVO de um sócio é o de admin ──────
-- Por que ela precisa entrar aqui: `deals_insert` (0053) não pergunta por
-- `has_any_role` nem por `is_admin()` — ela compara
-- `auth_effective_role(auth.uid()) in ('admin','director','manager','broker',
-- 'cca')`. Como a função devolvia 'partner', o sócio continuava sem cadastrar
-- negócio mesmo depois do item 1.
--
-- OS CONSUMIDORES, levantados antes de mexer (`grep -rn auth_effective_role
-- supabase/ src/`), e o que acontece com cada um:
--
--   · `deals_insert` (0053) — AUTORIZA. É o que se quer consertar.
--   · `selectable_brokers()` (0076) — AUTORIZA quem lista a corretagem para
--     montar o rateio. É o mesmo predicado de `deals_insert` por construção; o
--     sócio entra junto, como o administrador. Sem isso ele cadastraria o
--     negócio e abriria "Corretor 2"/"Corretor 3" pela metade.
--   · `deals_add_creator_participant()` (0053) — não autoriza nem exibe: usa o
--     papel para decidir a LINHA em `deal_participants`, que é rateio de VGV e
--     ponto de venda. É o consumidor que a mudança não pode perturbar.
--   · nenhum consumidor de EXIBIÇÃO. A função é `revoke ... from public, anon`
--     e o front nunca a chama: quem escreve o nome do papel na tela usa
--     `roleLabelFor`/`primaryRole` (`src/integrations/supabase/`), que são
--     código próprio e continuam devolvendo "Sócio".
--
-- POR QUE O `case` E NÃO "quem tem partner é admin". A troca é feita DEPOIS da
-- ordenação, sobre o papel que venceu a precedência — não sobre o conjunto.
-- Assim quem acumula papel de precedência maior não é afetado: um
-- {director, partner} continua devolvendo 'director' e continua entrando em
-- `deal_participants` como diretor. Trocar pelo conjunto ("tem partner →
-- admin") devolveria 'admin' para ele, e o gatilho pararia de inscrevê-lo no
-- rateio do negócio que ele mesmo cadastrou — a correção de uma tela viraria
-- comissão sumindo em outra.
--
-- Quem cai no `case` é o sócio puro e o {partner, broker} (partner tem
-- precedência sobre o `broker` que `handle_new_auth_user` dá a todo cadastro).
-- Nos dois o gatilho já não inscrevia ninguém — 'partner' e 'admin' estão
-- igualmente fora de ('director','manager','broker') — então o comportamento de
-- `deal_participants` é o mesmo de antes, linha por linha.
--
-- O `order by` continua lendo `ur.role` cru, com `nulls first`: papel novo no
-- enum e ausente do array segue vencendo a ordenação e falhando fechado nas
-- duas listas.
create or replace function public.auth_effective_role(p_profile uuid)
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when ur.role = 'partner' then 'admin'::app_role else ur.role end
    from public.user_roles ur
   where ur.profile_id = p_profile
   order by array_position(
     array['admin', 'director', 'manager', 'cca',
           'sdr', 'marketing', 'partner', 'broker']::app_role[],
     ur.role) nulls first
   limit 1;
$$;

comment on function public.auth_effective_role(uuid) is
  'Papel de maior precedência do perfil, para TRAVA DE ESCRITA e não para exibir: o sócio sai daqui como ''admin'' (0099), porque administrador e sócio têm o mesmo nível de permissão. A troca é feita depois da ordenação, então quem acumula papel de precedência maior (um diretor que também é sócio) continua saindo como esse papel e continua entrando no rateio de `deal_participants`. Quem mostra o nome do papel na tela usa roleLabelFor/primaryRole no front. Papel novo e não classificado ordena antes de tudo (nulls first) para falhar fechado.';
