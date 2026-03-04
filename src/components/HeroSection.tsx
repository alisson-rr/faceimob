import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MapPin, Home, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroBg1 from "@/assets/hero-bg-1.jpg";
import heroBg2 from "@/assets/hero-bg-2.jpg";
import heroBg3 from "@/assets/hero-bg-3.jpg";
import logoSymbol from "@/assets/logo-faceimob-symbol.png";

const backgrounds = [heroBg1, heroBg2, heroBg3];

const HeroSection = () => {
  const [currentBg, setCurrentBg] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBg((prev) => (prev + 1) % backgrounds.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Animated Background Slideshow */}
      {backgrounds.map((bg, index) => (
        <motion.div
          key={index}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{
            opacity: index === currentBg ? 1 : 0,
            scale: index === currentBg ? 1.05 : 1,
          }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
        >
          <img
            src={bg}
            alt=""
            className="w-full h-full object-cover"
          />
        </motion.div>
      ))}

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/80 to-primary/60" />
      <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-transparent to-primary/40" />

      {/* Glow Effects */}
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-accent/5 blur-[100px] pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 pt-24 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Mascot area */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="hidden lg:flex flex-col items-center justify-center"
          >
            <motion.img
              src={logoSymbol}
              alt="Faceimob"
              className="w-64 h-auto drop-shadow-2xl"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-6 glass rounded-2xl px-6 py-3 text-center"
            >
              <p className="text-accent font-bold text-lg font-display">Dianho recomenda!</p>
              <p className="text-primary-foreground/60 text-sm">Líder em vendas do 1º imóvel</p>
            </motion.div>
          </motion.div>

          {/* Right side - Content */}
          <div className="text-center lg:text-left">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-accent font-semibold text-sm tracking-widest uppercase mb-4"
            >
              A imobiliária Galponeira!
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-primary-foreground font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6"
            >
              Encontre o imóvel{" "}
              <span className="text-gradient-accent">dos seus sonhos</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-primary-foreground/60 text-lg md:text-xl max-w-xl mx-auto lg:mx-0 mb-8"
            >
              Especialistas em imóveis residenciais, comerciais e galpões em Porto Alegre e região.
            </motion.p>

            {/* Social Links */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex gap-3 justify-center lg:justify-start mb-8"
            >
              {["Instagram", "Facebook", "YouTube", "LinkedIn"].map((social) => (
                <a
                  key={social}
                  href="#"
                  className="glass w-10 h-10 rounded-full flex items-center justify-center text-primary-foreground/60 hover:text-accent hover:shadow-glow transition-all duration-300"
                >
                  <span className="text-xs font-bold">{social.charAt(0)}</span>
                </a>
              ))}
            </motion.div>
          </div>
        </div>

        {/* Search Bar - Glass */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="glass rounded-2xl p-6 md:p-8 mt-8 shadow-glow-primary"
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

          <div className="mt-3">
            <a href="#" className="text-accent/70 text-xs hover:text-accent transition-colors underline">
              Buscar por referência
            </a>
          </div>
        </motion.div>
      </div>

      {/* Background slide indicators */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        {backgrounds.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentBg(i)}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === currentBg ? "bg-accent w-6" : "bg-primary-foreground/30"
            }`}
          />
        ))}
      </div>
    </section>
  );
};

export default HeroSection;
