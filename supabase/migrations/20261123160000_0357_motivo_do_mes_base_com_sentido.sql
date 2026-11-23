-- =============================================================================
-- 0357 · Motivo do mês-base com sentido (pedido de 23/11/2026)
--
-- Um adiamento de mês-base foi registrado com o motivo "dsasd": a regra só
-- pedia 3 caracteres. Agora pede uma frase: ao menos 10 caracteres e duas
-- palavras de três letras ou mais ("Resolvendo SERASA" passa; "Análise" não).
-- =============================================================================

create or replace function public.alterar_mes_base(p_deal_id uuid, p_mes date, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal   public.deals;
  v_mes    date := date_trunc('month', p_mes)::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if p_mes is null then
    raise exception 'Escolha o novo mês-base.' using errcode = '22023';
  end if;
  -- 0357: motivo de verdade, não "dsasd": ao menos 10 caracteres e duas
  -- palavras de três letras ou mais. A tela aplica a mesma regra.
  if length(v_motivo) < 10 or length(v_motivo) > 1000
     or (select count(*) from regexp_matches(v_motivo, '[[:alpha:]]{3,}', 'g')) < 2 then
    raise exception 'Explique o motivo da troca do mês-base em uma frase (ao menos duas palavras).' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'Negócio não encontrado.' using errcode = 'P0002';
  end if;

  if not (public.is_admin()
          or (public.has_any_role('manager', 'director') and public.can_edit_deal(p_deal_id))) then
    raise exception 'Só o administrador, o gerente ou o diretor do negócio altera o mês-base.' using errcode = '42501';
  end if;

  -- 0207: no máximo dois meses à frente do mês corrente (horário de Brasília).
  if v_mes > (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '2 months')::date then
    raise exception 'O mês-base pode ir no máximo dois meses à frente.' using errcode = '22023';
  end if;

  if v_deal.month_base = v_mes then
    raise exception 'O negócio já está nesse mês-base.' using errcode = '22023';
  end if;

  update public.deals set month_base = v_mes where id = p_deal_id;

  insert into public.deal_history (deal_id, actor_id, kind, to_value)
  values (p_deal_id, auth.uid(), 'comment',
          'MÊS-BASE ALTERADO de ' || coalesce(to_char(v_deal.month_base, 'MM/YYYY'), '—')
          || ' para ' || to_char(v_mes, 'MM/YYYY') || ': ' || v_motivo);
end;
$$;

revoke all on function public.alterar_mes_base(uuid, date, text) from public, anon;
grant execute on function public.alterar_mes_base(uuid, date, text) to authenticated;
