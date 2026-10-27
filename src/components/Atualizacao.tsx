// Atualização do app via GitHub Releases (plugin updater do Tauri).
// Ao abrir, verifica em segundo plano; se houver versão nova, mostra um aviso e o usuário decide.
// Os dados ficam na pasta de dados do usuário (fora da instalação) e as migrações do banco rodam
// sozinhas; antes de instalar é feita ainda uma cópia de segurança do banco.

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";

const emTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface Nova { versao: string; notas: string; instalar: (cb: (pct: number | null) => void) => Promise<void> }

export default function Atualizacao() {
  const [versao, setVersao] = useState("");
  const [nova, setNova] = useState<Nova | null>(null);
  const [aberto, setAberto] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [pct, setPct] = useState<number | null>(null);

  const verificar = useCallback(async (manual: boolean) => {
    if (!emTauri) {
      if (manual) toast.info("A atualização funciona no aplicativo instalado (não no navegador).");
      return;
    }
    setVerificando(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const up = await check();
      if (!up) {
        if (manual) toast.success("Você já está na versão mais recente.");
        return;
      }
      setNova({
        versao: up.version,
        notas: up.body ?? "",
        instalar: async (cb) => {
          // 1) cópia de segurança do banco; 2) baixa e instala; 3) reinicia.
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("copia_pre_atualizacao");
          let total = 0, baixado = 0;
          await up.downloadAndInstall((e) => {
            if (e.event === "Started") total = e.data.contentLength ?? 0;
            else if (e.event === "Progress") { baixado += e.data.chunkLength; cb(total ? Math.round((baixado / total) * 100) : null); }
            else if (e.event === "Finished") cb(100);
          });
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        },
      });
      setAberto(true);
    } catch (e) {
      // Sem internet, repositório ainda não configurado etc.: só avisa quando o usuário pediu.
      if (manual) toast.error("Não foi possível verificar atualizações agora. Confira a internet e tente de novo.");
      console.warn("Falha ao verificar atualização:", e);
    } finally {
      setVerificando(false);
    }
  }, []);

  useEffect(() => {
    if (!emTauri) return;
    import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setVersao).catch(() => undefined);
    const t = setTimeout(() => void verificar(false), 5000);
    return () => clearTimeout(t);
  }, [verificar]);

  async function atualizar() {
    if (!nova) return;
    setInstalando(true);
    try {
      await nova.instalar(setPct);
    } catch (e) {
      toast.error("Falha ao atualizar: " + ((e as Error).message ?? String(e)) + ". Seus dados não foram alterados.");
      setInstalando(false);
    }
  }

  return (
    <>
      <div className="border-t p-2">
        <button
          type="button"
          onClick={() => (nova ? setAberto(true) : void verificar(true))}
          disabled={verificando}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
        >
          {nova ? <Download className="h-4 w-4 text-primary" /> : <RefreshCw className={verificando ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
          <span className="flex-1">
            {nova ? <b className="text-primary">Atualização {nova.versao} disponível</b> : verificando ? "Verificando…" : "Verificar atualizações"}
          </span>
          {versao && <span>v{versao}</span>}
        </button>
      </div>

      <Modal aberto={aberto} onFechar={() => !instalando && setAberto(false)} titulo="Nova versão disponível"
        descricao={nova ? `Versão ${nova.versao} (você usa a ${versao || "atual"})` : undefined} largura="max-w-md">
        {nova && (
          <div className="space-y-3 text-sm">
            {nova.notas && <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">{nova.notas}</div>}
            <p className="text-muted-foreground">
              Seus dados (escolas, professores, grade, usuários) <b>são mantidos</b>. O sistema faz uma cópia de segurança do banco antes de instalar e reinicia sozinho no fim.
            </p>
            {instalando && (
              <div>
                <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${pct ?? 10}%` }} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{pct != null && pct >= 100 ? "Instalando e reiniciando…" : `Baixando… ${pct ?? ""}${pct != null ? "%" : ""}`}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={instalando} onClick={() => setAberto(false)}>Depois</Button>
              <Button disabled={instalando} onClick={atualizar}><Download className="h-4 w-4" />Atualizar agora</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
