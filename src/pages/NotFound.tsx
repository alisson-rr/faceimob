import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMotif } from "@/components/shared/BrandMotif";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404: rota inexistente acessada:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative grid min-h-[100svh] place-items-center overflow-hidden bg-background px-6">
      <BrandMotif />

      <div className="relative max-w-md text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-eyebrow mt-6">Erro 404</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-foreground">
          Esta página não existe
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          O endereço <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{location.pathname}</code> não
          corresponde a nenhuma tela do CRM. Ele pode ter mudado de lugar ou o link estar incompleto.
        </p>
        <Button asChild size="lg" className="mt-7">
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para o Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
