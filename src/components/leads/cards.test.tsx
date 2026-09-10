import { describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { GroupQueue, LeadRecord } from "@/integrations/supabase/leads";
import { OverdueLeadsCard } from "./OverdueLeadsCard";
import { RouletteHealthCard } from "./RouletteHealthCard";
import LeadDetailModal from "@/components/LeadDetailModal";

/**
 * O que a tela de Leads DIZ e OFERECE: os dois cards e o detalhe do lead.
 *
 * Os cards erravam a frase, não o número: o de atrasados anunciava "Check-in
 * bloqueado" para o diretor que via a soma da equipe contra um limite que é
 * individual, e não existia nada dizendo que a roleta estava parada com lead
 * esperando. Frase errada em cartão de operação é defeito, não estética.
 *
 * O detalhe entra aqui pelo mesmo motivo: ele oferecia "Converter" a quem o
 * banco recusa, e a frase de modo leitura logo abaixo nem citava converter.
 *
 * Sem @testing-library no projeto, o render é o do react-dom mesmo (mesmo
 * padrão de `dashboard/blocks.test.tsx`).
 */

/** Sessão que o modal enxerga. Mutável: cada teste ajusta antes de renderizar. */
const sessao = {
  user: { id: "eu" } as { id: string } | null,
  isAdmin: false,
  can: (_code: string) => false,
};

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => sessao }));

// O modal carrega histórico, comentários e anexos por `useQuery`; aqui só
// interessa quais ações ele oferece, então o detalhe vem vazio.
/** Histórico do lead que o modal enxerga. Mutável: cada teste ajusta antes. */
const detalhe: {
  events: { id: string; created_at: string; actor_name: string | null; description: string }[];
  comments: { id: string; created_at: string; author_name: string; body: string }[];
  attachments: { id: string; original_name: string; storage_path: string }[];
  /** Consultas ainda correndo: as três listas chegam vazias sem serem vazias. */
  isPending: boolean;
} = { events: [], comments: [], attachments: [], isPending: false };

