import { describe, expect, it } from "vitest";
import {
  canWriteLead, isLeadUnattended, leadSearchFilter, rejectAttachment,
  type LeadRecord, type LeadSource,
} from "@/integrations/supabase/leads";
import {
  emptyLeadFilters, fillWhatsappTemplate, hasActiveFilter, leadMetrics, matchesFilters,
  nextActionPreset, overdueByBroker, parseVgvInput, toDateTimeInput, waNumber,
} from "./model";
import { rowsToLeads } from "./importSheet";

const lead = (patch: Partial<LeadRecord>): LeadRecord => ({
  id: "id", full_name: "Cliente", phone: null, phone_raw: null, email: null, document: null,
  source_id: null, distribution_group_id: null, form_id: null, external_id: null,
  campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null,
  ad_name: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
  utm_term: null, landing_page: null, raw_payload: null,
  status: "queued", funnel_stage: "new", assigned_to: null, assigned_at: null,
  attend_deadline: null, first_contact_at: null, last_activity_at: null, next_action_at: null,
  sdr_qualified_at: null, converted_at: null, converted_deal_id: null, lost_reason: null,
  lost_at: null, notes: null, roulette_misses: 0, created_at: "2026-08-20T10:00:00Z", updated_at: "2026-08-20T10:00:00Z",
  name: patch.full_name ?? "Cliente", whatsapp: "", source: "", broker_name: null,
  form_name: null, form_answers: {}, tracking: {}, stage_changed_at: "2026-08-20T10:00:00Z",
  ...patch,
});

const source = (patch: Partial<LeadSource>): LeadSource => ({
  id: "s1", code: "s1", label: "Origem", channel: "meta", active: true, ...patch,
});

describe("matchesFilters", () => {
  const meta = lead({ full_name: "Ana Silva", name: "Ana Silva", email: "ana@ex.com", phone: "11988887777", source_id: "s1", status: "assigned", campaign_name: "Campanha Verão" });
  const semOrigem = lead({ id: "b", full_name: "Bruno", name: "Bruno", status: "queued" });

  it("sem filtro, todo lead passa", () => {
    expect(matchesFilters(meta, emptyLeadFilters)).toBe(true);
    expect(matchesFilters(semOrigem, emptyLeadFilters)).toBe(true);
  });

  it("a busca cobre nome, e-mail, telefone e campanha", () => {
    for (const term of ["ana", "ANA@EX", "98888", "verão"]) {
      expect(matchesFilters(meta, { ...emptyLeadFilters, search: term })).toBe(true);
    }
    expect(matchesFilters(semOrigem, { ...emptyLeadFilters, search: "ana" })).toBe(false);
  });

  it("telefone com máscara casa com o número normalizado que o banco grava", () => {
    // `normalize_phone` grava dígitos com DDI ("5511988770001"). O filtro
    // comparava o texto CRU: o banco devolvia o lead pela busca e a tela o
    // descartava, mostrando "Nenhum lead com esses filtros" para o telefone
    // digitado como o corretor tem na mão.
    const comDdi = lead({
      id: "c", full_name: "Carla", name: "Carla", phone: "5511988770001", status: "assigned",
    });
    for (const term of ["(11) 98877-0001", "11 98877-0001", "988770001"]) {
      expect(matchesFilters(comDdi, { ...emptyLeadFilters, search: term })).toBe(true);
    }
    expect(matchesFilters(comDdi, { ...emptyLeadFilters, search: "(11) 90000-0000" })).toBe(false);
  });

  it("'none' é lead sem origem, e não 'todas as origens'", () => {
    expect(matchesFilters(semOrigem, { ...emptyLeadFilters, source: "none" })).toBe(true);
    expect(matchesFilters(meta, { ...emptyLeadFilters, source: "none" })).toBe(false);
    expect(matchesFilters(meta, { ...emptyLeadFilters, source: "s1" })).toBe(true);
  });

  it("hasActiveFilter ignora busca só de espaço", () => {
    expect(hasActiveFilter(emptyLeadFilters)).toBe(false);
    expect(hasActiveFilter({ ...emptyLeadFilters, search: "   " })).toBe(false);
    expect(hasActiveFilter({ ...emptyLeadFilters, status: "queued" })).toBe(true);
  });
});

