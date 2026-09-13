import { createRoot } from "react-dom/client";
// Fontes variaveis servidas pelo proprio bundle: uma requisicao a menos e
// nenhuma dependencia do Google Fonts para a tela abrir com a tipografia certa.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/dm-sans";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "@/lib/push";

/**
 * Tema aplicado ANTES do React montar.
 *
 * A classe `.light` so era escrita pelo efeito do `useTheme`, e o unico
 * componente que chamava esse hook era a barra lateral — que so existe dentro
 * do AppLayout. Resultado: Login, 404, Diario e Checkpoint publico abriam
 * sempre no escuro, mesmo com o tema claro salvo. Aqui tambem mata o flash
 * escuro-para-claro no primeiro quadro. O `useTheme` continua dono da troca.
 */
if (localStorage.getItem("faceimob-theme") === "light") {
  document.documentElement.classList.add("light");
}

// Service worker só de notificação push (sem cache): precisa estar ativo antes
// de a pessoa ligar os avisos em Configurações.
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
