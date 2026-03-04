import { motion } from "framer-motion";
import { Phone, Mail, MapPin, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  return (
    <section className="py-20 md:py-28 bg-secondary relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="font-display text-3xl md:text-5xl font-bold text-secondary-foreground mb-6">
            Pronto para encontrar seu{" "}
            <span className="text-gradient-orange">imóvel ideal</span>?
          </h2>
          <p className="text-secondary-foreground/60 text-lg mb-10">
            Entre em contato com nossa equipe e vamos juntos conquistar o imóvel dos seus sonhos.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button variant="hero" size="lg" className="gap-2">
              <Phone className="h-5 w-5" />
              Fale com um consultor
            </Button>
            <Button variant="heroOutline" size="lg" className="gap-2">
              Ver todos os imóveis
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex flex-wrap justify-center gap-8 text-secondary-foreground/50 text-sm">
            <span className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" /> (51) 99999-9999
            </span>
            <span className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> contato@satinimoveis.com.br
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" /> Porto Alegre, RS
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
