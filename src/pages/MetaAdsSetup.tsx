import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, ExternalLink, Plug, Webhook, ShieldCheck, Facebook } from "lucide-react";
import { toast } from "sonner";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-ads-webhook`;
const VERIFY_TOKEN = "faceimob_meta_verify";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`${label} copiado`);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button variant="outline" size="icon" onClick={onCopy}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function MetaAdsSetup() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Facebook className="h-6 w-6 text-primary" /> Configuração do Meta Ads
          </h1>
          <p className="text-sm text-muted-foreground">
            Conecte seus formulários de Lead Ads para receber leads em tempo real no CRM.
          </p>
        </div>
        <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Webhook ativo</Badge>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Webhook className="h-4 w-4" /> Credenciais do Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyField label="Callback URL" value={WEBHOOK_URL} />
          <CopyField label="Verify Token" value={VERIFY_TOKEN} />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Passo a passo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {[
            {
              t: "1. Acesse o Meta for Developers",
              d: "Entre em developers.facebook.com, crie (ou selecione) um App do tipo Business.",
              link: "https://developers.facebook.com/apps/",
            },
            {
              t: "2. Adicione o produto Webhooks",
              d: "No painel do App → 'Adicionar produto' → Webhooks. Selecione o objeto 'Page'.",
            },
            {
              t: "3. Configure o Callback",
              d: "Cole a Callback URL e o Verify Token acima. Clique em 'Verificar e Salvar'.",
            },
            {
              t: "4. Assine o campo leadgen",
              d: "Na lista de campos da Page, marque 'leadgen' e clique em Subscribe.",
            },
            {
              t: "5. Conecte sua Página do Facebook",
              d: "No produto 'Marketing API' → Ferramentas → Lead Ads Testing, associe sua Página e envie um lead de teste.",
              link: "https://developers.facebook.com/tools/lead-ads-testing",
            },
            {
              t: "6. Valide no CRM",
              d: "O lead aparecerá em Pipeline → aba Leads e no Dashboard → aba Leads em segundos.",
            },
          ].map((s, i) => (
            <div key={i} className="flex gap-3 p-3 rounded-lg border border-border bg-card">
              <div className="w-7 h-7 shrink-0 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{s.t}</p>
                <p className="text-muted-foreground text-xs mt-0.5">{s.d}</p>
                {s.link && (
                  <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-1 hover:underline">
                    Abrir <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Plug className="h-4 w-4" /> Formato esperado (fallback direto)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Se preferir enviar leads via POST direto (Zapier, Make, N8N), use a mesma URL com este JSON:
          </p>
          <pre className="text-xs bg-muted text-muted-foreground border border-border rounded-lg p-3 overflow-x-auto font-mono">
{`POST ${WEBHOOK_URL}
Content-Type: application/json

{
  "name": "João Silva",
  "phone": "51999999999",
  "email": "joao@email.com",
  "source": "Meta Ads"
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
