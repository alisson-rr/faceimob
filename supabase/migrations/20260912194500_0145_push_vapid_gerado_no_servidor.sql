-- =============================================================================
-- 0145 — Par VAPID do push gerado dentro do servidor
--
-- A 0143 lê o par em private.integration_credentials (webpush/vapid_*), mas
-- não havia como gravá-lo sem que alguém visse a chave privada: a tela de
-- Integrações exige colar o valor, e colar é ler. Aqui a edge function
-- push-dispatch gera o par com WebCrypto e grava por esta função, que só a
-- service role executa. Nenhuma pessoa nem agente vê a chave privada.
--
-- Nunca sobrescreve: trocar o par invalida todo aparelho já assinado (o
-- navegador assina com a chave pública antiga). Troca deliberada continua
-- sendo apagar as linhas no cofre e chamar a geração de novo.
-- =============================================================================

create or replace function public.webpush_guardar_vapid(
  p_public  text,
  p_private text,
  p_subject text
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- 65 bytes em base64url sem padding = 87 caracteres; 32 bytes = 43.
  if p_public is null or p_public !~ '^[A-Za-z0-9_-]{87}$'
     or p_private is null or p_private !~ '^[A-Za-z0-9_-]{43}$'
     or p_subject is null or p_subject !~ '^(mailto:|https://)' then
    raise exception 'Par VAPID fora do formato.' using errcode = '22023';
  end if;

  if exists (
    select 1 from private.integration_credentials
     where provider = 'webpush' and label in ('vapid_public_key', 'vapid_private_key')
  ) then
    return false;
  end if;

  insert into private.integration_credentials (provider, label, secret)
  values ('webpush', 'vapid_public_key', p_public),
         ('webpush', 'vapid_private_key', p_private),
         ('webpush', 'vapid_subject', p_subject)
  on conflict (provider, label) do nothing;

  return true;
end;
$$;

revoke all on function public.webpush_guardar_vapid(text, text, text) from public, anon, authenticated;
grant execute on function public.webpush_guardar_vapid(text, text, text) to service_role;

comment on function public.webpush_guardar_vapid(text, text, text) is
  'Grava o par VAPID gerado pela edge push-dispatch (ação garantir_vapid). Só service_role; nunca sobrescreve um par existente.';
