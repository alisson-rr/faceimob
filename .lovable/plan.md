## Objetivo
Consolidar as três páginas ("Equipe", "Pessoal", "Gestão de Equipes") numa única rota `/equipes` que mostra tudo na mesma tela e permite reorganizar a hierarquia com um modal em massa. Todos os dados vêm de `brokers` (fonte única), então qualquer alteração feita aqui já se reflete em todo o CRM automaticamente.

## Nova página `/equipes` (rota única)
Layout empilhado, sem abas:

```text
┌───────────────────────────────────────────────────────────┐
│ 1. Meu Perfil (usuário logado)                            │
│    nome, e-mail, CRECI, CPF, tel, cargo, foto             │
├───────────────────────────────────────────────────────────┤
│ 2. Hierarquia (3 colunas)                                 │
│    Diretores (3) │ Gerentes (9) │ Corretores (73)         │
│                                                            │
│    [Vincular em massa] ← botão topo da coluna              │
│    (só aparece para Admin e Diretor)                       │
├───────────────────────────────────────────────────────────┤
│ 3. Performance por Equipe                                 │
│    Cards de cada gerente com métricas + ranking top       │
│    (conteúdo atual do Team.tsx, simplificado)             │
└───────────────────────────────────────────────────────────┘
```

## Modal "Vincular em massa"
- Aberto pelo botão no topo da coluna Gerentes ou Corretores.
- Passo 1: escolher o superior (Diretor se estiver na coluna de Gerentes; Gerente se estiver na de Corretores).
- Passo 2: checkbox list com todos os membros da coluna, filtro por nome. Já vem marcado quem hoje está vinculado a esse superior.
- Passo 3: "Aplicar" atualiza `brokers.manager_id` (ou `director_id`) para todos os selecionados numa única chamada `.in('id', ids)`.
- Ao vincular corretores a um gerente, o `director_id` é propagado automaticamente do gerente escolhido.
- Toast de confirmação e recarregamento.

O ícone de lápis atual (edição individual) continua funcionando para ajustes pontuais.

## Permissões
- Botão "Vincular em massa" e ícone de lápis visíveis apenas se `role in ('admin','director')`.
- Diretores editam somente sua própria árvore (managers e brokers com `director_id = próprio broker.id`).
- Admins editam tudo.

## Sincronização com Equipe/Pessoal
Como Team.tsx já lê de `brokers` e Profile.tsx lê de `profiles`, unificar em `/equipes` significa apenas remover as rotas duplicadas e trazer o conteúdo para dentro da nova página. Nenhuma migração de dados é necessária.

## Detalhes técnicos
- Nova página: `src/pages/Equipes.tsx` (substitui Team, Profile e AdminTeams).
- Sidebar (`AppSidebar.tsx`): remover itens "Equipe", "Pessoal" e "Equipes" (admin) → um único item **"Equipes"** apontando para `/equipes`, visível para todos os papéis.
- `App.tsx`: rota `/equipes`; redirecionar `/team`, `/profile` e `/admin/teams` → `/equipes` para não quebrar links salvos.
- Arquivos antigos (`Team.tsx`, `Profile.tsx`, `AdminTeams.tsx`) removidos.
- Query do "Meu Perfil": `profiles` filtrado por `auth.uid()`, formulário edita nome, telefone, CRECI, CPF, foto (mesma lógica atual).
- Modal de massa: componente único `BulkAssignDialog` reutilizado nas duas colunas.

## Fora do escopo
- Não altero regras de RLS nem schema do banco (a permissão de update em `brokers` já existe).
- Não mexo em Pipeline, CCA, Marketing.
