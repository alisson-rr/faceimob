import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { pageTitleFor } from "@/components/layout/navigation";
import { Outlet, useLocation } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { EngagementLayer, SoundToggle } from "@/components/engagement";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import NotificationBell from "@/components/NotificationBell";
import { BrandMotif } from "@/components/shared/BrandMotif";

import { useAuth } from "@/contexts/AuthContext";
import { Trophy } from "lucide-react";
import { useGameRanking } from "@/hooks/useGameRanking";
import { cn } from "@/lib/utils";
import { podiumTextClass } from "@/lib/tone";

export default function AppLayout() {
  const location = useLocation();
  const pageTitle = pageTitleFor(location.pathname);
  const { user, profile } = useAuth();
  const { scoped, meuScore, minhaPosicao, recorte } = useGameRanking();

  const me = profile
    ? { name: profile.name, avatar_url: profile.avatar_url }
    : user
      ? {
          name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Usuário",
          avatar_url: user.user_metadata?.avatar_url || null,
        }
      : null;

  // A tira do cabecalho espelha o card do Pipeline, e agora pela MESMA regra
  // (`recorteDoRanking`, em useGameRanking). A condicao daqui era
  // `scoped.length === 1`, que nunca acontece: o corretor recebe do servidor a
  // equipe ATIVA inteira, entao ele caia no `else` e via o podio da equipe no
  // cabecalho enquanto o card do Pipeline lhe mostrava a propria colocacao —
  // duas telas, duas regras, e nenhuma delas escrita num lugar so.
  //
  // `minhaPosicao` nula = quem ainda nao pontuou na temporada. A tira fica
  // vazia: escrever "0º" inventaria uma colocacao que o placar nao tem.
  const headerScores = recorte.soMinhaPosicao
    ? (meuScore && minhaPosicao !== null ? [{ ...meuScore, rank: minhaPosicao }] : [])
    : scoped.slice(0, 3).map((s, i) => ({ ...s, rank: i + 1 }));

  return (
    // `reducedMotion="user"` desliga a animacao do framer-motion para quem pediu
    // menos movimento no sistema; o bloco @media de `index.css` cobre o CSS.
    <MotionConfig reducedMotion="user">
      <SidebarProvider style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}>
        <EngagementLayer>
        <AppSidebar />
        <SidebarInset>
          {/* `overflow-visible`, nao `hidden`: o painel do sino e `absolute` dentro
              deste header de 64 px, e o `hidden` deixava 9 px visiveis de 363 —
              clicar no sino parecia nao fazer nada. Nada mais aqui depende do
              corte: o titulo tem `min-w-0 truncate`, o BrandMotif tem
              `overflow-hidden` proprio e a tira de ranking tambem. Trocar para
              `position: fixed` no painel nao resolveria: o `backdrop-blur` da
              `.glass` faz deste header um containing block. */}
          <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 overflow-visible border-b border-border px-4 sm:px-6">
            <BrandMotif className="opacity-25" />

            <SidebarTrigger className="relative shrink-0 md:hidden" />
            {/* Rotulo da barra, nao o titulo do documento: cada tela tem o
                proprio <h1> (via PageHeader). Dois <h1> na pagina quebram a
                navegacao por cabecalho do leitor de tela.

                O titulo e QUEM CEDE quando falta largura. Ele tinha `shrink-0`
                junto com `truncate`, e `shrink-0` anula o `truncate`: a caixa
                nunca encolhia, entao o excesso saia pela direita e o
                `overflow-hidden` do header cortava o sino e o avatar em
                silencio — sem barra de rolagem para denunciar (handoff-J §3.4).
                Titulo maior, como "Esteira CCA", cortava mais. */}
            <p className="relative min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
              {pageTitle}
            </p>

            <div className="relative mx-auto hidden items-center gap-2 overflow-hidden lg:flex">
              {headerScores.map((s) => (
                <div
                  key={s.broker.id}
                  className="interactive ease-premium flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 hover:border-primary/40"
                >
                  <span className="text-xs font-bold tabular-nums text-primary">{s.rank}º</span>
                  {/* `rank` da tira é 1º, 2º, 3º; o pódio de `@/lib/tone` é base 0. */}
                  <Trophy className={cn("h-3.5 w-3.5", podiumTextClass(s.rank - 1))} aria-hidden />
                  <span className="max-w-[140px] truncate text-xs font-medium">{s.broker.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{s.points} pts</span>
                </div>
              ))}
            </div>

            <div className="relative ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <SoundToggle />
              <RoleSwitcher />
              <NotificationBell />
              {/* `lg`, nao `sm`: a faixa apertada e 768-1023 px — a lateral de
                  224 px ja abriu e sobram 496 px de barra. O bloco da direita e
                  `shrink-0` e mede ~460 px com o nome ligado, entao quem cede e
                  o titulo (`min-w-0 truncate`): sobrava largura para meia
                  palavra. O avatar ao lado e a lateral continuam dizendo quem
                  esta logado. */}
              <span className="hidden text-xs tracking-tight text-muted-foreground lg:block">
                {me?.name || user?.email || "Usuário"}
              </span>
              {me?.avatar_url ? (
                <img
                  src={me.avatar_url}
                  alt=""
                  className="h-8 w-8 rounded-full border border-primary/30 object-cover"
                />
              ) : (
                <div
                  aria-hidden
                  className="grid h-8 w-8 place-items-center rounded-full border border-primary/30 bg-primary/15 text-xs font-bold text-primary"
                >
                  {(me?.name || user?.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </header>

          <div className="gradient-premium flex-1">
            <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
              <div className="animate-fade-in">
                <Outlet />
              </div>
            </div>
          </div>
        </SidebarInset>
        </EngagementLayer>
      </SidebarProvider>
    </MotionConfig>
  );
}
