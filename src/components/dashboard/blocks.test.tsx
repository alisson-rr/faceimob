import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Lead } from "@/types/crm";
import { CcaStatusCard, StaffCard } from "./Breakdown";
import { DirectorPanel } from "./DirectorPanel";
import { LeadsPanel } from "./LeadsPanel";
import { SalesFunnelCard } from "./SalesFunnelCard";
import { DeveloperOverview, DeveloperRanking } from "./DeveloperOverview";
import { GoalCard } from "./GoalCard";
import { KpiRow } from "./KpiRow";
import { MonthlyTrend } from "./MonthlyTrend";
import { TopBrokers } from "./TopBrokers";
import type { DealRow, DeveloperStats, MonthStats } from "./data";

/**
 * Renderizacao dos blocos do painel.
 *
 * Nove dos dez blocos nao tinham teste nenhum: so as funcoes puras de `data.ts`
 * eram cobertas, e um cartao que deixasse de pintar o numero passava verde. Aqui
 * o alvo e o que a pessoa LE — o rotulo, o `aria-label` do medidor, o estado
 * vazio certo — e nao a arvore de componentes.
 *
 * Sem @testing-library no projeto, o render e o do react-dom mesmo; a flag e o
 * que faz `act` aceitar o jsdom como ambiente de teste (mesmo padrao de
 * `ComparativeFunnel.test.tsx`).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// O `ResponsiveContainer` do Recharts observa o tamanho do container, e o jsdom
// nao implementa `ResizeObserver`. Sem este esboco o bloco com grafico nem monta
// — e a tabela `sr-only`, que e justamente o que estes testes conferem, morre
// junto. O esboco nao mede nada: o grafico fica com 0 x 0, como no jsdom sempre.
const comObserver = globalThis as typeof globalThis & { ResizeObserver?: unknown };
comObserver.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  const text = container.textContent ?? "";
  const query = <T extends Element>(selector: string) => container.querySelector<T>(selector);
  const cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, text, query, cleanup };
}

/**
 * Os dois blocos que consultam o banco por conta propria rendem com o cache JA
 * preenchido: `setQueryData` deixa a consulta em `success` sem rede, entao o
 * teste exercita o que a tela mostra — e nao o cliente HTTP.
 */
async function renderComCache(ui: ReactNode, seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const rendered = await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return {
    ...rendered,
    cleanup: async () => {
      await rendered.cleanup();
      client.clear();
    },
  };
}

const stats = (fields: Partial<MonthStats> = {}): MonthStats => ({
  vendas: 7,
  propostas: 18,
  negocios: 25,
  perdas: 1,
  vgv: 3_250_000,
  ...fields,
});

