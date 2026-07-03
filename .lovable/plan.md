
## O que vamos construir

Um sistema de **Check-in Diário por Equipe** onde gerentes lançam, por corretor, os números do dia via link público protegido por PIN. Um **Dashboard Semanal (ADM)** compila segunda→domingo e compara ao **Funil Ideal 100 / 10 / 4 / 2**. Visual no tema "game lendário" já usado no app.

---

## 1. Banco de dados (Lovable Cloud)

Três novas tabelas:

- **`team_pins`** — PIN por equipe (link público seguro)
  - `team_id` (FK teams), `pin_hash`, `active`
- **`daily_team_reports`** — lançamento diário agregado
  - `team_id`, `report_date`, `filled_by_name`, `notes` (texto livre)
  - unique(team_id, report_date)
- **`daily_broker_entries`** — números por corretor no dia
  - `report_id` (FK), `broker_id`, campos abaixo

Campos numéricos por corretor (todos INT, default 0):
`leads`, `atendimentos`, `propostas`, `visitas_agendadas`, `visitas_realizadas`, `analises`, `aprovados`, `vendas`

RLS:
- Público (anon) pode **inserir** em `daily_team_reports` / `daily_broker_entries` **somente** via edge function que valida PIN.
- Leitura só para authenticated (admin/diretor).

Uma **edge function `submit-daily-report`** valida `team_id + pin` → grava report + entries com service role. Isso protege PIN e evita abuso.

## 2. Página pública `/daily/:teamSlug`

Fluxo em 3 passos:
1. Digita PIN → valida via edge function
2. Escolhe a data (default: hoje) e nome de quem preenche
3. Lista **corretores ativos da equipe** (buscados via função pública `get_team_roster`) com 8 inputs numéricos cada + campo de observações do dia
4. Submit → toast de sucesso com "XP ganho" (tema game)

Se já existe report do dia → carrega para edição.

## 3. Cadastro de corretores em equipes

Reaproveitar a página `/equipes` (Admin) — já existe `team_assignments`. Adicionar:
- Botão "Gerar/Renovar PIN" por equipe (retorna PIN de 6 dígitos uma vez)
- Botão "Copiar link público" (`/daily/<team_id>`)

## 4. Dashboard Admin `/admin/daily-bi`

Filtro: seletor de semana (segunda–domingo, default: semana atual).

**KPIs (soma da semana):** Leads, Análises, Aprovados, Vendas, Visitas, Propostas.

**Comparativo Funil Ideal** (o coração da tela):

```text
Ideal (base = leads reais)   Real
Leads      100%   ████████   100%
Análises    10%   █░░░░░░░   X%
Aprovados    4%   █░░░░░░░   Y%
Vendas       2%   █░░░░░░░   Z%
```

Para cada etapa: barra "Ideal" vs barra "Real", % de aderência, e badge (Acima / No alvo / Abaixo).

**Rankings da semana:**
- Equipes por vendas / aderência ao funil
- Top corretores (vendas, conversão leads→venda)

**Tabela detalhada:** dia × equipe com todos os campos.

Export CSV da semana.

## 5. Navegação

- Sidebar (admin): novo item **"Diário das Equipes"** → `/admin/daily-bi`
- Página `/equipes`: seção "Link público de preenchimento" por equipe
- `/daily/:teamId` fica fora do AppLayout (rota pública, sem sidebar)

## 6. Visual — Tema Game Lendário

Reutiliza tokens já existentes (`#0F0E19`, `#1C264B`, glassmorphism). Adições específicas para essa área:
- Header do formulário público com "aura" gradiente animada e título "Missão Diária da Equipe"
- Cada corretor = "card de personagem" com ícone de classe
- Ao submeter: animação de "XP +N" + confete curto
- Dashboard: barras do funil com brilho neon (verde = acima do ideal, âmbar = no alvo, vermelho = abaixo)
- Ícones lucide: `Swords`, `Trophy`, `Target`, `Flame`

---

## Detalhes técnicos

- Migração cria as 3 tabelas + GRANTs + RLS + função `get_team_roster(team_id uuid)` SECURITY DEFINER que retorna `[{broker_id, name}]` para uso público (sem PII sensível).
- Edge function `submit-daily-report` (verify_jwt=false) com Zod validando payload e comparando `pin_hash` via `crypto.subtle`.
- Semana ISO calculada no front (date-fns `startOfWeek`/`endOfWeek` com `weekStartsOn: 1`).
- Query React Query com `queryKey: ["daily-bi", weekStart]`.
- Sem alterações no Dashboard principal existente.

## Fora de escopo (pergunto se quiser depois)

- Notificação automática ao gerente que esqueceu de preencher.
- Metas customizadas por equipe (por enquanto o ideal 100/10/4/2 é global).
- Histórico multi-semanas com gráfico de tendência.
