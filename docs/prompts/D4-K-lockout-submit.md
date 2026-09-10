# Tarefa K — Fechar o buraco do lockout no envio do diário (migration 0034)

> Contexto do agente: **limpo**. Tarefa curta (uma a duas horas). Exige Docker (`./scripts/validate-schema.sh --all`) e a CLI do Supabase linkada (`npx supabase link --project-ref mcmqgxvtwegtptfseqvw`, já feito nesta máquina). O banco é **homologação** — migration e SQL direto podem rodar sem cerimônia. As Tarefas **G e H rodam em paralelo** neste diretório: respeite a lista de arquivos.

## O problema (confirmado, aberto, com a URL já pública)

Leia `docs/prompts/handoff-I.md` §7.5b — está diagnosticado lá com precisão. Em resumo:

A Tarefa I colocou lockout em `resolve_public_link` (5 PINs errados → 15 min). Ele funciona nos dois caminhos de **leitura**, que devolvem `NULL` no PIN errado e portanto **commitam** o `update` do contador. Não funciona no caminho de **escrita**: `public_daily_submit` (migration `0009:267-269`) sinaliza PIN errado com `raise exception ... errcode = '42501'`. PL/pgSQL não tem transação autônoma — a exceção aborta a transação que o PostgREST abriu e **descarta junto o incremento do contador**.

Efeito: um script anônimo que faça `POST /rest/v1/rpc/public_daily_submit` com `{p_slug, p_pin, p_entries: []}` varre os 10^6 PINs **sem nunca travar**, e a resposta é um oráculo perfeito (403 no errado, 200 no certo). Só é explorável por quem conhece o slug: link novo tem 128 bits aleatórios, mas os **legados têm slug derivado do nome** (`seed-daily-*`) e renovar o PIN não troca o slug.

## Contexto
- Repo: `C:\Users\Alisson\CascadeProjects\FACEIMOB`, branch `nova`. Leia `.claude/CLAUDE.md`, `.claude/rules/{database,security}.md`, a migration `20260825120000_0033_public_link_hardening.sql` inteira (é a base do lockout) e `20260725121000_0009_*.sql` na parte de `public_daily_submit`.
- **Você SÓ pode editar:** migration **nova** `supabase/migrations/20260826??????_0034_submit_lockout.sql`, `supabase/tests/11_public_link_hardening.sql` (acrescentar casos), `src/pages/DailyReport.tsx`, `supabase/README.md`, `docs/sprints/decisoes.md`.
- **NÃO toque em:** `Leads.tsx`, `Checkin.tsx`, `components/leads/**` (agente G) · `Pipeline.tsx`, `CcaPipeline.tsx`, `DealDetailModal.tsx`, `components/pipeline/**` (agente H) · qualquer migration já aplicada · `package.json`.

## Entregas
1. **As duas metades, num commit só.** Fazer só a metade do banco é **pior que não fazer nada** — a tela passaria a dizer "enviado" para um envio recusado.
   - (a) Migration `0034`: `public_daily_submit` devolve `null` (ou um retorno que signifique recusa) em vez de `raise` quando o `resolve_public_link` falha. Aí a transação commita e o contador do lockout vale. Mantenha a assinatura e o `grant` para `anon` como estão — a superfície anônima continua sendo exatamente três RPCs, e `tests/06_anon_surface.sql` é o tripwire disso.
   - (b) `DailyReport.tsx:309-317` trata `data === null` como falha: `const { data, error } = ...; if (error || !data) return toast(...)`. Hoje ele só olha o `error`.
2. **Trate o resto do caminho de escrita.** Se houver outro `raise` dentro de `public_daily_submit` (ou irmão) que aborte depois de o contador ser tocado, ele tem o mesmo defeito. Verifique antes de dar por fechado — a causa é compartilhada, não é um `if` isolado.
3. **Teste SQL** em `supabase/tests/11_public_link_hardening.sql`: 5 chamadas de `public_daily_submit` com PIN errado travam o link; a 6ª com o PIN **certo** é recusada dentro da janela; o contador zera no acerto depois da janela. É exatamente o caso que hoje passa despercebido.
4. **Aplicar.** `./scripts/validate-schema.sh --all` verde. No remoto, **`npx supabase db push` não roda neste projeto** — o histórico está incompleto (handoff-I §7.1). Aplique por SQL direto (`npx supabase db query --linked`, como as Tarefas E e I fizeram) e **registre a versão exata do arquivo em `schema_migrations`**, que é o que o push faria.
5. **Opcional, se sobrar tempo — conserte o histórico de migrations.** `supabase migration repair --status applied <versões locais>` e `--status reverted <versões órfãs>`, mais as 0001–0018 que nunca foram registradas. Não roda DDL, é bookkeeping, e destrava o `db push` para todo mundo daqui em diante. Se fizer, liste antes o `supabase migration list` no handoff, faça, e liste depois. Se não fizer, deixe o comando pronto no handoff.

## Fora de escopo (anote, não faça)
- `handle_new_auth_user` ainda concede `broker` a toda conta nova (`0002`). Com signup desligado é inofensivo; vale uma linha numa próxima.
- O `UPDATE` de migração do T14 (cor semântica do CCA) chega escrito no `handoff-H.md`. Se o H já tiver entregue quando você chegar aqui, aplique junto e registre; se não, ignore.

## Critérios de aceite
- `validate-schema --all` verde com os casos novos · `npm run typecheck` · `npm run build` verdes (o `DailyReport.tsx` mudou).
- Prova no handoff: sequência de 5 PINs errados via `curl` na RPC (com a chave publicável, sem token pessoal na saída) e a 6ª tentativa com o PIN certo recusada. Nenhuma credencial em arquivo, log ou saída.
- A tela de diário continua enviando normalmente com o PIN certo — teste o caminho feliz também, senão a correção troca um buraco por uma regressão.

## Entrega
Não commite. Escreva `docs/prompts/handoff-K.md`: o que a 0034 muda, a prova do lockout, o que fez (ou não) com o histórico de migrations, riscos restantes. Atualize a linha da Tarefa K em `docs/sprints/sprint-demo.md`.
