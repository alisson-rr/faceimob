Valide a mudança atual. Escopo opcional: `$ARGUMENTS`

1. Descubra os comandos existentes no manifesto, README, CI ou arquivos de configuração.
2. Não instale dependências e não invente um novo sistema de validação.
3. Rode somente as verificações relevantes, da mais rápida para a mais ampla: formatter em modo check, lint, tipos, testes focados e build quando ele validar algo adicional.
4. Se uma verificação falhar, separe falha causada pela mudança de falha preexistente com evidência.
5. Resuma cada comando como passou, falhou ou não foi executado, com o próximo passo mínimo.
