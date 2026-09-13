-- =============================================================================
-- 0146 · Atividade só para quem o autor enxerga
--
-- `tasks_write` (0011, igual na homologação em 12/09/2026) aceitava no WITH
-- CHECK qualquer `created_by = auth.uid()`: qualquer usuário gravava atividade
-- com `assigned_to` de qualquer pessoa. Desde a 0143 `notify_task_assigned`
-- avisa o responsável com o título livre da atividade, e o aviso sai por push —
-- um corretor escrevia o que quisesse na tela de bloqueio do celular de
-- qualquer um.
--
-- Regra nova, só no WITH CHECK (criar e alterar). O responsável tem de ser:
--   · alguém em `auth_visible_profiles()` — que já inclui o próprio usuário e,
--     para admin e sócio, todo mundo; `is_admin()` vem antes só para não
--     montar a lista inteira de perfis;
--   · ou, só para o SDR, o dono de um lead que ele LÊ, quando a atividade é
--     desse lead. É o fluxo da aba Agenda do lead: o SDR tem `menu.leads`, lê
--     lead de corretor pela `leads_select_sdr` (lead com conversa de SDR) e o
--     TaskPanel do LeadDetailModal cria a atividade para `lead.assigned_to`.
--     O subselect em `leads` passa pelo RLS de quem grava. O alcance é o dono
--     de TODO lead com conversa de SDR — mais largo que o do comentário de lead,
--     que exige `can_write_lead` e não inclui o SDR.
--     O papel fica explícito porque a `leads_select_sdr` também libera leitura
--     ao marketing, que não tem `menu.leads` nem `menu.pipeline` (as duas telas
--     que abrem o LeadDetailModal): sem o gate ele ganharia um canal de push
--     sem tela nenhuma que o use.
--
-- `manages_profile(assigned_to)` saiu: ou é admin, ou integrante de equipe que
-- o usuário lidera — as duas coisas estão em `auth_visible_profiles()`.
--
-- O USING não muda: a policy é FOR ALL e ele também decide SELECT, UPDATE e
-- DELETE — responsável e autor seguem lendo e apagando o que existe.
--
-- Consequência no UPDATE (o WITH CHECK é o mesmo do INSERT): o autor não
-- conclui nem cancela atividade cujo responsável saiu do alcance dele — o
-- corretor que deixou a equipe do gerente, ou o lead do SDR que a roleta passou
-- para outro corretor (nenhuma função move `tasks.assigned_to`). O responsável
-- e o admin continuam fechando. Voltar a aceitar `created_by` no WITH CHECK
-- reabriria o INSERT, que usa a mesma expressão.
-- ponytail: autor perde o fechamento quando o responsável sai do alcance;
-- evoluir com função security definer que aceite o autor quando `assigned_to`
-- não mudou, se isso aparecer em uso real (a homologação tinha 0 atividades).
--
-- Fora do alcance desta policy e sem mudança: funções security definer. Na
-- homologação nenhuma grava em `tasks` (`notify_due_tasks` e
-- `tasks_sync_lead_deadline` só leem), e as edge functions não tocam a tabela.
-- =============================================================================

alter policy tasks_write on public.tasks
  with check (
    (select public.is_admin())
    or assigned_to in (select public.auth_visible_profiles())
    or ((select public.has_role('sdr'))
        and ref_type = 'lead'
        and exists (select 1
                      from public.leads l
                     where l.id = tasks.ref_id
                       and l.assigned_to = tasks.assigned_to))
  );
