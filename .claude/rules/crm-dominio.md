# Regras do CRM que erramos antes

Confirme no código antes de afirmar; isto é um atalho, não a fonte de verdade.

## Negócio, Status 1 e Status 2
- Status 2 é `deals.status_detail`. O Pipeline pode filtrar também por Status 1; a Esteira CCA não. Contagens diferentes entre as duas telas costumam ser filtro, não bug: compare os filtros antes de mexer.
- A coluna da Esteira CCA é decidida pelo Status 2 (coluna ligada a um Status 2 só recebe negócios com esse Status 2). Negócio sem Status 2 é "Em preparação" e fica fora da esteira.
- Quem pode mover o Status 2 é regra de permissão (matriz e função de mover); não crie atalho na tela.

## Pessoas e equipes
- Papel é N:N em `user_roles` (`profile_id`, `role`). Toda visibilidade sai de `auth_visible_profiles()`.
- Gerente e diretor do negócio ficam em `deal_participants` (papel `manager`/`director`) e vêm da equipe do corretor. Corrigir à mão só sob pedido explícito, só em um negócio, e mostrando antes e depois.
- Um gerente pode liderar mais de uma equipe ativa: a ficha pede qual (`team_id`).
- Nome do cliente do negócio está em `deal_clients.full_name`, não em `deals`.

## Leads
- Repasse manual (`reassign_lead`) vai direto ao novo corretor, sem cronômetro (`attend_deadline` nulo). "Atrasado" é `next_action_at` vencido. A roleta (`assign_lead`) é que usa o prazo de atendimento.
- Candidatos (vagas de corretor) nunca entram na roleta.
- O histórico do lead mostra nomes pela RPC `lead_history_names`; `profiles` sozinha não mostra quem o chamador não enxerga.

## Banco e produção
- Antes de escrever SQL, abra a migration da tabela: já erramos `profiles.active` (é `status`), `user_roles.user_id` (é `profile_id`) e `deals.client_name`.
- Consulta de produção só leitura, sem autorização. Alterar dado de produção só com o pedido explícito do usuário, uma linha por vez, mostrando o resultado. Comandos longos colados no terminal da VPS corrompem: prefira uma linha curta.
- Merge na `main` publica na VPS (deploy). Migration roda no deploy.
