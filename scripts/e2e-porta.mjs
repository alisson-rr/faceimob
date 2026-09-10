/**
 * Limpa o servidor de desenvolvimento órfão da porta da suíte.
 *
 * POR QUE. `playwright.config.ts` sobe o Vite com `reuseExistingServer: false`
 * — e está certo: um servidor de outra execução serve código e variáveis de
 * ambiente antigos, e o teste passaria (ou falharia) por um motivo que não é o
 * do commit em teste. O efeito colateral é que qualquer processo esquecido na
 * porta derruba a suíte inteira com "http://localhost:5199 is already used",
 * uma mensagem que não diz o que fazer.
 *
 * E processo esquecido acontece o tempo todo aqui: execução morta no meio
 * (Ctrl+C, `taskkill`, agente encerrado) deixa o Vite filho vivo. Um desses
 * ficou 5 horas na porta 5199 em 05/09/2026 e queimou uma rodada de suíte.
 *
 * SEGURANÇA DISSO. Só é chamado DEPOIS de a trava (`e2e-lock.mjs`) ter sido
 * obtida — ou seja, não existe outra execução legítima da suíte neste
 * repositório. E a porta é a da SUÍTE (5199 por padrão, `E2E_PORT`), não a do
 * `npm run dev` de todo dia (8080): quem está ali é órfão nosso.
 *
 * ponytail: mata pelo dono da porta, sem conferir se o processo é mesmo um
 * Vite; evoluir se algum dia alguém usar a porta da suíte para outra coisa.
 */
import { execFileSync } from "node:child_process";
import { connect } from "node:net";

/** Alguém atende nesta porta? Resolve em ~300 ms, sem depender de ferramenta externa. */
export function portaOcupada(porta) {
  return new Promise((resolve) => {
    const socket = connect({ port: porta, host: "127.0.0.1" });
    const fim = (valor) => { socket.destroy(); resolve(valor); };
    socket.setTimeout(300);
    socket.once("connect", () => fim(true));
    socket.once("timeout", () => fim(false));
    socket.once("error", () => fim(false));
  });
}

/** PIDs escutando na porta. Vazio quando não dá para descobrir. */
function donosDaPorta(porta) {
  try {
    if (process.platform === "win32") {
      const saida = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const pids = new Set();
      for (const linha of saida.split(/\r?\n/)) {
        // "  TCP    127.0.0.1:5199   0.0.0.0:0   LISTENING   37240"
        const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(linha);
        if (m && Number(m[1]) === porta) pids.add(Number(m[2]));
      }
      return [...pids];
    }
    const saida = execFileSync("lsof", ["-ti", `tcp:${porta}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return saida.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/**
 * Libera a porta, se houver órfão. Devolve os PIDs encerrados.
 *
 * Falha em encerrar NÃO derruba nada: o Playwright vai reclamar da porta logo
 * em seguida com a mensagem dele, e aí o aviso impresso aqui é a pista.
 */
export async function liberarPorta(porta) {
  if (!(await portaOcupada(porta))) return [];

  const pids = donosDaPorta(porta);
  if (!pids.length) {
    console.log(
      `[e2e] a porta ${porta} está ocupada e não consegui descobrir por quem.\n` +
        "      Encerre o processo e rode de novo.",
    );
    return [];
  }

  const mortos = [];
  for (const pid of pids) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
      else process.kill(pid, "SIGKILL");
      mortos.push(pid);
    } catch {
      console.log(`[e2e] não consegui encerrar o PID ${pid} na porta ${porta}.`);
    }
  }
  if (mortos.length) {
    console.log(
      `[e2e] servidor órfão na porta ${porta} encerrado (PID ${mortos.join(", ")}) — sobra de uma execução interrompida.`,
    );
  }
  return mortos;
}
