import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MapPin, Home, Building2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import dianho from "@/assets/dianho.png";

const floatingIcons = [
  { icon: "🏠", x: "10%", y: "20%", delay: 0, duration: 6 },
  { icon: "🏢", x: "85%", y: "15%", delay: 1, duration: 7 },
  { icon: "🔑", x: "75%", y: "70%", delay: 2, duration: 5 },
  { icon: "📍", x: "15%", y: "75%", delay: 0.5, duration: 8 },
  { icon: "🏗️", x: "50%", y: "10%", delay: 1.5, duration: 6 },
];

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-primary">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <motion.div
          className="absolute inset-0 opacity-30"
          style={{
            background: "radial-gradient(ellipse at 30% 50%, hsl(213, 42%, 35%) 0%, transparent 60%), radial-gradient(ellipse at 70% 30%, hsl(150, 30%, 40%) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, hsl(47, 80%, 40%) 0%, transparent 50%)"
          }}
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 2, -2, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(hsla(0,0%,100%,0.1) 1px, transparent 1px), linear-gradient(90deg, hsla(0,0%,100%,0.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px"
        }}
      />

      {/* Floating real estate icons */}
      {floatingIcons.map((item, i) => (
        <motion.div
          key={i}
          className="absolute text-2xl md:text-3xl opacity-10 pointer-events-none select-none"
          style={{ left: item.x, top: item.y }}
          animate={{
            y: [0, -20, 0],
            rotate: [0, 10, -10, 0],
            opacity: [0.05, 0.15, 0.05],
          }}
          transition={{ duration: item.duration, delay: item.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          {item.icon}
        </motion.div>
      ))}

      {/* Glow Effects */}
      <div className="absolute top-1/4 right-1/3 w-[600px] h-[600px] rounded-full bg-accent/8 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-[hsl(213,42%,56%)]/10 blur-[120px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 pt-28 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          {/* Left - Text content */}
          <div className="text-center lg:text-left order-2 lg:order-1">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-accent font-semibold text-sm tracking-[0.2em] uppercase mb-4"
            >
              A imobiliária Galponeira!
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-primary-foreground font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6"
            >
              Encontre o imóvel{" "}
              <span className="text-gradient-accent">dos seus sonhos</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-primary-foreground/50 text-lg md:text-xl max-w-xl mx-auto lg:mx-0 mb-8"
            >
              Especialistas em imóveis residenciais, comerciais e galpões em Porto Alegre e região.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8"
            >
              <Button variant="hero" size="lg" className="gap-2 text-base">
                <Search className="h-5 w-5" />
                Ver Imóveis
              </Button>
              <Button variant="heroOutline" size="lg" className="gap-2 text-base">
                Fale com o Dianho
                <ChevronRight className="h-5 w-5" />
              </Button>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex gap-8 justify-center lg:justify-start"
            >
              {[
                { value: "500+", label: "Imóveis" },
                { value: "1.200+", label: "Clientes" },
                { value: "15+", label: "Anos" },
              ].map((stat) => (
                <div key={stat.label} className="text-center lg:text-left">
                  <p className="text-accent font-bold text-2xl md:text-3xl font-display">{stat.value}</p>
                  <p className="text-primary-foreground/40 text-xs uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right - Dianho character */}
          <motion.div
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, type: "spring" }}
            className="relative flex justify-center order-1 lg:order-2"
          >
            {/* Glow behind character */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] rounded-full bg-accent/10 blur-[80px] pointer-events-none" />
            
            {/* Glass card behind */}
            <motion.div
              className="absolute bottom-8 -left-4 glass rounded-2xl px-5 py-3 shadow-glow z-20"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1 }}
              whileHover={{ scale: 1.05 }}
            >
              <p className="text-accent font-bold text-sm font-display">Dianho recomenda! 🤙</p>
              <p className="text-primary-foreground/50 text-xs">Líder em vendas do 1º imóvel</p>
            </motion.div>

            <motion.div
              className="absolute top-12 -right-2 glass rounded-2xl px-4 py-2 shadow-glow z-20"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.2 }}
              whileHover={{ scale: 1.05 }}
            >
              <p className="text-[hsl(150,30%,65%)] font-bold text-xs">⭐ 4.9/5</p>
              <p className="text-primary-foreground/50 text-[10px]">+200 avaliações</p>
            </motion.div>

            <motion.img
              src={dianho}
              alt="Dianho - Mascote Faceimob"
              className="relative z-10 w-full max-w-md h-auto drop-shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
        </div>

        {/* Search Bar - Glass */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="glass rounded-2xl p-6 md:p-8 mt-12 shadow-glow-primary"
        >
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="flex items-center gap-3 bg-primary-foreground/10 rounded-xl px-4 py-3 hover:bg-primary-foreground/15 transition-colors">
              <Home className="h-5 w-5 text-accent shrink-0" />
              <select className="bg-transparent text-primary-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                <option value="">Tipo do Imóvel</option>
                <option>Apartamento</option>
                <option>Casa</option>
                <option>Galpão</option>
                <option>Terreno</option>
                <option>Comercial</option>
              </select>
            </div>

            <div className="flex items-center gap-3 bg-primary-foreground/10 rounded-xl px-4 py-3 hover:bg-primary-foreground/15 transition-colors">
              <MapPin className="h-5 w-5 text-accent shrink-0" />
              <select className="bg-transparent text-primary-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                <option value="">Cidade</option>
                <option>Porto Alegre</option>
                <option>Canoas</option>
                <option>Gravataí</option>
                <option>Cachoeirinha</option>
                <option>Viamão</option>
              </select>
            </div>

            <div className="flex items-center gap-3 bg-primary-foreground/10 rounded-xl px-4 py-3 hover:bg-primary-foreground/15 transition-colors">
              <Building2 className="h-5 w-5 text-accent shrink-0" />
              <select className="bg-transparent text-primary-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                <option value="">Bairros</option>
                <option>Centro</option>
                <option>Cristal</option>
                <option>Cavalhada</option>
                <option>Zona Norte</option>
              </select>
            </div>

            <div className="flex items-center gap-3 bg-primary-foreground/10 rounded-xl px-4 py-3 hover:bg-primary-foreground/15 transition-colors">
              <input
                type="text"
                placeholder="Valor mínimo"
                className="bg-transparent text-primary-foreground/80 text-sm w-full outline-none placeholder:text-primary-foreground/40"
              />
            </div>

            <Button variant="hero" size="lg" className="gap-2 rounded-xl h-auto py-3 animate-glow-pulse">
              <Search className="h-5 w-5" />
              Pesquisar
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
