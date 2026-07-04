import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Lock, Eye, EyeOff } from "lucide-react";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase auto-parses the recovery hash and creates a session
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return toast({ title: "Senha muito curta", description: "Use ao menos 10 caracteres, misturando letras, números e símbolos.", variant: "destructive" });
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return toast({ title: "Senha fraca", description: "Inclua maiúscula, minúscula, número e símbolo.", variant: "destructive" });
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      const weak = /weak|pwned|known/i.test(error.message);
      return toast({
        title: "Falha ao redefinir",
        description: weak
          ? "Essa senha já vazou em outros sites e não é segura. Escolha uma senha única, com maiúsculas, minúsculas, números e símbolos."
          : error.message,
        variant: "destructive",
      });
    }
    toast({ title: "Senha atualizada", description: "Faça login com a nova senha." });
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="h-[100svh] w-full flex items-center justify-center bg-background p-4 overflow-hidden">
      <Card className="glass-strong glow-primary border-primary/20 w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <img src={logoWhite} alt="Faceimob" className="h-12 object-contain mx-auto" />
          <CardDescription>Defina sua nova senha</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type={show ? "text" : "password"}
                placeholder="Nova senha"
                className="pl-10 pr-10 glass-subtle"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!ready}
              />
              <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Use ao menos 10 caracteres com maiúscula, minúscula, número e símbolo. Evite senhas comuns (ex.: <code>Face@1234</code>).
            </p>
            <Button type="submit" className="w-full" disabled={loading || !ready}>
              {loading ? "Salvando..." : ready ? "Redefinir senha" : "Aguardando link válido..."}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
