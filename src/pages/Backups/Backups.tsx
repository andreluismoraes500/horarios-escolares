import { useEffect, useState } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { Badge, Button, Campo, Card, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { formatarDataHora, formatarTamanho } from "@/lib/utils";
import type { ConfigBackup, EntradaBackup } from "@/types";

const TIPOS: Record<string, string> = {
  manual: "Manual", automatico: "Automático", pre_restauracao: "Pré-restauração", restauracao: "Restauração",
};

export default function Backups() {
  const { pode, sair } = useAuth();
  const [log, setLog] = useState<EntradaBackup[]>([]);
  const [cfg, setCfg] = useState<ConfigBackup | null>(null);
  const [exp, setExp] = useState<{ senha: string; senha2: string } | null>(null);
  const [imp, setImp] = useState<{ caminho: string; senha: string; snapshot: boolean } | null>(null);

  const recarregar = async () => {
    try {
      setLog(await api.listarBackups());
      setCfg(await api.obterConfigBackup());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  useEffect(() => { void recarregar(); }, []);

  async function exportar() {
    if (!exp) return;
    if (exp.senha.length < 6) return toast.error("A senha deve ter pelo menos 6 caracteres.");
    if (exp.senha !== exp.senha2) return toast.error("As senhas não conferem.");
    const caminho = await save({
      defaultPath: `horarios-${new Date().toISOString().slice(0, 10)}.bak`,
      filters: [{ name: "Backup", extensions: ["bak"] }],
    });
    if (!caminho) return;
    const ok = await executar(() => api.exportarBackup(caminho, exp.senha), "Backup exportado e criptografado.");
    if (ok) {
      setExp(null);
      await recarregar();
    }
  }

  async function escolherArquivo() {
    const r = await open({ multiple: false, filters: [{ name: "Backup", extensions: ["bak"] }] });
    if (typeof r === "string") setImp({ caminho: r, senha: "", snapshot: true });
  }

  async function importar() {
    if (!imp) return;
    try {
      const snap = await api.importarBackup(imp.caminho, imp.senha, imp.snapshot);
      toast.success(snap ? `Backup restaurado. Snapshot de segurança salvo em: ${snap}` : "Backup restaurado.");
      setImp(null);
      // As sessões foram encerradas pela restauração: refaz o login.
      await sair();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function escolherPasta() {
    const r = await open({ directory: true });
    if (typeof r === "string" && cfg) setCfg({ ...cfg, pasta: r });
  }

  async function salvarCfg() {
    if (!cfg) return;
    if (await executar(() => api.salvarConfigBackup(cfg), "Configuração salva.")) await recarregar();
  }

  return (
    <>
      <Titulo
        titulo="Backups"
        subtitulo="Arquivos .bak criptografados (AES-256-GCM). Guarde a senha: sem ela o backup não pode ser restaurado."
        acoes={
          <>
            {pode("backup", "criar") && <Button onClick={() => setExp({ senha: "", senha2: "" })}><Download className="h-4 w-4" />Exportar backup</Button>}
            {pode("backup", "editar") && <Button variant="outline" onClick={escolherArquivo}><Upload className="h-4 w-4" />Importar backup</Button>}
          </>
        }
      />

      {cfg && pode("backup", "editar") && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 font-medium">Backup automático</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <Campo label="Frequência">
              <Select value={cfg.auto} onChange={(e) => setCfg({ ...cfg, auto: e.target.value as ConfigBackup["auto"] })}>
                <option value="off">Desativado</option>
                <option value="diario">Diário</option>
                <option value="semanal">Semanal</option>
              </Select>
            </Campo>
            <Campo label="Pasta de destino" dica={`Vazio = ${cfg.pasta_padrao}`} className="md:col-span-2">
              <div className="flex gap-2">
                <Input value={cfg.pasta} onChange={(e) => setCfg({ ...cfg, pasta: e.target.value })} placeholder={cfg.pasta_padrao} />
                <Button variant="outline" onClick={escolherPasta} aria-label="Escolher pasta"><FolderOpen className="h-4 w-4" /></Button>
              </div>
            </Campo>
            <Campo label="Senha dos backups automáticos" dica={cfg.tem_senha ? "Já definida. Preencha só para trocar." : "Obrigatória para ativar."}>
              <Input type="password" autoComplete="new-password" value={cfg.senha ?? ""} onChange={(e) => setCfg({ ...cfg, senha: e.target.value })} />
            </Campo>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Último backup automático: {cfg.ultimo ? new Date(cfg.ultimo).toLocaleString("pt-BR") : "nunca"}</span>
            <Button onClick={salvarCfg}>Salvar configuração</Button>
          </div>
        </Card>
      )}

      <h2 className="mb-2 font-medium">Histórico</h2>
      {log.length === 0 ? <Vazio texto="Nenhum backup registrado." /> : (
        <Tabela>
          <thead><tr><Th>Data</Th><Th>Tipo</Th><Th>Arquivo</Th><Th>Tamanho</Th><Th>Usuário</Th><Th>Resultado</Th></tr></thead>
          <tbody>
            {log.map((b) => (
              <tr key={b.id}>
                <Td className="whitespace-nowrap">{formatarDataHora(b.data)}</Td>
                <Td><Badge>{TIPOS[b.tipo] ?? b.tipo}</Badge></Td>
                <Td className="max-w-xs truncate" title={b.arquivo}>{b.arquivo}</Td>
                <Td>{formatarTamanho(b.tamanho)}</Td>
                <Td>{b.usuario}</Td>
                <Td>{b.sucesso ? "OK" : <span className="text-destructive" title={b.detalhe ?? ""}>Falhou</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      <Modal aberto={!!exp} onFechar={() => setExp(null)} titulo="Exportar backup" descricao="Escolha uma senha para criptografar o arquivo." largura="max-w-sm">
        {exp && (
          <div className="space-y-3">
            <Campo label="Senha do backup"><Input type="password" autoComplete="new-password" value={exp.senha} onChange={(e) => setExp({ ...exp, senha: e.target.value })} /></Campo>
            <Campo label="Confirmar senha"><Input type="password" autoComplete="new-password" value={exp.senha2} onChange={(e) => setExp({ ...exp, senha2: e.target.value })} /></Campo>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setExp(null)}>Cancelar</Button>
              <Button onClick={exportar}>Escolher local e exportar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!imp} onFechar={() => setImp(null)} titulo="Restaurar backup" largura="max-w-md"
        descricao="Todos os dados atuais serão SUBSTITUÍDOS pelos do arquivo. Após restaurar, será preciso entrar novamente.">
        {imp && (
          <div className="space-y-3">
            <div className="break-all rounded bg-muted p-2 text-xs">{imp.caminho}</div>
            <Campo label="Senha do backup"><Input type="password" autoFocus value={imp.senha} onChange={(e) => setImp({ ...imp, senha: e.target.value })} /></Campo>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={imp.snapshot} onChange={(e) => setImp({ ...imp, snapshot: e.target.checked })} />
              Criar snapshot de segurança do estado atual antes de restaurar
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setImp(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={importar} disabled={!imp.senha}>Restaurar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