describe("leadMetrics", () => {
  it("conta atrasado pela mesma regra do banco: próxima ação vencida e lead vivo", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    const metrics = leadMetrics([
      lead({ id: "1", status: "queued" }),
      lead({ id: "2", status: "attending", next_action_at: "2026-08-25T12:00:00Z" }),
      lead({ id: "3", status: "in_progress", next_action_at: "2026-08-27T12:00:00Z" }),
      // Convertido com ação vencida não é atraso: saiu da operação.
      lead({ id: "4", status: "converted", next_action_at: "2026-08-01T12:00:00Z" }),
    ], now);

    expect(metrics).toEqual({ total: 4, queued: 1, awaiting: 0, attending: 2, converted: 1, overdue: 1 });
  });

  it("'aguardando você' é só o que está na trava DESTE corretor", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    const leads = [
      lead({ id: "1", status: "assigned", assigned_to: "eu" }),
      lead({ id: "2", status: "assigned", assigned_to: "outro" }),
      lead({ id: "3", status: "attending", assigned_to: "eu" }),
    ];
    expect(leadMetrics(leads, now, "eu").awaiting).toBe(1);
    // Sem perfil (gestor olhando a equipe) conta todos os que estão na trava.
    expect(leadMetrics(leads, now).awaiting).toBe(2);
  });
});

describe("overdueByBroker", () => {
  const atrasado = (id: string, broker: string | null, nome: string) =>
    lead({ id, assigned_to: broker, broker_name: nome, status: "in_progress", next_action_at: "2026-08-01T12:00:00Z" });

  it("compara cada corretor com o limite, em vez de somar a equipe inteira", () => {
    // O card dizia "Check-in bloqueado" para o diretor que via 3 atrasados de
    // gente diferente contra o limite 2 — ninguém estava bloqueado.
    const grupos = overdueByBroker(
      [
        atrasado("1", "a", "Ana"),
        atrasado("2", "a", "Ana"),
        atrasado("3", "b", "Bruno"),
      ],
      2,
    );

    expect(grupos.map((g) => [g.brokerName, g.leads.length, g.blocked]))
      .toEqual([["Ana", 2, true], ["Bruno", 1, false]]);
  });

  it("lead sem corretor vira um grupo próprio, não some", () => {
    const grupos = overdueByBroker([atrasado("1", null, "")], 20);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ brokerId: null, brokerName: "Sem corretor", blocked: false });
  });
});

describe("próxima ação", () => {
  it("o valor do input é hora local, não UTC — senão a ação nasce 3h fora", () => {
    const quando = new Date(2026, 8, 3, 14, 5); // 03/09/2026 14:05 local
    expect(toDateTimeInput(quando)).toBe("2026-09-03T14:05");
  });

  it("os atalhos caem no futuro e às 9h quando são de outro dia", () => {
    const agora = new Date(2026, 8, 3, 14, 5);
    expect(toDateTimeInput(nextActionPreset("2h", agora))).toBe("2026-09-03T16:05");
    expect(toDateTimeInput(nextActionPreset("amanha", agora))).toBe("2026-09-04T09:00");
    expect(toDateTimeInput(nextActionPreset("3d", agora))).toBe("2026-09-06T09:00");
  });
});

describe("canWriteLead", () => {
  const meu = lead({ id: "1", assigned_to: "eu" });
  const alheio = lead({ id: "2", assigned_to: "outro" });
  const semDono = lead({ id: "3", assigned_to: null });
  const base = { profileId: "eu", isAdmin: false, managesTeam: false, canViewQueue: false };

  it("dono escreve no próprio lead e não no dos outros", () => {
    expect(canWriteLead(meu, base)).toBe(true);
    expect(canWriteLead(alheio, base)).toBe(false);
  });

  it("sócio (sem permissão nenhuma) não escreve em lead algum", () => {
    const socio = { profileId: "socio", isAdmin: false, managesTeam: false, canViewQueue: false };
    expect(canWriteLead(meu, socio)).toBe(false);
    expect(canWriteLead(alheio, socio)).toBe(false);
    expect(canWriteLead(semDono, socio)).toBe(false);
  });

  it("admin escreve em tudo; gestor escreve no lead com corretor", () => {
    expect(canWriteLead(alheio, { ...base, isAdmin: true })).toBe(true);
    expect(canWriteLead(alheio, { ...base, managesTeam: true })).toBe(true);
  });

  it("lead sem corretor é de quem alcança a fila (leads.view_queue)", () => {
    expect(canWriteLead(semDono, base)).toBe(false);
    expect(canWriteLead(semDono, { ...base, canViewQueue: true })).toBe(true);
    // Gerir equipe não dá acesso ao lead que ainda não tem dono — é o que
    // `leads_update` exige, e a tela precisa dizer o mesmo.
    expect(canWriteLead(semDono, { ...base, managesTeam: true })).toBe(false);
  });
});

