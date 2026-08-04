import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Mail, KeyRound, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Login por código no e-mail (ata 23/07): não existe senha no fluxo.
 *
 * `shouldCreateUser: false` é a trava que importa — sem ela o Supabase cria
 * conta para qualquer e-mail digitado, e a tela de login viraria auto-cadastro.
 * Conta é criada só por `provision-broker-user`.
 */
const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) {
      return toast({ title: "Informe seu e-mail", description: "Digite o e-mail cadastrado para receber o código.", variant: "destructive" });
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: false },
    });
    setLoading(false);

    if (error) {
      // Rate limit tem mensagem própria; o resto vira uma resposta única para
      // não revelar quais e-mails existem no sistema.
      const rateLimited = /rate|limit|seconds/i.test(error.message);
      return toast({
        title: rateLimited ? "Aguarde para pedir outro código" : "Não foi possível enviar",
        description: rateLimited
          ? "Já enviamos um código há pouco. Espere um minuto e tente de novo."
          : "Se este e-mail estiver cadastrado, o código chegará em instantes.",
        variant: "destructive",
      });
    }

    setEmail(target);
    setStep("code");
    setCooldown(RESEND_SECONDS);
    toast({ title: "Código enviado", description: `Enviamos um código de ${CODE_LENGTH} dígitos para ${target}.` });
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (token.length !== CODE_LENGTH) {
      return toast({ title: "Código incompleto", description: `O código tem ${CODE_LENGTH} dígitos.`, variant: "destructive" });
    }

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setLoading(false);

    if (error) {
      const expired = /expired/i.test(error.message);
      setCode("");
      codeInputRef.current?.focus();
      return toast({
        title: expired ? "Código expirado" : "Código inválido",
        description: expired ? "Peça um novo código para continuar." : "Confira os dígitos e tente novamente.",
        variant: "destructive",
      });
    }

    sessionStorage.setItem("faceimob-just-logged", "true");
    navigate("/dashboard");
  };

  const backToEmail = () => {
    setStep("email");
    setCode("");
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
              {step === "email"
                ? "Entre com seu e-mail — enviamos um código de acesso"
                : `Digite o código enviado para ${email}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "email" ? (
              <form onSubmit={sendCode} className="space-y-4">
                <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      className="pl-10 glass-subtle"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </motion.div>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
                  <Button type="submit" className="w-full glow-primary pulse-glow" disabled={loading}>
                    {loading ? "Enviando..." : "Enviar código"}
                  </Button>
                </motion.div>
                <p className="text-[11px] text-center text-muted-foreground">
                  O acesso é sempre por código. Não usamos senha.
                </p>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="space-y-4">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_LENGTH}
                    placeholder="000000"
                    aria-label="Código de acesso"
                    className="pl-10 glass-subtle tracking-[0.4em] text-center text-lg"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <Button type="submit" className="w-full glow-primary" disabled={loading || code.length !== CODE_LENGTH}>
                  {loading ? "Verificando..." : "Entrar"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={backToEmail}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <ArrowLeft className="h-3 w-3" /> Trocar e-mail
                  </button>
                  <button
                    type="button"
                    onClick={() => sendCode()}
                    disabled={cooldown > 0 || loading}
                    className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
