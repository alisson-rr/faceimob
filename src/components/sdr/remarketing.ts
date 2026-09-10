import { functionErrorMessage } from "@/lib/functionError";

/**
 * Lógica pura da aba Remarketing: o que a planilha vira, quando uma lista ainda
 * está disparando de verdade e como a falha da edge function é lida.
 *
 * Fica fora do componente porque são as três decisões que precisam de teste
 * sem browser — e as duas primeiras espelham regra que mora no banco e na edge
 * function, onde divergir sai caro.
 */

/**
 * Mesma redução de `public.normalize_phone` (migration 0001): só dígitos, com
 * DDI 55 implícito para 10 ou 11 dígitos. Não é validação — é a CHAVE de
 * deduplicação da planilha.
 *
 * Sem ela, "(11) 98888-1234" e "11988881234" são duas linhas para o app e a
 * MESMA para o banco: o `unique (list_id, phone)` da 0008 levanta 23505, a
 * importação é atômica (0031) e o operador perde a planilha inteira lendo "Já
 * existe um registro com esses dados." — telefone repetido em export de base
 * antiga é a regra, não a exceção.
 *
 * Telefone impossível continua devolvendo `null` e SEGUE para o banco: quem
 * recusa é o trigger `remarketing_contacts_normalize`, com o aviso "Telefone
 * inválido na importação". Recusar aqui trocaria esse aviso por uma importação
 * silenciosamente incompleta.
 */
export function chaveDeTelefone(raw: string): string | null {
  const digitos = raw.replace(/\D/g, "");
  if (!digitos) return null;
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

export type ContatoImportado = {
  full_name: string;
  phone: string;
  extra: Record<string, string>;
};

export type PlanilhaLida = {
  contatos: ContatoImportado[];
  /** Linhas descartadas por repetirem um telefone já lido na mesma planilha. */
  repetidos: number;
};

/**
 * As linhas da planilha no formato que a RPC `import_remarketing_list` espera.
 *
 * O público da lista é exatamente isto: as linhas do arquivo que o operador
 * subiu, com telefone preenchido e sem repetição. Nenhum contato entra por
 * critério que não esteja na planilha.
 *
 * Colunas aceitas: nome/name/cliente, fone/telefone/phone/celular,
 * campanha/campaign/origem. As demais colunas seguem inteiras em `extra`, que é
 * de onde o disparo tira o valor de `{{campanha}}` quando o template pede.
 */
export function lerContatos(linhas: Record<string, string>[]): PlanilhaLida {
  const contatos: ContatoImportado[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;

  for (const linha of linhas) {
    const phone = (linha.fone || linha.telefone || linha.phone || linha.celular || "").trim();
    if (!phone) continue;
    // Telefone que não normaliza entra pelo texto cru: duas linhas idênticas
    // ainda colapsam, e a primeira delas segue para o trigger recusar.
    const chave = chaveDeTelefone(phone) ?? phone.toLowerCase();
    if (vistos.has(chave)) { repetidos++; continue; }
    vistos.add(chave);
    contatos.push({
      full_name: (linha.nome || linha.name || linha.cliente || "").trim(),
      phone,
      extra: { campaign: (linha.campanha || linha.campaign || linha.origem || "").trim(), ...linha },
    });
  }

  return { contatos, repetidos };
}

/**
 * Por quanto tempo `remarketing_lists.status = 'running'` vale como disparo em
 * andamento.
 *
 * A trava não pode ser eterna: o runtime mata a edge function no teto de tempo
 * da plataforma ANTES do `catch` que solta a lista, e uma lista presa em
 * 'running' deixava o botão "Disparar" desabilitado para sempre, sem saída pela
 * tela. Passado o prazo, a tela volta a oferecer o disparo e a function assume
 * a trava vencida.
 *
 * Mudou aqui, muda em `supabase/functions/sdr-whatsapp-broadcast/index.ts` —
 * os dois lados têm de concordar, senão o botão libera antes de a function
 * aceitar (ou depois).
 */
export const MINUTOS_DE_TRAVA = 10;

export function disparoEmAndamento(
  lista: { status: string | null; updated_at: string | null },
  agora: number = Date.now(),
): boolean {
  if (lista.status !== "running") return false;
  const desde = lista.updated_at ? Date.parse(lista.updated_at) : NaN;
  // Sem relógio confiável, o conservador é tratar como em andamento: perder um
  // clique é menos grave que mandar o mesmo template duas vezes ao cliente.
  if (!Number.isFinite(desde)) return true;
  return agora - desde < MINUTOS_DE_TRAVA * 60_000;
}

export type FalhaDoDisparo = {
  mensagem: string;
  /** Nome do slot do cofre quando a function respondeu `missing_credential`. */
  credencialAusente: string | null;
};

/**
 * A falha da `sdr-whatsapp-broadcast` separada em duas coisas diferentes.
 *
 * "A Meta recusou" some com o toast e o operador tenta de novo; "não há
 * credencial cadastrada" não muda até alguém ir em Admin · Integrações, e
 * precisa ficar escrito na tela. O `code`/`credential` vêm do 503 da function.
 */
export async function falhaDoDisparo(error: unknown, fallback: string): Promise<FalhaDoDisparo> {
  const mensagem = await functionErrorMessage(error, fallback);
  let credencialAusente: string | null = null;
  try {
    const corpo = await (error as { context?: Response }).context?.clone().json() as
      { code?: unknown; credential?: unknown } | undefined;
    if (corpo?.code === "missing_credential") {
      credencialAusente = typeof corpo.credential === "string" && corpo.credential
        ? corpo.credential
        : "META_WHATSAPP_ACCESS_TOKEN";
    }
  } catch {
    // Resposta não-JSON (proxy, timeout): fica só a mensagem.
  }
  return { mensagem, credencialAusente };
}