describe("rejectAttachment", () => {
  it("recusa acima de 8 MB dizendo o que fazer", () => {
    const recusa = rejectAttachment({ name: "escritura.pdf", size: 9 * 1024 * 1024, type: "application/pdf" });
    expect(recusa).toMatch(/8 MB/);
  });

  it("recusa tipo fora da lista do bucket", () => {
    expect(rejectAttachment({ name: "x.html", size: 100, type: "text/html" })).toMatch(/não aceito/i);
  });

  it("aceita documento comum e arquivo sem tipo declarado", () => {
    expect(rejectAttachment({ name: "rg.jpg", size: 500_000, type: "image/jpeg" })).toBeNull();
    // Alguns navegadores não declaram o tipo: recusar aqui perderia documento
    // válido; o bucket ainda barra o que não presta.
    expect(rejectAttachment({ name: "rg.heic", size: 500_000, type: "" })).toBeNull();
  });
});

describe("waNumber", () => {
  it("normaliza para dígitos com DDI e devolve vazio sem telefone", () => {
    expect(waNumber("(11) 98888-7777")).toBe("5511988887777");
    expect(waNumber("5511988887777")).toBe("5511988887777");
    expect(waNumber(null)).toBe("");
    expect(waNumber("---")).toBe("");
  });
});

describe("fillWhatsappTemplate", () => {
  it("troca {{n}} pelo nome declarado em variables, na ordem da tabela", () => {
    const body = "Ola, {{1}}! Recebemos seu interesse no {{2}}.";
    expect(fillWhatsappTemplate(body, ["nome", "empreendimento"], { nome: "Ana", empreendimento: "Reserva Sul" }))
      .toBe("Ola, Ana! Recebemos seu interesse no Reserva Sul.");
    // A ordem vem de `variables`, não do nome: template novo com outra ordem continua certo.
    expect(fillWhatsappTemplate(body, ["empreendimento", "nome"], { nome: "Ana", empreendimento: "Reserva Sul" }))
      .toBe("Ola, Reserva Sul! Recebemos seu interesse no Ana.");
  });

  it("posição sem valor conhecido fica visível como {{n}}, não vira vazio", () => {
    expect(fillWhatsappTemplate("Oi {{1}}, visita {{2}}", ["nome", "data_visita"], { nome: "Ana" }))
      .toBe("Oi Ana, visita {{2}}");
    expect(fillWhatsappTemplate("Oi {{1}}", [], { nome: "Ana" })).toBe("Oi {{1}}");
  });
});

describe("parseVgvInput", () => {
  it("aceita o formato pt-BR com ou sem R$, milhar e centavos", () => {
    expect(parseVgvInput("R$ 500.000,00")).toEqual({ value: 500000, invalid: false });
    expect(parseVgvInput("500.000")).toEqual({ value: 500000, invalid: false });
    expect(parseVgvInput("500000,5")).toEqual({ value: 500000.5, invalid: false });
    expect(parseVgvInput("350000")).toEqual({ value: 350000, invalid: false });
  });

  it("vazio é 'sem VGV', não erro de digitação", () => {
    expect(parseVgvInput("")).toEqual({ value: null, invalid: false });
    expect(parseVgvInput("R$ ")).toEqual({ value: null, invalid: false });
  });

  it("texto que não é número é recusado com aviso, não vira null silencioso", () => {
    for (const raw of ["1.5 mi", "abc", "12,34,56", "R$ mil"]) {
      expect(parseVgvInput(raw), raw).toEqual({ value: null, invalid: true });
    }
  });

  it("ponto decimal americano vale como decimal — o mesmo que a importação de aportes", () => {
    // `parseBrl` só remove o ponto quando ele agrupa de 3 em 3 ("500.000"), então
    // "500000.00" continua valendo quinhentos mil, não cinquenta milhões.
    expect(parseVgvInput("500000.00")).toEqual({ value: 500000, invalid: false });
  });
});

