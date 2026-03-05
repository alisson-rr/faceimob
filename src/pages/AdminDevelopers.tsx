import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface DeveloperConfig {
  name: string;
  usesInternalCca: boolean;
}

const initialDevelopers: DeveloperConfig[] = [
  { name: 'MRV', usesInternalCca: true },
  { name: 'Tenda', usesInternalCca: true },
  { name: 'Direcional', usesInternalCca: true },
  { name: 'Cyrela', usesInternalCca: false },
  { name: 'Eztec', usesInternalCca: false },
  { name: 'Even', usesInternalCca: false },
];

export default function AdminDevelopers() {
  const [developers, setDevelopers] = useState(initialDevelopers);
  const [newDev, setNewDev] = useState("");

  const toggleCca = (name: string) => {
    setDevelopers(prev => prev.map(d => d.name === name ? { ...d, usesInternalCca: !d.usesInternalCca } : d));
    toast({ title: "Configuração atualizada" });
  };

  const addDev = () => {
    if (!newDev.trim()) return;
    setDevelopers(prev => [...prev, { name: newDev.trim(), usesInternalCca: false }]);
    setNewDev("");
    toast({ title: "Construtora adicionada" });
  };

  const removeDev = (name: string) => {
    setDevelopers(prev => prev.filter(d => d.name !== name));
    toast({ title: "Construtora removida" });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Construtoras & CCA</h1>
        <p className="text-xs text-muted-foreground">Configure quais construtoras utilizam o CCA interno para aprovação de crédito</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Adicionar Construtora</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex gap-2">
            <Input value={newDev} onChange={e => setNewDev(e.target.value)} placeholder="Nome da construtora" className="text-xs max-w-64" />
            <Button size="sm" onClick={addDev}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40">
                <th className="p-3 text-left font-medium text-muted-foreground">Construtora</th>
                <th className="p-3 text-center font-medium text-muted-foreground">CCA Interno</th>
                <th className="p-3 text-center font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {developers.map(dev => (
                <tr key={dev.name} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-3 font-medium">{dev.name}</td>
                  <td className="p-3 text-center">
                    <Switch checked={dev.usesInternalCca} onCheckedChange={() => toggleCca(dev.name)} />
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant="outline" className={dev.usesInternalCca ? "text-amber-400 border-amber-400/30" : "text-muted-foreground"}>
                      {dev.usesInternalCca ? 'CCA Ativo' : 'Sem CCA'}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => removeDev(dev.name)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
