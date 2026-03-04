import { motion } from "framer-motion";
import { Building2, Home, Warehouse, BedDouble } from "lucide-react";

const categories = [
  {
    icon: Building2,
    title: "Apartamentos",
    description: "Veja tudo que temos em opção vertical.",
    count: "120+ imóveis",
  },
  {
    icon: Home,
    title: "Casas",
    description: "Escolha uma de nossas opções horizontais!",
    count: "85+ imóveis",
  },
  {
    icon: Warehouse,
    title: "Galpões",
    description: "A imobiliária Galponeira! Somos especialistas.",
    count: "45+ imóveis",
  },
  {
    icon: BedDouble,
    title: "2 Dormitórios",
    description: "Conforto e muito espaço. Confira!",
    count: "60+ imóveis",
  },
];

const PropertyCategories = () => {
  return (
    <section className="py-20 md:py-28 bg-primary relative overflow-hidden">
      {/* Glow orbs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-accent font-semibold text-sm tracking-widest uppercase mb-3">
            Categorias
          </p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-primary-foreground">
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
              whileHover={{ y: -8, scale: 1.02 }}
              className="group glass rounded-2xl p-8 cursor-pointer hover:shadow-glow transition-all duration-300"
            >
              <div className="w-14 h-14 rounded-xl bg-gradient-accent flex items-center justify-center mb-6 group-hover:animate-glow-pulse transition-all">
                <cat.icon className="h-7 w-7 text-accent-foreground" />
              </div>
              <h3 className="font-display text-xl font-bold text-primary-foreground mb-2">
                {cat.title}
              </h3>
              <p className="text-primary-foreground/50 text-sm mb-4">{cat.description}</p>
              <p className="text-accent font-semibold text-sm">{cat.count}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PropertyCategories;
