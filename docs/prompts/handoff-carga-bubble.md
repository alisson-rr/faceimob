# Handoff — carga real do Bubble na homologação (12/09/2026)

Projeto `mcmqgxvtwegtptfseqvw`. Carga feita com `scripts/import/run.mjs … --gatilhos-desligados`,
seguindo o `docs/importacao/COMO_RODAR.md` §2, §4, §5 e §6. Início: 2026-09-12T19:03:50Z.
Banco religado às 20:52:53Z.

## Migrations aplicadas nesta rodada

As 0115 a 0125 foram aplicadas pelo MCP `apply_migration`, com `name` = `NNNN_nome`. As 11 bateram
o hash do arquivo. Os 4 crons que elas criam (`faceimob-meta-*`) ficaram desligados. As 0097–0114
já tinham entrado em 11/09.

## O que entrou (conferido no banco)

| Domínio | Gravado |
|---|---|
| Pessoas | 297 perfis: 296 contas novas e 1 conta adotada (@faceimob.com.br). 298 cadastros do Bubble no de-para: um cadastro repetido aponta para o mesmo perfil. 12 equipes, 266 vínculos (87 abertos), 86 na fila-geral. 93 ativos; 204 desligados, bloqueados até 2126 |
| Catálogo | 41 construtoras · 618 empreendimentos · 3 links · 10 dicas · 18 avisos |
| Negócios | 7.579 negócios · 7.560 casos de crédito · 7.916 clientes · 20.737 participantes. VGV bruto R$ 465.819.613,45 (bate ao centavo). Rateio 100% em todo negócio com corretor |
| Histórico | 34.738 linhas: 24.628 observações e 10.110 da trilha de anexos |
| Jogo e metas | 7 temporadas · 35 regras · 629 pódios · 191 metas · 66 resultados anuais |
| Leads | 102.799 leads: in_progress 65.756 · lost 31.160 · discarded 5.824 · converted 59. 7.432 comentários, 6.337 ligações e 5 origens novas. Nenhum na roleta, nenhum telefone fora do padrão |
| Documentos | 29.572 de 29.573. Com arquivo: 21.753 (6,97 GB), iguais aos objetos do bucket e sem órfãos. Sem arquivo: 7.819 (7.815 fora do recorte de 12 meses e 4 acima de 25 MB) |

Conferência por amostra contra os exports, com 5 verificadores e ~360 registros, mais uma impressão
digital do domínio inteiro. Em pessoas, negócios, histórico, leads, jogo e catálogo não houve falha da
carga. A reativação não mexeu em nenhum lead ou negócio, nem criou atribuição.

## Correções feitas durante a carga (no repositório, não commitadas)

1. **`01-pessoas.mjs` e `lib/bubble.mjs` (`emailLogin`).** O login do Supabase recusa acento antes do
   @ ("invalid format"). Duas pessoas desligadas tinham acento no e-mail, e a conta foi criada com o
   endereço sem acento. O provedor do domínio (KingHost) não usa acento em caixa.
2. **`01-pessoas.mjs`.** Um cadastro do Bubble com o mesmo e-mail de outro (desligado duplicando um
   ativo, com o mesmo CPF e a mesma equipe) passa a apontar no de-para para o perfil do primeiro. Antes
   a linha era descartada e a carga 03 abortava por falta de par.
3. **`06-documentos.mjs` (N-27).** CPF grudado por hífen em data ou horário escapava da máscara. Agora
   ele é mascarado. As 88 linhas já gravadas foram renomeadas e 66 objetos movidos, e não sobrou
   nenhum CPF válido em `stored_name` ou `storage_path`.
4. **`06-documentos.mjs` (Cloudflare Polish).** Com o cache do CDN quente, a carga recebia a imagem
   otimizada, e não o original. Agora baixa da origem S3 quando a resposta vem otimizada. As 1.539
   imagens já gravadas foram substituídas pelo original (tamanho e MD5 conferidos), e a remedição deu
   3.757/3.757 originais.
5. Os erros de rede 520/504 do gateway foram resolvidos pela retomada normal do de-para.

Os scripts de reparo (itens 3 e 4) foram descartáveis e ficaram fora do repositório.

## Exceções da origem (entraram como a regra manda; decisão humana)

- **1 documento não entrou:** `analise-ativa.png` do negócio `BUB-1770914179292x560852656395386900`
  tem 0 bytes no CDN.
- **4 anexos acima de 25 MB em negócios ativos** estão sem arquivo. Opções: subir o limite do bucket
  ou pedir o reenvio.
- **16 negócios com rateio inflado** (corretor ligado a ficha sem pessoa) e **36 negócios sem
  participante**, que ninguém vê. Revisar na tela.
- **3.120 leads sem corretor** (nome não resolvido, inclusive nomes com acento corrompido na origem).
  **Ligações** casadas pelos 8 dígitos finais do telefone.
- **"Gerente Interino"** tem pódio mas não tem papel de corretor, então não aparece no ranking.
- **A conta @faceimob.com.br** manteve director e manager de antes da carga; pela regra seria só
  admin.
- **LAKEWOOD** está cadastrado em duas construtoras. **Julho 2026** tem os pesos deslocados no
  próprio Bubble.

## Pendências operacionais

- **IP real da unidade** em Admin · IPs: sem ele nenhum corretor faz check-in e a roleta não entrega
  lead.
- **A conta @gmail.com (admin)** tem a trava de IP desligada e vaga na fila-geral; recebe lead se
  fizer check-in.
- **A temporada aberta "Setembro 2026"** não tem regras próprias e pontua pelas 5 globais do seed,
  com pesos diferentes dos do Bubble. Há também dois "Setembro 2026" no seletor: o do Bubble, fechado,
  e o de produção.
- **Os 4 crons `faceimob-meta-*`** estão desligados. Ligar só com as credenciais da Meta e da IA e
  aceitando o custo.
- **Alerta falso de cron:** `notify_cron_failures()` conta execução em andamento como falha e gerou 12
  avisos "Automação com falha" às 21:15.
- **Conferências documentais desatualizadas:**
  - a consulta de CPF do COMO_RODAR §6 e a do cabeçalho do 06 dão falso positivo;
  - o `ESPERADO` do 01 ainda diz 317 papéis e 267 vínculos (vigente: 316 e 266);
  - o COMO_RODAR diz que Node 20 não roda, mas a carga rodou em Node 20.19.6.
- **Não rodar** seed, `db reset` ou `supabase db push` nesse banco. `backup_pre_bubble` continua lá.
