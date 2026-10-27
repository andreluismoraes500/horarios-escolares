import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/stores/auth";
import { Button, Card, Campo, Input } from "@/components/ui";

const schema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail.").email("E-mail inválido."),
  senha: z.string().min(1, "Informe a senha."),
});

export default function Login() {
  const entrar = useAuth((s) => s.entrar);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const r = schema.safeParse({ email, senha });
    if (!r.success) return toast.error(r.error.issues[0].message);
    setCarregando(true);
    try {
      await entrar(r.data.email, r.data.senha);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="rounded-full bg-primary/10 p-3">
            <CalendarDays className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Horários Escolares</h1>
          <p className="text-sm text-muted-foreground">Entre com sua conta para continuar</p>
        </div>
        <form onSubmit={enviar} className="space-y-4">
          <Campo label="E-mail">
            <Input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <Campo label="Senha">
            <Input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Campo>
          <Button type="submit" className="w-full" disabled={carregando}>
            {carregando ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
