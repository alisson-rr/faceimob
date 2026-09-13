import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppLayout from "./AppLayout";

/**
 * Duas correções de desempenho que nenhum outro teste enxerga, porque o jsdom
 * não mede layout nem pintura:
 *
 *   1. O menu aberto pelo hover passa POR CIMA do conteúdo. O espaçador fica na
 *      largura do ícone e não anima a largura; só o Ctrl+B (fixado) empurra a
 *      página. Animar a largura do espaçador repintava a tela inteira por
 *      quadro e travava Pipeline e Leads.
 *   2. O Suspense em volta do Outlet: tela ainda baixando mostra "Carregando..."
 *      só no miolo, com menu e cabeçalho na tela.
 *
 * O que se confere são as classes que o Tailwind transforma nesse layout.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "eu", email: "eu@faceimob.test", user_metadata: {} }, profile: null, can: () => true, signOut: async () => undefined }),
}));
vi.mock("@/hooks/useGameRanking", () => ({
  useGameRanking: () => ({ scoped: [], meuScore: null, minhaPosicao: null, recorte: { soMinhaPosicao: false } }),
}));
vi.mock("@/components/engagement", () => ({
  EngagementLayer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SoundToggle: () => null,
}));
vi.mock("@/components/RoleSwitcher", () => ({ RoleSwitcher: () => null }));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/shared/Logo", () => ({ Logo: () => null }));

// jsdom não tem matchMedia; 1024 px de largura = desktop no `useIsMobile`.
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
}));

/** Tela lazy que nunca termina de baixar. */
const TelaBaixando = lazy(() => new Promise<never>(() => {}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      // Igual ao App: há um Suspense de tela cheia por fora.
      <Suspense fallback={<p>APP INTEIRO CARREGANDO</p>}>
        <MemoryRouter initialEntries={["/pipeline"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/pipeline" element={<TelaBaixando />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </Suspense>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const menu = () => container.querySelector<HTMLElement>('[data-variant="sidebar"][data-side="left"]')!;
const espacador = () => menu().children[0] as HTMLElement;
const painel = () => menu().children[1] as HTMLElement;
const classes = (el: HTMLElement) => el.className.split(/\s+/);

const ctrlB = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
  });
const avancar = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("AppLayout", () => {
  it("tela ainda baixando: só o miolo mostra Carregando, menu e cabeçalho ficam", () => {
    expect(container.textContent).not.toContain("APP INTEIRO CARREGANDO");
    expect(container.querySelector("header")).not.toBeNull();
    expect(menu()).not.toBeNull();
    expect(container.querySelector("main [role=status]")?.textContent).toBe("Carregando...");
  });

  it("hover abre o menu por cima sem mexer na largura da página; Ctrl+B empurra", () => {
    // O espaçador está no fluxo da página: animar a largura dele repinta tudo.
    expect(espacador().className).not.toMatch(/transition/);

    ctrlB();
    expect(menu().dataset.state).toBe("collapsed");

    // Hover: abre depois de 350 ms, por cima (espaçador na largura do ícone).
    act(() => {
      painel().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    avancar(349);
    expect(menu().dataset.state).toBe("collapsed");
    avancar(1);
    expect(menu().dataset.state).toBe("expanded");
    expect(classes(espacador())).toContain("w-[--sidebar-width-icon]");
    expect(classes(painel())).toContain("z-40");

    // Saída: fecha em 500 ms e continua por cima durante a animação de 500 ms.
    act(() => {
      painel().dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    avancar(500);
    expect(menu().dataset.state).toBe("collapsed");
    expect(classes(painel())).toContain("z-40");
    avancar(500);
    expect(classes(painel())).toContain("z-10");

    // Fixado pelo Ctrl+B: não pode ter ficado preso no modo por cima.
    ctrlB();
    expect(menu().dataset.state).toBe("expanded");
    expect(classes(espacador())).toContain("w-[--sidebar-width]");
    expect(classes(espacador())).not.toContain("w-[--sidebar-width-icon]");
    expect(classes(painel())).toContain("z-10");
  });
});
