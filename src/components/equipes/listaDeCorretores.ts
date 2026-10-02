import type { PersonRecord } from "@/integrations/supabase/newSchema";

/**
 * Lista de corretores em Excel (pedido de 02/10/2026), só para admin e sócio —
 * a mesma regra de todo relatório desde a 0185. Puro na montagem das linhas,
 * para o vitest cobrir; o arquivo sai pela mesma biblioteca da planilha do
 * Pipeline.
 */
export const CABECALHO_CORRETORES = [
  "NOME", "E-MAIL", "TELEFONE", "EQUIPE", "GERENTE", "DIRETOR", "SITUAÇÃO",
] as const;

const SITUACAO: Record<string, string> = { active: "Ativo", suspended: "Suspenso", terminated: "Desligado" };

export function linhasDeCorretores(pessoas: PersonRecord[]): string[][] {
  const nome = new Map(pessoas.map((p) => [p.id, p.name]));
  return pessoas
    .filter((p) => p.role === "broker")
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"))
    .map((p) => [
      p.name,
      p.email ?? "",
      p.phone ?? "",
      p.team ?? "",
      (p.manager_id && nome.get(p.manager_id)) || "",
      (p.director_id && nome.get(p.director_id)) || "",
      SITUACAO[p.status] ?? p.status,
    ]);
}

export async function baixarListaDeCorretores(pessoas: PersonRecord[]): Promise<number> {
  const linhas = linhasDeCorretores(pessoas);
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  await writeXlsxFile(
    [
      CABECALHO_CORRETORES.map((titulo) => ({ value: titulo, fontWeight: "bold" as const })),
      ...linhas.map((linha) => linha.map((valor) => ({ value: valor, type: String }))),
    ],
    {
      columns: [{ width: 34 }, { width: 32 }, { width: 18 }, { width: 24 }, { width: 28 }, { width: 28 }, { width: 12 }],
      stickyRowsCount: 1,
      sheet: "Corretores",
    },
  ).toFile(`corretores_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return linhas.length;
}
