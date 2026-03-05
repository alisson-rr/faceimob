import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket, TrendingUp, Star, Target, Zap, Trophy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const messages = [
  { icon: Rocket, title: "Hora de Decolar! 🚀", text: "Cada lead é uma oportunidade. Vamos transformar contatos em contratos hoje!" },
  { icon: TrendingUp, title: "Rumo ao Topo! 📈", text: "Os melhores corretores fazem mais uma ligação. Seja esse corretor!" },
  { icon: Star, title: "Você é Estrela! ⭐", text: "Sua dedicação faz a diferença. Continue brilhando nas vendas!" },
  { icon: Target, title: "Foco na Meta! 🎯", text: "A meta está ao seu alcance. Cada proposta te aproxima do objetivo!" },
  { icon: Zap, title: "Energia Total! ⚡", text: "Comece o dia com energia! O mercado imobiliário espera por você!" },
  { icon: Trophy, title: "Campeão de Vendas! 🏆", text: "Lembre-se: disciplina supera talento. Você está no caminho certo!" },
];

export function MotivationalPopup() {
  const [open, setOpen] = useState(false);
  const [msg] = useState(() => messages[Math.floor(Math.random() * messages.length)]);

  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const Icon = msg.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="glass-strong glow-primary max-w-sm text-center border-primary/20">
        <DialogTitle className="sr-only">Mensagem Motivacional</DialogTitle>
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
                className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center"
              >
                <Icon className="w-8 h-8 text-primary" />
              </motion.div>
              <h3 className="text-xl font-bold text-foreground">{msg.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{msg.text}</p>
              <Button onClick={() => setOpen(false)} className="mt-2 glow-primary">
                Bora Vender! 💪
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
