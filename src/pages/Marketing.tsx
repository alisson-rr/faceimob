import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockCampaigns } from "@/data/mockData";
import { Megaphone, TrendingUp, Users, Target } from "lucide-react";

export default function Marketing() {
  const totalLeads = mockCampaigns.reduce((a, c) => a + c.leads_generated, 0);
  const totalConverted = mockCampaigns.reduce((a, c) => a + c.deals_converted, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-muted-foreground">Campanhas e fontes de leads</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass glow-primary">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Megaphone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{mockCampaigns.length}</p>
                <p className="text-sm text-muted-foreground">Campanhas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass glow-success">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/20 flex items-center justify-center">
                <Users className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalLeads}</p>
                <p className="text-sm text-muted-foreground">Leads Gerados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass glow-warning">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning/20 flex items-center justify-center">
                <Target className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{((totalConverted / totalLeads) * 100).toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Taxa de Conversão</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Campanhas Ativas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="text-left p-3 font-medium">Campanha</th>
                  <th className="text-left p-3 font-medium">Fonte</th>
                  <th className="text-left p-3 font-medium">Leads</th>
                  <th className="text-left p-3 font-medium">Convertidos</th>
                  <th className="text-left p-3 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {mockCampaigns.map(c => (
                  <tr key={c.id} className="border-b border-border/30 hover:bg-secondary/50 transition-colors">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-muted-foreground">{c.source}</td>
                    <td className="p-3">{c.leads_generated}</td>
                    <td className="p-3 text-success">{c.deals_converted}</td>
                    <td className="p-3">{((c.deals_converted / c.leads_generated) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
