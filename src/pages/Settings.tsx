import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Bell, Shield, Palette } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Configurações do sistema</p>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /> Notificações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="font-medium">Notificações por email</p><p className="text-sm text-muted-foreground">Receba alertas sobre novos leads</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">Alertas de pipeline</p><p className="text-sm text-muted-foreground">Notificar mudanças de etapa</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">Relatórios semanais</p><p className="text-sm text-muted-foreground">Receba resumo semanal</p></div>
            <Switch />
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-success" /> Segurança</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><p className="font-medium">Autenticação em dois fatores</p><p className="text-sm text-muted-foreground">Camada extra de segurança</p></div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div><p className="font-medium">Sessão única</p><p className="text-sm text-muted-foreground">Permitir apenas uma sessão ativa</p></div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
