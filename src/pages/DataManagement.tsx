import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockDevelopers, mockProjects, mockSources, mockTeams } from "@/data/mockData";
import { Plus, X } from "lucide-react";
import { useState } from "react";

function DataList({ title, items: initialItems }: { title: string; items: string[] }) {
  const [items, setItems] = useState(initialItems);
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (newItem.trim()) {
      setItems([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder={`Novo ${title.toLowerCase()}...`} value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
        <Button size="sm" onClick={addItem}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
            <span className="text-sm">{item}</span>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DataManagement() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gestão de Dados</h1>
        <p className="text-muted-foreground">Gerencie os dados cadastrais do sistema</p>
      </div>

      <Tabs defaultValue="developers">
        <TabsList className="glass">
          <TabsTrigger value="developers">Incorporadoras</TabsTrigger>
          <TabsTrigger value="projects">Empreendimentos</TabsTrigger>
          <TabsTrigger value="sources">Fontes</TabsTrigger>
          <TabsTrigger value="teams">Times</TabsTrigger>
        </TabsList>

        <TabsContent value="developers" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Incorporadora" items={mockDevelopers} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Empreendimento" items={mockProjects} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Fonte" items={mockSources} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          <Card className="glass"><CardContent className="p-4"><DataList title="Time" items={mockTeams} /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
