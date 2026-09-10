# Pendências do importador

Estado em **09/09/2026**, depois da rodada de correções desta data. Só entra aqui o que continua
aberto; o que foi fechado está no cabeçalho da carga correspondente, não nesta lista.

Fechados nesta rodada e retirados daqui: de-para de pessoas parcial agora termina em **código de
saída 1** com o que falta e o que fazer (antes a carga dizia "concluído" tendo deixado participante
de fora); os números da era do CSV em `COMO_RODAR.md` e `DECISOES.md`
(7.568 / 7.549 / 204 → **7.579 / 7.560 / 205**, mais o VGV de aceite `465211260.70` →
**465819613.45**); o roteiro de operação sem as cargas 05 e 06; e as três consultas de aceite de
`deal_participants` que contavam seed e demonstração junto com o import.

---

## P-1 [média] `run.mjs` imprime uma preparação de banco incompleta

O bloco `PREPARACAO` (`scripts/import/run.mjs:108-140`) é o SQL que o orquestrador cospe na tela de
quem esquece o `--gatilhos-desligados` — e ele parou na onda 1. Faltam duas coisas que as cargas
novas exigem, e que `COMO_RODAR.md` §2 já traz:

- `alter table public.deal_documents disable trigger deal_documents_award_points;` (carga 06);
- `notify_on_assign = false, notify_on_timeout = false` em `automation_settings` (carga 05 **aborta**
  na própria sonda sem isso).

O comentário `-- 3. gatilhos da carga 03 (as outras três não precisam de nenhum)` também está velho:
hoje são seis outras cargas, e uma delas precisa.

Quem seguir o roteiro (`COMO_RODAR.md`) roda tudo certo; quem seguir a mensagem de erro do
`run.mjs`, não. **Não editei porque `run.mjs` não é arquivo desta tarefa.**

**Como conferir:** `node scripts/import/run.mjs` sem `--gatilhos-desligados` e comparar a saída com
`COMO_RODAR.md` §2.

---

## P-2 [média] N-02 e N-03 foram fechadas no código sem ratificação do dono

`DECISOES.md` lista as duas como "adiadas para depois do reexport". O reexport de `leadfies` não
veio e não virá, e `scripts/import/05-leads.mjs` fechou as duas com número medido no CSV de 08/09:
`Arquivado` vira `discarded` (5.105 leads, motivo de contato inválido / duplicado / teste) ou `lost`
(31.160), e o casamento de corretor por nome passou a exigir igualdade exata, sem escada de
primeiro+último nome.

É decisão de negócio: `discarded` sai do denominador de perda e `lost` entra. Enquanto o dono da
operação não ratificar, `DECISOES.md` e o código dizem coisas diferentes sobre o mesmo campo.

**Consequência de cada caminho:** ratificar como está mantém 5.105 leads fora da taxa de perda e
fecha N-02/N-03; mudar depois da carga exige um `update` em massa em `leads.status`/`lost_at` — os
dois campos juntos, porque a constraint `leads_lost_consistency` recusa um sem o outro.

**Como conferir:** cabeçalho de `05-leads.mjs` (seções N-02/R-07 e R-08) e
`node scripts/import/05-leads.mjs --dry-run` (contadores `status:*`).

---

## P-3 [baixa] Decisão de operação: adotar equipe do destino pelo nome, sim ou não?

O ramo do nome (`01-pessoas.mjs`, passo 9) adota equipe que já existe no destino e normaliza igual à
do Bubble — com `equipes:adotada-por-nome` e aviso, não mais calado. Ele não pode simplesmente cair:
é o único caminho que reencontra a equipe quando a rodada anterior a criou e morreu antes de gravar
o de-para.

Falta olhar o banco de homologação para saber se alguma equipe criada pela tela colide com as 12 do
Bubble — `Archimedes, Zona Sul, Mauricio, Jose Portilho, Faceimob, Susana, Victor, Veronica,
Alisson, Alexandre, Daiane Dias, Leonardo`. Nos seeds não há colisão (`Equipe Paulista`,
`Equipe Sul`, `Equipe Centro`).

**Consequência de cada caminho:** aceitar a adoção mantém a recuperação automática e corre o risco
de o de-para apontar `bubble_id` para uma equipe de outra procedência, com `director_id`/`manager_id`
alheios; bloquear a adoção obriga a apagar a equipe duplicada à mão quando a rodada morrer no meio.

