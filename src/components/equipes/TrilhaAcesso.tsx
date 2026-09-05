import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollText } from "lucide-react";
import { dateTime } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { listAccessTrail, type TrailEntry } from "@/integrations/supabase/people";
import { EmptyState, LoadingState } from "@/components/shared";

/**
 * Quem mexeu no acesso e no papel de quem.
 *
 * As duas tabelas de auditoria (`access_provision_log`, da 0061, e
 * `role_change_log`, da 0079) têm policy de leitura só para admin e NENHUMA
 * tela as mostrava — a auditoria existia e ninguém a lia, que é o mesmo que não
 * existir no dia em que alguém pergunta.
 *
 * Carrega só quando o admin abre: são duas consultas que ninguém precisa em
 * toda visita a /equipes.
 */
export function TrilhaAcesso() {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<TrailEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLinhas(await listAccessTrail());
    } catch (error: unknown) {
      setErro(describeError(error, "Não foi possível ler a trilha de auditoria."));
    } finally {
      setCarregando(false);
    }
  };

  const alternar = () => {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo && linhas === null) void carregar();
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" /> Trilha de acesso e de papéis
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          aria-expanded={aberto}
          onClick={alternar}
        >
          {aberto ? "Ocultar" : "Ver últimos registros"}
        </Button>
      </CardHeader>
      {aberto && (
        <CardContent className="px-4 pb-4">
          {carregando && <LoadingState variant="list" rows={3} label="Carregando a trilha…" />}
          {!carregando && erro && (
            <EmptyState
              icon={ScrollText}
              tone="danger"
              title="Não foi possível ler a trilha"
              description={erro}
              action={<Button size="sm" onClick={() => void carregar()}>Tentar de novo</Button>}
            />
          )}
          {!carregando && !erro && linhas?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nada registrado ainda. Cada criação de acesso, troca de e-mail de login, recusa do
              endpoint de provisionamento e troca de funções entra aqui.
            </p>
          )}
          {!carregando && !erro && !!linhas?.length && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="p-2 text-left font-medium">Quando</th>
                    <th className="p-2 text-left font-medium">Quem fez</th>
                    <th className="p-2 text-left font-medium">Em quem</th>
                    <th className="p-2 text-left font-medium">O quê</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => (
                    <tr key={`${linha.kind}-${linha.at}-${linha.target ?? ""}`} className="border-b border-border/10">
                      <td className="p-2 whitespace-nowrap">{dateTime(linha.at)}</td>
                      <td className="p-2 truncate">{linha.actor ?? "—"}</td>
                      <td className="p-2 truncate">{linha.target ?? "—"}</td>
                      <td className="p-2">{linha.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Os e-mails são guardados como texto: as chaves para <code>profiles</code> são
            <code> on delete set null</code>, e a pergunta "quem fez isso" costuma vir depois de a
            pessoa já ter saído.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
