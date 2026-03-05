import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Compass } from "lucide-react";

export default function Norteador() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Norteador</h1>
        <p className="text-muted-foreground">Guia estratégico de vendas</p>
      </div>
      <Card className="glass">
        <CardContent className="p-8 text-center">
          <Compass className="h-12 w-12 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Em breve: ferramentas de orientação estratégica para sua operação.</p>
        </CardContent>
      </Card>
    </div>
  );
}
