import { Link } from "react-router-dom";
import { Instagram, Facebook, Linkedin, Youtube, MapPin, Phone, Mail } from "lucide-react";
import logoSatin from "@/assets/logo-satin.png";

const Footer = () => {
  return (
    <footer className="bg-foreground py-16">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <img src={logoSatin} alt="Satin Imóveis" className="h-10 w-10 object-contain" />
              <span className="text-background text-lg font-bold font-display">Satin Imóveis</span>
            </div>
            <p className="text-background/50 text-sm leading-relaxed">
              Especialistas em imóveis residenciais e comerciais. Realizando sonhos com transparência e dedicação.
            </p>
          </div>

          <div>
            <h4 className="text-background font-semibold mb-4">Navegação</h4>
            <div className="flex flex-col gap-2">
              {["Início", "Imóveis", "Sobre", "Contato"].map((item) => (
                <Link key={item} to="/" className="text-background/50 text-sm hover:text-primary transition-colors">
                  {item}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-background font-semibold mb-4">Contato</h4>
            <div className="flex flex-col gap-3 text-background/50 text-sm">
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
          </div>

          <div>
            <h4 className="text-background font-semibold mb-4">Redes Sociais</h4>
            <div className="flex gap-3">
              {[Instagram, Facebook, Youtube, Linkedin].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="w-10 h-10 rounded-full bg-background/10 flex items-center justify-center text-background/60 hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-background/10 mt-12 pt-8 text-center">
          <p className="text-background/30 text-sm">
            © 2024 Satin Imóveis. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
