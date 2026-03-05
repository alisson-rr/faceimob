import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link2, Plus, ExternalLink, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

const defaultLinks = [
  { id: '1', title: 'Portal do Corretor', url: 'https://portal.example.com', category: 'Ferramentas' },
  { id: '2', title: 'Tabela de Preços', url: 'https://precos.example.com', category: 'Documentos' },
  { id: '3', title: 'Material de Marketing', url: 'https://marketing.example.com', category: 'Marketing' },
  { id: '4', title: 'Simulador de Financiamento', url: 'https://simulador.example.com', category: 'Ferramentas' },
];

export default function Links() {
  const [links] = useState(defaultLinks);

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Link copiado!" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Links</h1>
          <p className="text-muted-foreground">Links úteis da operação</p>
        </div>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Novo Link</Button>
      </div>
      <div className="grid gap-3">
        {links.map(link => (
          <Card key={link.id} className="glass hover:bg-secondary/50 transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Link2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{link.title}</p>
                  <p className="text-xs text-muted-foreground">{link.category}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={() => copyLink(link.url)}><Copy className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" asChild><a href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
