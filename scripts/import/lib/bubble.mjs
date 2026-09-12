#!/usr/bin/env node
/**
 * Biblioteca comum do importador Bubble → Supabase.
 *
 * Todo script de carga em `scripts/import/` importa daqui. O contrato é fixo
 * (ver `docs/importacao/PLANO.md` §6): localizar o export, parse (JSON ou CSV),
 * conversões de tipo, resolução de FK, escrita em lote e relatório.
 *
 *   node scripts/import/lib/bubble.mjs --autoteste   → roda as asserções e sai
 *
 * Credenciais: `VITE_SUPABASE_URL` sai do `.env` da raiz; a service role key
 * sai SÓ de `process.env.SUPABASE_SERVICE_ROLE_KEY`. Nada aqui imprime chave,
 * token, CPF, PIS ou telefone completo — e a coluna `senha_temporaria` do CSV
 * de `Users` não é lida por função nenhuma deste arquivo.
 *
 * Extras além do contrato, para quem quiser: `resolvedor.contagem`,
 * `resolvedor.pendencias` e `resolvedor.relatar(rel)` despejam o placar de FK
 * no relatório sem cada carga reescrever o mesmo laço; `anomaliasDaLib()` conta
 * data ilegível, CSV de largura errada e valor não textual vindo do JSON (o
 * `relatorio` já imprime as três).
 */
import assert from "node:assert/strict";
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

/**
 * Nome da coluna de destino em `public.import_bubble_map`.
 *
 * `DECISOES.md` N-06 fixa a PK como `(entidade, bubble_id, tabela_destino)`;
 * o DDL rascunhado em `PLANO.md` §6 Fase 1 chama a mesma coluna de `tabela`.
 * Vale a decisão. Se a migration entrar com o outro nome, é esta linha que muda.
 */
const COL_TABELA = "tabela_destino";

// ── anomalias silenciosas ────────────────────────────────────────────────────

/**
 * Acumulador das anomalias que a lib detecta e nenhum chamador pede: data em
 * formato desconhecido e linha de CSV com largura diferente do cabeçalho.
 *
 * Nenhuma das duas pode virar `null`/`""` calado — é assim que uma coluna
 * NOT NULL recebe null sem ninguém perceber. Nenhuma das duas justifica
 * derrubar a carga inteira. Como toda carga termina em `relatorio.imprimir()`,
 * o despejo sai de graça, sem tocar em nenhum script de carga.
 */
const anomalias = new Map();
const exemploAnomalia = new Map();

function anotarAnomalia(chave, amostra) {
  anomalias.set(chave, (anomalias.get(chave) ?? 0) + 1);
  if (amostra !== undefined && !exemploAnomalia.has(chave))
    exemploAnomalia.set(chave, String(amostra).slice(0, 60));
}

/**
 * Cópia do placar de anomalias, para quem quiser abortar por conta própria.
 *
 * @returns {Map<string, number>}
 */
export function anomaliasDaLib() {
  return new Map(anomalias);
}

// ── onde estão os exports ────────────────────────────────────────────────────

const RAIZ_DADOS = new URL(
  "../../../DOCUMENTOS/DADOS_BUBBLE/",
  import.meta.url,
);

/**
 * Onde procurar, em ordem. O reexport de N-05 saiu em JSON e traz `unique id`
 * nas colunas de relacionamento; o CSV de 08/09 traz nome de exibição. Só 7 das
 * 23 entidades vieram em JSON — `leadfies`, `Equipes`, `doc-clientes` e o resto
 * ainda são CSV —, então os dois diretórios convivem e o JSON tem prioridade.
 */
const DIRS = [
  [fileURLToPath(new URL("json/", RAIZ_DADOS)), ".json"],
  [fileURLToPath(RAIZ_DADOS), ".csv"],
];

/**
 * Carimbo do export no nome: `…_2026-09-08_19-43-56.csv` e também
 * `…_2026-09-09.json` — o export em JSON só acrescenta a hora quando há mais de
 * um do mesmo dia. `null` sem carimbo: é o que separa snapshot de cópia à mão.
 */
const carimbo = (nome) =>
  nome.match(
    /_(\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?)\.(?:csv|json)$/i,
  )?.[1] ?? null;

/**
 * O mais novo de uma lista de nomes de arquivo, pelo carimbo.
 *
 * Nome SEM carimbo só entra na disputa se nenhum outro tiver: comparado pelo
 * nome inteiro, `export_All-pipelines (1).csv` vence qualquer `…_2026-…`
 * (a letra ganha do dígito) e redirecionaria a carga inteira em silêncio.
 */
function maisNovoExport(nomes) {
  const carimbados = nomes.filter((n) => carimbo(n));
  return [...(carimbados.length ? carimbados : nomes)]
    .sort((a, b) => (carimbo(a) ?? a).localeCompare(carimbo(b) ?? b))
    .at(-1);
}

/**
 * Caminho do export mais novo que começa com `prefixo` — JSON antes de CSV.
 *
 * Devolve caminho, e não um "formato": quem carrega precisa saber qual coluna
 * ler (no JSON `CORRETOR 1` traz `unique id`, no CSV traz nome), e testar
 * `.endsWith(".json")` no chamador é mais barato do que um envelope.
 *
 * @param {string} prefixo
 * @param {[string, string][]} [dirs] só o autoteste passa outro valor
 * @returns {string}
 */
export function acharExport(prefixo, dirs = DIRS) {
  for (const [dir, sufixo] of dirs) {
    let nomes;
    try {
      nomes = readdirSync(dir);
    } catch {
      continue; // diretório ausente é normal enquanto o reexport não terminou
    }
    const achados = nomes.filter(
      (n) => n.startsWith(prefixo) && n.toLowerCase().endsWith(sufixo),
    );
    if (achados.length) return join(dir, maisNovoExport(achados));
  }
  throw new Error(
    `Nenhum export começando por "${prefixo}" em DOCUMENTOS/DADOS_BUBBLE (nem json/ nem csv).`,
  );
}

// ── leitura do export ────────────────────────────────────────────────────────

