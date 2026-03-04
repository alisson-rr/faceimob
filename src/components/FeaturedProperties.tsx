import { motion } from "framer-motion";
import { Bed, Bath, Maximize, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import property1 from "@/assets/property-1.jpg";
import property2 from "@/assets/property-2.jpg";
import property3 from "@/assets/property-3.jpg";
import property4 from "@/assets/property-4.jpg";

const properties = [
  {
    id: 1,
    title: "Apartamento Parque Pontal",
    location: "Cristal - Porto Alegre/RS",
    price: "R$ 275.000",
    beds: 2,
    baths: 1,
    area: "42 m²",
    image: property1,
    tag: "Lançamento",
  },
  {
    id: 2,
    title: "Casa Villa Pienza",
    location: "Cavalhada - Porto Alegre/RS",
    price: "R$ 389.000",
    beds: 3,
    baths: 2,
    area: "85 m²",
    image: property2,
    tag: "Destaque",
  },
  {
    id: 3,
    title: "Cobertura Sky Residence",
    location: "Centro - Canoas/RS",
    price: "R$ 520.000",
    beds: 3,
    baths: 2,
    area: "120 m²",
    image: property3,
    tag: "Exclusivo",
  },
  {
    id: 4,
    title: "Residencial Camélias",
    location: "Sítio Ipiranga - Cachoeirinha/RS",
    price: "Sob Consulta",
    beds: 2,
    baths: 1,
    area: "41 m²",
    image: property4,
    tag: "Em construção",
  },
];

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.15 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const FeaturedProperties = () => {
  return (
    <section className="py-20 md:py-28 bg-background">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-primary font-semibold text-sm tracking-widest uppercase mb-3">
            Imóveis selecionados
          </p>
          <h2 className="font-display text-3xl md:text-5xl font-bold text-foreground">
            Imóveis em Destaque
          </h2>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {properties.map((property) => (
            <motion.div
              key={property.id}
              variants={cardVariants}
              className="group bg-card rounded-2xl overflow-hidden shadow-card hover:shadow-elevated transition-shadow duration-300"
            >
              <div className="relative overflow-hidden aspect-[4/3]">
                <img
                  src={property.image}
                  alt={property.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <span className="absolute top-3 left-3 bg-gradient-orange text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                  {property.tag}
                </span>
              </div>

              <div className="p-5">
                <h3 className="font-display font-bold text-lg text-card-foreground mb-1">
                  {property.title}
                </h3>
                <p className="flex items-center gap-1 text-muted-foreground text-sm mb-4">
                  <MapPin className="h-3.5 w-3.5" />
                  {property.location}
                </p>

                <div className="flex items-center gap-4 text-muted-foreground text-xs mb-4 pb-4 border-b border-border">
                  <span className="flex items-center gap-1">
                    <Bed className="h-3.5 w-3.5" /> {property.beds}
                  </span>
                  <span className="flex items-center gap-1">
                    <Bath className="h-3.5 w-3.5" /> {property.baths}
                  </span>
                  <span className="flex items-center gap-1">
                    <Maximize className="h-3.5 w-3.5" /> {property.area}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-primary font-bold text-lg">{property.price}</p>
                  <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
                    Ver mais
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-12"
        >
          <Button variant="outline" size="lg">
            Ver todos os imóveis
          </Button>
        </motion.div>
      </div>
    </section>
  );
};

export default FeaturedProperties;
