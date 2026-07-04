import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Lock, Mail, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (error) {
      toast({
        title: "Não foi possível entrar",
        description: "Confira seu e-mail e senha.",
        variant: "destructive",
      });
      return;
    }

    sessionStorage.setItem("faceimob-just-logged", "true");
    navigate("/dashboard");
  };

  return (
    <div className="h-[100svh] w-full flex items-center justify-center bg-background p-4 overflow-hidden relative">
      {/* Animated background orbs */}
      <motion.div
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/8 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ x: [0, -20, 0], y: [0, 30, 0] }}
        transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="glass-strong glow-primary border-primary/20">
          <CardHeader className="text-center space-y-4">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto"
            >
              <img src={logoWhite} alt="Faceimob" className="h-12 object-contain" />
            </motion.div>
            <CardDescription className="mt-2">
              Acesse sua plataforma de gestão imobiliária
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="email" placeholder="seu@email.com" className="pl-10 glass-subtle" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </motion.div>
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.4 }}>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="password" placeholder="Senha" className="pl-10 glass-subtle" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                <Button type="submit" className="w-full glow-primary pulse-glow" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </motion.div>
              <button type="button" className="w-full text-sm text-muted-foreground hover:text-primary transition-colors">
                Esqueceu sua senha?
              </button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
