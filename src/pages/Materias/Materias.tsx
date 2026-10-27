import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type MateriaInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Button, Campo, Confirmar, Input, Modal, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { ExcluirLote, TdSel, ThSel, useSelecao } from "@/components/Lote";
import type { Materia } from "@/types";

export default function Materias() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, materias, carregar } = useDados();
  const [edit, setEdit] = useState<{ id: number | null; dados: MateriaInput } | null>(null);
  const [excluir, setExcluir] = useState<Materia | null>(null);
  const [busca, setBusca] = useState("");
  // Busca sem diferenciar acentos/maiúsculas.
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const lista = useMemo(() => materias.filter((m) => norm(m.nome).includes(norm(busca.trim()))), [materias, busca]);

  const selecao = useSelecao(lista);

  async function salvar() {
    if (!edit || !escolaId) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome da matéria.");
    const ok = await executar(
      () => (edit.id ? api.atualizarMateria(edit.id, edit.dados) : api.criarMateria({ ...edit.dados, escola_id: escolaId })),
      "Matéria salva.",
    );
    if (ok) {
      setEdit(null);
      await carregar(["materias", "professores"]);
    }
  }

  return (
    <>
      <Titulo
        titulo="Matérias"
        subtitulo="A cor define como a matéria aparece na grade"
        acoes={pode("materias", "criar") && escolaId && (
          <Button onClick={() => setEdit({ id: null, dados: { escola_id: escolaId, nome: "", cor: "#3b82f6" } })}>
            <Plus className="h-4 w-4" />Nova matéria
          </Button>
        )}
      />
      <Input className="mb-3 max-w-xs" placeholder="Buscar matéria…" aria-label="Buscar matéria" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {pode("materias", "excluir") && (
        <div className="mb-3 empty:hidden">
          <ExcluirLote s={selecao} singular="matéria" plural="matérias" aviso="As aulas que usam estas matérias passarão a ser aulas livres." excluirUm={api.excluirMateria} depois={() => carregar(["materias", "professores", "aulas"])} />
        </div>
      )}
      {materias.length === 0 ? <Vazio texto="Nenhuma matéria cadastrada." /> : lista.length === 0 ? <Vazio texto="Nenhuma matéria encontrada." /> : (
        <Tabela>
          <thead><tr>{pode("materias", "excluir") && <ThSel s={selecao} />}<Th className="w-16">Cor</Th><Th>Nome</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id}>
                {pode("materias", "excluir") && <TdSel s={selecao} id={m.id} nome={m.nome} />}
                <Td><span className="inline-block h-5 w-5 rounded" style={{ background: m.cor }} /></Td>
                <Td className="font-medium">{m.nome}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("materias", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: m.id, dados: { escola_id: m.escola_id, nome: m.nome, cor: m.cor } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("materias", "excluir") && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(m)}>
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

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar matéria" : "Nova matéria"} largura="max-w-sm">
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <Campo label="Cor">
              <input type="color" value={edit.dados.cor} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, cor: e.target.value } })} className="h-9 w-20 cursor-pointer rounded border bg-card" />
            </Campo>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir matéria"
        mensagem={`Excluir “${excluir?.nome}”? As aulas que usam esta matéria passarão a ser aulas livres.`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirMateria(excluir.id), "Matéria excluída."))) {
            setExcluir(null);
            await carregar(["materias", "professores", "aulas"]);
          }
        }}
      />
    </>
  );
}