describe("KpiRow", () => {
  it("o cartao de leads fala do PERIODO e o total da base tem cartao proprio", async () => {
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats()}
        leadsNoPeriodo={12}
        leadsNaBase={42}
        month="08/2026"
        vgvGoal={null}
        previous={null}
        previousLabel={null}
      />,
    );

    // Era o mesmo cartao dizendo "Leads 42" sob um cabecalho "— 08/2026".
    expect(text).toContain("recebidos em 08/2026");
    expect(text).toContain("Base de leads");
    expect(text).toContain("sem recorte de período");
    await cleanup();
  });

  it("cada cartao diz de QUEM e o numero: negocio e lead nao tem o mesmo recorte", async () => {
    // `deals_select` chega em `can_read_all()` e `leads_select` recorta por
    // `auth_visible_profiles()`: para o diretor a mesma regua somava 35
    // negocios da empresa inteira ao lado de 58 leads da subarvore dele, e o
    // cartao da base ainda afirmava "total na base, sem recorte de período" —
    // negando um recorte que existe.
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats()}
        leadsNoPeriodo={58}
        leadsNaBase={69}
        dealsLabel="toda a operação"
        leadsLabel="os leads da sua carteira e da sua equipe"
        month="08/2026"
        previous={null}
        previousLabel={null}
      />,
    );
    expect(text).toContain("recebidos em 08/2026 · os leads da sua carteira e da sua equipe");
    expect(text).toContain("sem recorte de período · os leads da sua carteira e da sua equipe");
    expect(text).toContain("vendas + em aberto · toda a operação");
    expect(text).not.toContain("total na base, sem recorte de período");
    await cleanup();
  });

  it("a consulta de leads falhada oferece 'Tentar de novo' no proprio cartao", async () => {
    // O botao so existia dentro da aba Leads: para consertar um cartao do topo
    // era preciso adivinhar que a saida estava em outra aba.
    let refeita = 0;
    const { container, text, cleanup } = await render(
      <KpiRow
        stats={stats()}
        leadsNoPeriodo={null}
        leadsError
        onLeadsRetry={() => {
          refeita += 1;
        }}
        leadsNaBase={42}
        month="08/2026"
        previous={null}
        previousLabel={null}
      />,
    );
    expect(text).toContain("não consegui carregar os leads");
    const botao = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Tentar de novo",
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refeita).toBe(1);
    await cleanup();
  });

  it("enquanto a lista de leads nao chega, mostra travessao — nao zero", async () => {
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats()}
        leadsNoPeriodo={null}
        leadsNaBase={42}
        month="08/2026"
        previous={null}
        previousLabel={null}
      />,
    );
    expect(text).toContain("—");
    await cleanup();
  });

  it("consulta de leads FALHADA nao passa por carregamento eterno", async () => {
    // O travessao e o mesmo do teste acima, e era a unica coisa que a tela
    // dizia quando a consulta errava: um "—" sob "recebidos em 08/2026", para
    // sempre. O erro so aparecia para quem abrisse a aba Leads.
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats()}
        leadsNoPeriodo={null}
        leadsError
        leadsNaBase={42}
        month="08/2026"
        previous={null}
        previousLabel={null}
      />,
    );
    expect(text).toContain("não consegui carregar os leads");
    expect(text).not.toContain("recebidos em 08/2026");
    await cleanup();
  });

  it("com meta de VGV cadastrada, o cartao de VGV mostra o atingimento", async () => {
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats({ vgv: 3_250_000 })}
        leadsNoPeriodo={0}
        leadsNaBase={0}
        month="08/2026"
        vgvGoal={6_500_000}
        previous={null}
        previousLabel={null}
      />,
    );
    // Metade da meta: 3,25 mi de 6,5 mi.
    expect(text).toMatch(/50% da meta de/);
    await cleanup();
  });

  it("o delta compara com o mes anterior e inverte a leitura em perdas", async () => {
    const { text, cleanup } = await render(
      <KpiRow
        stats={stats({ vendas: 7, perdas: 3 })}
        leadsNoPeriodo={0}
        leadsNaBase={0}
        month="08/2026"
        previous={stats({ vendas: 4, perdas: 1 })}
        previousLabel="07/2026"
      />,
    );
    expect(text).toContain("+3 vs. 07/2026");
    expect(text).toContain("+2 vs. 07/2026");
    await cleanup();
  });
});