vi.mock("@/components/leads", () => ({
  useLeadDetail: () => ({ ...detalhe, error: null, reload: () => {} }),
  useNowTicker: () => Date.now(),
  useDistributionGroups: () => ({ data: [], error: null }),
  useAutomationSettings: () => ({ data: undefined, error: null }),
  // Os diálogos do modal (próxima ação e encerramento) só abrem por clique; o
  // que este arquivo cobra é quais ações o modal OFERECE.
  NextActionDialog: () => null,
  CloseLeadDialog: () => null,
  toDateTimeInput: () => "",
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(ui: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  const text = container.textContent ?? "";
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
  return { container, text, cleanup };
}

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

const atrasado = (id: string, dono: string | null, nome: string) =>
  lead({
    id, full_name: `Lead ${id}`, name: `Lead ${id}`, assigned_to: dono, broker_name: nome,
    status: "in_progress", next_action_at: "2026-08-01T09:00:00Z",
  });

const fila = (patch: Partial<GroupQueue> = {}): GroupQueue => ({
  groupId: "g1", groupName: "Fila Geral", kind: "general", entries: [], error: null, ...patch,
});

const semAcao = () => undefined;

describe("RouletteHealthCard", () => {
  it("diz que a roleta está parada quando há lead esperando e ninguém na fila", async () => {
    const { text, cleanup } = await render(
      <RouletteHealthCard
        queues={[fila()]}
        queuedLeads={[lead({ id: "1", full_name: "Ana", name: "Ana" })]}
        isPending={false}
        error={null}
        onRetry={semAcao}
        onOpenLead={semAcao}
        onDistribute={semAcao}
        distributingId={null}
      />,
    );

    expect(text).toMatch(/roleta está parada/i);
    expect(text).toMatch(/1 lead\(s\) ficam esperando/i);
    expect(text).toMatch(/Ninguém na fila/i);
    await cleanup();
  });

  it("com gente na fila mostra a ordem e não fala em roleta parada", async () => {
    const { text, cleanup } = await render(
      <RouletteHealthCard
        queues={[fila({ entries: [
          { profile_id: "a", full_name: "Ana Corretora", queue_position: 1 },
          { profile_id: "b", full_name: "Bruno Corretor", queue_position: 2 },
        ] })]}
        queuedLeads={[]}
        isPending={false}
        error={null}
        onRetry={semAcao}
        onOpenLead={semAcao}
        onDistribute={semAcao}
        distributingId={null}
      />,
    );

    expect(text).toMatch(/2 pronto\(s\)/i);
    expect(text).toMatch(/Ana Corretora/);
    expect(text).not.toMatch(/roleta está parada/i);
    await cleanup();
  });

  it("com a distribuição pausada, diz que está pausada e não deixa distribuir", async () => {
    // O defeito: `assign_lead` devolve null antes de olhar a fila quando
    // `leads_paused` está ligado. O card mostrava "1 pronto(s)" e o botão
    // respondia "ninguém com check-in aberto" — o gestor procurava ponto
    // enquanto o problema estava em Admin · Automação de Leads.
    const { container, text, cleanup } = await render(
      <RouletteHealthCard
        queues={[fila({ entries: [{ profile_id: "a", full_name: "Ana Corretora", queue_position: 1 }] })]}
        queuedLeads={[lead({ id: "1", full_name: "Ana", name: "Ana" })]}
        isPending={false}
        error={null}
        onRetry={semAcao}
        onOpenLead={semAcao}
        onDistribute={semAcao}
        distributingId={null}
        paused
      />,
    );

    expect(text).toMatch(/distribuição está pausada/i);
    expect(text).toMatch(/Automação de Leads/);
    expect(text).not.toMatch(/roleta está parada/i);
    const distribuir = [...container.querySelectorAll("button")]
      .find((b) => /distribuir/i.test(b.textContent ?? ""));
    expect(distribuir, "o botão Distribuir precisa existir para ser recusado").toBeTruthy();
    expect(distribuir?.disabled).toBe(true);
    await cleanup();
  });

  it("separa o lead que rodou o teto de voltas do que acabou de chegar", async () => {
    // O laço medido em homologação: leads com 22 prazos vencidos girando na
    // roleta. Com o teto (0074) eles param — mas parados em `queued`, sem esta
    // separação, ficavam indistinguíveis de um lead recém-chegado e ninguém
    // sabia que estavam esperando gente, não a roleta.
    const { text, cleanup } = await render(
      <RouletteHealthCard
        queues={[fila({ entries: [
          { profile_id: "a", full_name: "Ana Corretora", queue_position: 1 },
        ] })]}
        queuedLeads={[
          lead({ id: "1", full_name: "Novo", name: "Novo" }),
          lead({ id: "2", full_name: "Rodou Cinco", name: "Rodou Cinco", roulette_misses: 5 }),
        ]}
        isPending={false}
        error={null}
        onRetry={semAcao}
        onOpenLead={semAcao}
        onDistribute={semAcao}
        distributingId={null}
        maxRounds={5}
      />,
    );

    expect(text).toMatch(/Sem atendimento \(1\)/);
    expect(text).toMatch(/5 voltas/);
    // E o outro continua contado como quem só espera a roleta.
    expect(text).toMatch(/Leads aguardando a roleta \(1\)/);
    await cleanup();
  });

  it("fila recusada mostra o motivo, não 'fila vazia' em silêncio", async () => {
    const recusa = Object.assign(new Error("sem permissão"), {
      db: { code: "42501", message: "Sem permissão para ver a fila deste grupo." },
    });
    const { text, cleanup } = await render(
      <RouletteHealthCard
        queues={[fila({ error: recusa })]}
        queuedLeads={[]}
        isPending={false}
        error={null}
        onRetry={semAcao}
        onOpenLead={semAcao}
        onDistribute={semAcao}
        distributingId={null}
      />,
    );

    expect(text).toMatch(/permissão/i);
    await cleanup();
  });
});

describe("OverdueLeadsCard", () => {
  it("para o dono dos leads, compara a própria conta com o limite", async () => {
    const { text, cleanup } = await render(
      <OverdueLeadsCard
        leads={[atrasado("1", "eu", "Eu"), atrasado("2", "eu", "Eu")]}
        threshold={2}
        profileId="eu"
        onOpen={semAcao}
        onReschedule={semAcao}
      />,
    );

    expect(text).toMatch(/Seu check-in está bloqueado/i);
    expect(text).toMatch(/Reagendar/);
    await cleanup();
  });

  it("para quem vê a equipe, agrupa por corretor e não anuncia bloqueio próprio", async () => {
    // O defeito: a diretora via 3 atrasados de gente diferente somados contra um
    // limite que é individual, e o card dizia "Check-in bloqueado" para ela.
    const { text, cleanup } = await render(
      <OverdueLeadsCard
        leads={[
          atrasado("1", "ana", "Ana"),
          atrasado("2", "ana", "Ana"),
          atrasado("3", "bruno", "Bruno"),
        ]}
        threshold={2}
        profileId="diretora"
        onOpen={semAcao}
        onReschedule={semAcao}
      />,
    );

    expect(text).not.toMatch(/Seu check-in está bloqueado/i);
    expect(text).toMatch(/1 corretor\(es\) bloqueado\(s\)/i);
    expect(text).toMatch(/Ana \(2\)/);
    expect(text).toMatch(/Bruno \(1\)/);
    // Cada grupo carrega o próprio veredito, não o da soma.
    expect(text).toMatch(/limite 2/);
    await cleanup();
  });

  it("sem atrasado nenhum, o card confirma que está tudo em dia", async () => {
    // O card sumia com zero atrasados: o corretor não distinguia "estou em dia"
    // de "o bloco quebrou" — e é justamente o bloco que explica por que o
    // check-in dele pode travar.
    const { container, cleanup } = await render(
      <OverdueLeadsCard leads={[]} threshold={20} profileId="eu" onOpen={semAcao} onReschedule={semAcao} />,
    );
    expect(container.textContent).toMatch(/Tudo em dia/i);
    expect(container.textContent).toMatch(/Leads atrasados \(0\)/);
    await cleanup();
  });

  it("cada atrasado oferece encerrar com motivo, não só reagendar", async () => {
    // Sem a saída, o único jeito de sair da conta dos 20 era reagendar para
    // sempre: a trava punia quem é honesto.
    const encerrar = vi.fn();
    const { container, cleanup } = await render(
      <OverdueLeadsCard
        leads={[atrasado("1", "eu", "Eu")]}
        threshold={20}
        profileId="eu"
        onOpen={semAcao}
        onReschedule={semAcao}
        onCloseLead={encerrar}
      />,
    );

    const botao = [...container.querySelectorAll("button")]
      .find((b) => /encerrar/i.test(b.getAttribute("aria-label") ?? ""));
    expect(botao, "o card de atrasados precisa oferecer o encerramento").toBeTruthy();
    await cleanup();
  });
});

describe("LeadDetailModal · ações que o banco aceita", () => {
  /** O modal vai para um portal: a busca é no body, não no container. */
  const botao = (rotulo: RegExp) => [...document.body.querySelectorAll("button")]
    .find((b) => rotulo.test((b.textContent ?? "").trim()));

  /**
   * As abas do Radix montam só o conteúdo ativo: sem trocar de aba, nada
   * existe no DOM. O `click()` do jsdom não basta — o Tabs troca no
   * `mousedown`/foco, não no clique.
   */
  const irPara = async (rotulo: RegExp) => {
    const alvo = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((t) => rotulo.test((t.textContent ?? "").trim()));
    if (!alvo) throw new Error(`aba não encontrada: ${rotulo}`);
    await act(async () => {
      alvo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      alvo.focus();
    });
  };

  const abrir = (patch: Partial<LeadRecord>) => render(
    <LeadDetailModal
      lead={lead({ id: "l1", full_name: "Cliente Detalhe", name: "Cliente Detalhe", ...patch })}
      open
      onOpenChange={semAcao}
      actorName="Você"
      onConvert={semAcao}
    />,
  );

  it("a linha do tempo junta log e comentário em ordem, marcando o que é manual", async () => {
    // "O registro histórico deve permitir comentários manuais para manter um log
    // de toda a movimentação do lead" (ata 23/07): as duas fontes numa lista só,
    // do mais recente para o mais antigo. Nada verificava a mistura.
    sessao.user = { id: "eu" };
    sessao.isAdmin = false;
    sessao.can = () => false;
    detalhe.events = [
      { id: "e1", created_at: "2026-08-20T10:00:00Z", actor_name: null, description: "Lead criado" },
      { id: "e2", created_at: "2026-08-22T10:00:00Z", actor_name: "Ana", description: "Etapa alterada" },
    ];
    detalhe.comments = [
      { id: "c1", created_at: "2026-08-21T10:00:00Z", author_name: "Bruno", body: "Cliente pediu para ligar à tarde" },
    ];
    detalhe.attachments = [
      { id: "a1", original_name: "rg-cliente.pdf", storage_path: "l1/rg-cliente.pdf" },
    ];

    const { cleanup } = await abrir({ assigned_to: "eu", broker_name: "Eu", status: "attending" });
    try {
      // As abas do Radix só montam o conteúdo ativo: sem o clique, o histórico
      // não existe no DOM — e um teste que passasse assim não provaria nada.
      await irPara(/histórico/i);
      const texto = document.body.textContent ?? "";

      expect(texto).toMatch(/Lead criado/);
      expect(texto).toMatch(/Cliente pediu para ligar à tarde/);
      expect(texto).toMatch(/Etapa alterada/);
      // Ordem: o mais recente primeiro, e o comentário no meio dos dois eventos.
      expect(texto.indexOf("Etapa alterada"))
        .toBeLessThan(texto.indexOf("Cliente pediu para ligar à tarde"));
      expect(texto.indexOf("Cliente pediu para ligar à tarde"))
        .toBeLessThan(texto.indexOf("Lead criado"));
      // O comentário é marcado como manual: no histórico do lead, "alguém
      // digitou isto" e "o sistema registrou isto" não podem parecer a mesma
      // coisa.
      expect(texto).toMatch(/comentário/);

      // E o anexo tem botão de baixar nomeado — sem nome ele é inalcançável
      // por teclado e por leitor de tela.
      await irPara(/anexos/i);
      const baixar = [...document.body.querySelectorAll("button")]
        .find((b) => /baixar rg-cliente\.pdf/i.test(b.getAttribute("aria-label") ?? ""));
      expect(baixar, "anexo sem botão nomeado é inalcançável por teclado").toBeTruthy();
    } finally {
      // Sem o finally, uma falha aqui deixaria o modal montado no body e
      // derrubaria os testes seguintes por contaminação.
      detalhe.events = [];
      detalhe.comments = [];
      detalhe.attachments = [];
      await cleanup();
    }
  });

  it("enquanto o banco não respondeu, o detalhe não afirma que não há histórico", async () => {
    // As três listas chegam vazias durante a consulta, e a tela dizia "Sem
    // histórico.", "Nenhum comentário ainda." e "Sem anexos" antes de saber de
    // nada. Num lead com linha do tempo longa o corretor lia o oposto da
    // verdade e fechava o modal.
    sessao.user = { id: "eu" };
    sessao.isAdmin = false;
    sessao.can = () => false;
    detalhe.isPending = true;

    const { cleanup } = await abrir({ assigned_to: "eu", broker_name: "Eu", status: "attending" });
    try {
      await irPara(/histórico/i);
      let texto = document.body.textContent ?? "";
      expect(texto).toMatch(/carregando o histórico/i);
      expect(texto, "'Sem histórico' antes da resposta é mentira").not.toMatch(/Sem histórico/i);

      await irPara(/^comentar$/i);
      texto = document.body.textContent ?? "";
      expect(texto).toMatch(/carregando os comentários/i);
      expect(texto).not.toMatch(/Nenhum comentário ainda/i);

      await irPara(/anexos/i);
      texto = document.body.textContent ?? "";
      expect(texto).toMatch(/carregando os anexos/i);
      expect(texto).not.toMatch(/Sem anexos/i);
    } finally {
      detalhe.isPending = false;
      await cleanup();
    }
  });

  it("lead que já circulou mostra a volta da roleta no cabeçalho", async () => {
    // Um lead na 19ª volta era indistinguível de um lead novo — nem na lista,
    // nem no detalhe, nem no card de saúde da roleta.
    sessao.user = { id: "eu" };
    sessao.isAdmin = false;
    sessao.can = () => false;
    const { cleanup } = await abrir({ assigned_to: "eu", broker_name: "Eu", roulette_misses: 3 });

    expect(document.body.textContent).toMatch(/3ª volta na roleta/);
    await cleanup();
  });

  it("quem só enxerga o lead não recebe o botão Converter", async () => {
    // `convert_lead_to_deal` exige dono, gestor do dono ou admin (0028). O
    // sócio tem menu.leads e enxerga TODO lead: com o botão aceso ele
    // preenchia construtora, empreendimento e VGV e só então tomava 42501.
    sessao.user = { id: "eu" };
    sessao.isAdmin = false;
    sessao.can = () => false;
    const { cleanup } = await abrir({ assigned_to: "outro", broker_name: "Outro Corretor" });

    expect(botao(/^converter/i), "o botão Converter não pode aparecer em modo leitura").toBeUndefined();
    // E a frase de modo leitura precisa citar converter, senão a tela se
    // contradiz na mesma dobra.
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(/modo leitura/i);
    expect(texto).toMatch(/anexar e\s+converter/i);
    await cleanup();
  });

  it("o dono do lead continua com Converter", async () => {
    sessao.user = { id: "eu" };
    sessao.isAdmin = false;
    sessao.can = () => false;
    const { cleanup } = await abrir({ assigned_to: "eu", broker_name: "Eu", status: "attending" });

    expect(botao(/^converter/i), "o dono do lead converte, e o banco aceita").toBeTruthy();
    await cleanup();
  });
});
