import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { playSaleFanfare } from "@/lib/sound";

/**
 * Comemoração de venda (ata 14/07: "som a cada venda", com celebração visual).
 *
 * Dispara por realtime em `game_events` com `event_code = 'venda'`: o evento do
 * jogo é gravado pelo trigger `deals_award_points` no fechamento, então a
 * celebração vem do mesmo fato que pontua. Escutar `deals` diretamente
 * dispararia em qualquer UPDATE da linha, inclusive edição de valor.
 *
 * É um aviso de time: todo mundo logado vê, não só quem vendeu — é o efeito que
 * o cliente pediu (a loja inteira ouve).
 */
const DISPLAY_MS = 6000;

type Celebration = { id: string; brokerName: string };

export default function SaleCelebration() {
  const [current, setCurrent] = useState<Celebration | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Evita comemorar duas vezes o mesmo evento quando o realtime reentrega.
  const seen = useRef<Set<string>>(new Set());

  const celebrate = useCallback(async (eventId: string, profileId: string) => {
    if (seen.current.has(eventId)) return;
    seen.current.add(eventId);

    const { data } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", profileId)
      .maybeSingle();

    playSaleFanfare();
    setCurrent({ id: eventId, brokerName: (data as { full_name: string | null } | null)?.full_name ?? "Equipe" });

    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCurrent(null), DISPLAY_MS);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("sale-celebration")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_events", filter: "event_code=eq.venda" },
        (payload) => {
          const row = payload.new as { id: string; profile_id: string };
          void celebrate(row.id, row.profile_id);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [celebrate]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: 0.8, y: 40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="fixed inset-x-0 top-16 z-[60] flex justify-center pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="relative glass-strong glow-primary border border-primary/30 rounded-2xl px-8 py-5 text-center overflow-hidden">
            {/* Confete: divs animadas, sem biblioteca — 14 elementos que somem
                com o card. Um pacote de confete custaria mais que isso. */}
            {Array.from({ length: 14 }).map((_, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute w-1.5 h-3 rounded-sm"
                style={{
                  left: `${(i * 7 + 5) % 95}%`,
                  backgroundColor: ["#fbbf24", "#34d399", "#38bdf8", "#f472b6"][i % 4],
                }}
                initial={{ y: -20, opacity: 0, rotate: 0 }}
                animate={{ y: 140, opacity: [0, 1, 1, 0], rotate: 360 }}
                transition={{ duration: 2.2, delay: (i % 7) * 0.12, repeat: 1, ease: "easeIn" }}
              />
            ))}

            <motion.div
              animate={{ rotate: [0, -12, 12, -8, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 0.9, repeat: 2 }}
              className="mx-auto w-12 h-12 rounded-full bg-yellow-400/20 flex items-center justify-center mb-2"
            >
              <Trophy className="h-7 w-7 text-yellow-400" />
            </motion.div>
            <p className="text-lg font-bold text-foreground">Venda fechada! 🎉</p>
            <p className="text-sm text-primary font-semibold">{current.brokerName}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
