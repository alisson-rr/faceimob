import { useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const MIN_PASSWORD = 8;

/** O GoTrue devolve o motivo em inglês; estes são os que o próprio usuário provoca. */
const AUTH_ERRORS: Record<string, string> = {
  weak_password: `Senha fraca. Misture letras, números e ao menos ${MIN_PASSWORD} caracteres.`,
  same_password: 'A nova senha é igual à atual. Escolha outra.',
  reauthentication_not_valid: 'Código inválido ou expirado. Peça outro e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
};
const authMessage = (code: string | undefined, fallback: string) => AUTH_ERRORS[code ?? ''] ?? fallback;

/**
 * Segurança da conta.
 *
 * A conta entra por código no e-mail e, pela decisão de 21/08, também por senha
 * — quem define a própria senha é o usuário, aqui. Com "Secure password change"
 * ligado no projeto, o Supabase exige reautenticação: pedimos o código por
 * e-mail (`reauthenticate`) e refazemos a chamada com ele como `nonce`.
 *
 * "Encerrar todas as sessões" continua sendo o controle para "desconfio que
 * alguém entrou na minha conta" — daí `signOut({ scope: 'global' })`.
 */
export default function Settings() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsNonce, setNeedsNonce] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return toast({
        title: 'Senha muito curta',
        description: `Use ao menos ${MIN_PASSWORD} caracteres.`,
        variant: 'destructive',
      });
    }
    if (password !== confirmation) {
      return toast({
        title: 'As senhas não conferem',
        description: 'Digite a mesma senha nos dois campos.',
        variant: 'destructive',
      });
    }
    if (needsNonce && !nonce.trim()) {
      return toast({
        title: 'Falta o código',
        description: 'Digite o código que enviamos para o seu e-mail.',
        variant: 'destructive',
      });
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser(
        needsNonce ? { password, nonce: nonce.trim() } : { password },
      );
      if (!error) {
        setPassword('');
        setConfirmation('');
        setNonce('');
        setNeedsNonce(false);
        return toast({
          title: 'Senha salva',
          description: 'A partir de agora você também pode entrar com e-mail e senha.',
        });
      }

      // Reautenticação exigida: o Supabase manda um código por e-mail e a mesma
      // chamada é refeita com ele. Só vale uma vez — no segundo envio o `nonce`
      // já vai junto e o erro é do código, não do fluxo.
      const reason = `${error.code ?? ''} ${error.message}`.toLowerCase();
      if (reason.includes('reauthentication') && !needsNonce) {
        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) {
          return toast({
            title: 'Não foi possível enviar o código',
            description: authMessage(reauthError.code, 'Tente de novo em instantes.'),
            variant: 'destructive',
          });
        }
        setNeedsNonce(true);
        return toast({
          title: 'Confirme que é você',
          description: `Enviamos um código para ${profile?.email ?? 'seu e-mail'}. Digite-o abaixo e salve de novo.`,
        });
      }

      toast({
        title: 'Não foi possível salvar a senha',
        description: authMessage(error.code, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const revokeAllSessions = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setLoading(false);
    if (error) {
      return toast({
        title: 'Não foi possível encerrar as sessões',
        description: authMessage(error.code, 'Tente de novo em instantes.'),
        variant: 'destructive',
      });
    }
    // O onAuthStateChange do AuthContext derruba a sessão local e o guard leva ao /login.
    toast({ title: 'Sessões encerradas', description: 'Entre novamente para continuar.' });
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
              Por código enviado para{' '}
              <span className="text-foreground font-medium">{profile?.email ?? 'seu e-mail cadastrado'}</span>
              {' '}ou, depois de definir uma senha abaixo, por e-mail e senha.
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

      <Card className="p-6 border-border/30 space-y-4">
        <div className="space-y-1">
          <Label className="text-foreground font-semibold">Senha de acesso</Label>
          <p className="text-sm text-muted-foreground">
            Defina ou troque a senha desta conta. Mínimo de {MIN_PASSWORD} caracteres.
          </p>
        </div>
        <form className="space-y-3" onSubmit={savePassword}>
          <div className="space-y-1">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Repita a nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          {needsNonce && (
            <div className="space-y-1">
              <Label htmlFor="reauth-code">Código enviado por e-mail</Label>
              <Input
                id="reauth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={nonce}
                onChange={(e) => setNonce(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Este projeto pede confirmação por e-mail para trocar a senha.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={savingPassword || !password || !confirmation} className="gap-2">
              <KeyRound className="h-4 w-4" />
              {savingPassword ? 'Salvando...' : 'Salvar senha'}
            </Button>
          </div>
        </form>
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
