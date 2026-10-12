# Ponte do relatório: qualidade por campanha

Entrega ao Assistente DG (Telegram) o mesmo quadro de Marketing → Qualidade,
em JSON. Só contagens por campanha: nenhum nome nem telefone de lead sai daqui.

## Ativar

1. Admin → Integrações: cadastre `relatorio / api_token` com uma senha longa
   (a mesma que o Assistente DG vai usar). Sem ela a ponte responde 503.
2. Chame (GET ou POST):

```
GET https://<functions_url>/relatorio-qualidade-campanhas?dias=30
Authorization: Bearer <token>
```

`dias` vai de 1 a 365 (padrão 30).

## Resposta

`{ dias, gerado_em, campanhas: [...] }`. Cada campanha traz `campanha`, `gasto`,
`leads` (os que o CRM recebeu), `cpl`, `resultados_meta` (o que a Meta contou),
`custo_resultado_meta`, `atendidos`, `qualificados` (entregues pelo robô),
`em_analise`, `aprovadas`, `vendas`, `custo_qualificado`, `custo_analise`,
`nomes_distintos` e `formularios` (mais de um indica atribuição a conferir).

## Como ler

- Qualidade de verdade é `em_analise`/`aprovadas`/`vendas`; `qualificados` é a
  leitura rápida.
- Se `resultados_meta` for bem maior que `leads`, o CPL do CRM está inflado:
  use `custo_resultado_meta` e investigue por que os leads não entraram.
- Campanha recente tem pouca análise e venda: o ciclo é maior que a janela.

## Segurança

Token comparado em tempo constante, só leitura, 503 sem token cadastrado.
Para trocar o token, grave outro no cofre; o antigo deixa de valer na hora.
