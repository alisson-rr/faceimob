import type { CanalMeta, MetaMetricaRow, NivelDeVerba } from "@/integrations/supabase/analytics";

/**
 * Painel "Gestão de anúncios" do Marketing (pedido de 02/10/2026, no modelo da
 * tela da DG): uma linha por campanha sincronizada da Meta, com o período
 * escolhido somado dos insights diários (`meta_metricas`).
 *
 * Cores pedidas pelo cliente: AMARELO = custo por resultado acima do limite da
 * conta; VERMELHO = gastou e não gerou lead nenhum. Puro, para o vitest cobrir.
 */
export type Alerta = "ok" | "cpl_alto" | "sem_lead";

export type CampanhaDaConta = {
  id: string;
  externalId: string;
  name: string;
  status: string | null;
  dailyBudget: number | null;
  metaAccountId: string | null;
  metaChannel: CanalMeta | null;
  metaBudgetLevel: NivelDeVerba | null;
};

export type LinhaDoPainel = CampanhaDaConta & {
  ativa: boolean;
  canal: CanalMeta;
  investido: number;
  resultados: number;
  custoPorResultado: number | null;
  ctr: number | null;
  alerta: Alerta;
};

export const ROTULO_DO_RESULTADO: Record<CanalMeta, string> = {
  formulario: "Cadastros",
  whatsapp: "Conversas",
  landing_page: "Leads no site",
  misto: "Resultados",
  outro: "Resultados",
};

export function alertaDaCampanha(investido: number, resultados: number, custo: number | null, cplLimite: number | null): Alerta {
  if (investido > 0 && resultados === 0) return "sem_lead";
  if (custo !== null && cplLimite !== null && custo > cplLimite) return "cpl_alto";
  return "ok";
}

const PESO: Record<Alerta, number> = { ok: 0, cpl_alto: 1, sem_lead: 2 };

export function linhasDoPainel(
  campanhas: CampanhaDaConta[],
  metricas: MetaMetricaRow[],
  cplLimite: number | null,
): LinhaDoPainel[] {
  const porCampanha = new Map(metricas.map((m) => [m.campaign_id, m]));
  return campanhas
    .filter((c) => c.metaAccountId)
    .map((c) => {
      const m = porCampanha.get(c.id);
      const investido = m?.spend ?? 0;
      const resultados = m?.resultados ?? 0;
      const custo = resultados > 0 ? investido / resultados : null;
      return {
        ...c,
        ativa: c.status === "ACTIVE",
        canal: m?.channel ?? c.metaChannel ?? "outro",
        investido,
        resultados,
        custoPorResultado: custo,
        ctr: m?.ctr ?? null,
        alerta: alertaDaCampanha(investido, resultados, custo, cplLimite),
      };
    })
    // Ativas primeiro; dentro delas, as saudáveis pelo menor custo e os alertas no fim.
    .sort((a, b) => Number(b.ativa) - Number(a.ativa)
      || PESO[a.alerta] - PESO[b.alerta]
      || (a.custoPorResultado ?? Infinity) - (b.custoPorResultado ?? Infinity)
      || b.investido - a.investido);
}

export type ResumoDoPainel = {
  ativas: number;
  verbaDiaria: number;
  cadastros: number;
  custoPorCadastro: number | null;
  conversas: number;
  custoPorConversa: number | null;
  investido: number;
  comCplAlto: number;
  semLead: number;
};

export function resumoDoPainel(linhas: LinhaDoPainel[]): ResumoDoPainel {
  const soma = (filtro: (l: LinhaDoPainel) => boolean, valor: (l: LinhaDoPainel) => number) =>
    linhas.filter(filtro).reduce((total, l) => total + valor(l), 0);
  const ativas = linhas.filter((l) => l.ativa);
  const form = (l: LinhaDoPainel) => l.canal === "formulario" || l.canal === "landing_page";
  const whats = (l: LinhaDoPainel) => l.canal === "whatsapp";
  const cadastros = soma(form, (l) => l.resultados);
  const conversas = soma(whats, (l) => l.resultados);
  const gastoForm = soma(form, (l) => l.investido);
  const gastoWhats = soma(whats, (l) => l.investido);
  return {
    ativas: ativas.length,
    verbaDiaria: ativas.reduce((total, l) => total + (l.dailyBudget ?? 0), 0),
    cadastros,
    custoPorCadastro: cadastros > 0 ? gastoForm / cadastros : null,
    conversas,
    custoPorConversa: conversas > 0 ? gastoWhats / conversas : null,
    investido: soma(() => true, (l) => l.investido),
    comCplAlto: linhas.filter((l) => l.alerta === "cpl_alto").length,
    semLead: linhas.filter((l) => l.alerta === "sem_lead").length,
  };
}
