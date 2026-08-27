-- =============================================================================
-- 0033 — Links públicos deixam de nascer abertos (achados S02 e S05)
--
-- A superfície anônima do sistema são três RPCs, e todas as três dependem de um
-- slug para decidir o que devolver. O slug era, na prática, a senha — e nascia
-- adivinhável: `AdminDailyTeams` gravava `diretor-<nome-do-diretor>` e
-- `<nome-da-equipe>`. Quem soubesse o nome de um diretor da casa (site, LinkedIn,
-- assinatura de e-mail) montava a URL e lia funil, visitas e vendas da diretoria
-- inteira. Pior: o link de diretor nascia sem PIN, então nem havia segundo fator
-- — `public_director_checkpoint` só pede PIN quando `pin_hash` existe.
--
-- Três frentes, todas na causa e não no sintoma:
--
--  1. O slug deixa de ser escolhido. `create_public_link` é o único caminho de
--     criação e sorteia `gen_random_uuid()`; a coluna também ganha esse default,
--     para que um insert direto por psql (seed, suporte) não recaia no nome.
--
--  2. Link novo nasce COM PIN, dos dois tipos. Não dá para exigir `pin_hash` no
--     insert pelo PostgREST — o navegador não faz bcrypt —, então a criação vira
--     RPC: recebe o PIN em claro, devolve o hash gravado, e o `insert` direto
--     some do contrato de `authenticated` (grant revogado + a policy de escrita
--     passa a cobrir só update/delete). Fica um caminho só, com a regra dentro.
--
--  3. `resolve_public_link` ganha lockout. Um PIN de 6 dígitos sem trava é um
--     espaço de 10^6 que um script varre em minutos; com 5 tentativas por janela
--     de 15 min, o mesmo ataque leva séculos. A contagem zera no acerto para o
--     gerente que errou duas vezes e acertou na terceira não acumular dívida.
--
-- O que NÃO muda: link já existente continua valendo com o slug e o PIN (ou a
-- ausência de PIN) que tem hoje. Invalidar em massa derrubaria o Diário de todas
-- as equipes numa manhã; a tela passa a marcar os que estão sem PIN e oferece o
-- botão de gerar, que é a migração incremental de verdade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Slug sorteado e estado do lockout
-- -----------------------------------------------------------------------------

-- Sem hífen: o slug vai na URL e é ditado por telefone com alguma frequência.
alter table public.public_links
  alter column slug set default replace(gen_random_uuid()::text, '-', '');

alter table public.public_links
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until    timestamptz;

comment on column public.public_links.failed_attempts is
  'PINs errados desde o último acerto. Zera no acerto e ao disparar a trava.';
comment on column public.public_links.locked_until is
  'Enquanto for futuro, nem o PIN correto resolve o link. Definido após 5 erros.';

