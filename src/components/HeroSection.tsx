import { motion } from "framer-motion";
import { Search, MapPin, Home, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroBg from "@/assets/hero-bg.jpg";

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src={heroBg}
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-hero/80" />
        <div className="absolute inset-0 bg-gradient-to-b from-hero/60 via-transparent to-hero/90" />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 pt-20">
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-primary font-semibold text-sm tracking-widest uppercase mb-4"
          >
            Seu novo lar começa aqui
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-hero-foreground font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6"
          >
            Encontre o imóvel{" "}
            <span className="text-gradient-orange">dos seus sonhos</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-hero-foreground/70 text-lg md:text-xl max-w-2xl mx-auto mb-12"
          >
            Especialistas em imóveis residenciais e comerciais. 
            Realizamos o sonho da casa própria com transparência e dedicação.
          </motion.p>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="bg-card/10 backdrop-blur-xl rounded-2xl p-6 md:p-8 border border-hero-foreground/10"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 bg-hero-foreground/10 rounded-xl px-4 py-3">
                <Home className="h-5 w-5 text-primary shrink-0" />
                <select className="bg-transparent text-hero-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                  <option value="">Tipo do Imóvel</option>
                  <option>Apartamento</option>
                  <option>Casa</option>
                  <option>Terreno</option>
                  <option>Comercial</option>
                </select>
              </div>

              <div className="flex items-center gap-3 bg-hero-foreground/10 rounded-xl px-4 py-3">
                <MapPin className="h-5 w-5 text-primary shrink-0" />
                <select className="bg-transparent text-hero-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                  <option value="">Cidade</option>
                  <option>Porto Alegre</option>
                  <option>Canoas</option>
                  <option>Gravataí</option>
                  <option>Viamão</option>
                </select>
              </div>

              <div className="flex items-center gap-3 bg-hero-foreground/10 rounded-xl px-4 py-3">
                <DollarSign className="h-5 w-5 text-primary shrink-0" />
                <select className="bg-transparent text-hero-foreground/80 text-sm w-full outline-none appearance-none cursor-pointer">
                  <option value="">Faixa de Preço</option>
                  <option>Até R$ 200.000</option>
                  <option>R$ 200.000 - R$ 400.000</option>
                  <option>R$ 400.000 - R$ 600.000</option>
                  <option>Acima de R$ 600.000</option>
                </select>
              </div>

              <Button variant="hero" size="lg" className="gap-2 rounded-xl h-auto py-3">
                <Search className="h-5 w-5" />
                Pesquisar
              </Button>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex flex-wrap justify-center gap-8 md:gap-16 mt-12"
          >
            {[
              { value: "500+", label: "Imóveis disponíveis" },
              { value: "1.200+", label: "Clientes satisfeitos" },
              { value: "10+", label: "Anos de experiência" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-gradient-orange font-display">
                  {stat.value}
                </p>
                <p className="text-hero-foreground/60 text-sm mt-1">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
