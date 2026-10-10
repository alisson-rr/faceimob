import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { listLegacyDeals, type LegacyDealRecord } from "@/integrations/supabase/newSchema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?negocio=<id>` abre o negócio — é o destino do aviso do sino (0231). O
 * parâmetro é instrução de navegação, não estado: sai da URL na hora, como o
 * `?lead=` da tela de Leads, para fechar o modal não reabri-lo na recarga.
 *
 * 10/10/2026: tirar o parâmetro da URL re-renderiza com `id` nulo, e a limpeza
 * do efeito cancelava a busca ainda em voo — o "Abrir card" nunca abria nada.
 * Agora a busca só é descartada se a tela desmontar.
 */
export function useNegocioDoLink(abrir: (deal: LegacyDealRecord) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get("negocio");
  const montado = useRef(true);
  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  useEffect(() => {
    if (!id) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("negocio");
      return next;
    }, { replace: true });
    if (!UUID.test(id)) return;
    listLegacyDeals(undefined, { ids: [id] })
      .then((achados) => {
        if (!montado.current) return;
        const negocio = achados.find((deal) => deal.id === id);
        if (negocio) abrirRef.current(negocio);
        else toast("Negócio indisponível", { description: "Ele pode ter saído da sua visibilidade." });
      })
      .catch(() => {
        if (montado.current) toast.error("Não foi possível abrir o negócio do aviso", { description: "Recarregue a página e tente de novo." });
      });
  }, [id, setSearchParams]);
}