/**
 * Export em JSON: array único de objetos, todo valor string.
 *
 * `JSON.parse` do arquivo inteiro. Medido no maior (pipelines, 21 MB,
 * 7.579 × 110): 150 ms, +60 MB de heap e +73 MB de RSS. O array não tem uma
 * quebra de linha sequer, então parser incremental custaria ~150 linhas para
 * economizar isso — não paga.
 * ponytail: carrega tudo na memória; se o `leadfies` em JSON (o CSV tem 56 MB)
 * não couber, rode com `node --max-old-space-size=4096` antes de trocar o parser.
 *
 * @param {string} caminho
 * @returns {AsyncGenerator<Record<string, string>>}
 */
async function* lerJson(caminho) {
  const dados = JSON.parse(readFileSync(caminho, "utf8"));
  if (!Array.isArray(dados))
    throw new Error(
      `${caminho}: esperava um array de objetos no topo do JSON.`,
    );
  for (const linha of dados) {
    if (!linha || typeof linha !== "object" || Array.isArray(linha))
      throw new Error(`${caminho}: elemento do array não é objeto de colunas.`);
    // Valor não textual quebraria o contrato em silêncio: `String([a, b])` junta
    // com "," e a lista do Bubble usa " , " — os dois ids virariam um só.
    for (const coluna in linha)
      if (typeof linha[coluna] !== "string") {
        anotarAnomalia("json-valor-nao-textual", coluna);
        linha[coluna] = linha[coluna] == null ? "" : String(linha[coluna]);
      }
    yield linha;
  }
}

/**
 * Lê um export do Bubble, um registro por objeto `{coluna: valor}`.
 *
 * Decide pelo sufixo do caminho: `.json` (reexport de N-05) ou CSV. O nome
 * continua `lerCsv` de propósito — o contrato é o mesmo nos dois formatos e os
 * pontos de chamada são das quatro cargas, que não deveriam mudar por um nome.
 *
 * O CSV passa por um parser próprio de RFC 4180 porque os arquivos têm quebra
 * de linha dentro de campo (aspas) e o maior tem 56 MB — `readFileSync` +
 * `split` estoura memória e quebra as células multilinha. Trata BOM, CRLF e
 * `""` como aspa escapada.
 *
 * @param {string} caminho
 * @returns {AsyncGenerator<Record<string, string>>}
 */
export async function* lerCsv(caminho) {
  if (/\.json$/i.test(caminho)) return yield* lerJson(caminho);

  let cabecalho = null;
  let campos = [];
  let campo = "";
  let dentroAspas = false;
  let aspaPendente = false; // vimos `"` dentro do campo citado: `""` é escape, resto fecha
  let primeiroPedaco = true;

  const fecharLinha = () => {
    campos.push(campo);
    campo = "";
    const linha = campos;
    campos = [];
    if (linha.length === 1 && linha[0] === "") return null; // linha em branco
    if (!cabecalho) {
      cabecalho = linha;
      return null;
    }
    // Largura diferente do cabeçalho: campo extra some, campo faltante vira ""
    // (indistinguível de célula vazia). Contar é o que separa arquivo íntegro de
    // arquivo estragado — só truncar/preencher calado, não.
    if (linha.length !== cabecalho.length)
      anotarAnomalia(
        linha.length > cabecalho.length
          ? "csv-linha-mais-larga-que-o-cabecalho"
          : "csv-linha-mais-curta-que-o-cabecalho",
      );
    const obj = {};
    for (let c = 0; c < cabecalho.length; c++)
      obj[cabecalho[c]] = linha[c] ?? "";
    return obj;
  };

  for await (const pedaco of createReadStream(caminho, { encoding: "utf8" })) {
    let texto = pedaco;
    if (primeiroPedaco) {
      primeiroPedaco = false;
      if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    }
    let inicio = 0;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];

      if (aspaPendente) {
        aspaPendente = false;
        if (c === '"') {
          campo += '"';
          inicio = i + 1;
          continue;
        }
        dentroAspas = false;
        inicio = i; // o caractere ainda vale pelas regras de fora das aspas
      }

      if (dentroAspas) {
        if (c === '"') {
          campo += texto.slice(inicio, i);
          aspaPendente = true;
          inicio = i + 1;
        }
        continue;
      }

      if (c === '"') {
        campo += texto.slice(inicio, i);
        dentroAspas = true;
        inicio = i + 1;
      } else if (c === ",") {
        campo += texto.slice(inicio, i);
        campos.push(campo);
        campo = "";
        inicio = i + 1;
      } else if (c === "\n") {
        campo += texto.slice(inicio, i);
        inicio = i + 1;
        const linha = fecharLinha();
        if (linha) yield linha;
      } else if (c === "\r") {
        campo += texto.slice(inicio, i);
        inicio = i + 1;
      }
    }
    campo += texto.slice(inicio);
  }

  if (aspaPendente) dentroAspas = false;
  // Aspas ainda abertas no fim do arquivo = download interrompido no meio de um
  // campo. Emitir o registro parcial importaria metade do reexport em silêncio.
  if (dentroAspas)
    throw new Error(
      `${caminho}: o arquivo termina com um campo entre aspas aberto — download truncado?`,
    );
  if (campos.length > 0 || campo !== "") {
    const linha = fecharLinha();
    if (linha) yield linha;
  }
}

/**
 * Conta registros reais (sem cabeçalho, sem linha em branco). Serve os dois
 * formatos, pelo mesmo motivo que `lerCsv` mantém o nome.
 * Passa pelo mesmo parser de propósito: `wc -l` erra em toda célula multilinha
 * — e no JSON, que é uma linha só, erra em 100% dos registros.
 *
 * @param {string} caminho
 * @returns {Promise<number>}
 */
export async function contarCsv(caminho) {
  let n = 0;
  for await (const _ of lerCsv(caminho)) n++;
  return n;
}

// ── conversões ───────────────────────────────────────────────────────────────

const MESES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
// "May 11, 2024 6:18 pm" — Creation Date / Modified Date, en-US
const DATA_US =
  /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i;
