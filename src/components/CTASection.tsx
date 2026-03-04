import { motion } from "framer-motion";
import { Phone, Mail, MapPin, ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section className="py-20 md:py-28 bg-primary relative overflow-hidden">
      {/* Glow orbs */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="font-display text-3xl md:text-5xl font-bold text-primary-foreground mb-6">
            Pronto para encontrar seu{" "}
            <span className="text-gradient-accent">imóvel ideal</span>?
          </h2>
          <p className="text-primary-foreground/50 text-lg mb-10">
            Entre em contato com nossa equipe e vamos juntos conquistar o imóvel dos seus sonhos. Dianho recomenda!
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button variant="hero" size="lg" className="gap-2 animate-glow-pulse">
              <MessageCircle className="h-5 w-5" />
              WhatsApp
            </Button>
            <Button variant="heroOutline" size="lg" className="gap-2">
              Ver todos os imóveis
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex flex-wrap justify-center gap-8 text-primary-foreground/40 text-sm">
            <span className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-accent" /> (51) 99999-9999
            </span>
            <span className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-accent" /> contato@faceimob.com.br
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-accent" /> Porto Alegre, RS
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
