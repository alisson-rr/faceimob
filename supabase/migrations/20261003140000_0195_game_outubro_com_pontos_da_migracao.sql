-- =============================================================================
-- 0195 — game de outubro começa com a pontuação do sistema anterior
--
-- Pedido do cliente em 03/10/2026: "deixe o game de outubro com essas
-- pontuações para iniciar, remova as pontuações existentes e coloque estas da
-- migração" (print do ranking do sistema anterior). Só os que tinham ponto:
--   Rudinei Teixeira De Souza 40 · Alisson Luiz Soares de Oliveira 15 ·
--   Paulo Ricardo Soares da Silveira 15 · Tabhata Rezer Nobre 5 ·
--   Nathalia de Matos Dias Sito 5 · Kaua Marques 5.
--
-- O que já pontuou na temporada de outubro sai, com cópia em
-- `private.game_events_antes_0195` para voltar se preciso. Os pontos da
-- migração entram como evento `migracao` (rótulo na tela: "Pontos do sistema
-- anterior"). Daqui para frente o game segue pontuando normalmente.
-- Nome que não casar com um cadastro só gera aviso no log do deploy.
-- =============================================================================

create table if not exists private.game_events_antes_0195 (like public.game_events);
revoke all on private.game_events_antes_0195 from public, anon, authenticated;

-- Função (e não um DO solto) para o teste SQL poder reaplicar a regra numa
-- temporada criada por ele; só o dono do banco executa.
create or replace function private.game_outubro_pontos_da_migracao_0195()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_temporada uuid;
  v_perfil uuid;
  v_linha record;
begin
  select s.id into v_temporada
    from public.game_seasons s
   -- A temporada aberta é uma só (índice game_seasons_one_open); confere que é a de outubro.
   where s.closed_at is null and s.period_start >= date '2026-10-01' and s.period_start < date '2026-11-01'
   order by s.created_at desc
   limit 1;
  if v_temporada is null then
    raise notice '[0195] sem temporada aberta de outubro/2026; nada a fazer.';
    return;
  end if;

  insert into private.game_events_antes_0195
  select * from public.game_events where season_id = v_temporada;
  delete from public.game_events where season_id = v_temporada;

  for v_linha in
    select * from (values
      ('Rudinei Teixeira De Souza', 40),
      ('Alisson Luiz Soares de Oliveira', 15),
      ('Paulo Ricardo Soares da Silveira', 15),
      ('Tabhata Rezer Nobre', 5),
      ('Nathalia de Matos Dias Sito', 5),
      ('Kaua Marques', 5)
    ) as t(nome, pontos)
  loop
    select p.id into v_perfil
      from public.profiles p
     where public.nome_comparavel(p.full_name) = public.nome_comparavel(v_linha.nome)
     order by (p.status = 'active') desc, p.created_at
     limit 1;
    if v_perfil is null then
      raise warning '[0195] corretor não encontrado no cadastro: %', v_linha.nome;
      continue;
    end if;
    insert into public.game_events (season_id, profile_id, event_code, points, ref_type, occurred_at)
    values (v_temporada, v_perfil, 'migracao', v_linha.pontos, 'migracao_sistema_anterior',
            timestamptz '2026-10-01 12:00:00-03');
  end loop;
end;
$$;

revoke all on function private.game_outubro_pontos_da_migracao_0195() from public, anon, authenticated;

select private.game_outubro_pontos_da_migracao_0195();