// "15/01/24 17:28:00", "02/01/24 18:37", "07/03/24" — corpo dos CSVs de leads
const DATA_BR =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
// "2026/02/11 09:14" — as 499 linhas reimportadas (mapa/leads.md §5.3)
const DATA_BARRA =
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const anoCheio = (a) => (a.length === 2 ? 2000 + Number(a) : Number(a));

const valida = (ano, mes, dia, hora, minuto, segundo) =>
  mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && hora <= 23 && minuto <= 59
    ? { ano, mes, dia, hora, minuto, segundo }
    : null;

// Ordem de tentativa de mapa/leads.md §5.3. Os dois formatos com "/" não se
// confundem: o brasileiro começa com dia de 1-2 dígitos, o outro com ano de 4.
function casarData(s) {
  const us = DATA_US.exec(s);
  if (us) {
    const mes = MESES[us[1].slice(0, 3).toLowerCase()];
    const hora12 = Number(us[4]);
    if (!mes || hora12 < 1 || hora12 > 12) return null;
    const pm = us[6].toLowerCase() === "p";
    // 12:00 am é meia-noite e 12:00 pm é meio-dia: as duas exceções do relógio de 12h.
    const hora = hora12 === 12 ? (pm ? 12 : 0) : hora12 + (pm ? 12 : 0);
    return valida(Number(us[3]), mes, Number(us[2]), hora, Number(us[5]), 0);
  }
  const br = DATA_BR.exec(s);
  const m = br ?? DATA_BARRA.exec(s);
  if (!m) return null;
  const [ano, mes, dia] = br
    ? [anoCheio(m[3]), Number(m[2]), Number(m[1])]
    : [Number(m[1]), Number(m[2]), Number(m[3])];
  return valida(
    ano,
    mes,
    dia,
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
}

function partesData(txt) {
  // trim() já cobre o NBSP que 4 rótulos do Bubble trazem no lugar do espaço (T-NBSP).
  const s = String(txt ?? "").trim();
  if (s === "") return null; // célula vazia: ausência legítima, não é anomalia
  const p = casarData(s);
  if (p) return p;
  // Texto que não casou NÃO pode virar o mesmo null da célula vazia: é assim que
  // uma coluna NOT NULL recebe null sem ninguém perceber. Fica contado.
  anotarAnomalia("data-em-formato-desconhecido", s);
  return null;
}

const pad = (n, largura = 2) => String(n).padStart(largura, "0");

const RELOGIO_SP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset de `America/Sao_Paulo`, em minutos, no instante `ms`. */
function offsetNoInstante(ms) {
  const p = Object.fromEntries(
    RELOGIO_SP.formatToParts(ms).map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  return (local - ms) / 60000;
}

/** "-03:00" ou "-02:00", conforme a data-hora LOCAL informada. */
function offsetSaoPaulo(p) {
  const chute = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // Duas passadas: a primeira lê o offset do instante errado (a hora local
  // tratada como UTC), a segunda confirma no instante real.
  const min = offsetNoInstante(chute - offsetNoInstante(chute) * 60000);
  const abs = Math.abs(min);
  return `${min <= 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * "May 11, 2024 6:18 pm" → "2024-05-11T18:18:00-03:00".
 * "Feb 1, 2017 12:00 am" → "2017-02-01T00:00:00-02:00" (horário de verão).
 *
 * O offset sai do `Intl`, não é fixo: o Brasil teve horário de verão até 2019 e
 * o valor mais antigo do export é de 1957-09-21 (`Users.nascimento`). Fixar
 * -03:00 desloca uma hora em toda data dentro de janela de verão — 84 valores
 * medidos, incluindo `Oct 16, 2016 1:00 am`, o dia da virada.
 *
 * Não emitimos texto naive: a carga entra por PostgREST, e o Postgres do
 * Supabase converte `timestamp` sem offset usando a sessão em **UTC** — o erro
 * viraria 3 horas em vez de 1. Quem manda o offset é quem sabe o fuso (N-01).
 *
 * @param {string} txt
 * @returns {string|null}
 */
export function dataBubble(txt) {
  const p = partesData(txt);
  if (!p) return null;
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}T${pad(p.hora)}:${pad(p.minuto)}:${pad(p.segundo)}${offsetSaoPaulo(p)}`;
}

/**
 * "Apr 15, 2025 12:00 am" → "2025-04-15". Usar quando a hora é sempre 00:00.
 * Não passa por `Date`: converter meia-noite para timestamptz e voltar para
 * date desloca um dia (mapa/pessoas.md §10).
 *
 * @param {string} txt
 * @returns {string|null}
 */
export function dataBubbleDia(txt) {
  const p = partesData(txt);
  if (!p) return null;
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
}

/**
 * "R$ 1.234,56" / "1234.56" / "R$ -" / "" → Number ou null (T-MOEDA).
 *
 * Divergência deliberada do T-MOEDA de `mapa/negocios.md`: lá, "458.000" sem
 * vírgula vira 458 (o ponto é lido como decimal). Aqui, um valor que só casa
 * `\d{1,3}(\.\d{3})+` é milhar brasileiro — o destino é `numeric(14,2)` e não
 * existe dinheiro com 3 casas decimais, então ler 458 mil como 458 seria perder
 * o VGV por um fator de mil.
 *
 * @param {string} txt
 * @returns {number|null}
 */
export function dinheiro(txt) {
  let v = String(txt ?? "")
    .trim()
    .toLowerCase()
    .replace("r$", "")
    .replace(/\s/g, "");
  if (v === "" || v === "-") return null;
  if (v.includes(",") && v.includes("."))
    v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Número inteiro ou null. Mesma limpeza de `dinheiro` (aceita "1.234", "R$ 5").
 *
 * @param {string} txt
 * @returns {number|null}
 */
export function inteiro(txt) {
  const n = dinheiro(txt);
  return n === null ? null : Math.round(n);
}

/**
 * Telefone brasileiro → "55DDNNNNNNNNN", ou null.
 *
 * Espelha `public.normalize_phone` (`0001:125-141`) dígito a dígito — sem "+",
 * que é o formato que o banco inteiro usa (`deal_clients.phone` nasce de
 * `leads.phone`, saída da própria função). Só o `else d` da função fica de
 * fora, porque ele grava lixo. 12 e 13 dígitos começando em 55 são o mesmo
 * número com DDI: 55 + fixo de 10 e 55 + celular de 11. Qualquer outro tamanho
 * é descartado. Destino que precise de E.164 com "+" põe o "+" no chamador.
 *
 * Não usar para `leads.phone`: ali manda-se `phone_raw` com o texto original e
 * o gatilho `leads_normalize` deriva `phone` (mapa/leads.md §5.4).
 *
 * @param {string} txt
 * @returns {string|null}
 */
export function telefoneBR(txt) {
  const d = String(txt ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

/**
 * CPF → 11 dígitos, ou null.
 *
 * NUNCA completar com zero à esquerda (R-17): `zfill` no único valor de 10
 * dígitos produz um CPF com DV inválido que passa no check `^[0-9]{11}$` e
 * ocupa o unique parcial `profiles_cpf_key`, bloqueando o CPF verdadeiro.
 *
 * @param {string} txt
 * @returns {string|null}
 */
export function cpf(txt) {
  const d = String(txt ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

/**
 * Normalização para casar FK por nome (T-NOME).
 * NFKD sem acento, minúsculas, pontuação vira espaço, espaços colapsados.
 *
 * Pontuação vira espaço (e não some): "Ana-Maria" casa com "Ana Maria", que é
 * a variação real entre exports. Apagar a pontuação juntaria "J.R." e "JR" e
 * aumentaria a chance de falso positivo, exatamente o que R-08 cobra.
 *
 * @param {string} txt
 * @returns {string}
 */
export function normalizarNome(txt) {
  return String(txt ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .join(" ")
    .toLowerCase();
}

/**
 * E-mail de login. O GoTrue recusa acento antes do @ ("Unable to validate email
 * address: invalid format") e o provedor do domínio (KingHost) não cria caixa
 * com acento: o Bubble guardou o endereço como foi digitado. A conta nasce com
 * o mesmo endereço sem o acento — o resto do texto não muda.
 *
 * @param {string} txt
 * @returns {string}
 */
export function emailLogin(txt) {
  return String(txt ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

/**
 * Lista do Bubble separada por " , " → array já com trim. "" → [].
 * (Alguns arquivos usam ", " — leads §16. Este separador é o de `Equipes`.)
 *
 * @param {string} txt
 * @returns {string[]}
 */
export function listaBubble(txt) {
  const v = String(txt ?? "").trim();
  if (v === "") return [];
  return v
    .split(" , ")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/**
 * `unique id` do Bubble: 13 dígitos, "x", dígitos.
 *
 * @param {string} txt
 * @returns {boolean}
 */
export function ehIdBubble(txt) {
  return /^[0-9]{13}x[0-9]+$/.test(String(txt ?? "").trim());
}

// ── resolução de FK ──────────────────────────────────────────────────────────

/**
 * Resolvedor de referência do Bubble: aceita `unique id` (export reexportado)
 * ou nome de exibição (export "-modified").
 *
 * Com o JSON de 09/09 o ramo do id virou o caminho principal. O ramo do nome
 * NÃO sai daqui: `leadfies`, `Equipes`, `doc-clientes`, `vendas` e mais nove
 * entidades continuam só em CSV, e lá a referência ainda é nome.
 *
 * Igualdade exata do nome normalizado é o ÚNICO critério automático. Nome que
 * bate com mais de uma pessoa devolve `via="ambiguo"` e `id=null` — nunca
 * escolhe uma. Sem heurística de primeiro+último token: ela já casou
 * "fernanda lucas teixeira" com "Fernanda Cardoso Teixeira", 85 leads na mão
 * da corretora errada e sem marca que distinga do acerto (R-08).
 *
 * @param {object} cfg
 * @param {Map<string, string>} cfg.porId    `unique id` → id do destino
 * @param {Map<string, string|string[]>} cfg.porNome  nome normalizado → id, ou
 *   ARRAY com os ids quando duas pessoas normalizam para o mesmo nome. Guardar
 *   as duas é o que faz o resolvedor devolver "ambiguo" em vez de sortear.
 * @param {string} cfg.rotulo  nome da relação, só para o relatório
 * @returns {((valor: string) => {id: string|null, via: "id"|"nome"|"ambiguo"|"ausente"}) & {rotulo: string, contagem: Record<string, number>, pendencias: Map<string, number>, relatar: (rel: any) => void}}
 */
export function criarResolvedor({ porId, porNome, rotulo }) {
  const contagem = { id: 0, nome: 0, ambiguo: 0, ausente: 0 };
  const pendencias = new Map();

  const anotar = (via, valor) => {
    contagem[via]++;
    if (via === "id" || via === "nome" || !valor) return;
    pendencias.set(valor, (pendencias.get(valor) ?? 0) + 1);
  };

  const resolver = (valor) => {
    const bruto = String(valor ?? "").trim();
    if (bruto === "") {
      anotar("ausente", "");
      return { id: null, via: "ausente" };
    }
    if (ehIdBubble(bruto)) {
      const id = porId?.get(bruto);
      anotar(id ? "id" : "ausente", bruto);
      return { id: id ?? null, via: id ? "id" : "ausente" };
    }
    const achado = porNome?.get(normalizarNome(bruto));
    if (Array.isArray(achado)) {
      if (achado.length > 1) {
        anotar("ambiguo", bruto);
        return { id: null, via: "ambiguo" };
      }
      if (achado.length === 1) {
        anotar("nome", bruto);
        return { id: achado[0], via: "nome" };
      }
      anotar("ausente", bruto);
      return { id: null, via: "ausente" };
    }
    anotar(achado ? "nome" : "ausente", bruto);
    return { id: achado ?? null, via: achado ? "nome" : "ausente" };
  };

  resolver.rotulo = rotulo;
  resolver.contagem = contagem;
  resolver.pendencias = pendencias;
  resolver.relatar = (rel) => {
    for (const [via, n] of Object.entries(contagem))
      if (n) rel.conta(`${rotulo}:${via}`, n);
    const piores = [...pendencias.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    for (const [valor, n] of piores)
      rel.aviso(`${rotulo} não resolvido (${n}x): ${valor}`);
    if (pendencias.size > piores.length) {
      rel.aviso(
        `${rotulo}: mais ${pendencias.size - piores.length} valores distintos sem match`,
      );
    }
  };
  return resolver;
}

// ── Supabase ─────────────────────────────────────────────────────────────────

let clienteCache = null;

/** Falhas individuais seguidas com a mesma mensagem que provam erro sistêmico. */
const SISTEMICO = 10;

/**
 * Cliente supabase-js com service role. A URL sai do `.env` da raiz; a chave
 * sai só do ambiente — nunca de arquivo versionado.
 *
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function supa() {
  if (clienteCache) return clienteCache;

  let env = "";
  try {
    env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
  } catch {
    throw new Error("Sem .env na raiz — não sei qual é a URL do Supabase.");
  }
  const url = env.match(/^VITE_SUPABASE_URL="?([^"\r\n]+)"?/m)?.[1];
  if (!url) throw new Error("VITE_SUPABASE_URL não está no .env.");

  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    throw new Error(
      [
        "SUPABASE_SERVICE_ROLE_KEY não está no ambiente.",
        "Pegue em Supabase → Project Settings → API → service_role e rode:",
        '  $env:SUPABASE_SERVICE_ROLE_KEY = "..."     # PowerShell',
      ].join("\n"),
    );
  }

  // O @supabase/supabase-js 2.110 recusa subir sem `WebSocket` global, e o Node 20
  // só tem esse global atrás de `--experimental-websocket`. A importação inteira
  // fala por PostgREST e nunca abre Realtime, então um esboço que EXPLODE se
  // alguém tentar usar resolve sem esconder um uso indevido nem prender a carga a
  // uma flag de linha de comando que dá para esquecer. Sai quando o projeto subir
  // para o Node 22.
  if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = class {
      constructor() {
        throw new Error("Realtime não é usado na importação — este WebSocket é um esboço.");
      }
    };
  }

  clienteCache = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return clienteCache;
}

/**
 * Insere em blocos. Bloco que falha é reenviado linha a linha para isolar a
 * linha ruim, e o resto do lote continua.
 *
 * `onConflict` vira `ON CONFLICT … DO NOTHING`. **Índice PARCIAL exige o
 * predicado repetido** — `leads_external_id_idx` é
 * `unique … where external_id is not null` (`0005:83-84`) e sem o predicado o
 * Postgres devolve 42P10 e o bloco inteiro falha antes da primeira linha
 * (R-06). Ressalva medida: o parâmetro `on_conflict` do PostgREST aceita só
 * nomes de coluna, então uma carga que dependa do predicado tem de ir por SQL
 * (MCP como `postgres`) ou filtrar antes com `lerMapa`.
 *
 * Erro sistêmico (coluna inexistente, RLS, tabela errada) repete em toda linha:
 * o reenvio individual aborta depois de `SISTEMICO` falhas seguidas com a mesma
 * mensagem, em vez de gastar 102.799 round-trips para chegar no mesmo lugar.
 *
 * Em `--dry-run` não escreve nada e devolve a contagem que teria inserido.
 *
 * @param {string} tabela
 * @param {object[]} linhas
 * @param {{onConflict?: string, chunk?: number}} [opcoes]
 * @returns {Promise<{inseridos: number, erros: {indice: number, mensagem: string}[]}>}
 */
export async function inserirEmLote(
  tabela,
  linhas,
  { onConflict, chunk = 500 } = {},
) {
  if (linhas.length === 0) return { inseridos: 0, erros: [] };
  if (ehDryRun()) return { inseridos: linhas.length, erros: [] };

  const cliente = supa();
  // Com DO NOTHING a linha ignorada não volta: sem o select, o total mentiria.
  const enviar = (bloco) =>
    onConflict
      ? cliente
          .from(tabela)
          .upsert(bloco, { onConflict, ignoreDuplicates: true })
          .select()
      : cliente.from(tabela).insert(bloco);

  let inseridos = 0;
  const erros = [];
  for (let i = 0; i < linhas.length; i += chunk) {
    const bloco = linhas.slice(i, i + chunk);
    const { data, error } = await enviar(bloco);
    if (!error) {
      inseridos += onConflict ? (data?.length ?? 0) : bloco.length;
      continue;
    }
    let iguais = 0;
    let ultima = null;
    for (let j = 0; j < bloco.length; j++) {
      const r = await enviar([bloco[j]]);
      if (!r.error) {
        iguais = 0;
        inseridos += onConflict ? (r.data?.length ?? 0) : 1;
        continue;
      }
      erros.push({ indice: i + j, mensagem: r.error.message });
      iguais = r.error.message === ultima ? iguais + 1 : 1;
      ultima = r.error.message;
      if (iguais >= SISTEMICO)
        throw new Error(
          `inserirEmLote(${tabela}): ${iguais} linhas seguidas recusadas com a mesma mensagem — ` +
            `isso é erro de contrato, não linha ruim: ${r.error.message}`,
        );
    }
  }
  return { inseridos, erros };
}

/**
 * Grava o de-para em `public.import_bubble_map` (N-06). Reexecução não duplica:
 * a PK é `(entidade, bubble_id, tabela_destino)`.
 *
 * `registro_id` é `uuid not null` (`0096:56`): par sem id não é linha ruim que o
 * Postgres devolve como 23502 e a carga contorna — é chamador quebrado. Falha
 * aqui, antes da primeira requisição, com a contagem do que estava errado.
 *
 * @param {string} entidade
 * @param {{bubble_id: string, tabela_destino: string, registro_id: string}[]} pares
 * @returns {Promise<{inseridos: number, erros: {indice: number, mensagem: string}[]}>}
 */
export async function registrarMapa(entidade, pares) {
  const semId = pares.filter((p) => !p.registro_id);
  if (semId.length)
    throw new Error(
      `registrarMapa(${entidade}): ${semId.length} de ${pares.length} pares sem registro_id ` +
        `(ex.: bubble_id ${semId[0].bubble_id} → ${semId[0].tabela_destino}). ` +
        `import_bubble_map.registro_id é uuid NOT NULL — o de-para não registra "linha vista e não importada".`,
    );
  const linhas = pares.map((p) => ({
    entidade,
    bubble_id: p.bubble_id,
    [COL_TABELA]: p.tabela_destino,
    registro_id: p.registro_id,
  }));
  return inserirEmLote("import_bubble_map", linhas, {
    onConflict: `entidade,bubble_id,${COL_TABELA}`,
  });
}

/**
 * De-para já gravado: `bubble_id` → `registro_id`. É a trava de idempotência de
 * toda carga — nenhuma delas pode usar `count(*)` da tabela de destino, que já
 * traz seed e demo (R-02).
 *
 * @param {string} entidade
 * @param {string} tabelaDestino
 * @returns {Promise<Map<string, string>>}
 */
export async function lerMapa(entidade, tabelaDestino) {
  const cliente = supa();
  const mapa = new Map();
  const pagina = 1000; // teto padrão do PostgREST; acima disso ele trunca calado
  for (let de = 0; ; de += pagina) {
    const { data, error } = await cliente
      .from("import_bubble_map")
      .select("bubble_id, registro_id")
      .eq("entidade", entidade)
      .eq(COL_TABELA, tabelaDestino)
      // Sem ORDER BY o Postgres não garante ordem entre páginas: com
      // `synchronize_seqscans` ligado, duas páginas repetem e PULAM linhas, e o
      // bubble_id pulado faz o chamador reinserir. Com `entidade` e
      // `tabela_destino` fixados no filtro, `bubble_id` já é a ordem total da PK.
      .order("bubble_id")
      .range(de, de + pagina - 1);
    if (error)
      throw new Error(
        `lerMapa(${entidade}, ${tabelaDestino}): ${error.message}`,
      );
    for (const linha of data)
      if (linha.registro_id) mapa.set(linha.bubble_id, linha.registro_id);
    if (data.length < pagina) return mapa;
  }
}

// ── relatório e flags ────────────────────────────────────────────────────────

/**
 * Acumulador de contagens e avisos da carga.
 *
 * @param {string} titulo
 */
export function relatorio(titulo) {
  const contagens = new Map();
  const avisos = [];
  const inicio = Date.now();
  return {
    conta(chave, n = 1) {
      contagens.set(chave, (contagens.get(chave) ?? 0) + n);
    },
    aviso(txt) {
      avisos.push(String(txt));
    },
    imprimir() {
      const seg = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(
        `\n[${titulo}] ${ehDryRun() ? "DRY-RUN — nada gravado" : "concluído"} em ${seg}s`,
      );
      for (const [chave, n] of [...contagens].sort())
        console.log(`  ${chave}: ${n}`);
      // O que a lib viu e ninguém pediu: data ilegível e CSV de largura errada.
      // Sai aqui para nenhuma carga precisar lembrar de perguntar.
      for (const [chave, n] of [...anomalias].sort()) {
        const ex = exemploAnomalia.get(chave);
        console.log(`  ! lib:${chave}: ${n}${ex ? ` (ex.: ${ex})` : ""}`);
      }
      for (const txt of avisos.slice(0, 50)) console.log(`  ! ${txt}`);
      if (avisos.length > 50)
        console.log(`  ! (+${avisos.length - 50} avisos omitidos)`);
    },
  };
}

/** @returns {boolean} */
export function ehDryRun() {
  return process.argv.includes("--dry-run");
}

// ── autoteste ────────────────────────────────────────────────────────────────

async function autoteste() {
  // e-mail de login: só o acento sai
  assert.equal(emailLogin(" Luís.Silva@FaceImob.com.br "), "luis.silva@faceimob.com.br");
  assert.equal(emailLogin("joao_1@gmail.com"), "joao_1@gmail.com");

  // datas: os dois casos de relógio de 12h e o dia que não pode deslizar
  assert.equal(dataBubble("May 11, 2024 6:18 pm"), "2024-05-11T18:18:00-03:00");
  assert.equal(dataBubble("Jan 3, 2025 12:00 am"), "2025-01-03T00:00:00-03:00");
  assert.equal(dataBubble("Jan 3, 2025 12:00 pm"), "2025-01-03T12:00:00-03:00");
  assert.equal(
    dataBubble("Jul 25, 2025 10:34 am"),
    "2025-07-25T10:34:00-03:00",
  );
  assert.equal(dataBubbleDia("Apr 15, 2025 12:00 am"), "2025-04-15");
  assert.equal(dataBubbleDia("Dec 31, 2024 11:59 pm"), "2024-12-31");

  // horário de verão: -02:00 dentro da janela, -03:00 fora, na virada e em 1957
  assert.equal(dataBubble("Feb 1, 2017 12:00 am"), "2017-02-01T00:00:00-02:00");
  assert.equal(dataBubble("Oct 16, 2016 1:00 am"), "2016-10-16T01:00:00-02:00");
  assert.equal(
    dataBubble("Feb 17, 2019 12:00 am"),
    "2019-02-17T00:00:00-03:00",
  );
  assert.equal(dataBubbleDia("Sep 21, 1957 12:00 am"), "1957-09-21");

  // formatos brasileiros do corpo dos CSVs (mapa/leads.md §5.3)
  assert.equal(dataBubble("15/01/24 17:28:00"), "2024-01-15T17:28:00-03:00");
  assert.equal(dataBubble("02/01/24 18:37"), "2024-01-02T18:37:00-03:00");
  assert.equal(dataBubble("11/05/2024"), "2024-05-11T00:00:00-03:00");
  assert.equal(dataBubbleDia("07/03/24"), "2024-03-07");
  assert.equal(dataBubble("2026/02/11 09:14"), "2026-02-11T09:14:00-03:00");
  assert.equal(dataBubbleDia("2026/02/11"), "2026-02-11");
  assert.equal(dataBubbleDia("32/01/24"), null); // dia impossível

  // célula vazia é ausência legítima; texto que não casou é anomalia contada
  const antesData = anomaliasDaLib().get("data-em-formato-desconhecido") ?? 0;
  assert.equal(dataBubble(""), null);
  assert.equal(dataBubble("   "), null);
  assert.equal(
    anomaliasDaLib().get("data-em-formato-desconhecido") ?? 0,
    antesData,
  );
  assert.equal(dataBubble("ontem à tarde"), null);
  assert.equal(dataBubbleDia("lixo"), null);
  assert.equal(
    anomaliasDaLib().get("data-em-formato-desconhecido") ?? 0,
    antesData + 2,
  );

  // dinheiro
  assert.equal(dinheiro("R$ 1.234,56"), 1234.56);
  assert.equal(dinheiro("1234.56"), 1234.56);
  assert.equal(dinheiro("R$ 11.810,02"), 11810.02);
  assert.equal(dinheiro("458.000"), 458000); // milhar BR, não 458
  assert.equal(dinheiro("1.5"), 1.5);
  assert.equal(dinheiro("-2.000"), -2000);
  assert.equal(dinheiro("R$ -"), null);
  assert.equal(dinheiro(""), null);
  assert.equal(dinheiro("abc"), null);
  assert.equal(inteiro("1.234"), 1234);
  assert.equal(inteiro(""), null);

  // telefone: sem "+", idêntico a normalize_phone. 9 dígitos some, DDI 55 sobrevive
  assert.equal(telefoneBR("(51) 99999-8888"), "5551999998888");
  assert.equal(telefoneBR("51 3333-4444"), "555133334444");
  assert.equal(telefoneBR("999998888"), null); // 9 dígitos, sem DDD
  assert.equal(telefoneBR("5551999998888"), "5551999998888");
  assert.equal(telefoneBR("555133334444"), "555133334444");
  assert.equal(telefoneBR("+1 (305) 555 1234 9"), null);
  assert.equal(telefoneBR(""), null);

  // CPF: 10 dígitos vira null, nunca zfill (R-17)
  assert.equal(cpf("123.456.789-09"), "12345678909");
  assert.equal(cpf("1234567890"), null);
  assert.equal(cpf("123456789012"), null);
  assert.equal(cpf(""), null);

  // nomes
  assert.equal(normalizarNome("  JOSÉ   da Silva Ção "), "jose da silva cao");
  assert.equal(
    normalizarNome("José da Silva"),
    normalizarNome("JOSE DA SILVA"),
  );
  assert.equal(normalizarNome("Ana-Maria"), "ana maria");
  assert.equal(normalizarNome("Marco Antonio"), "marco antonio");

  // listas e ids
  assert.deepEqual(listaBubble("Suane Tossi , Jorge Giorgi Gadret"), [
    "Suane Tossi",
    "Jorge Giorgi Gadret",
  ]);
  assert.deepEqual(listaBubble(""), []);
  assert.deepEqual(listaBubble("Um só"), ["Um só"]);
  assert.equal(ehIdBubble("1780772620462x354212239768173300"), true);
  assert.equal(ehIdBubble("1780772620462"), false);
  assert.equal(ehIdBubble("Fernanda Teixeira"), false);

  // resolvedor: id, nome, ambíguo e ausente
  const r = criarResolvedor({
    porId: new Map([["1780772620462x354212239768173300", "uuid-a"]]),
    porNome: new Map([
      ["fernanda lucas teixeira", "uuid-b"],
      ["fernanda teixeira", ["uuid-c", "uuid-d"]],
    ]),
    rotulo: "corretor",
  });
  assert.deepEqual(r("1780772620462x354212239768173300"), {
    id: "uuid-a",
    via: "id",
  });
  assert.deepEqual(r("1780772620462x000000000000000000"), {
    id: null,
    via: "ausente",
  });
  assert.deepEqual(r("FERNANDA LUCAS TEIXEIRA"), { id: "uuid-b", via: "nome" });
  assert.deepEqual(r("Fernanda Teixeira"), { id: null, via: "ambiguo" });
  assert.deepEqual(r("Ninguém"), { id: null, via: "ausente" });
  assert.deepEqual(r(""), { id: null, via: "ausente" });
  assert.deepEqual(r.contagem, { id: 1, nome: 1, ambiguo: 1, ausente: 3 });

  // CSV: BOM, aspa escapada, vírgula e quebra de linha dentro do campo, CRLF
  const { writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const arquivo = join(tmpdir(), `bubble-autoteste-${process.pid}.csv`);
  const arquivoJson = join(tmpdir(), `bubble-autoteste-${process.pid}.json`);
  const dirTeste = join(tmpdir(), `bubble-autoteste-dirs-${process.pid}`);
  writeFileSync(
    arquivo,
    '﻿"nome","obs","unique id"\r\n' +
      '"Ana, a corretora","linha 1\nlinha 2","1780772620462x1"\r\n' +
      '"Bruno","aspas ""no meio""","1780772620462x2"\r\n' +
      '"Sem obs","","1780772620462x3"\r\n',
    "utf8",
  );
  try {
    const linhas = [];
    for await (const linha of lerCsv(arquivo)) linhas.push(linha);
    assert.equal(linhas.length, 3);
    assert.deepEqual(Object.keys(linhas[0]), ["nome", "obs", "unique id"]);
    assert.equal(linhas[0].nome, "Ana, a corretora");
    assert.equal(linhas[0].obs, "linha 1\nlinha 2");
    assert.equal(linhas[1].obs, 'aspas "no meio"');
    assert.equal(linhas[2].obs, "");
    assert.equal(await contarCsv(arquivo), 3);

    // largura diferente do cabeçalho: campo extra some, campo faltante vira "".
    // As duas continuam acontecendo, mas contadas.
    const larga = anomalias.get("csv-linha-mais-larga-que-o-cabecalho") ?? 0;
    const curta = anomalias.get("csv-linha-mais-curta-que-o-cabecalho") ?? 0;
    writeFileSync(arquivo, "a,b\n1,2,3\n4\n5,6\n", "utf8");
    assert.equal(await contarCsv(arquivo), 3);
    assert.equal(
      anomalias.get("csv-linha-mais-larga-que-o-cabecalho"),
      larga + 1,
    );
    assert.equal(
      anomalias.get("csv-linha-mais-curta-que-o-cabecalho"),
      curta + 1,
    );

    // arquivo truncado dentro de um campo citado: lança, não emite meia linha
    writeFileSync(arquivo, 'a,b\n"comeco de campo que nunca fecha', "utf8");
    await assert.rejects(() => contarCsv(arquivo), /aspas aberto/);

    // JSON: mesmo contrato do CSV — objeto por registro, valor sempre string,
    // célula vazia como "" e lista com o mesmo " , " (agora com id, não nome).
    writeFileSync(
      arquivoJson,
      JSON.stringify([
        {
          nome: "Ana",
          "CORRETOR 1": "1715490173191x117765087374868480",
          financeiro: "1715490173191x1 , 1715490173191x2",
          obs: "",
        },
        {
          nome: "Bruno",
          "CORRETOR 1": "",
          financeiro: "",
          obs: "linha 1\nlinha 2",
        },
      ]),
      "utf8",
    );
    const jl = [];
    for await (const linha of lerCsv(arquivoJson)) jl.push(linha);
    assert.equal(jl.length, 2);
    assert.deepEqual(Object.keys(jl[0]), [
      "nome",
      "CORRETOR 1",
      "financeiro",
      "obs",
    ]);
    assert.equal(jl[0].obs, ""); // célula vazia, não undefined
    assert.equal(ehIdBubble(jl[0]["CORRETOR 1"]), true);
    assert.deepEqual(listaBubble(jl[0].financeiro), [
      "1715490173191x1",
      "1715490173191x2",
    ]);
    assert.equal(jl[1].obs, "linha 1\nlinha 2");
    assert.equal(await contarCsv(arquivoJson), 2);

    // número e null do JSON não chegam como número e null no consumidor
    const naoTexto = anomalias.get("json-valor-nao-textual") ?? 0;
    writeFileSync(arquivoJson, '[{"a":1,"b":null,"c":"ok"}]', "utf8");
    for await (const linha of lerCsv(arquivoJson))
      assert.deepEqual(linha, { a: "1", b: "", c: "ok" });
    assert.equal(anomalias.get("json-valor-nao-textual"), naoTexto + 2);

    // JSON que não é o array esperado para, não importa metade
    writeFileSync(arquivoJson, '{"a":"b"}', "utf8");
    await assert.rejects(() => contarCsv(arquivoJson), /array de objetos/);
    writeFileSync(arquivoJson, '[["a","b"]]', "utf8");
    await assert.rejects(
      () => contarCsv(arquivoJson),
      /não é objeto de colunas/,
    );

    // localizar: o JSON do reexport vence o CSV do dia anterior; quem só tem
    // CSV continua achando o CSV; prefixo sem arquivo nenhum é erro, não null.
    const dirJson = join(dirTeste, "json");
    mkdirSync(dirJson, { recursive: true });
    writeFileSync(join(dirJson, "export_All-pipelines_2026-09-09.json"), "[]");
    writeFileSync(
      join(dirTeste, "export_All-pipelines-modified--_2026-09-08_19-43-56.csv"),
      "a\n",
    );
    writeFileSync(
      join(dirTeste, "export_All-Equipes-modified_2026-09-08_19-38-04.csv"),
      "a\n",
    );
    const dirs = [
      [dirJson, ".json"],
      [dirTeste, ".csv"],
    ];
    assert.equal(
      acharExport("export_All-pipelines", dirs),
      join(dirJson, "export_All-pipelines_2026-09-09.json"),
    );
    assert.equal(
      acharExport("export_All-Equipes", dirs),
      join(dirTeste, "export_All-Equipes-modified_2026-09-08_19-38-04.csv"),
    );
    assert.throws(
      () => acharExport("export_All-leadfies", dirs),
      /Nenhum export/,
    );

    // carimbo mais novo ganha; cópia sem carimbo não vence export carimbado
    const c1 = "export_All-Construtoras-modified_2026-09-08_19-36-44.csv";
    const c2 = "export_All-Construtoras-modified_2026-09-08_19-37-19.csv";
    assert.equal(maisNovoExport([c1, c2]), c2);
    assert.equal(maisNovoExport([c2, c1]), c2);
    assert.equal(maisNovoExport([c2, "export_All-Construtoras (1).csv"]), c2);
    assert.equal(
      maisNovoExport(["export_All-links.csv"]),
      "export_All-links.csv",
    );
    // JSON com hora e sem hora no mesmo dia: o com hora é o mais novo
    assert.equal(
      maisNovoExport(["x_2026-09-09.json", "x_2026-09-09_19-59-13.json"]),
      "x_2026-09-09_19-59-13.json",
    );
  } finally {
    rmSync(arquivo, { force: true });
    rmSync(arquivoJson, { force: true });
    rmSync(dirTeste, { force: true, recursive: true });
  }

  // de-para: par sem registro_id é chamador quebrado, não linha ruim (uuid NOT NULL)
  await assert.rejects(
    () =>
      registrarMapa("user", [
        {
          bubble_id: "1780772620462x1",
          tabela_destino: "profiles",
          registro_id: "uuid-a",
        },
        {
          bubble_id: "1780772620462x2",
          tabela_destino: "profiles",
          registro_id: null,
        },
      ]),
    /1 de 2 pares sem registro_id/,
  );

  // relatório não explode e não vaza nada
  const rel = relatorio("autoteste");
  rel.conta("linhas", 3);
  rel.aviso("exemplo");
  rel.imprimir();

  console.log("autoteste: OK");
}

if (
  process.argv.includes("--autoteste") &&
  process.argv[1]?.endsWith("bubble.mjs")
) {
  autoteste().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
