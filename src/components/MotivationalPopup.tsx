import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Rocket, TrendingUp, Star, Target, Zap, Trophy, Cake, FileCheck2, Music } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { playSound } from "@/lib/engagement/audio";
import { fireConfetti } from "@/components/engagement/Confetti";
import { saudacao } from "@/components/leads/mensagensProntas";
import { useMeuApelido } from "@/components/leads/mensagensProntasData";
import { num } from "@/lib/format";

const messages = [
  { icon: Rocket, title: "Hora de Decolar! 🚀", text: "Cada lead é uma oportunidade. Vamos transformar contatos em contratos hoje!" },
  { icon: TrendingUp, title: "Rumo ao Topo! 📈", text: "Os melhores corretores fazem mais uma ligação. Seja esse corretor!" },
  { icon: Star, title: "Você é Estrela! ⭐", text: "Sua dedicação faz a diferença. Continue brilhando nas vendas!" },
  { icon: Target, title: "Foco na Meta! 🎯", text: "A meta está ao seu alcance. Cada proposta te aproxima do objetivo!" },
  { icon: Zap, title: "Energia Total! ⚡", text: "Comece o dia com energia! O mercado imobiliário espera por você!" },
  { icon: Trophy, title: "Campeão de Vendas! 🏆", text: "Lembre-se: disciplina supera talento. Você está no caminho certo!" },
];

// RPCs da 0196, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;
type Aniversariante = { profile_id: string; nome: string; avatar_url: string | null };

const hojeLocal = () => new Date().toLocaleDateString("sv-SE");

/** Primeira vez no dia para este usuário? Storage bloqueado não abre de novo a cada tela. */
function primeiraVezHoje(userId: string): boolean {
  try {
    const chave = `faceimob-boas-vindas:${userId}`;
    if (localStorage.getItem(chave) === hojeLocal()) return false;
    localStorage.setItem(chave, hojeLocal());
    return true;
  } catch {
    return false;
  }
}

const iniciais = (nome: string) => nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/**
 * Boas-vindas (pedido de 03/10/2026): "Bem-vindo, <apelido>" com a mensagem do
 * dia, o parabéns para quem faz aniversário hoje (com confete e o "Parabéns pra
 * você"), o aviso a todos de quem é o aniversariante e, para o gerente, quantas
 * análises esperam a conferência dele para seguir ao CCA.
 *
 * Abre logo depois do login (`faceimob-just-logged`, gravado pelo Login) ou no
 * primeiro acesso do dia — a sessão dura dias, e o aniversariante não precisa
 * sair e entrar para ver o parabéns.
 */
export function MotivationalPopup() {
  const navigate = useNavigate();
  const { user, roles } = useAuth();
  const apelido = useMeuApelido();
  const [open, setOpen] = useState(false);
  const [msg] = useState(() => messages[Math.floor(Math.random() * messages.length)]);
  const gerente = roles.includes("manager");

  const aniversariantes = useQuery({
    queryKey: ["boas-vindas", "aniversariantes", hojeLocal()],
    queryFn: async (): Promise<Aniversariante[]> => {
      const { data, error } = await untyped.rpc("aniversariantes_de_hoje");
      if (error) throw error;
      return (data ?? []) as Aniversariante[];
    },
    enabled: open,
    staleTime: 60 * 60_000,
  });
  const conferencias = useQuery({
    queryKey: ["boas-vindas", "conferencias", user?.id ?? null],
    queryFn: async (): Promise<number> => {
      const { data, error } = await untyped.rpc("minhas_conferencias_pendentes");
      if (error) throw error;
      return Number(data) || 0;
    },
    enabled: open && gerente,
  });

  useEffect(() => {
    if (!user?.id) return;
    let logou = false;
    try {
      logou = sessionStorage.getItem("faceimob-just-logged") === "true";
      if (logou) sessionStorage.removeItem("faceimob-just-logged");
    } catch { /* storage bloqueado: segue pela regra do dia */ }
    const deHoje = primeiraVezHoje(user.id);
    if (!logou && !deHoje) return;
    const timer = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(timer);
  }, [user?.id]);

  const lista = aniversariantes.data ?? [];
  const souAniversariante = lista.some((a) => a.profile_id === user?.id);
  const outros = lista.filter((a) => a.profile_id !== user?.id);
  const pendentes = conferencias.data ?? 0;

  // Festa uma vez quando os dados chegam: aniversário com fogos e música,
  // análise à espera com uma chuva de confete ("negócio à vista").
  useEffect(() => {
    if (!open) return;
    if (souAniversariante) {
      fireConfetti("fireworks");
      playSound("birthday");
    } else if (pendentes > 0) {
      fireConfetti("rain");
    }
  }, [open, souAniversariante, pendentes]);

  const Icon = souAniversariante ? Cake : msg.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Destaque em âmbar, não mais o azul `glow-primary`: brilho só no escuro
          (`.light .glow-highlight` zera), ícone em `gold` porque `highlight` em
          traço some no claro. */}
      <DialogContent className="glass-strong glow-highlight max-w-sm text-center">
        <DialogTitle className="sr-only">Boas-vindas</DialogTitle>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="flex flex-col items-center gap-4 py-4"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-highlight/20"
              >
                <Icon className="h-8 w-8 text-gold" aria-hidden />
              </motion.div>

              {souAniversariante ? (
                <>
                  <h3 className="text-xl font-bold text-foreground">🎂 Feliz aniversário, {apelido}!</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Hoje o dia é seu! Toda a família Faceimob deseja muita saúde, alegria e muitas vendas. 🎉🥳
                  </p>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => playSound("birthday", { manual: true })}>
                    <Music className="h-4 w-4" aria-hidden /> Tocar o parabéns
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-foreground">{saudacao()}, {apelido}! 👋</h3>
                  <p className="text-sm font-semibold text-foreground">{msg.title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{msg.text}</p>
                </>
              )}

              {outros.length > 0 && (
                <section className="w-full rounded-xl border border-gold/40 bg-gold/10 p-3 text-left" aria-label="Aniversariantes de hoje">
                  <p className="mb-2 text-sm font-semibold">🎉 Hoje é aniversário de:</p>
                  <ul className="space-y-1.5">
                    {outros.map((a) => (
                      <li key={a.profile_id} className="flex items-center gap-2 text-sm">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={a.avatar_url || undefined} alt="" />
                          <AvatarFallback className="text-xs">{iniciais(a.nome)}</AvatarFallback>
                        </Avatar>
                        {a.nome}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">Mande os parabéns! 🎂</p>
                </section>
              )}

              {gerente && pendentes > 0 && (
                <section className="w-full rounded-xl border border-success/40 bg-success/10 p-3 text-left" aria-label="Análises para conferir">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <FileCheck2 className="h-4 w-4 text-success" aria-hidden /> 💰 Negócio à vista!
                  </p>
                  <p className="mt-1 text-sm">
                    Você tem <strong>{num(pendentes)}</strong> {pendentes === 1 ? "análise" : "análises"} para conferir e mandar ao CCA.
                  </p>
                  <Button
                    size="sm" className="mt-2 w-full"
                    onClick={() => { setOpen(false); navigate("/pipeline?conferencia=pendente"); }}
                  >
                    Conferir agora
                  </Button>
                </section>
              )}

              <Button variant="highlight" onClick={() => setOpen(false)} className="mt-2">
                Bora Vender! 💪
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
