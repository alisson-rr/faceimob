import { motion } from "framer-motion";
import { Bed, Bath, Maximize, MapPin, Car, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import property1 from "@/assets/property-1.jpg";
import property2 from "@/assets/property-2.jpg";
import property3 from "@/assets/property-3.jpg";
import property4 from "@/assets/property-4.jpg";

const properties = [
  { id: 1, title: "Parque Pontal", location: "Cristal - Porto Alegre/RS", price: "Sob Consulta", beds: 2, baths: 1, area: "42 m²", parking: 1, image: property1, tag: "Lançamento" },
  { id: 2, title: "Villa Pienza", location: "Cavalhada - Porto Alegre/RS", price: "R$ 389.000", beds: 3, baths: 2, area: "85 m²", parking: 1, image: property2, tag: "Destaque" },
  { id: 3, title: "Sky Residence", location: "Centro - Canoas/RS", price: "R$ 520.000", beds: 3, baths: 2, area: "120 m²", parking: 2, image: property3, tag: "Exclusivo" },
  { id: 4, title: "Residencial Camélias", location: "Cachoeirinha/RS", price: "Sob Consulta", beds: 2, baths: 1, area: "41 m²", parking: 1, image: property4, tag: "Em construção" },
  { id: 5, title: "Galpão Industrial", location: "Zona Norte - POA/RS", price: "R$ 950.000", beds: 0, baths: 2, area: "350 m²", parking: 5, image: property1, tag: "Comercial" },
  { id: 6, title: "Apto Beira Rio", location: "Praia de Belas - POA/RS", price: "R$ 680.000", beds: 3, baths: 2, area: "98 m²", parking: 2, image: property3, tag: "Novo" },
  { id: 7, title: "Casa Zona Sul", location: "Ipanema - Porto Alegre/RS", price: "R$ 450.000", beds: 3, baths: 2, area: "110 m²", parking: 2, image: property2, tag: "Destaque" },
  { id: 8, title: "Studio Moinhos", location: "Moinhos - Porto Alegre/RS", price: "R$ 320.000", beds: 1, baths: 1, area: "35 m²", parking: 1, image: property4, tag: "Compacto" },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: "easeOut" as const } },
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
          className="text-center mb-14"
        >
          <p className="text-accent font-semibold text-sm tracking-widest uppercase mb-3">
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
          viewport={{ once: true, margin: "-50px" }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5"
        >
          {properties.map((property) => (
            <motion.div
              key={property.id}
              variants={cardVariants}
              whileHover={{
                y: -6,
                rotateX: 2,
                rotateY: -2,
                transition: { duration: 0.3 }
              }}
              className="group bg-card rounded-xl overflow-hidden shadow-card hover:shadow-elevated hover:shadow-glow transition-all duration-300 cursor-pointer"
              style={{ perspective: "1000px", transformStyle: "preserve-3d" }}
            >
              {/* Image - compact */}
              <div className="relative overflow-hidden aspect-[16/10]">
                <img
                  src={property.image}
                  alt={property.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow-glow">
                  {property.tag}
                </span>
                <motion.div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  initial={false}
                >
                  <div className="glass rounded-full p-3">
                    <Eye className="h-5 w-5 text-primary-foreground" />
                  </div>
                </motion.div>
              </div>

              {/* Content - compact */}
              <div className="p-3 md:p-4">
                <h3 className="font-display font-bold text-sm md:text-base text-card-foreground leading-tight mb-1 line-clamp-1">
                  {property.title}
                </h3>
                <p className="flex items-center gap-1 text-muted-foreground text-[11px] mb-3">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="line-clamp-1">{property.location}</span>
                </p>

                <div className="flex items-center gap-2 text-muted-foreground text-[10px] md:text-xs mb-3 pb-3 border-b border-border">
                  {property.beds > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Bed className="h-3 w-3" /> {property.beds}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Bath className="h-3 w-3" /> {property.baths}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Maximize className="h-3 w-3" /> {property.area}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Car className="h-3 w-3" /> {property.parking}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-accent font-bold text-sm md:text-base">{property.price}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-10"
        >
          <Button variant="outline" size="lg" className="border-primary hover:bg-primary hover:text-primary-foreground transition-all">
            Ver todos os imóveis
          </Button>
        </motion.div>
      </div>
    </section>
  );
};

export default FeaturedProperties;