describe("GoalCard", () => {
  const props = {
    month: "08/2026",
    vendas: 1,
    scope: "global" as const,
    canManage: true,
    isLoading: false,
    error: null,
    onRetry: () => undefined,
  };

  it("sem linha em goals nao inventa alvo: diz qual meta falta e onde cadastrar", async () => {
    const { text, query, cleanup } = await render(
      <MemoryRouter>
        <GoalCard {...props} goal={null} />
      </MemoryRouter>,
    );
    expect(text).toContain("Sem meta cadastrada para 08/2026");
    // O cartão de /equipes abre no mês do RELÓGIO e ainda não lê o `?mes=` da
    // URL (pendência com o dono daquele arquivo): quem clicava aqui em 08/2026
    // caía no formulário de outro mês e gravava a meta no lugar errado sem
    // perceber. Enquanto o destino não lê o parâmetro, quem diz o mês é a
    // FRASE — é ela que este teste trava, não só o atributo do link.
    expect(text).toContain("escolhendo 08/2026 no campo Mês");
    expect(query('a[href="/equipes?mes=2026-08"]')).not.toBeNull();
    expect(query('[role="progressbar"]')).toBeNull();
    await cleanup();
  });

  it("com alvo, o medidor declara escopo, periodo, realizado e meta", async () => {
    const { text, query, cleanup } = await render(
      <MemoryRouter>
        <GoalCard {...props} goal={4} />
      </MemoryRouter>,
    );
    const barra = query('[role="progressbar"]');
    expect(barra?.getAttribute("aria-valuenow")).toBe("25");
    expect(barra?.getAttribute("aria-label")).toBe("Meta da empresa de vendas de 08/2026: 1 de 4");
    expect(text).toContain("Faltam 3 para bater a meta");
    await cleanup();
  });

  it("em 'todos os meses' avisa que a meta e mensal, em vez de somar alvos", async () => {
    const { text, cleanup } = await render(
      <MemoryRouter>
        <GoalCard {...props} month="all" goal={4} />
      </MemoryRouter>,
    );
    expect(text).toContain("A meta é mensal");
    await cleanup();
  });

  it("a quem grava a meta global, nao afirma que 'nenhuma tela cadastra'", async () => {
    // `goals_write` aceita admin E diretor, e /equipes renderiza o cartao "Meta
    // global do mes" para os dois. Dizer a eles que a meta "e lancada direto no
    // banco pelo administrador" e falso — e era exatamente o que o diretor lia,
    // porque o escopo dele nunca resolvia para 'global'.
    const { text, query, cleanup } = await render(
      <MemoryRouter>
        <GoalCard {...props} goal={null} scope="team" canManage />
      </MemoryRouter>,
    );
    expect(text).not.toContain("lançada direto no banco pelo administrador");
    expect(text).toContain('Meta global do mês');
    expect(text).toContain("escolhendo 08/2026 no campo Mês");
    expect(query('a[href="/equipes?mes=2026-08"]')).not.toBeNull();
    await cleanup();
  });

  it("quem nao pode gravar nao ganha botao que o banco recusaria", async () => {
    const { text, query, cleanup } = await render(
      <MemoryRouter>
        <GoalCard {...props} goal={null} canManage={false} />
      </MemoryRouter>,
    );
    expect(query('a[href="/equipes"]')).toBeNull();
    expect(text).toContain("Peça a um administrador ou diretor");
    // Sem botão, o mês continua escrito: é o que a pessoa repassa a quem grava.
    expect(text).toContain("escolhendo 08/2026 no campo Mês");
    await cleanup();
  });
});

describe("TopBrokers", () => {
  const rows = [
    { id: "b1", name: "Diego", vendas: 3, vgv: 900_000 },
    { id: "b2", name: "Gustavo", vendas: 1, vgv: 300_000 },
  ];

  it("o podio mostra nome e vendas, e o rodape conta quem entrou", async () => {
    const { text, cleanup } = await render(
      <TopBrokers title="Ranking de corretores" description="Vendas do período" rows={rows} />,
    );
    expect(text).toContain("Diego");
    expect(text).toContain("2 com venda no período");
    await cleanup();
  });

  it("nao promete nome escondido pela RLS: a RPC de nomes e SECURITY DEFINER", async () => {
    // O rodape tinha uma variante "N sem nome, fora do seu alcance de
    // visibilidade" e o vazio outra, "Venda no periodo, sem nome a mostrar".
    // Nenhuma das duas podia acontecer: `deal_participant_names()` devolve o
    // nome de todo participante de negocio visivel. Sairam em 02/09/2026.
    const comLista = await render(
      <TopBrokers title="Ranking" description="Vendas do período" rows={rows} />,
    );
    expect(comLista.text).not.toContain("sem nome");
    await comLista.cleanup();

    const vazio = await render(<TopBrokers title="Ranking" description="Vendas do período" rows={[]} />);
    expect(vazio.text).toContain("Sem venda no período");
    expect(vazio.text).not.toContain("sem nome a mostrar");
    await vazio.cleanup();
  });

  it("a lista rolavel e alcancavel pelo teclado, e tem nome", async () => {
    // A tabela do 4º colocado em diante nao tem UM elemento focavel dentro, so
    // texto: sem `tabIndex` no container rolavel quem navega por teclado nao
    // consegue rolar (WCAG 2.1.1, `scrollable-region-focusable` no axe).
    const quatro = [
      ...rows,
      { id: "b3", name: "Helena", vendas: 1, vgv: 100_000 },
      { id: "b4", name: "Ivo", vendas: 1, vgv: 50_000 },
    ];
    const comRolagem = await render(
      <TopBrokers title="Ranking de corretores" description="Vendas do período" rows={quatro} scroll />,
    );
    const regiao = comRolagem.query('[role="region"]');
    expect(regiao?.getAttribute("tabindex")).toBe("0");
    expect(regiao?.getAttribute("aria-label")).toBe("Ranking de corretores");
    await comRolagem.cleanup();

    // Sem rolagem nao ha o que rolar: um `tabIndex` a mais so aumentaria a
    // ordem de tabulacao sem nada para alcancar.
    const semRolagem = await render(
      <TopBrokers title="Ranking de gerentes" description="Vendas do período" rows={quatro} />,
    );
    expect(semRolagem.query('[role="region"]')).toBeNull();
    await semRolagem.cleanup();
  });

  it("sem venda e sem oculto, o estado vazio e o do periodo", async () => {
    const { text, cleanup } = await render(
      <TopBrokers title="Ranking" description="Vendas do período" rows={[]} />,
    );
    expect(text).toContain("Sem venda no período");
    await cleanup();
  });
});

