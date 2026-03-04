import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";

const WhatsAppButton = () => {
  return (
    <motion.a
      href="https://wa.me/5551999999999?text=Olá! Vi o site da Faceimob e quero saber mais sobre os imóveis."
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[hsl(142,70%,45%)] text-white flex items-center justify-center shadow-[0_4px_20px_rgba(37,211,102,0.4)] hover:scale-110 transition-transform"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1.5, type: "spring" }}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.95 }}
      aria-label="Fale no WhatsApp"
    >
      <MessageCircle className="h-7 w-7" />
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-[hsl(142,70%,45%)]"
        animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </motion.a>
  );
};

export default WhatsAppButton;
