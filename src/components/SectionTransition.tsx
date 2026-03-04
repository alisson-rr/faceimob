import { motion } from "framer-motion";

interface Props {
  variant?: "dark-to-light" | "light-to-dark";
}

const SectionTransition = ({ variant = "dark-to-light" }: Props) => {
  const isDarkToLight = variant === "dark-to-light";

  return (
    <div className="relative h-24 overflow-hidden">
      <svg
        viewBox="0 0 1440 120"
        className="absolute w-full h-full"
        preserveAspectRatio="none"
      >
        <path
          d="M0,0 C360,120 1080,0 1440,80 L1440,120 L0,120 Z"
          className={isDarkToLight ? "fill-background" : "fill-primary"}
        />
      </svg>
      <div className={`absolute inset-0 ${isDarkToLight ? "bg-primary" : "bg-background"}`} style={{ zIndex: -1 }} />
    </div>
  );
};

export default SectionTransition;
