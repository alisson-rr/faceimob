import { Link } from "react-router-dom";
import { Instagram, Facebook, Linkedin, Youtube, MapPin, Phone, Mail } from "lucide-react";
import logoFaceimob from "@/assets/logo-faceimob.png";

const Footer = () => {
  return (
    <footer className="bg-secondary py-16">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <img src={logoFaceimob} alt="Faceimob" className="h-12 w-auto object-contain" />
            </div>
            <p className="text-secondary-foreground/50 text-sm leading-relaxed">
              A imobiliária Galponeira! Líder em vendas do 1º imóvel. Especialistas em imóveis residenciais, comerciais e galpões.
            </p>
            <p className="text-secondary-foreground/30 text-xs mt-2">CRECI J-23681</p>
          </div>

          <div>
            <h4 className="text-secondary-foreground font-semibold mb-4">Navegação</h4>
            <div className="flex flex-col gap-2">
              {["Início", "Sobre", "Contato", "Links Úteis"].map((item) => (
                <Link key={item} to="/" className="text-secondary-foreground/50 text-sm hover:text-accent transition-colors">
                  {item}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-secondary-foreground font-semibold mb-4">Contato</h4>
            <div className="flex flex-col gap-3 text-secondary-foreground/50 text-sm">
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
          </div>

          <div>
            <h4 className="text-secondary-foreground font-semibold mb-4">Redes Sociais</h4>
            <div className="flex gap-3">
              {[
                { Icon: Instagram, url: "https://www.instagram.com/faceimob.com.br/" },
                { Icon: Facebook, url: "https://www.facebook.com/FaceimobGestaoImobiliaria" },
                { Icon: Youtube, url: "https://www.youtube.com/@FaceimobGestaoImobiliaria" },
                { Icon: Linkedin, url: "https://www.linkedin.com/company/faceimob-com-br/" },
              ].map(({ Icon, url }, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-secondary-foreground/10 flex items-center justify-center text-secondary-foreground/60 hover:bg-accent hover:text-accent-foreground transition-all duration-300"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-secondary-foreground/10 mt-12 pt-8 text-center">
          <p className="text-secondary-foreground/30 text-sm">
            © 2024 Faceimob - Gestão Imobiliária. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
