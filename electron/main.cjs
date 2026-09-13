const { app, BrowserWindow, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

/**
 * O app é servido por um protocolo próprio, e não por `file://`.
 *
 * O build do Vite (`base: "/"`) referencia tudo por caminho absoluto —
 * `/assets/…`, `/senna.weba`, os ícones — e o roteador é `BrowserRouter`. Por
 * `file://`, `/assets/x.js` virava `file:///C:/assets/x.js` e a rota lida era
 * `/C:/…/dist/index.html`: a janela abria em branco (conferido em 12/09/2026,
 * `#root` sem filho nenhum). Em `app://faceimob/` a raiz do site é `dist/`, e
 * caminho que não é arquivo devolve o `index.html` — o fallback de SPA que o
 * servidor web faz.
 *
 * `standard` + `secure` dão uma origem de verdade (sessão do Supabase no
 * localStorage, módulos ES); `supportFetchAPI` libera o `fetch` do próprio app
 * (o `UpdateNotifier`); `stream` é o que deixa `<audio>` tocar a faixa daqui.
 */
const SCHEME = "app";
const HOST = "faceimob";
const DIST = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// No Windows a notificação do sistema (a `Notification` da página; push não
// roda no Electron, ver `src/lib/push.ts`) sai em nome do AppUserModelID; sem
// ele o Windows pode descartá-la calado.
// Id fixo: se trocar, o Windows trata como outro app e perde as preferências
// de notificação que a pessoa já deu. Se um dia houver instalador
// (electron-builder), o `appId` dele precisa ser este mesmo valor.
if (process.platform === "win32") app.setAppUserModelId("br.com.faceimob.crm");

async function servirDist(request) {
  const { host, pathname } = new URL(request.url);
  if (host !== HOST) return new Response("Not found", { status: 404 });

  // Decodifica antes de resolver: `..%2f` também sobe pasta, e o parser de URL
  // não normaliza a barra codificada. Fora de `dist/` é recusado antes do disco.
  let relativo;
  try {
    relativo = decodeURIComponent(pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const alvo = path.join(DIST, relativo);
  const dentro = path.relative(DIST, alvo);
  if (dentro === ".." || dentro.startsWith(`..${path.sep}`) || path.isAbsolute(dentro)) {
    return new Response("Forbidden", { status: 403 });
  }

  const ehArquivo = await fs.promises.stat(alvo).then((info) => info.isFile(), () => false);
  return net.fetch(pathToFileURL(ehArquivo ? alvo : path.join(DIST, "index.html")).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0F0E19",
    title: "CRM Faceimob",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`${SCHEME}://${HOST}/`);

  // Links externos abrem no navegador — só esquemas de navegação comuns:
  // `openExternal` com `file:` ou esquema de sistema vindo da página é execução
  // local de graça para qualquer XSS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, servirDist);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
