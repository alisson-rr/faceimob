-- =============================================================================
-- 0287 · Diretor atualiza nascimento e CRECI de quem lidera
--
-- Pedido de 16/10/2026: o diretor muda a equipe entre as dele (já era
-- `move_team_member`, 0167), a data de nascimento e se a pessoa tem CRECI, com
-- o número. Gerente continua como na 0167 (situação e crachá). Os demais dados
-- pessoais (nome, CPF, contato, endereço) seguem só com o administrador.
-- Cópia da 0167 com a lista do diretor.
-- =============================================================================
create or replace function public.profiles_guard_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- O que o gestor pode mudar na linha de quem lidera.
  v_do_gestor constant text[] := array['status', 'badge_requested_at', 'badge_delivered_at', 'updated_at'];
  -- E o diretor, além disso (0287).
  v_do_diretor constant text[] := array['birth_date', 'habilitation', 'creci'];
  v_permitidas text[];
begin
  if public.is_admin() then
    return new;
  end if;

  -- Edge function com service role: dona do e-mail de acesso e da inativação
  -- (`provision-broker-user`), nada além disso.
  if auth.role() = 'service_role' then
    if new.bypass_ip_check is distinct from old.bypass_ip_check then
      raise exception 'Somente o administrador libera a validação de IP.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from auth.uid() and public.manages_profile(new.id) then
    v_permitidas := v_do_gestor
      || case when public.has_role('director') then v_do_diretor else '{}'::text[] end;
    if (to_jsonb(new) - v_permitidas) is distinct from (to_jsonb(old) - v_permitidas) then
      raise exception 'Só o administrador altera os dados do colaborador; o gestor muda a situação, o crachá e a equipe, e o diretor também nascimento e CRECI.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- O próprio usuário só edita dados de contato.
  if new.status          is distinct from old.status
  or new.bypass_ip_check is distinct from old.bypass_ip_check
  or new.email           is distinct from old.email
  or new.terminated_at   is distinct from old.terminated_at
  or new.hired_at        is distinct from old.hired_at then
    raise exception 'Campos administrativos do perfil só podem ser alterados pelo administrador.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.profiles_guard_admin_columns() is
  'Colunas de profiles por papel (0287): admin tudo; service_role tudo menos bypass de IP; gestor de OUTRA pessoa só '
  'status e crachá, e o diretor também nascimento, habilitação e CRECI; o próprio usuário só contato. '
  'Mover de equipe é move_team_member; inativar é provision-broker-user.';
