import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type State = { erro: Error | null; componente: string | null };

/** Primeira linha da pilha de componentes: diz QUAL tela ou peça quebrou. */
const primeiroComponente = (pilha?: string | null): string | null =>
  pilha?.split("\n").map((linha) => linha.trim()).find(Boolean)?.replace(/^at\s+/, "") ?? null;

/**
 * Sem boundary, exceção de render ou chunk de rota velho (deploy no meio do
 * uso) vira tela branca sem saída. O botão recarrega a página inteira, o que
 * baixa o bundle novo e resolve os dois casos.
 *
 * Quando recarregar não resolve (06/10/2026: uma usuária só, em qualquer
 * navegador), o erro é de dado dela, e "algo deu errado" não diz qual. Os
 * detalhes aparecem na tela para o print chegar ao suporte, e "Sair e entrar"
 * troca a sessão sem depender de a tela funcionar.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { erro: null, componente: null };

  static getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro não tratado na interface:", error, info.componentStack);
    this.setState({ componente: primeiroComponente(info.componentStack) });
  }

  private sair = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.assign("/login");
    }
  };

  render() {
    const { erro, componente } = this.state;
    if (erro) {
      return (
        <div className="min-h-screen grid place-items-center bg-background p-6 text-center">
          <div className="space-y-3 max-w-md">
            <p className="text-sm font-semibold text-foreground">Algo deu errado</p>
            <p className="text-xs text-muted-foreground">
              A tela encontrou um erro inesperado. Recarregar resolve na maioria
              dos casos — inclusive logo após uma atualização do sistema.
            </p>
            <div className="flex justify-center gap-2">
              <Button size="sm" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
              <Button size="sm" variant="outline" onClick={() => void this.sair()}>
                Sair e entrar de novo
              </Button>
            </div>
            <details className="rounded-lg border border-border bg-muted/30 p-2 text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Detalhes para o suporte</summary>
              <p className="mt-2 break-words font-mono">{erro.name}: {erro.message}</p>
              {componente && <p className="mt-1 break-words font-mono">em {componente}</p>}
              <p className="mt-1 break-words font-mono">tela {window.location.pathname}</p>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
