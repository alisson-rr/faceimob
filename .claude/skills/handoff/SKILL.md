---
name: handoff
description: Gera um resumo curto e retomável do trabalho atual, com objetivo, progresso, decisões, pendências e próximo passo. Use quando o usuário pedir handoff, pausa, retomada ou resumo para outra sessão.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

Prepare um handoff do trabalho atual. Contexto adicional: `$ARGUMENTS`.

- Consulte o estado e o diff do repositório; leia apenas os arquivos necessários para confirmar fatos.
- Não altere arquivos, não faça commit e não inclua segredos.
- Seja curto o bastante para outra sessão retomar sem reler a conversa.

Use exatamente estas seções:

## Objetivo
## Concluído
## Decisões e motivos
## Pendente ou bloqueado
## Próximo passo exato
## Arquivos e comandos relevantes
