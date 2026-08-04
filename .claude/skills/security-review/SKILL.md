---
name: security-review
description: Audita uma mudança ou fluxo por vulnerabilidades concretas e produz achados acionáveis. Use manualmente antes de release, ao mexer em autenticação, pagamentos, webhooks, uploads, dados sensíveis ou permissões.
disable-model-invocation: true
context: fork
agent: code-reviewer
background: false
---

Faça uma revisão de segurança read-only no escopo: `$ARGUMENTS`.

1. Leia o diff e identifique ativos, fronteiras de confiança, atores e operações privilegiadas.
2. Se houver Graphify, consulte os caminhos entre entrada, autorização, persistência e saída; confirme no código.
3. Procure somente riscos sustentados por evidência: autenticação e autorização, isolamento de tenant, injeção, XSS/CSRF/SSRF, segredos, exposição de dados, upload/path traversal, webhooks/replay, concorrência, logs e configuração insegura.
4. Verifique controles existentes antes de registrar um achado.
5. Não altere arquivos e não produza checklist genérico.

Para cada achado, informe:

- severidade (`crítica`, `alta`, `média`, `baixa`);
- arquivo e linha;
- evidência e cenário de exploração;
- impacto;
- correção mínima e como validá-la.

Se não houver achados, diga isso e registre as partes que não puderam ser verificadas.
