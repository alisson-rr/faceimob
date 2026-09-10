import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Sem boundary, exceção de render ou chunk de rota velho (deploy no meio do
 * uso) vira tela branca sem saída. O botão recarrega a página inteira, o que
 * baixa o bundle novo e resolve os dois casos.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro não tratado na interface:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center bg-background p-6 text-center">
          <div className="space-y-3 max-w-sm">
            <p className="text-sm font-semibold text-foreground">Algo deu errado</p>
            <p className="text-xs text-muted-foreground">
              A tela encontrou um erro inesperado. Recarregar resolve na maioria
              dos casos — inclusive logo após uma atualização do sistema.
            </p>
            <Button size="sm" onClick={() => window.location.reload()}>
              Recarregar
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
