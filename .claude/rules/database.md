---
paths:
  - "**/*.sql"
  - "**/migrations/**/*"
  - "**/supabase/**/*"
---

# Banco de dados

- Não edite migração já aplicada; crie uma nova migração corretiva.
- Mudanças destrutivas exigem confirmação, plano de recuperação e estratégia para dados existentes.
- Use transações para manter invariantes quando várias operações precisarem ser atômicas.
- Use consultas parametrizadas e privilégio mínimo.
- Em Supabase, trate RLS como parte do contrato e teste usuário autorizado, não autorizado e ausência de sessão.
- Adicione índice por consulta e volume observados, não por antecipação; considere custo de escrita.
- Evite `select *` em contratos estáveis e caminhos de alto volume.
- Mudanças de schema precisam ser compatíveis com o código durante a ordem real de deploy.