describe("rowsToLeads · prioridade das colunas", () => {
  const sources = [source({ id: "imp", label: "Leadfy", channel: "import" })];

  it("'E-mail do cliente' antes de 'Nome' não vira o nome do lead", () => {
    // O defeito: a busca aceitava o PRIMEIRO cabeçalho que casasse com QUALQUER
    // sinônimo, e "cliente" batia em "E-mail do cliente".
    const parsed = rowsToLeads([
      ["E-mail do cliente", "Nome", "Telefone"],
      ["ana@ex.com", "Ana", "11988887777"],
    ], sources);
    expect(parsed[0]).toMatchObject({ full_name: "Ana", email: "ana@ex.com", phone: "11988887777" });
  });

  it("'Canal' à esquerda de 'Telefone' não vira o telefone", () => {
    const parsed = rowsToLeads([
      ["Canal", "Nome", "Telefone"],
      ["WhatsApp", "Bia", "11977776666"],
    ], sources);
    expect(parsed[0]).toMatchObject({ full_name: "Bia", phone: "11977776666" });
  });
});

describe("rowsToLeads", () => {
  const sources = [source({ id: "imp", label: "Leadfy", channel: "import" }), source({ id: "meta", label: "Meta Ads" })];
  const header = ["Cliente", "Telefone", "Email", "Fonte", "Observação"];
  const row = (n: number) => [`Cliente ${n}`, `1198888000${n}`, `c${n}@ex.com`, "Meta Ads", "veio do anúncio"];

  it("importa TODAS as linhas — a amostra de 10 é só da tabela (F03)", () => {
    const rows = [header, ...Array.from({ length: 30 }, (_, i) => row(i))];
    expect(rowsToLeads(rows, sources)).toHaveLength(30);
  });

  it("casa a origem pelo rótulo e cai na origem de importação quando não bate", () => {
    const parsed = rowsToLeads([header, row(1), ["Cliente X", "11999", "x@ex.com", "Origem que não existe", ""]], sources);
    expect(parsed[0].source_id).toBe("meta");
    expect(parsed[1].source_id).toBe("imp");
    // O rótulo cru sobrevive no UTM, que é o que permite auditar depois.
    expect(parsed[1].utm_source).toBe("Origem que não existe");
  });

  it("reconhece cabeçalhos alternativos e ignora linha sem nome", () => {
    const parsed = rowsToLeads([
      ["nome", "whatsapp", "e-mail"],
      ["Ana", "11988887777", "ana@ex.com"],
      ["", "", ""],
    ], sources);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ full_name: "Ana", phone: "11988887777", email: "ana@ex.com" });
  });

  it("linha com a coluna 0 preenchida mas sem nome é descartada, não gravada vazia", () => {
    // Cabeçalho com data na primeira coluna: o filtro aceitava a linha por
    // `row[0]` e `full_name` ia vazio — o CHECK do banco derrubava o lote todo.
    const parsed = rowsToLeads([
      ["data", "nome", "telefone"],
      ["12/08/2026", "Ana", "11988887777"],
      ["13/08/2026", "", "11977776666"],
      ["14/08/2026", "   ", "11966665555"],
    ], sources);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].full_name).toBe("Ana");
  });
});


/**
 * Recortes que faltavam ao gestor.
 *
 * Com 40 corretores, "o que está na mão do Rodrigo?" e "quantos leads do
 * Parque das Flores estão parados?" não tinham resposta na tela: só havia busca
 * livre, status e origem.
 */
