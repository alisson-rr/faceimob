/**
 * Períodos da aba Leads do Dashboard (pedido de 03/10/2026): hoje, ontem, esta
 * semana, este mês, mês passado e um intervalo escolhido. "filtro" segue o mês
 * do filtro do topo, que era o único comportamento até aqui. Puro: o vitest
 * cobre as bordas (semana começa na segunda; o fim é exclusivo).
 */
export type PeriodoLeads = "filtro" | "hoje" | "ontem" | "semana" | "mes" | "mes_passado" | "custom";

export const PERIODOS_DE_LEADS: { value: PeriodoLeads; label: string }[] = [
  { value: "filtro", label: "Mês do filtro do topo" },
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mês" },
  { value: "mes_passado", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
];

/** Início (inclusivo) e fim (exclusivo), meia-noite no horário de quem olha. */
export type Intervalo = { de: Date; ate: Date };

const dia = (ano: number, mes: number, d: number) => new Date(ano, mes, d);

/** "AAAA-MM-DD" do `<input type="date">` → meia-noite local; inválido → null. */
export function dataDoCampo(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const data = dia(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(data.getTime()) ? null : data;
}

export function intervaloDoPeriodo(
  periodo: PeriodoLeads,
  agora: Date = new Date(),
  custom: { de: string; ate: string } = { de: "", ate: "" },
): Intervalo | null {
  const [a, m, d] = [agora.getFullYear(), agora.getMonth(), agora.getDate()];
  switch (periodo) {
    case "hoje": return { de: dia(a, m, d), ate: dia(a, m, d + 1) };
    case "ontem": return { de: dia(a, m, d - 1), ate: dia(a, m, d) };
    case "semana": {
      const desdeSegunda = (agora.getDay() + 6) % 7;
      return { de: dia(a, m, d - desdeSegunda), ate: dia(a, m, d + 1) };
    }
    case "mes": return { de: dia(a, m, 1), ate: dia(a, m, d + 1) };
    case "mes_passado": return { de: dia(a, m - 1, 1), ate: dia(a, m, 1) };
    case "custom": {
      const de = dataDoCampo(custom.de);
      const ate = dataDoCampo(custom.ate);
      if (!de || !ate || ate < de) return null;
      return { de, ate: dia(ate.getFullYear(), ate.getMonth(), ate.getDate() + 1) };
    }
    default: return null;
  }
}

/**
 * O mês do filtro do topo ("MM/AAAA") como intervalo; "todos os meses" → null.
 * Com ele o mês vem inteiro do banco, em páginas: a lista sem recorte para nos
 * 1.000 leads mais recentes, e numa semana de 700 leads/dia o começo do mês
 * sumia do gráfico (09/10/2026: 01/10 aparecia zerado).
 */
export function intervaloDoMes(month: string): Intervalo | null {
  const m = /^(\d{2})\/(\d{4})$/.exec(month);
  if (!m) return null;
  const [ano, mes] = [Number(m[2]), Number(m[1]) - 1];
  return { de: dia(ano, mes, 1), ate: dia(ano, mes + 1, 1) };
}

/** Os dias do intervalo em "AAAA-MM-DD" (até 92, os mais recentes), para a série diária. */
export function diasDoIntervalo({ de, ate }: Intervalo, limite = 92): string[] {
  const dias: string[] = [];
  for (let cursor = new Date(de); cursor < ate; cursor = dia(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getDate()).padStart(2, "0");
    dias.push(`${cursor.getFullYear()}-${mm}-${dd}`);
  }
  return dias.slice(-limite);
}

const curta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/** O texto do período para os títulos ("hoje", "01/10 a 03/10"…). */
export function rotuloDoIntervalo(periodo: PeriodoLeads, intervalo: Intervalo): string {
  if (periodo === "hoje") return "hoje";
  if (periodo === "ontem") return "ontem";
  const ultimo = dia(intervalo.ate.getFullYear(), intervalo.ate.getMonth(), intervalo.ate.getDate() - 1);
  const de = curta.format(intervalo.de);
  const ate = curta.format(ultimo);
  return de === ate ? de : `${de} a ${ate}`;
}
