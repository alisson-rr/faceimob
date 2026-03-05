import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserCircle, Mail, Phone, Shield } from "lucide-react";

export default function Profile() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Meu Perfil</h1>
        <p className="text-muted-foreground">Gerencie suas informações pessoais</p>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-primary" /> Informações Pessoais
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center text-primary text-2xl font-bold">A</div>
            <div>
              <p className="font-medium text-lg">Admin</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" /> Administrador</p>
            </div>
          </div>
          <div className="grid gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Nome</label>
              <Input defaultValue="Admin" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Email</label>
              <Input defaultValue="admin@imobcrm.com" type="email" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Telefone</label>
              <Input defaultValue="(11) 99999-0000" />
            </div>
          </div>
          <Button className="mt-4">Salvar Alterações</Button>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Alterar Senha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input type="password" placeholder="Senha atual" />
          <Input type="password" placeholder="Nova senha" />
          <Input type="password" placeholder="Confirmar nova senha" />
          <Button variant="outline">Atualizar Senha</Button>
        </CardContent>
      </Card>
    </div>
  );
}
