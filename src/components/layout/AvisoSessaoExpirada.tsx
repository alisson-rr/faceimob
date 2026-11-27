import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sessaoContinuaValida } from "@/lib/sessaoNoServidor";

/**
 * O `signOut` do contexto devolve erro e mantém a sessão quando a renovação
 * falhou por rede ou 5xx — justamente o caso deste aviso. Aqui a pessoa pediu
 * para entrar de novo: tenta sair pelo servidor, limpa o login guardado neste
 * navegador e recarrega no /login.
 */
async function entrarDeNovo() {
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  try {
    for (const chave of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token$/.test(chave)) localStorage.removeItem(chave);
    }
  } catch { /* storage bloqueado: o /login ainda pede a senha */ }
  window.location.assign("/login");
}

const INTERVALO_MS = 60_000;
const NOVA_TENTATIVA_MS = 5_000;

/**
 * Aviso no topo quando o login caiu no servidor e a tela continua aberta.
 * Confere a cada minuto e na volta à aba; uma falha só vira aviso se a segunda
 * conferência, 5 s depois, também falhar (rede piscando não assusta ninguém).
 * Some sozinho quando o login volta a valer.
 */
export function AvisoSessaoExpirada() {
  const { session } = useAuth();
  const [expirada, setExpirada] = useState(false);

  useEffect(() => {
    if (!session) return;
    let ativo = true;
    let novaTentativa: ReturnType<typeof setTimeout> | undefined;

    const conferir = async () => {
      if (await sessaoContinuaValida(supabase.auth)) {
        if (ativo) setExpirada(false);
        return;
      }
      clearTimeout(novaTentativa);
      novaTentativa = setTimeout(async () => {
        const valida = await sessaoContinuaValida(supabase.auth);
        if (ativo) setExpirada(!valida);
      }, NOVA_TENTATIVA_MS);
    };
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void conferir();
    };

    void conferir();
    const intervalo = setInterval(() => void conferir(), INTERVALO_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      ativo = false;
      clearInterval(intervalo);
      clearTimeout(novaTentativa);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [session]);

  if (!session || !expirada) return null;

  return (
    <div
      role="alert"
      className="sticky top-16 z-20 flex flex-wrap items-center justify-center gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-2.5 text-sm"
    >
      <span className="font-semibold text-destructive">
        Sua sessão expirou. Entre de novo para ver seu turno, sua fila e receber leads.
      </span>
      <Button size="sm" variant="destructive" onClick={() => void entrarDeNovo()}>
        <LogIn className="mr-1.5 h-4 w-4" aria-hidden /> Entrar de novo
      </Button>
    </div>
  );
}
