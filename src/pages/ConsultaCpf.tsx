import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { IdCard, Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared";
import { BatidaCpfDialog } from "@/components/pipeline/BatidaCpfDialog";
import {
  assumirNegocioDoCpf, cpfDigitos, negocioDoCpf, type NegocioDoCpf,
} from "@/integrations/supabase/batidaCpf";
import { describeError } from "@/lib/supabaseError";

/**
 * Consulta CPF (pedido de 10/11/2026): o corretor digita o CPF e vê se o
 * cliente já está em atendimento, com quem (corretor, gerente, diretor) e a
 * data do último comentário. Se o negócio está OFF/QUEDA ou o corretor dele
 * foi desligado/suspenso, pode resgatar. Quem decide o que é resgatável é o
 * banco (`negocio_do_cpf.pode_resgatar`, 0329); a tela só mostra.
 */
export default function ConsultaCpf() {
  const id = useId();
  const [cpf, setCpf] = useState("");
  const [consultando, setConsultando] = useState(false);
  const [livre, setLivre] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [achado, setAchado] = useState<{ negocio: NegocioDoCpf; enviando: boolean; erro: string | null } | null>(null);
  const digitos = cpfDigitos(cpf);

  const consultar = async (e: FormEvent) => {
    e.preventDefault();
    if (digitos.length !== 11) return;
    setConsultando(true);
    setLivre(false);
    setErro(null);
    try {
      const negocio = await negocioDoCpf([digitos]);
      if (negocio) setAchado({ negocio, enviando: false, erro: null });
      else setLivre(true);
    } catch (err) {
      setErro(describeError(err, "Não foi possível consultar o CPF."));
    } finally {
      setConsultando(false);
    }
  };

  const resgatar = async (comentario: string) => {
    if (!achado) return;
    setAchado({ ...achado, enviando: true, erro: null });
    try {
      await assumirNegocioDoCpf(achado.negocio.deal_id, comentario);
      toast.success("Negócio resgatado", { description: "Ele já está no seu Pipeline, com histórico e documentos." });
      setAchado(null);
      setCpf("");
    } catch (err) {
      setAchado({ ...achado, enviando: false, erro: describeError(err, "O negócio não foi resgatado.") });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consulta CPF"
        icon={IdCard}
        description="Veja se o cliente já está em atendimento e com quem. Negócio OFF ou de corretor desligado pode ser resgatado."
      />
      <Card className="max-w-xl p-4">
        <form onSubmit={(e) => void consultar(e)} className="space-y-3">
          <Label htmlFor={`${id}-cpf`}>CPF do cliente</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-cpf`} inputMode="numeric" autoComplete="off" maxLength={14}
              placeholder="000.000.000-00" value={cpf}
              onChange={(e) => { setCpf(e.target.value); setLivre(false); setErro(null); }}
              aria-describedby={`${id}-status`}
            />
            <Button type="submit" className="gap-1" disabled={digitos.length !== 11 || consultando}>
              {consultando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              Consultar
            </Button>
          </div>
          <div id={`${id}-status`} role="status" className="text-sm">
            {livre && <p className="text-success">Nenhum negócio com este CPF. O cliente está livre para atendimento.</p>}
            {erro && <p className="text-destructive">{erro}</p>}
          </div>
        </form>
      </Card>
      {achado && (
        <BatidaCpfDialog
          negocio={achado.negocio}
          enviando={achado.enviando}
          erro={achado.erro}
          onAssumir={(comentario) => void resgatar(comentario)}
          onClose={() => setAchado(null)}
        />
      )}
    </div>
  );
}
