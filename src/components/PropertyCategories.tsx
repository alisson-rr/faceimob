import { motion } from "framer-motion";
import { Building2, Home, Landmark, TrendingUp } from "lucide-react";

const categories = [
  {
    icon: Building2,
    title: "Apartamentos",
    description: "Opções verticais com conforto e praticidade para sua família.",
    count: "120+ imóveis",
  },
  {
    icon: Home,
    title: "Casas",
    description: "Escolha entre nossas opções horizontais com espaço e segurança.",
    count: "85+ imóveis",
  },
  {
    icon: Landmark,
    title: "Comerciais",
    description: "Salas, lojas e galpões para impulsionar o seu negócio.",
    count: "45+ imóveis",
  },
  {
    icon: TrendingUp,
    title: "Investimento",
    description: "Imóveis com alto potencial de valorização e rentabilidade.",
    count: "30+ imóveis",
  },
];

const PropertyCategories = () => {
  return (
    <section className="py-20 md:py-28 bg-secondary">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-primary font-semibold text-sm tracking-widest uppercase mb-3">
            Categorias
          </p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-secondary-foreground">
            Imóveis Exclusivos
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {categories.map((cat, index) => (
            <motion.div
              key={cat.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -8 }}
              className="group bg-secondary-foreground/5 backdrop-blur-sm border border-secondary-foreground/10 rounded-2xl p-8 cursor-pointer hover:border-primary/40 transition-colors"
            >
              <div className="w-14 h-14 rounded-xl bg-gradient-orange flex items-center justify-center mb-6">
                <cat.icon className="h-7 w-7 text-primary-foreground" />
              </div>
              <h3 className="font-display text-xl font-bold text-secondary-foreground mb-2">
                {cat.title}
              </h3>
              <p className="text-secondary-foreground/60 text-sm mb-4">{cat.description}</p>
              <p className="text-primary font-semibold text-sm">{cat.count}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PropertyCategories;
