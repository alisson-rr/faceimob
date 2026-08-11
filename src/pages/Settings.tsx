import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Segurança da conta.
 *
 * Não há troca de senha porque não há senha: o acesso é por código no e-mail.
 * O controle equivalente para "desconfio que alguém entrou na minha conta" é
 * revogar as sessões — daí `signOut({ scope: 'global' })`.
 */
export default function Settings() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);

  const revokeAllSessions = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setLoading(false);
    if (error) {
      return toast({ title: 'Não foi possível encerrar as sessões', description: error.message, variant: 'destructive' });
    }
    // O onAuthStateChange do AuthContext derruba a sessão local e o guard leva ao /login.
    toast({ title: 'Sessões encerradas', description: 'Entre novamente com o código enviado ao seu e-mail.' });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Configurações</h1>
      <Card className="p-6 border-border/30 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1">
            <Label className="text-foreground font-semibold">Como você entra</Label>
            <p className="text-sm text-muted-foreground">
              O acesso é por código enviado para{' '}
              <span className="text-foreground font-medium">{profile?.email ?? 'seu e-mail cadastrado'}</span>.
              Não existe senha nesta conta — nada para vazar, nada para trocar.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 pt-4 border-t border-border/30">
          <KeyRound className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-1">
            <Label className="text-foreground font-semibold">Trocar o e-mail de acesso</Label>
            <p className="text-sm text-muted-foreground">
              O e-mail é a credencial da conta. Peça a alteração a um administrador.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 border-destructive/30 space-y-4">
        <div className="space-y-1">
          <Label className="text-foreground font-semibold">Encerrar todas as sessões</Label>
          <p className="text-sm text-muted-foreground">
            Desconecta esta conta de todos os dispositivos, inclusive deste. Use se
            achar que alguém acessou seu e-mail.
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="destructive" onClick={revokeAllSessions} disabled={loading} className="gap-2">
            <LogOut className="h-4 w-4" />
            {loading ? 'Encerrando...' : 'Encerrar todas as sessões'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
