import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LeadImportDialog } from "./LeadImportDialog";

/**
 * O que a importação faz DEPOIS de quebrar no meio.
 *
 * `createLeads` grava em lotes de 200 e para no primeiro que falha — os
 * anteriores já estão no banco. A tela mostrava o toast de erro e continuava
 * com o botão "Importar N leads" armado com a planilha inteira: um segundo
 * clique reinseria os lotes já gravados, e duplicata na roleta é dois
 * corretores atendendo o mesmo cliente. É o caso que nenhum teste pegava,
 * porque só acontece com o insert falhando no meio.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invalidou = vi.fn(async () => undefined);
vi.mock("./data", () => ({
  useInvalidateLeads: () => invalidou,
  // O seletor de grupo consulta `distribution_groups`; aqui o lote cai no
  // padrão ("deixar o sistema decidir"), que é o caso deste arquivo.
  useDistributionGroups: () => ({ data: [], error: null }),
}));

const criar = vi.fn();
const conferir = vi.fn();
vi.mock("@/integrations/supabase/leads", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createLeads: (...args: unknown[]) => criar(...args),
  existingLeadPhones: (...args: unknown[]) => conferir(...args),
}));

const PLANILHA = [
  "Cliente,Telefone",
  "Ana Importada,11988770001",
  "Bruno Importado,11988770002",
  "Carla Importada,11988770003",
].join("\n");

/** Erro no formato que `dbError` monta: `describeError` lê a mensagem do P0001. */
const falhaDoLote = Object.assign(new Error("importar leads"), {
  db: {
    code: "P0001",
    message: "2 lead(s) foram importados. O erro começou no lote da linha 3 da planilha.",
  },
});

const texto = () => document.body.textContent ?? "";
const botao = (rotulo: RegExp) => [...document.body.querySelectorAll("button")]
  .find((b) => rotulo.test((b.textContent ?? "").trim()));

/** Um tique para o FileReader e as promessas do diálogo resolverem. */
const respirar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function abrirComPlanilha() {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<LeadImportDialog sources={[]} onClose={() => undefined} />); });

  const entrada = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  if (!entrada) throw new Error("o diálogo não tem seletor de arquivo");
  // `DataTransfer` não existe no jsdom; o React lê `event.target.files`, então
  // é a propriedade que o teste precisa entregar.
  Object.defineProperty(entrada, "files", {
    value: [new File([PLANILHA], "leads.csv", { type: "text/csv" })],
    configurable: true,
  });
  await act(async () => { entrada.dispatchEvent(new Event("change", { bubbles: true })); });
  await respirar();
  await respirar();

  return async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  };
}

describe("LeadImportDialog · lote que falha no meio", () => {
  beforeEach(() => {
    invalidou.mockClear();
    criar.mockReset();
    conferir.mockReset();
    // Primeira conferência: nenhum dos três telefones existe.
    conferir.mockResolvedValueOnce(new Set<string>());
  });

  it("depois da falha, recarrega a lista e passa a importar só o que faltou", async () => {
    criar.mockRejectedValueOnce(falhaDoLote);
    // Reconferência: os dois primeiros ENTRARAM antes do erro.
    conferir.mockResolvedValueOnce(new Set(["11988770001", "11988770002"]));

    const fechar = await abrirComPlanilha();
    expect(botao(/^importar 3 leads$/i), "a prévia precisa oferecer os 3 leads").toBeTruthy();

    await act(async () => { botao(/^importar 3 leads$/i)!.click(); });
    await respirar();
    await respirar();

    // 1. A lista recarrega: os leads que ENTRARAM precisam aparecer na tela.
    expect(invalidou).toHaveBeenCalled();
    // 2. A tela diz o que aconteceu, com a mensagem do banco.
    expect(texto()).toMatch(/importação parou no meio/i);
    expect(texto()).toMatch(/2 lead\(s\) foram importados/);
    // 3. E o botão passa a valer só pelo que faltou — clicar de novo não
    //    reinsere os dois primeiros.
    expect(conferir).toHaveBeenCalledTimes(2);
    expect(botao(/^importar 1 leads$/i)).toBeTruthy();
    expect(botao(/^importar 3 leads$/i)).toBeUndefined();

    await fechar();
  });

  it("sem conseguir reconferir, o botão trava em vez de reimportar às cegas", async () => {
    criar.mockRejectedValueOnce(falhaDoLote);
    conferir.mockRejectedValueOnce(new Error("rede"));

    const fechar = await abrirComPlanilha();
    await act(async () => { botao(/^importar 3 leads$/i)!.click(); });
    await respirar();
    await respirar();

    const travado = botao(/recarregue a planilha/i);
    expect(travado, "sem saber o que entrou, importar de novo duplica").toBeTruthy();
    expect(travado?.disabled).toBe(true);
    expect(texto()).toMatch(/recarregue a planilha antes de tentar de novo/i);

    await fechar();
  });
});
