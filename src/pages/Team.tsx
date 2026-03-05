import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockBrokers, mockManagers } from "@/data/mockData";
import { Users, UserCheck, TrendingUp } from "lucide-react";

export default function Team() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-muted-foreground">Gerenciamento de corretores e gerentes</p>
      </div>

      <Tabs defaultValue="brokers">
        <TabsList className="glass">
          <TabsTrigger value="brokers">Corretores</TabsTrigger>
          <TabsTrigger value="managers">Gerentes</TabsTrigger>
        </TabsList>

        <TabsContent value="brokers" className="space-y-3 mt-4">
          {mockBrokers.map(b => (
            <Card key={b.id} className="glass hover:bg-secondary/50 transition-colors">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold">
                    {b.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-muted-foreground">Time {b.team}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium">{b.monthly_sales} vendas</p>
                    <p className="text-xs text-muted-foreground">R$ {(b.monthly_vgv / 1000000).toFixed(1)}M VGV</p>
                  </div>
                  <Badge variant={b.active ? "default" : "secondary"}>
                    {b.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="managers" className="space-y-3 mt-4">
          {mockManagers.map(m => (
            <Card key={m.id} className="glass hover:bg-secondary/50 transition-colors">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center text-success font-semibold">
                    {m.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted-foreground">Time {m.team}</p>
                  </div>
                </div>
                <Badge variant={m.active ? "default" : "secondary"}>
                  {m.active ? 'Ativo' : 'Inativo'}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
