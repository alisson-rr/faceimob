# Qualidade de código

- Siga o formatter, o linter e os padrões que o repositório já usa.
- Não reformate nem renomeie código fora do escopo.
- Procure implementações existentes antes de criar helpers, tipos ou componentes.
- Prefira funções coesas, nomes explícitos, retornos antecipados e fluxo linear.
- Comentários explicam o motivo ou uma restrição; o código deve explicar o que faz.
- Mantenha uma única fonte de verdade para cada regra de negócio.
- Preserve APIs públicas e compatibilidade, salvo pedido explícito em contrário.
- Não adicione dependência se a biblioteca padrão, a plataforma ou uma dependência instalada resolverem de forma adequada.
- Não crie interface com uma implementação, factory para um produto ou configuração para um valor fixo sem necessidade atual comprovada.
- Um bug deve ser corrigido na causa compartilhada, depois de verificar os chamadores relevantes.
- Lógica não trivial deixa uma verificação executável proporcional ao risco.
