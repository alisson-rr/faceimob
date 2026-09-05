/**
 * Trava de execução única da suíte E2E.
 *
 * POR QUE ELA EXISTE. Os dez usuários da suíte têm identidade FIXA
 * (`provisionE2EUsers()`) e o `global-teardown` os APAGA no fim. Duas execuções
 * ao mesmo tempo contra o mesmo alvo — dois terminais, um agente e uma pessoa,
 * ou vários agentes em paralelo — se atropelam: a faxina de uma remove as
 * contas e as duas equipes que a outra ainda está usando, e a segunda falha
 * com "a sessão não foi aceita pelo app". O sintoma aponta para o produto; a
 * causa é ambiente.
 *
 * COMO. `mkdir` é atômico em NTFS e em POSIX: quem consegue criar o diretório
 * é o dono da trava. Dentro dele fica o PID, para uma execução morta (Ctrl+C,
 * `taskkill`, terminal fechado no X — os mesmos casos em que o teardown também
 * não roda) não deixar a trava presa para sempre.
 *
 * A trava vive em `os.tmpdir()` e é derivada do caminho do repositório: dois
 * clones diferentes não disputam a mesma trava, e nada suja a árvore de trabalho.
 *
 * ponytail: espera em laço com intervalo fixo, sem notificação entre processos;
 * evoluir se a fila passar de uns poucos participantes.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

const INTERVALO_MS = 5_000;
/** Teto do tempo de espera. A suíte inteira leva ~10 min; três na frente ainda cabem. */
const ESPERA_MAX_MS = 60 * 60_000;
/** Sem sinal de vida por mais que isto, a trava é considerada abandonada. */
const BATIMENTO_MAX_MS = 3 * 60_000;

const pastaDaTrava = () => {
  const chave = createHash("sha1").update(process.cwd().toLowerCase()).digest("hex").slice(0, 12);
  return join(tmpdir(), `faceimob-e2e-${chave}.lock`);
};

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** O processo dono ainda existe? `signal 0` não envia nada, só testa. */
const vivo = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = existe e é de outro usuário; ESRCH = não existe.
    return e?.code === "EPERM";
  }
};

const leDono = (pasta) => {
  try {
    return JSON.parse(readFileSync(join(pasta, "dono.json"), "utf8"));
  } catch {
    return null;
  }
};

/**
 * Segura a trava até `liberar()`. Devolve a função de liberação.
 *
 * O batimento é reescrito enquanto a suíte roda: sem ele, uma execução longa e
 * legítima seria confundida com trava abandonada por quem espera.
 */
export async function travar({ silencioso = false } = {}) {
  const pasta = pastaDaTrava();
  const inicio = Date.now();
  let avisou = false;

  for (;;) {
    try {
      mkdirSync(pasta, { recursive: false });
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;

      const dono = leDono(pasta);
      const parado = !dono || (!vivo(dono.pid) && Date.now() - (dono.batimento ?? 0) > BATIMENTO_MAX_MS);
      if (parado) {
        if (!silencioso) {
          console.log(`[e2e] trava abandonada por ${dono?.pid ?? "processo desconhecido"} — assumindo.`);
        }
        rmSync(pasta, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - inicio > ESPERA_MAX_MS) {
        throw new Error(
          `[e2e] esperei ${Math.round(ESPERA_MAX_MS / 60_000)} min pela execução ${dono.pid} e ela não terminou.\n` +
            `  Se ela morreu de verdade, apague ${pasta} e rode de novo.`,
        );
      }
      if (!avisou && !silencioso) {
        avisou = true;
        console.log(
          `[e2e] outra execução (PID ${dono.pid}) está usando o alvo — os dez usuários da suíte são os\n` +
            "      mesmos e a faxina dela apagaria os seus. Esperando a vez...",
        );
      }
      await dorme(INTERVALO_MS);
    }
  }

  const escreveDono = () =>
    writeFileSync(
      join(pasta, "dono.json"),
      JSON.stringify({ pid: process.pid, desde: inicio, batimento: Date.now() }),
    );
  escreveDono();

  const batida = setInterval(() => {
    try {
      escreveDono();
    } catch {
      // A trava sumiu (alguém a apagou à mão). Não vale derrubar a suíte por isso.
    }
  }, 30_000);
  batida.unref?.();

  let liberada = false;
  const liberar = () => {
    if (liberada) return;
    liberada = true;
    clearInterval(batida);
    try {
      rmSync(pasta, { recursive: true, force: true });
    } catch {
      // Já removida: nada a fazer.
    }
  };

  // Ctrl+C e `process.exit()` também soltam a trava — é justamente a saída
  // abrupta que deixaria a próxima execução esperando uma hora à toa.
  process.on("exit", liberar);
  for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sinal, () => {
      liberar();
      process.exit(130);
    });
  }

  return liberar;
}