**Como conferir:** `select name from public.teams` no destino contra a lista acima, ou rodar a
carga 01 e ler `equipes:adotada-por-nome` no relatório.

---

## P-4 [baixa] O corte de 50 avisos ainda pode comer a lista de pendências de FK

`lib/bubble.mjs` corta o relatório em 50 avisos. A lista de fichas sem vínculo e o carimbo de início
já saem fora do corte (por `console.log`), mas numa rodada online com FK faltando `pessoa.relatar` e
`construtora.relatar` emitem até 21 avisos cada e ainda podem empurrar avisos de outra natureza para
fora — inclusive os que explicam o novo código de saída 1 por de-para parcial.

O conserto natural é elevar ou remover o corte em `lib/bubble.mjs`, arquivo que esta tarefa não podia
editar. Alternativa sem mexer na lib: cada carga imprime a própria lista longa por `console.log`,
como a 03 já faz em dois blocos.

**Como conferir:** contar as linhas `  ! ` da saída de uma rodada com de-para incompleto.

---

## P-5 [baixa] Linha × arquivo de `deal_documents` não fecha por SQL

`06-documentos.mjs` grava em dois lugares (a linha em `deal_documents` e o objeto no bucket) e
nenhuma consulta casa as duas gravações. A conferência disponível é a da tela
(`missingStoragePaths`, `src/integrations/supabase/documents.ts`) ou repetir a carga, que só reenvia
o par que não está no de-para. Um número somado para o relatório de encerramento da migração ainda
não existe.

**Como conferir:** cabeçalho de `06-documentos.mjs`, seção "SQL QUE PROVA QUE DEU CERTO".

---

## Fechados depois desta lista, ainda em 09/09/2026

Corrigidos direto, com prova executada:

- **Máscara de CPF no nome do arquivo (N-27).** A regra dependia do agrupamento `3-3-3-2` e deixava
  passar as formas digitadas à mão (`3-6-2`, separador por vírgula). Passou a mascarar qualquer janela
  com exatamente 11 dígitos, e a rodar dos dois lados de `sanear` — `sanear` converte vírgula em
  hífen, e só depois disso um CPF separado por vírgula vira janela de 11 dígitos.
  **Medido nos 410.624 nomes reais do CSV: a regra antiga deixava 2.998 CPFs chegarem a
  `stored_name`; a nova deixa 0.** O SQL de aceite passou a contar dígito, o mesmo critério do código,
  em vez de repetir o formato — critério duplicado divergia do código.
- **Gatilho `deal_documents_supersede`.** Provado **contra o banco real**, em transação desfeita:
  três versões do mesmo par (negócio, tipo) num único INSERT deixam **0 documentos vigentes**; em
  INSERTs separados, em ordem crescente, deixam **1, e é a mais nova**. Confirma o defeito e a
  correção por ondas. Nada ficou no banco (`storage_path like 'x/%'` = 0).
- **Contagem de empreendimentos em `COMO_RODAR.md`** (615 → 618, o que o script mede hoje).
- **`lib/bubble.mjs supa()`** não construía o cliente no Node 20 (o `@supabase/supabase-js` 2.110
  exige `WebSocket` global). Resolvido com um esboço que lança se alguém tentar Realtime, que a
  importação não usa. Testado: o cliente constrói e o PostgREST responde.
- **`run.mjs`** passou a conhecer as cargas `05-leads` e `06-documentos`, com a ordem de dependência.

## Aberto e que depende do dono da operação

- **Ratificar N-02** (a quebra de `Arquivado` em 5.105 descartes e 31.160 perdas). A regra está no
  cabeçalho de `05-leads.mjs`, valor a valor.
- **30 fichas de corretor/gerente sem pessoa** (254 ocorrências, 88 negócios sem corretor). A maior
  é `Zona Sul`, que é região, não gente; outras são imobiliárias parceiras. A lista sai nomeada no
  relatório da carga 03.
- **2.495 arquivos de 684 negócios** que só existem em snapshot antigo de `doc-clientes` e ficam fora.
  Trazê-los custa ~2.495 downloads a mais.
- **746 arquivos** que só aparecem em `pipelines.documentos`, sem par em `doc-clientes`.
- **Confirmar o fuso do Bubble** (N-01). Segue `America/Sao_Paulo` como suposição.
