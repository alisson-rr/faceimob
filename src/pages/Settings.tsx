import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Eye, EyeOff, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-10 h-11 bg-background"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (!current || !next || !confirm) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    if (next.length < 6) {
      toast({ title: 'A nova senha deve ter ao menos 6 caracteres', variant: 'destructive' });
      return;
    }
    if (next !== confirm) {
      toast({ title: 'As senhas não coincidem', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error('Usuário não autenticado');

      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signInErr) {
        toast({ title: 'Senha atual incorreta', variant: 'destructive' });
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;

      toast({ title: 'Senha alterada com sucesso!' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e: any) {
      toast({ title: 'Erro ao alterar senha', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card className="p-6 bg-[#0f1729] border-border/30 space-y-5">
        <div className="space-y-2">
          <Label className="text-foreground font-semibold">Sua senha atual</Label>
          <PasswordInput value={current} onChange={setCurrent} placeholder="Inserir senha" />
          <p className="text-xs text-muted-foreground">
            Para alterar senha primeiro insira sua senha atual e insira novos dados nos campos abaixo e confirme
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-foreground font-semibold">Nova senha</Label>
          <PasswordInput value={next} onChange={setNext} placeholder="Inserir nova senha" />
        </div>

        <div className="space-y-2">
          <Label className="text-foreground font-semibold">Confirmar nova senha</Label>
          <PasswordInput value={confirm} onChange={setConfirm} placeholder="Inserir senha" />
        </div>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            onClick={handleChange}
            disabled={loading}
            className="text-primary hover:text-primary gap-2"
          >
            <Pencil className="h-4 w-4" />
            {loading ? 'Alterando...' : 'Alterar senha'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