describe("DeveloperOverview e DeveloperRanking", () => {
  const dev = (fields: Partial<DeveloperStats>): DeveloperStats => ({
    dev: "MRV",
    vendas: 0,
    propostas: 0,
    negocios: 0,
    vgv: 0,
    propostaVgv: 0,
    token: "chart-1",
    ...fields,
  });

  it("mes sem negocio nenhum mostra o estado vazio, nao um grafico de zeros", async () => {
    // A lista de construtoras vem de todos os meses, entao `rows.length` nunca
    // zerava e o estado vazio nunca disparava.
    const zerado = [dev({ dev: "MRV" }), dev({ dev: "TENDA" })];
    const overview = await render(<DeveloperOverview rows={zerado} />);
    expect(overview.text).toContain("Nenhum negócio no período");
    await overview.cleanup();

    const ranking = await render(<DeveloperRanking rows={zerado} />);
    expect(ranking.text).toContain("Nenhum negócio no período");
    await ranking.cleanup();
  });

  it("com dado, o grafico tem tabela equivalente para leitor de tela", async () => {
    const { container, cleanup } = await render(
      <DeveloperOverview rows={[dev({ dev: "MRV", vendas: 2, propostas: 3, negocios: 5 })]} />,
    );
    const tabela = container.querySelector("table.sr-only");
    expect(tabela?.querySelector("caption")?.textContent).toContain("por construtora");
    expect(tabela?.textContent).toContain("MRV");
    // O grafico em si nao e anunciado duas vezes.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await cleanup();
  });
});

describe("MonthlyTrend", () => {
  it("sem historico, avisa; com historico, entrega a tabela ano a ano", async () => {
    const vazio = await render(<MonthlyTrend series={{ rows: [], years: [] }} />);
    expect(vazio.text).toContain("Ainda não há histórico");
    await vazio.cleanup();

    const { container, cleanup } = await render(
      <MonthlyTrend
        series={{ rows: [{ mes: "08", "2026": 7 }, { mes: "09", "2026": 0 }], years: ["2026"] }}
      />,
    );
    const tabela = container.querySelector("table.sr-only");
    expect(tabela?.textContent).toContain("2026");
    expect(tabela?.textContent).toContain("ago");
    await cleanup();
  });
});

describe("SalesFunnelCard", () => {
  const stages = [
    { id: "1", code: "lead", label: "Lead", position: 2 },
    { id: "2", code: "proposal", label: "Proposta", position: 3 },
    { id: "3", code: "lost", label: "Perdido", position: 9 },
  ];
  const semearEtapas = (client: QueryClient) => client.setQueryData(["dashboard", "stages"], stages);

  it("usa os rótulos do banco, mantém etapa vazia e não lista o desfecho perdido", async () => {
    const { text, cleanup } = await renderComCache(
      <SalesFunnelCard stageCounts={new Map([["proposal", 4]])} />,
      semearEtapas,
    );
    expect(text).toContain("Proposta");
    expect(text).toContain("Lead");
    expect(text).not.toContain("Perdido");
    expect(text).toContain("4 negócios no período · vendas + em aberto");
    await cleanup();
  });

  it("mês sem negócio mostra o estado vazio, não uma lista de zeros", async () => {
    const { text, cleanup } = await renderComCache(
      <SalesFunnelCard stageCounts={new Map()} />,
      semearEtapas,
    );
    expect(text).toContain("Nenhum negócio no período");
    await cleanup();
  });
});

