import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type SalaInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Confirmar, Input, Modal, Select, Tabela, Td, Textarea, Th, Titulo, Vazio } from "@/components/ui";
import { ExcluirLote, TdSel, ThSel, useSelecao } from "@/components/Lote";
import type { Sala, TipoSala } from "@/types";

export const TIPOS_SALA: Record<TipoSala, string> = {
  sala_aula: "Sala de aula",
  laboratorio: "Laboratório",
  quadra: "Quadra",
  biblioteca: "Biblioteca",
  auditorio: "Auditório",
  outro: "Outro",
};

export default function Salas() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, salas, carregar } = useDados();
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("");
  const [edit, setEdit] = useState<{ id: number | null; dados: SalaInput } | null>(null);
  const [excluir, setExcluir] = useState<Sala | null>(null);

  const lista = useMemo(
    () => salas.filter((s) => s.nome.toLowerCase().includes(busca.toLowerCase()) && (!tipo || s.tipo === tipo)),
    [salas, busca, tipo],
  );

  const selecao = useSelecao(lista);

  async function salvar() {
    if (!edit || !escolaId) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome da sala.");
    const ok = await executar(
      () => (edit.id ? api.atualizarSala(edit.id, edit.dados) : api.criarSala({ ...edit.dados, escola_id: escolaId })),
      "Sala salva.",
    );
    if (ok) {
      setEdit(null);
      await carregar(["salas"]);
    }
  }

  return (
    <>
      <Titulo
        titulo="Salas e espaços"
        acoes={pode("salas", "criar") && escolaId && (
          <Button onClick={() => setEdit({ id: null, dados: { escola_id: escolaId, nome: "", tipo: "sala_aula", capacidade: 30, observacoes: "" } })}>
            <Plus className="h-4 w-4" />Nova sala
          </Button>
        )}
      />
      <div className="mb-3 flex gap-2">
        <Input className="max-w-xs" placeholder="Buscar por nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select className="w-52" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_SALA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {pode("salas", "excluir") && (
        <div className="mb-3 empty:hidden">
          <ExcluirLote s={selecao} singular="sala" plural="salas" aviso="As aulas alocadas nelas também serão removidas." excluirUm={api.excluirSala} depois={() => carregar(["salas", "aulas"])} />
        </div>
      )}
      {lista.length === 0 ? <Vazio texto="Nenhuma sala encontrada." /> : (
        <Tabela>
          <thead><tr>{pode("salas", "excluir") && <ThSel s={selecao} />}<Th>Nome</Th><Th>Tipo</Th><Th>Capacidade</Th><Th>Observações</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id}>
                {pode("salas", "excluir") && <TdSel s={selecao} id={s.id} nome={s.nome} />}
                <Td className="font-medium">{s.nome}</Td>
                <Td><Badge>{TIPOS_SALA[s.tipo]}</Badge></Td>
                <Td>{s.capacidade}</Td>
                <Td className="text-muted-foreground">{s.observacoes || "—"}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("salas", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: s.id, dados: { escola_id: s.escola_id, nome: s.nome, tipo: s.tipo, capacidade: s.capacidade, observacoes: s.observacoes ?? "" } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("salas", "excluir") && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(s)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar sala" : "Nova sala"}>
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Tipo">
                <Select value={edit.dados.tipo} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, tipo: e.target.value as TipoSala } })}>
                  {Object.entries(TIPOS_SALA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Campo>
              <Campo label="Capacidade">
                <Input type="number" min={0} value={edit.dados.capacidade} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, capacidade: Number(e.target.value) } })} />
              </Campo>
            </div>
            <Campo label="Observações"><Textarea value={edit.dados.observacoes ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, observacoes: e.target.value } })} /></Campo>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir sala"
        mensagem={`Excluir “${excluir?.nome}”? As aulas alocadas nela também serão removidas.`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirSala(excluir.id), "Sala excluída."))) {
            setExcluir(null);
            await carregar(["salas", "aulas"]);
          }
        }}
      />
    </>
  );
}
