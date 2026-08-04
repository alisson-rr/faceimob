# Segurança

- Nunca leia, exiba, registre ou versione credenciais sem necessidade explícita. Mascare valores em saídas.
- Segredos ficam no servidor e em variáveis de ambiente; mantenha apenas nomes e exemplos seguros no repositório.
- Nenhuma entrada externa é confiável: valide tipo, formato, tamanho e permissão na fronteira.
- Autorização deve verificar o recurso e o tenant, não apenas a existência de uma sessão.
- Use consultas parametrizadas; codifique a saída conforme o contexto para evitar injeção e XSS.
- Proteja webhooks com assinatura, tolerância de tempo e idempotência.
- Não registre tokens, dados pessoais, conteúdo sensível ou respostas completas de provedores.
- Aplique privilégio mínimo a chaves, papéis, buckets, tabelas e integrações.
- Não desative verificações TLS, RLS, CSRF, autenticação ou validação para contornar um erro.
- Em mudança sensível, descreva o cenário de ataque, a mitigação e a verificação executada.


