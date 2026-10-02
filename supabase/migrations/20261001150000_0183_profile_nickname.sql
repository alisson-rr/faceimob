-- Apelido curto para as superfícies sociais (game e ranking).
-- O nome completo continua sendo a identidade oficial e o fallback.
alter table public.profiles
  add column if not exists nickname text;

alter table public.profiles
  drop constraint if exists profiles_nickname_length;

alter table public.profiles
  add constraint profiles_nickname_length
  check (nickname is null or length(btrim(nickname)) between 1 and 40);

comment on column public.profiles.nickname is
  'Nome curto opcional exibido no game e no ranking; full_name permanece como fallback.';
