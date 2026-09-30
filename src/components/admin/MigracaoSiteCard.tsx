import { useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";
import { num } from "@/lib/format";

/**
 * Cópia do site para este banco (docs/migracao-site.md, etapa 2).
 *
 * "Conferir" compara a contagem de cada tabela no site e aqui. "Copiar tudo"
 * puxa usuários, tabelas e arquivos em pedaços pela edge `site-import` e
 * confere no fim. Só copia: nada é apagado no site nem aqui, e repetir não
 * duplica. Some depois da virada do domínio.
 */

type Status = {
  fonte: {
    tabelas: Record<string, number>;
    /** Tabela que o site não conseguiu contar, com o motivo. */
    erros?: Record<string, string>;
    buckets: { id: string; public: boolean }[];
  };
  destino: Record<string, number>;
  sem_par: { email: string; full_name: string | null }[] | null;
};

const BUCKETS = ["property-images", "property-docs", "campaign-images", "blog-images", "support-docs"];

async function importar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("site-import", { body });
  if (error) throw new Error(await functionErrorMessage(error, "A importação não respondeu."));
  if (!data) throw new Error("A importação respondeu sem conteúdo.");
  return data;
}

export function MigracaoSiteCard({ podeUsar }: { podeUsar: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falhasArquivos, setFalhasArquivos] = useState<string[]>([]);
  const ocupado = andamento !== null;

  const conferir = async () => {
    setErro(null);
    setAndamento("Conferindo contagens…");
    try {
      setStatus(await importar<Status>({ action: "status" }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falhou.");
    } finally {
      setAndamento(null);
    }
  };

  const copiarTudo = async () => {
    setErro(null);
    setFalhasArquivos([]);
    // O passo em que parou vai junto do erro: "não respondeu" sozinho não diz
    // se foi usuário, tabela ou arquivo — e repetir recomeça do mesmo jeito.
    let passo = "";
    const avancar = (texto: string) => {
      passo = texto;
      setAndamento(texto);
    };
    try {
      avancar("Copiando usuários…");
      await importar({ action: "usuarios" });

      // A ordem é a do banco (chaves estrangeiras primeiro).
      const { data: tabelas, error } = await supabase.rpc("site_import_tabelas" as never);
      if (error) throw new Error(error.message);
      for (const nome of (tabelas as unknown as string[]) ?? []) {
        for (let pagina = 0; ; pagina++) {
          avancar(`Copiando ${nome} (página ${pagina + 1})…`);
          const r = await importar<{ ultima: boolean }>({ action: "tabela", nome, pagina });
          if (r.ultima) break;
        }
      }

      const falhas: string[] = [];
      for (const bucket of BUCKETS) {
        avancar(`Copiando arquivos de ${bucket}…`);
        for (let de = 0; ; ) {
          // Copiar arquivo é regravar no mesmo caminho: repetir o lote que não
          // respondeu (rede, gateway) é seguro, e evita recomeçar tudo à mão.
          // Três vezes sem resposta no mesmo ponto é arquivo que não passa por
          // aqui: ele é pulado (nome e tamanho vão para a lista abaixo) e a
          // cópia segue com o resto.
          let r: { total: number; proximo: number; ultima: boolean; falhas: string[] } | undefined;
          for (let tentativa = 1; !r; tentativa++) {
            try {
              r = await importar({ action: "arquivos", bucket, de, pular: tentativa > 3 });
            } catch (e) {
              if (tentativa > 3) throw e;
            }
          }
          falhas.push(...r.falhas.map((f) => `${bucket}/${f}`));
          avancar(`Copiando arquivos de ${bucket}: ${num(r.proximo)} de ${num(r.total)}…`);
          if (r.ultima) break;
          de = r.proximo;
        }
      }
      setFalhasArquivos(falhas);
      avancar("Conferindo contagens…");
      setStatus(await importar<Status>({ action: "status" }));
    } catch (e) {
      setErro(`Parou em "${passo.replace(/…$/, "")}": ${e instanceof Error ? e.message : "falhou."}`);
    } finally {
      setAndamento(null);
    }
  };

  const linhas = status
    ? Object.entries(status.fonte.tabelas).map(([nome, fonte]) => ({ nome, fonte, destino: status.destino[nome] ?? 0 }))
    : [];
  const divergentes = linhas.filter((l) => l.fonte !== l.destino).length;

  return (
    <SectionCard
      title="Migração do site para a VPS"
      icon={ArrowRightLeft}
      description="Copia o banco e os arquivos do site (Lovable) para cá. Só copia: nada é apagado no site, e repetir não duplica."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void conferir()} disabled={!podeUsar || ocupado}>
            Conferir
          </Button>
          <Button type="button" onClick={() => void copiarTudo()} disabled={!podeUsar || ocupado}>
            {ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Copiar tudo
          </Button>
        </div>
        {andamento && <p role="status" className="text-sm text-muted-foreground">{andamento}</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

        {status && (
          <>
            <p className="text-sm">
              {divergentes === 0
                ? "Todas as tabelas batem com o site."
                : `${divergentes} tabela(s) com contagem diferente do site.`}
            </p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-label="Contagem por tabela">
              {linhas.map((l) => (
                <li key={l.nome} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                  <span className="truncate">{l.nome}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {num(l.destino)} / {num(l.fonte)}
                    <StatusBadge tone={l.fonte === l.destino ? "success" : "warning"}>
                      {l.fonte === l.destino ? "OK" : "Diferente"}
                    </StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
            {status.fonte.erros && Object.keys(status.fonte.erros).length > 0 && (
              <div className="text-sm">
                <p className="font-medium text-destructive">Tabelas que o site não conseguiu ler:</p>
                <ul className="text-muted-foreground">
                  {Object.entries(status.fonte.erros).map(([nome, motivo]) => (
                    <li key={nome}>{nome}: {motivo}</li>
                  ))}
                </ul>
              </div>
            )}
            {status.sem_par && status.sem_par.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">{status.sem_par.length} usuário(s) do site sem cadastro no CRM (mesmo e-mail):</p>
                <p className="text-muted-foreground">{status.sem_par.map((u) => u.email).join(", ")}</p>
              </div>
            )}
          </>
        )}
        {falhasArquivos.length > 0 && (
          <div className="text-sm">
            <p className="font-medium text-destructive">{falhasArquivos.length} arquivo(s) não copiados — repita a cópia:</p>
            <p className="text-muted-foreground">{falhasArquivos.slice(0, 20).join(" · ")}</p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