describe("LeadsPanel", () => {
  const lead = (id: string, created_at: string, status = "new") =>
    ({
      id,
      name: `Lead ${id}`,
      phone: "",
      whatsapp: "",
      email: "",
      source: "Meta Ads",
      broker_id: "b1",
      broker_name: "Diego",
      created_at,
      status,
      notes: "",
    }) as Lead;

  // Sem AuthProvider o `useAuth` devolve o contexto padrão (usuário nulo), e a
  // chave da consulta termina em `null` — é essa que o teste semeia.
  const semearLeads = (rows: Lead[]) => (client: QueryClient) =>
    client.setQueryData(["dashboard", "leads", null], rows);

  const rows = [
    lead("a", "2026-08-10T12:00:00-03:00", "converted"),
    lead("b", "2026-08-12T12:00:00-03:00"),
    lead("c", "2026-09-02T12:00:00-03:00"),
  ];

  it("a aba inteira segue o filtro de período do topo", async () => {
    // Era sempre "hoje / últimos 7 / últimos 14 dias": trocar o mês no
    // cabeçalho não mudava um número sequer dentro da aba.
    const { text, cleanup } = await renderComCache(<LeadsPanel month="08/2026" />, semearLeads(rows));
    expect(text).toContain("Leads no período");
    expect(text).toContain("Entrada diária em 08/2026");
    // 2 dos 3 leads são de agosto, e 1 deles converteu: 50%.
    expect(text).toContain("50%");
    // A régua do topo do Dashboard fica visível em TODAS as abas e já traz
    // "Base de leads" com o mesmo número e o mesmo texto de apoio. Repetir o
    // cartão aqui punha duas cópias idênticas na mesma tela.
    expect(text).not.toContain("Base de leads");
    expect(text).not.toContain("sem recorte de período");
    await cleanup();
  });

  it("período vazio com base cheia diz que é o filtro, não que a base está vazia", async () => {
    const { text, cleanup } = await renderComCache(<LeadsPanel month="07/2026" />, semearLeads(rows));
    expect(text).toContain("Nenhum lead em 07/2026");
    expect(text).toContain("A base tem 3 leads");
    await cleanup();
  });

  it("com base cheia, quem não lê a fila não lê 'a base tem N'", async () => {
    // O sócio passa em `auth_visible_profiles()` mas não tem `leads.view_queue`:
    // a `leads_select` esconde dele o lead sem dono (69 de 74 medidos na
    // homologação). Dizer "A base tem 69 leads" afirma que aquele número É a
    // base — e o rótulo ao lado dizia justamente o contrário.
    const { text, cleanup } = await renderComCache(
      <LeadsPanel month="07/2026" toda={false} scopeLabel="leads já atribuídos" />,
      semearLeads(rows),
    );
    expect(text).toContain("Você enxerga 3 leads");
    expect(text).not.toContain("A base tem 3 leads");
    await cleanup();
  });

  it("base vazia continua dizendo que a base está vazia", async () => {
    const { text, cleanup } = await renderComCache(<LeadsPanel month="08/2026" />, semearLeads([]));
    expect(text).toContain("Nenhum lead na base");
    await cleanup();
  });

  it("para quem NÃO enxerga todo mundo, o vazio é o dele — não o da empresa", async () => {
    // `leads_select` recorta por `auth_visible_profiles()`: dizer "nenhum lead
    // na base" a um corretor, com 74 leads na operação, manda procurar defeito
    // onde há recorte de perfil. Mesma distinção que o `CcaStatusCard` já faz.
    const { text, cleanup } = await renderComCache(
      <LeadsPanel month="08/2026" toda={false} scopeLabel="os leads da sua carteira" />,
      semearLeads([]),
    );
    expect(text).toContain("Nenhum lead no seu recorte");
    expect(text).not.toContain("Nenhum lead na base");
    expect(text).toContain("os leads da sua carteira");
    await cleanup();
  });

  it("a série por dia não desenha o futuro nem soma anos diferentes no mesmo rótulo", async () => {
    // Dois defeitos no mesmo lugar: o mês corrente desenhava a reta até o dia
    // 30 com zero (a queda no fim era o calendário, não a operação), e em
    // "todos os meses" a chave `dd/MM` empilhava 2025 e 2026 no mesmo ponto.
    const hoje = new Date();
    const mesCorrente = `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
    const doDia = (dia: number) =>
      `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}T12:00:00-03:00`;

    const { container, cleanup } = await renderComCache(
      <LeadsPanel month={mesCorrente} />,
      semearLeads([lead("hoje", doDia(hoje.getDate()))]),
    );
    // A tabela `sr-only` é a série: uma linha por dia coberto, e o mês corrente
    // para HOJE — não segue até o dia 30 com zeros.
    const linhas = container.querySelectorAll("table.sr-only tbody tr");
    expect(linhas.length).toBe(hoje.getDate());
    await cleanup();

    // Em "todos os meses" a janela é de 14 dias e a chave é a data completa: o
    // lead de um ano atrás, no mesmo dia do mês, não pode somar no ponto de hoje.
    // O MESMO dd/MM de hoje, um ano antes — é essa colisão que a chave `dd/MM`
    // somava no mesmo ponto.
    const mesmoDiaAnoPassado = `${hoje.getFullYear() - 1}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}T12:00:00-03:00`;
    const todos = await renderComCache(
      <LeadsPanel month="all" />,
      semearLeads([lead("hoje", doDia(hoje.getDate())), lead("ano-passado", mesmoDiaAnoPassado)]),
    );
    const ultima = Array.from(todos.container.querySelectorAll("table.sr-only tbody tr")).at(-1);
    expect(ultima?.querySelector("td")?.textContent).toBe("1");
    await todos.cleanup();
  });
});

describe("DirectorPanel", () => {
  // Sem AuthProvider o `useAuth` devolve o contexto padrão (usuário nulo), e a
  // chave do escopo termina em `null` — mesmo truque do LeadsPanel acima.
  const semearDiretoria = (client: QueryClient) => {
    client.setQueryData(["dashboard", "led-teams", "scope", null], {
      teams: [{ id: "t1", name: "Equipe Alfa", manager_id: null, director_id: null }],
      managers: [],
      brokers: [{ id: "b1", name: "Diego", team_id: "t1", roles: ["broker"] }],
    });
    client.setQueryData(["dashboard", "director", "daily", ["t1"], "08/2026"], {
      leads: 10,
      coleta_docs: 0,
      analises: 2,
      aprovados: 1,
      vendas: 1,
    });
    // O catalogo de etapas e o que diz o que e "alcancou a analise" — a mesma
    // consulta do funil por etapa, ja no cache.
    client.setQueryData(["dashboard", "stages"], [
      { id: "1", code: "under_analysis", label: "Em Análise", position: 5 },
      { id: "2", code: "approved", label: "Aprovado", position: 6 },
      { id: "3", code: "closed", label: "Fechado", position: 8 },
    ]);
    // A regua do funil, no formato do `buildTargetsMap` do /checkpoint. Sem
    // linha nenhuma vale o funil ideal do produto.
    client.setQueryData(["dashboard", "funnel-targets"], {});
  };

  const leadsOk = { data: [] as Lead[], isPending: false, error: null, refetch: () => undefined };

  it("consulta de leads FALHADA nao vira zero medido no comparativo", async () => {
    // `directorPipeline(deals, leads ?? [], …)` transformava a ausência em
    // medida: o comparativo pintava "10 vs 0 · 0% de aderência" em vermelho
    // como se o pipeline estivesse parado, e o erro só aparecia para quem
    // abrisse a aba Leads.
    const { text, cleanup } = await renderComCache(
      <DirectorPanel
        month="08/2026"
        deals={[]}
        leads={{ ...leadsOk, data: undefined, error: new Error("permission denied") }}
      />,
      semearDiretoria,
    );
    expect(text).toContain("Não consegui carregar o comparativo da diretoria");
    expect(text).not.toContain("de aderência");
    expect(text).not.toContain("Nenhum lançamento em 08/2026");
    await cleanup();
  });

  it("lista de leads ainda a caminho segura o painel, em vez de medir zero", async () => {
    const { text, cleanup } = await renderComCache(
      <DirectorPanel
        month="08/2026"
        deals={[]}
        leads={{ ...leadsOk, data: undefined, isPending: true }}
      />,
      semearDiretoria,
    );
    expect(text).toContain("Carregando o diário da diretoria");
    expect(text).not.toContain("de aderência");
    await cleanup();
  });

  it("com a consulta de leads resolvida, o comparativo aparece", async () => {
    const { text, cleanup } = await renderComCache(
      <DirectorPanel month="08/2026" deals={[]} leads={leadsOk} />,
      semearDiretoria,
    );
    expect(text).toContain("Declarado × medido");
    await cleanup();
  });

  it("a venda do mes conta como analise e aprovacao MEDIDAS, nao como zero", async () => {
    // O declarado e cumulativo no mes (2 análises, 1 aprovada, 1 venda).
    // Enquanto o medido era a fotografia da etapa atual, o negocio fechado saia
    // de "Em Análise" e o cartao dizia "2 vs 0 · 0% de aderência" em vermelho —
    // para a analise que aconteceu e virou venda.
    const vendido = {
      id: "d1",
      outcome: "won",
      stage: "closed",
      stage_position: 8,
      status: "03. ASSINADO",
      month_base: "08/2026",
      broker1_id: "b1",
    } as unknown as DealRow;
    const { text, cleanup } = await renderComCache(
      <DirectorPanel month="08/2026" deals={[vendido]} leads={leadsOk} />,
      semearDiretoria,
    );
    // O texto do cartao sai concatenado: rotulo, o par declarado/medido e a
    // aderencia. "2 vs 0" era o que a fotografia da etapa atual imprimia.
    expect(text).toContain("Análises2 vs 1100% de aderência");
    expect(text).toContain("Aprovações1 vs 1100% de aderência");
    expect(text).not.toContain("2 vs 0");
    await cleanup();
  });

  it("a régua vem de funnel_targets, não do 10/40/50 chumbado", async () => {
    // O /checkpoint já lia a tabela e esta aba não: o MESMO diretor era cobrado
    // por 53% lá e por 50% aqui, e o selo "Abaixo da meta" divergia entre as
    // duas telas com o mesmo dado. Precedência: diretoria > equipe > empresa.
    const comMetas = (client: QueryClient) => {
      semearDiretoria(client);
      client.setQueryData(["dashboard", "funnel-targets"], {
        __global__: { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 },
        t1: { analise_enviada_pct: 12, aprovada_pct: 45, venda_pct: 55 },
      });
    };
    const { text, cleanup } = await renderComCache(
      <DirectorPanel month="08/2026" deals={[]} leads={leadsOk} />,
      comMetas,
    );
    // Sem diretor identificado no contexto de teste e com UMA equipe no filtro,
    // vale a meta dela: 12 / 45 / 55.
    expect(text).toContain("12 / 45 / 55%");
    expect(text).toContain("meta da equipe");
    expect(text).not.toContain("100 / 10 / 4 / 2");
    await cleanup();
  });

  it("o gerente vê a mesma aba, com o texto da equipe dele", async () => {
    // `auth_led_team_ids()` casa `teams.manager_id`, então a RLS de
    // `daily_reports`/`daily_entries` já liberava o diário para o gerente: o que
    // faltava era a tela. Sem equipe vinculada, o aviso tem de falar de
    // GERÊNCIA — dizer "nenhuma equipe sob esta diretoria" a um gerente manda
    // procurar um vínculo que não é o dele.
    const semEquipe = (client: QueryClient) => {
      client.setQueryData(["dashboard", "led-teams", "scope", null], {
        teams: [],
        managers: [],
        brokers: [],
      });
      client.setQueryData(["dashboard", "stages"], []);
      client.setQueryData(["dashboard", "funnel-targets"], {});
    };
    const { text, cleanup } = await renderComCache(
      <DirectorPanel month="08/2026" deals={[]} leads={leadsOk} escopo="equipe" />,
      semEquipe,
    );
    expect(text).toContain("Nenhuma equipe sob a sua gerência");
    expect(text).not.toContain("Nenhuma equipe sob esta diretoria");
    await cleanup();
  });

  it("sem meta cadastrada, diz que a régua é o funil ideal — não finge meta", async () => {
    const { text, cleanup } = await renderComCache(
      <DirectorPanel month="08/2026" deals={[]} leads={leadsOk} />,
      semearDiretoria,
    );
    expect(text).toContain("funil ideal — nenhuma meta cadastrada");
    await cleanup();
  });
});

describe("Breakdown", () => {
  it("o CCA diz de quem e a contagem — a empresa ou so os seus negocios", async () => {
    const toda = await render(<CcaStatusCard counts={{ Aprovado: 3 }} toda />);
    expect(toda.text).toContain("Processos do CCA por situação");
    await toda.cleanup();

    const minha = await render(<CcaStatusCard counts={{}} toda={false} />);
    expect(minha.text).toContain("Nenhum processo do CCA nos seus negócios");
    await minha.cleanup();
  });

  it("o card de time mostra as quatro contagens", async () => {
    const { text, cleanup } = await render(
      <StaffCard staff={{ brokersTotal: 12, active: 15, managers: 3, directors: 2 }} />,
    );
    expect(text).toContain("Corretores");
    expect(text).toContain("Gerentes");
    expect(text).toContain("Diretores");
    expect(text).toContain("Pessoas ativas");
    await cleanup();
  });
});
