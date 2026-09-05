-- =============================================================================
-- 0069 · SDR: a matriz de papéis para de se contradizer
--
-- O módulo SDR tinha duas metades que discordavam entre si, e a tela só podia
-- mentir para um dos lados:
--
--   1. `marketing` escreve em QUATRO tabelas do módulo desde a 0008
--      (`sdr_agents_write`, `lead_sources_write`, `remarketing_lists_all`,
--      `sdr_conversations_write`) e NÃO tem `menu.sdr` em `role_permissions` —
--      `/sdr` é guardado por essa permissão (`src/lib/routePermissions.ts`),
--      então o papel que o banco autoriza a escrever não conseguia abrir a
--      tela. Todo o ramo `marketing` das constantes do front era inalcançável.
--
--   2. `whatsapp_templates_write` aceita só admin e marketing. Resultado: o
--      papel `sdr` — que administra agentes, origens e listas de remarketing —
--      via a aba WhatsApp travada, e o template travado é justamente o que ele
--      dispara. Na prática a aba era editável só por admin, e a copy mandava o
--      operador procurar `marketing`, o único papel que não entra no módulo.
--
-- Decisão: alinhar pelo que o banco já dizia. `marketing` ganha o menu (as
-- permissões de escrita dele já existem há dez migrations; remarketing É
-- trabalho de marketing) e `sdr` ganha a escrita de template (é o dono
-- operacional do módulo).
--
-- Consequência de seguir por aqui: um usuário `marketing` passa a ver o item
-- SDR no menu e a poder criar/editar agentes, origens e listas — que é
-- exatamente o que as policies da 0008 já permitiam se ele chegasse lá. O
-- caminho oposto (tirar `marketing` das policies) fecharia o remarketing para
-- quem faz campanha, e é mais destrutivo.
--
-- Espelho no front: `SDR_WRITE_ROLES` e `TEMPLATE_WRITE_ROLES` em
-- `src/components/sdr/types.ts`. Mudou aqui, muda lá.
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `marketing` enxerga o módulo que já podia administrar
-- -----------------------------------------------------------------------------
insert into public.role_permissions (role, permission, allowed)
values ('marketing', 'menu.sdr', true)
on conflict (role, permission) do update set allowed = true;

-- -----------------------------------------------------------------------------
-- 2. `sdr` escreve o template que ele mesmo dispara
-- -----------------------------------------------------------------------------
drop policy if exists whatsapp_templates_write on public.whatsapp_templates;
create policy whatsapp_templates_write on public.whatsapp_templates
  for all to authenticated
  using (public.has_any_role('admin', 'marketing', 'sdr'))
  with check (public.has_any_role('admin', 'marketing', 'sdr'));

comment on table public.whatsapp_templates is
  'Espelho dos templates aprovados na Meta. Escrita: admin, marketing e sdr (0069) — os mesmos papéis que escrevem agentes, origens e listas de remarketing.';
