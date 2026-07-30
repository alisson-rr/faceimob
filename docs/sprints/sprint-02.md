# Sprint 2 (07/08 – 13/08) — Login seguro + check-in e fila

**Meta da sprint:** ninguém mais depende de senha fixa exposta (vulnerabilidade
explícita da ata 23/07) e o corretor vê sua posição na fila e seus contadores.

---

## Épico E3 — Autenticação por código no e-mail `[Dev A]`

A ata 23/07 pede validação por e-mail para eliminar senha exposta. O schema já
não guarda senha — falta o fluxo no frontend. Arquivos de auth ficam com o
Dev A para o Dev B seguir nas telas de dados sem conflito.

### S3.1 — Login por OTP (`signInWithOtp`) (5 pts)
Fluxo: e-mail → código de 6 dígitos → sessão. Manter `signInWithPassword`
escondido atrás de flag durante a transição (1 sprint), depois remover.
- **Arquivos:** `src/pages/Login.tsx`
- **Aceite:** usuário entra só com e-mail + código; template de e-mail do
  Supabase configurado em pt-BR; rate limit verificado.

### S3.2 — Aposentar senha em `Settings.tsx` e `ResetPassword.tsx` (3 pts)
`Settings.tsx:59` reautentica com `signInWithPassword` — trocar por
reautenticação OTP; `ResetPassword.tsx` deixa de fazer sentido ou vira só
"reenviar código".
- **Arquivos:** `src/pages/Settings.tsx` (somente o bloco de senha),
  `src/pages/ResetPassword.tsx`
- **Aceite:** nenhuma chamada a `signInWithPassword` no repositório.

### S3.3 — Provisionamento sem senha (2 pts)
`provision-broker-user` deixa de definir senha fixa: cria o usuário e o
primeiro acesso é via OTP.
- **Arquivos:** `supabase/functions/provision-broker-user/index.ts`
- **Aceite:** usuário novo recebe convite e entra por código, sem senha
  trafegando em banco, logs ou planilha.

### S3.4 — Disparo do aviso de lead perdido (3 pts)
`notify_lead_timeout` existe no banco mas nada dispara a mensagem. Ligar ao
cron da Sprint 1 (ou trigger) e enviar via WhatsApp (Evolution API ou Cloud
API — o que já estiver com credencial ativa).
- **Arquivos:** `supabase/migrations/...0014_notify_timeout.sql` (novo),
  `supabase/functions/notify-lead-timeout/` (nova function, se necessário)
- **Aceite:** lead expirado gera mensagem de WhatsApp ao corretor em ≤ 1 min.

---

## Épico E4 — Porta de entrada da roleta `[Dev B]`

### S4.1 — Migrar `Checkin.tsx` (5 pts)
Usar `perform_checkin`/`perform_checkout` + `checkin_eligibility`. Mostrar
feedback visual do turno (requisito ata 14/07) e o motivo quando bloqueado
(+20 atrasados).
- **Arquivos:** `src/pages/Checkin.tsx`
- **Aceite:** check-in só com IP permitido; bloqueio por atraso mostra
  contagem de leads atrasados; turno atual visível.

### S4.2 — Migrar `AdminAllowedIps.tsx` (3 pts)
Inclui o facilitador de suporte da ata 23/07: exibir o IP atual do usuário
para o admin cadastrar rápido quando o IP é dinâmico.
- **Arquivos:** `src/pages/AdminAllowedIps.tsx`
- **Aceite:** CRUD de IPs no schema novo; botão "usar meu IP atual".

### S4.3 — Posição na fila (3 pts)
Requisito ata 23/07: indicador visual da posição na fila de atendimento.
`distribution_queue` já existe.
- **Arquivos:** `src/components/QueuePosition.tsx` (novo), integrado em
  `src/pages/Checkin.tsx`
- **Aceite:** corretor logado e em check-in vê "você é o Nº da fila X";
  atualiza sem recarregar a página.

### S4.4 — Contador de leads por período (3 pts)
Requisito ata 23/07: quantos leads recebidos hoje / na semana / no mês.
- **Arquivos:** `src/components/LeadCounter.tsx` (novo), integrado em
  `src/pages/Checkin.tsx` e `src/pages/Leads.tsx`*
- **Aceite:** contadores batem com o banco para os três períodos.

\* `Leads.tsx` foi do Dev B na Sprint 1 — sem conflito de trilho.

---

**Capacidade:** Dev A 13 pts · Dev B 14 pts.

**Dependências:** S3.4 depende do cron da Sprint 1. S4.3/S4.4 dependem da
migração do `Checkin.tsx` (S4.1) — fazer na ordem.

**Risco:** template OTP/e-mail do Supabase em produção exige SMTP próprio
(limite do e-mail embutido é baixo). Se travar, usar o SMTP da King Host já
contratado — investigação curta dentro da S3.1.
