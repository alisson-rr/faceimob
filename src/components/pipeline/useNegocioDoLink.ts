import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { listLegacyDeals, type LegacyDealRecord } from "@/integrations/supabase/newSchema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?negocio=<id>` abre o negócio — é o destino do aviso do sino (0231). O
 * parâmetro é instrução de navegação, não estado: sai da URL na hora, como o
 * `?lead=` da tela de Leads, para fechar o modal não reabri-lo na recarga.
 */
export function useNegocioDoLink(abrir: (deal: LegacyDealRecord) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get("negocio");

  useEffect(() => {
    if (!id) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("negocio");
      return next;
    }, { replace: true });
    if (!UUID.test(id)) return;
    let vivo = true;
    listLegacyDeals(undefined, { ids: [id] })
      .then((achados) => {
        if (!vivo) return;
        const negocio = achados.find((deal) => deal.id === id);
        if (negocio) abrir(negocio);
        else toast("Negócio indisponível", { description: "Ele pode ter saído da sua visibilidade." });
      })
      .catch(() => {
        if (vivo) toast.error("Não foi possível abrir o negócio do aviso", { description: "Recarregue a página e tente de novo." });
      });
    return () => { vivo = false; };
  }, [id, abrir, setSearchParams]);
}
