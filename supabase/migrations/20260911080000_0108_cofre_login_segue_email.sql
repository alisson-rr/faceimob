-- =============================================================================
-- 0108 · O login guardado no cofre passa a seguir a troca de e-mail
--
-- O QUE ESTAVA QUEBRADO. `store_broker_password` (0105) grava em
-- `private.operation_credentials` o PAR login/senha da pessoa, e o login é o
-- e-mail que valia no momento em que a senha foi definida. O ramo de troca de
-- e-mail da edge function `provision-broker-user` atualiza o Auth e o espelho
-- `profiles.email` — e não tocava no cofre. Depois de uma troca, a aba do cofre
-- em Equipes entregava ao administrador um login que o Auth já não conhece, que
-- é justamente o valor que ele copia para entrar.
--
-- POR QUE UMA FUNÇÃO NOVA, E NÃO REUSAR `store_broker_password`. Aquela exige o
-- segredo (`p_secret`) e o substitui. Na troca de e-mail ninguém tem a senha em
-- mãos — o Auth guarda hash — e ler a senha para regravá-la significaria passar
-- por `reveal_operation_credential`, que registra uma revelação que não houve.
-- Esta função move SÓ o `login`; o `secret` fica onde está, então o cofre nunca
-- passa a afirmar uma senha que o Auth não tem (a mesma regra que
-- `set_operation_credential` já defende ao recusar linha de pessoa).
--
-- POR QUE SÓ SERVICE ROLE. Mesma dupla trava da 0105: `grant execute` apenas
-- para `service_role` e checagem explícita de `auth.role()`, que sobrevive a
-- alguém conceder execute por engano numa migration futura. Do browser, mudar o
-- login de uma credencial de pessoa é escrita no cofre sem passar pelo Auth.
--
-- SEM LINHA NO COFRE NÃO É ERRO: quem nunca teve senha definida não tem
-- credencial guardada, e a troca de e-mail não pode falhar por isso. Devolve
-- `false` e a edge function segue.
--
-- Idempotente: `create or replace` mais `revoke`/`grant`. Nada em `public` muda
-- de forma (nenhuma tabela, nenhuma coluna), e `types.ts` só precisaria ser
-- regerado por quem chamar esta RPC do browser — ninguém pode.
-- =============================================================================

create or replace function public.sync_broker_login(
  p_profile_id uuid,
  p_login      text
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_login text := btrim(coalesce(p_login, ''));
  v_id    uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Somente a service role atualiza o login guardado no cofre.'
      using errcode = '42501';
  end if;

  -- Mesmo limite de `set_operation_credential`/`store_broker_password`: a
  -- coluna aceita 200, e entrada de fronteira se confere aqui também.
  if v_login = '' or length(v_login) > 200 then
    raise exception 'Login inválido.' using errcode = 'P0001';
  end if;

  update private.operation_credentials
     set login      = v_login,
         updated_at = now()
   where profile_id = p_profile_id
  returning id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.sync_broker_login(uuid, text) is
  'Move o login guardado no cofre para o novo e-mail de acesso, sem tocar no segredo. Exclusiva de service_role: é a porta de provision-broker-user ao trocar o e-mail.';

revoke all on function public.sync_broker_login(uuid, text) from public, anon, authenticated;
grant execute on function public.sync_broker_login(uuid, text) to service_role;