describe("matchesFilters · corretor e grupo", () => {
  const meu = lead({ id: "1", assigned_to: "rodrigo", distribution_group_id: "g1" });
  const dele = lead({ id: "2", assigned_to: "ana", distribution_group_id: "g2" });
  const naFila = lead({ id: "3", assigned_to: null, distribution_group_id: null });

  const filtra = (patch: Partial<typeof emptyLeadFilters>) =>
    [meu, dele, naFila].filter((l) => matchesFilters(l, { ...emptyLeadFilters, ...patch }))
      .map((l) => l.id);

  it("filtra por corretor", () => {
    expect(filtra({ broker: "rodrigo" })).toEqual(["1"]);
  });

  it("'sem corretor' é o recorte da fila, não 'todos'", () => {
    expect(filtra({ broker: "none" })).toEqual(["3"]);
  });

  it("filtra por grupo de distribuição", () => {
    expect(filtra({ group: "g2" })).toEqual(["2"]);
  });

  it("'sem grupo' pega quem cai na regra do banco", () => {
    expect(filtra({ group: "none" })).toEqual(["3"]);
  });

  it("corretor e grupo se combinam com os filtros antigos", () => {
    expect(filtra({ broker: "rodrigo", group: "g2" })).toEqual([]);
  });

  it("corretor ou grupo escolhido conta como filtro ativo", () => {
    expect(hasActiveFilter({ ...emptyLeadFilters, broker: "rodrigo" })).toBe(true);
    expect(hasActiveFilter({ ...emptyLeadFilters, group: "g1" })).toBe(true);
    expect(hasActiveFilter(emptyLeadFilters)).toBe(false);
  });
});

/**
 * A busca virou consulta ao banco (`listLeads({ search })`).
 *
 * `,` separa condições no `or` do PostgREST, `.` separa operador de valor e `*`
 * é o curinga: qualquer um deles cru no termo vira 400, não busca. E telefone
 * digitado com máscara precisa virar dígitos, porque o banco grava normalizado.
 */
describe("leadSearchFilter", () => {
  it("termo curto demais não vai ao banco", () => {
    expect(leadSearchFilter("an")).toBeNull();
    expect(leadSearchFilter("   ")).toBeNull();
  });

  it("procura por nome, e-mail e campanha", () => {
    // Campanha entra porque o placeholder do campo a promete. Sem ela o lead
    // que só casava por campanha aparecia com 2 letras (filtro do cliente) e
    // sumia na 3ª, quando o termo passa a ir ao banco.
    expect(leadSearchFilter("ana"))
      .toBe("full_name.ilike.*ana*,email.ilike.*ana*,campaign_name.ilike.*ana*");
  });

  it("telefone com máscara vira só dígitos", () => {
    const filtro = leadSearchFilter("(11) 98877-0001");
    expect(filtro).toContain("phone.ilike.*11988770001*");
  });

  it("e-mail inteiro chega ao banco com o ponto", () => {
    // O ponto era removido na sanitização e "maria@gmail.com" virava
    // `*maria@gmail com*`, que não casa com e-mail nenhum. O PostgREST usa só
    // os DOIS primeiros pontos de `coluna.operador.valor` como separadores —
    // conferido contra o projeto: com o ponto no valor a consulta devolve 200.
    expect(leadSearchFilter("maria@gmail.com")).toContain("email.ilike.*maria@gmail.com*");
  });

  it("vírgula, parêntese e asterisco no termo não quebram a consulta", () => {
    // A vírgula viraria uma condição a mais e o `*` um curinga solto — os dois
    // derrubam a consulta com 400 ("failed to parse logic tree"), não com "nada
    // encontrado".
    expect(leadSearchFilter("ana, paula*"))
      .toBe("full_name.ilike.*ana paula*,email.ilike.*ana paula*,campaign_name.ilike.*ana paula*");
    expect(leadSearchFilter("ana (paula)"))
      .toBe("full_name.ilike.*ana paula*,email.ilike.*ana paula*,campaign_name.ilike.*ana paula*");
  });
});

/**
 * Bandeja "sem atendimento": o lead bateu o teto de voltas e a roleta parou de
 * oferecê-lo. Sem esta separação ele ficava em `queued`, misturado com os que
 * acabaram de chegar, e ninguém sabia que estava parado.
 */
describe("isLeadUnattended", () => {
  it("na fila com o teto batido, o lead está na bandeja", () => {
    expect(isLeadUnattended(lead({ status: "queued", roulette_misses: 5 }), 5)).toBe(true);
  });

  it("abaixo do teto ele ainda é da roleta", () => {
    expect(isLeadUnattended(lead({ status: "queued", roulette_misses: 4 }), 5)).toBe(false);
  });

  it("lead na mão de alguém não está na bandeja, por mais voltas que tenha dado", () => {
    expect(isLeadUnattended(lead({ status: "assigned", roulette_misses: 22 }), 5)).toBe(false);
  });
});
