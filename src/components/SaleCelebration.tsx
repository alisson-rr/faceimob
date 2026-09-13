import { AnimatePresence, motion } from "framer-motion";
import { Trophy } from "lucide-react";

/**
 * Card de venda fechada (ata 14/07: "som a cada venda", com celebração visual).
 *
 * Virou apresentação pura: quem escuta o realtime, agrupa os eventos do mesmo
 * negócio, resolve os nomes e toca a fanfarra é o `EngagementLayer` — antes
 * cada corretor do rateio disparava uma comemoração própria, então uma venda a
 * três mãos tocava três fanfarras e trocava o nome no meio do card.
 *
 * É um aviso de time: todo mundo logado vê, não só quem vendeu — é o efeito que
 * o cliente pediu (a loja inteira ouve). O confete é do canvas do
 * `EngagementLayer`, não mais 14 divs com hex fixo.
 *
 * Âmbar no lugar do azul (12/09/2026): borda, brilho e filete dourados, nomes
 * em ouro. O fundo é `bg-card/95`, não o `glass-strong` (85%): com o ouro do
 * tema claro, 85% de opacidade sobre conteúdo escuro derrubava o nome para
 * 3,4:1; a 95% o pior caso fica em 4,35:1, e o nome em `text-xl` negrito é
 * texto grande (piso 3:1). O `glass-strong` também vem depois das utilities no
 * CSS gerado — a borda dourada ao lado dele nunca pintaria.
 *
 * Borda: ouro a 60% no escuro; no claro, ouro cheio (`[.light_&]`, como a
 * borda do turno ativo no Check-in) — a 60% sobre o card ela dava 2,38:1,
 * abaixo do 3:1 de traço.
 */
export default function SaleCelebration({ sale }: { sale: { id: string; names: string } | null }) {
  return (
    <AnimatePresence>
      {sale && (
        <motion.div
          key={sale.id}
          initial={{ opacity: 0, scale: 0.8, y: 40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <div className="gold-hairline glow-highlight relative max-w-sm rounded-2xl border border-gold/60 [.light_&]:border-gold bg-card/95 px-8 py-5 text-center backdrop-blur-2xl">
            <motion.div
              animate={{ rotate: [0, -12, 12, -8, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 0.9, repeat: 2 }}
              className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-highlight/20"
            >
              <Trophy className="h-7 w-7 text-gold" aria-hidden />
            </motion.div>
            <p className="text-eyebrow">Venda fechada</p>
            <p className="mt-1 font-display text-xl font-bold text-gold">{sale.names}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
