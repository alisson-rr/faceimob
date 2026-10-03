-- =============================================================================
-- 0192 — mensagens prontas de WhatsApp
--
-- Pedido do cliente em 03/10/2026: ao mandar WhatsApp para o lead, escolher
-- uma mensagem pronta com o primeiro nome do cliente, o cumprimento pela hora
-- (bom dia / boa tarde / boa noite) e o apelido do corretor. As variáveis são
-- trocadas na tela ({primeiro_nome}, {saudacao}, {corretor}); aqui fica só o
-- texto.
--
-- Cada pessoa cria as suas. Admin e sócio podem marcar uma mensagem como da
-- equipe toda (`compartilhada`), e só eles mexem nas compartilhadas.
-- =============================================================================

create table if not exists public.mensagens_prontas (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null check (char_length(btrim(titulo)) between 1 and 80),
  texto        text not null check (char_length(btrim(texto)) between 1 and 2000),
  dono         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  compartilhada boolean not null default false,
  criado_em    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists mensagens_prontas_dono_idx on public.mensagens_prontas (dono);

alter table public.mensagens_prontas enable row level security;
revoke all on public.mensagens_prontas from public, anon;
grant select, insert, update, delete on public.mensagens_prontas to authenticated;

drop policy if exists mensagens_prontas_select on public.mensagens_prontas;
create policy mensagens_prontas_select on public.mensagens_prontas
  for select to authenticated
  using (dono = (select auth.uid()) or compartilhada);

drop policy if exists mensagens_prontas_insert on public.mensagens_prontas;
create policy mensagens_prontas_insert on public.mensagens_prontas
  for insert to authenticated
  with check (dono = (select auth.uid()) and (not compartilhada or (select public.is_admin())));

drop policy if exists mensagens_prontas_update on public.mensagens_prontas;
create policy mensagens_prontas_update on public.mensagens_prontas
  for update to authenticated
  using ((dono = (select auth.uid()) and not compartilhada) or (select public.is_admin()))
  with check ((dono = (select auth.uid()) and not compartilhada) or (select public.is_admin()));

drop policy if exists mensagens_prontas_delete on public.mensagens_prontas;
create policy mensagens_prontas_delete on public.mensagens_prontas
  for delete to authenticated
  using ((dono = (select auth.uid()) and not compartilhada) or (select public.is_admin()));

drop trigger if exists mensagens_prontas_set_updated_at on public.mensagens_prontas;
create trigger mensagens_prontas_set_updated_at
  before update on public.mensagens_prontas
  for each row execute function public.set_updated_at();

comment on table public.mensagens_prontas is
  'Mensagens prontas de WhatsApp (0192). Variáveis {primeiro_nome}, {saudacao} e {corretor} são trocadas na tela.';
