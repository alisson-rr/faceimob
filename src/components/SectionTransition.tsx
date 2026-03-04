import { motion } from "framer-motion";

interface Props {
  variant?: "dark-to-light" | "light-to-dark";
}

const SectionTransition = ({ variant = "dark-to-light" }: Props) => {
  const isDarkToLight = variant === "dark-to-light";

  return (
    <div className="relative h-32 overflow-hidden">
      {/* Top color */}
      <div className={`absolute inset-0 ${isDarkToLight ? "bg-primary" : "bg-background"}`} />
      {/* Bottom color fading in */}
      <motion.div
        className={`absolute inset-0 ${isDarkToLight ? "bg-background" : "bg-primary"}`}
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, black 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 100%)",
        }}
      />
      {/* Subtle center glow line */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-accent/20 blur-sm" />
    </div>
  );
};

export default SectionTransition;
