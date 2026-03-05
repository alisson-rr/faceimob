import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockDeals, mockGamification } from "@/data/mockData";
import { TrendingUp, CheckCircle, Clock, FileText, Trophy, ArrowUp } from "lucide-react";

const metrics = [
  {
    title: "Deals Ativos",
    value: mockDeals.filter(d => d.active).length,
    icon: TrendingUp,
    color: "text-primary",
    glow: "glow-primary",
  },
  {
    title: "Aprovados",
    value: mockDeals.filter(d => d.stage === 'approved').length,
    icon: CheckCircle,
    color: "text-success",
    glow: "glow-success",
  },
  {
    title: "Pendentes",
    value: mockDeals.filter(d => ['lead', 'proposal'].includes(d.stage)).length,
    icon: Clock,
    color: "text-warning",
    glow: "glow-warning",
  },
  {
    title: "Propostas Hoje",
    value: 3,
    icon: FileText,
    color: "text-primary",
    glow: "glow-primary",
  },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da operação</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Card key={m.title} className={`glass ${m.glow}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{m.title}</p>
                  <p className="text-3xl font-bold mt-1">{m.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl bg-secondary flex items-center justify-center ${m.color}`}>
                  <m.icon className="h-6 w-6" />
                </div>
              </div>
              <div className="flex items-center gap-1 mt-3 text-xs text-success">
                <ArrowUp className="h-3 w-3" />
                <span>12% vs mês anterior</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leaderboard */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" />
            Ranking de Corretores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {mockGamification.sort((a, b) => b.points - a.points).map((entry, i) => (
              <div key={entry.id} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  i === 0 ? 'bg-warning/20 text-warning' : i === 1 ? 'bg-muted-foreground/20 text-muted-foreground' : i === 2 ? 'bg-warning/10 text-warning/70' : 'bg-secondary text-muted-foreground'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{entry.user_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.deals_closed} deals • {entry.calls} ligações • {entry.leads_collected} leads
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">{entry.points}</p>
                  <p className="text-xs text-muted-foreground">pontos</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