-- -----------------------------------------------------------------------------
-- 2. Criação de link: uma porta só, com o PIN dentro
--
-- SECURITY DEFINER porque grava o hash do PIN e sorteia o slug — as duas coisas
-- que o chamador não pode escolher. A checagem de papel é a mesma de
-- `set_public_link_pin`, para que "quem pode trocar o PIN" e "quem pode criar o
-- link" não divirjam.
-- -----------------------------------------------------------------------------
create or replace function public.create_public_link(
  p_kind        text,
  p_pin         text,
  p_team_id     uuid default null,
  p_director_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text := replace(gen_random_uuid()::text, '-', '');
  v_id   uuid;
begin
  if not public.has_any_role('admin','director') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  if p_kind not in ('daily_team','director_checkpoint') then
    raise exception 'Tipo de link inválido: %', p_kind using errcode = '22023';
  end if;

  -- A regra que dá nome à migration. Vale para os dois tipos: o link de equipe
  -- expõe a escala e os números do dia, o de diretoria expõe a operação inteira.
  if p_pin is null or btrim(p_pin) = '' then
    raise exception 'Link público exige PIN.' using errcode = '22023';
  end if;

  -- 6 dígitos é o que a tela gera; abaixo disso o lockout não compensa.
  if length(btrim(p_pin)) < 6 then
    raise exception 'PIN precisa de ao menos 6 caracteres.' using errcode = '22023';
  end if;

  -- Dono já tem link ativo? Troca o PIN dele em vez de criar um segundo.
  -- `public_links` não tem unicidade por (kind, dono) — dois cliques rápidos no
  -- botão "Criar link" deixariam duas URLs válidas, e a tela só mostra uma: a
  -- outra ficaria viva e invisível. Idempotente é mais barato que um índice
  -- parcial, que quebraria seed e teste (que criam vários links por equipe).
  select id into v_id
  from public.public_links
  where kind = p_kind
    and active
    and ((p_kind = 'daily_team'          and team_id     = p_team_id)
      or (p_kind = 'director_checkpoint' and director_id = p_director_id))
  order by created_at desc
  limit 1;

  if v_id is not null then
    update public.public_links
       set pin_hash        = extensions.crypt(btrim(p_pin), extensions.gen_salt('bf', 10)),
           failed_attempts = 0,
           locked_until    = null
     where id = v_id
    returning slug into v_slug;
  else
    insert into public.public_links (kind, team_id, director_id, slug, pin_hash, active, created_by)
    values (
      p_kind,
      p_team_id,
      p_director_id,
      v_slug,
      extensions.crypt(btrim(p_pin), extensions.gen_salt('bf', 10)),
      true,
      auth.uid()
    )
    returning id into v_id;
  end if;

  -- O PIN em claro não volta: quem chamou já o tem, e devolver seria convite
  -- para ele aparecer em log de rede.
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

-- -----------------------------------------------------------------------------
-- PIN novo destrava o link.
--
-- Sem isto, o remédio do lockout não existia: o admin renovava o PIN e o link
-- seguia recusando por 15 min — inclusive o PIN novo, porque a trava é checada
-- antes do hash. Trocar o segredo é justamente o que torna as tentativas
-- anteriores irrelevantes.
-- -----------------------------------------------------------------------------
create or replace function public.set_public_link_pin(p_link_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_any_role('admin','director') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  if p_pin is not null and btrim(p_pin) <> '' and length(btrim(p_pin)) < 6 then
    raise exception 'PIN precisa de ao menos 6 caracteres.' using errcode = '22023';
  end if;

  update public.public_links
     set pin_hash = case
           when p_pin is null or btrim(p_pin) = '' then null
           else extensions.crypt(btrim(p_pin), extensions.gen_salt('bf', 10))
         end,
         failed_attempts = 0,
         locked_until    = null
   where id = p_link_id;
end;
$$;

comment on function public.create_public_link(text, text, uuid, uuid) is
  'Único caminho de criação de link público: slug sorteado e PIN obrigatório. Só admin/diretoria.';

revoke all on function public.create_public_link(text, text, uuid, uuid) from public, anon;
grant execute on function public.create_public_link(text, text, uuid, uuid) to authenticated;

-- Insert direto sai do contrato do navegador. A trava é o RLS, não o grant: a
-- 0023 mantém `select/insert/update/delete` uniforme em todas as tabelas de
-- propósito (banco novo precisa abrir) e `tests/06_anon_surface.sql` é o
-- tripwire disso. Então a policy de escrita deixa de cobrir INSERT e passa a
-- existir só para update/delete — sem policy de insert, ninguém insere.
--
-- Superusuário (seed, harness, psql de suporte) e service_role (bypassrls)
-- continuam inserindo direto. É o esperado: quem tem service role já tem o
-- banco inteiro, e o seed precisa montar os links de demonstração.
drop policy if exists public_links_write on public.public_links;

create policy public_links_update on public.public_links
  for update to authenticated
  using (public.has_any_role('admin','director'))
  with check (public.has_any_role('admin','director'));

create policy public_links_delete on public.public_links
  for delete to authenticated
  using (public.has_any_role('admin','director'));

-- -----------------------------------------------------------------------------
-- 3. Lockout no resolvedor
--
-- Passa a VOLATILE: a função grava a tentativa errada, e função STABLE não
-- escreve. Os três chamadores (`public_daily_team`, `public_daily_submit`,
-- `public_director_checkpoint`) já são VOLATILE desde a 0026.
--
-- Continua devolvendo NULL para todos os casos de recusa — link inexistente,
-- inativo, expirado, PIN errado e travado são indistinguíveis de fora. Contar
-- ao atacante que ele acertou o slug e errou o PIN seria devolver metade do
-- segredo.
-- -----------------------------------------------------------------------------
create or replace function private.resolve_public_link(p_slug text, p_pin text)
returns public.public_links
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link     public.public_links;
  v_attempts integer;
begin
  select * into v_link
  from public.public_links
  where slug = p_slug and active
    and (expires_at is null or expires_at > now());

  if not found then
    return null;
  end if;

  -- Dentro da janela de trava nem o PIN certo abre: senão bastaria continuar
  -- tentando durante a punição.
  if v_link.locked_until is not null and v_link.locked_until > now() then
    return null;
  end if;

  if v_link.pin_hash is not null then
    -- PIN ausente é SONDAGEM, não chute — e a diferença aqui decide se o Diário
    -- abre. `DailyReport.tsx` chama `public_daily_team(slug, null)` ao montar,
    -- só para descobrir se o link pede PIN (é a única forma: `has_pin` só volta
    -- no sucesso), e o efeito que faz isso depende de `loadMonth`, que depende
    -- de `pin` — ou seja, refaz a chamada a CADA TECLA digitada no campo. Contar
    -- essas chamadas travaria o link no quinto caractere, e aí nem o PIN certo
    -- abriria. Quem não mandou PIN não está adivinhando nada.
    if p_pin is null or btrim(p_pin) = '' then
      return null;
    end if;

    if extensions.crypt(p_pin, v_link.pin_hash) <> v_link.pin_hash then
      v_attempts := coalesce(v_link.failed_attempts, 0) + 1;

      if v_attempts >= 5 then
        -- Zera junto com a trava: passada a janela, o próximo erro recomeça a
        -- contagem em 1 em vez de travar de novo na primeira tentativa.
        update public.public_links
           set failed_attempts = 0,
               locked_until    = now() + interval '15 minutes'
         where id = v_link.id;
      else
        update public.public_links
           set failed_attempts = v_attempts
         where id = v_link.id;
      end if;

      return null;
    end if;
  end if;

  if coalesce(v_link.failed_attempts, 0) <> 0 or v_link.locked_until is not null then
    update public.public_links
       set failed_attempts = 0,
           locked_until    = null
     where id = v_link.id;
  end if;

  return v_link;
end;
$$;

revoke all on function private.resolve_public_link(text, text) from public, anon, authenticated;

comment on function private.resolve_public_link(text, text) is
  'Resolve slug + PIN com lockout de 15 min após 5 erros. NULL para qualquer recusa.';
