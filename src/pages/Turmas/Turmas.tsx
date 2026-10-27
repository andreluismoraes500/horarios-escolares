import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type TurmaInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { fmtMin, parseHora, TURNOS } from "@/lib/tempo";
import { ExcluirLote, TdSel, ThSel, useSelecao } from "@/components/Lote";
import type { Turma, Turno } from "@/types";


export default function Turmas() {
  const pode = useAuth((s) => s.pode);
  const { grades, escolaId, turmas, grupos, carregar } = useDados();
  const [novoGrupo, setNovoGrupo] = useState("");
  const [busca, setBusca] = useState("");
  const [turno, setTurno] = useState("");
  const [edit, setEdit] = useState<{ id: number | null; dados: TurmaInput; fim: string } | null>(null);
  const [excluir, setExcluir] = useState<Turma | null>(null);

  const lista = useMemo(
    () => turmas.filter((t) => (t.nome + " " + (t.serie ?? "")).toLowerCase().includes(busca.toLowerCase()) && (!turno || t.turno === turno)),
    [turmas, busca, turno],
  );

  const selecao = useSelecao(lista);

  async function salvar() {
    if (!edit || !escolaId) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome da turma.");
    const fimMin = edit.fim.trim() ? parseHora(edit.fim) : null;
    if (edit.fim.trim() && fimMin == null) return toast.error("Horário de término inválido (use, por exemplo, 14:30).");
    const dados = { ...edit.dados, fim_max_min: fimMin };
    const ok = await executar(
      () => (edit.id ? api.atualizarTurma(edit.id, dados) : api.criarTurma({ ...dados, escola_id: escolaId })),
      "Turma salva.",
    );
    if (ok) {
      setEdit(null);
      await carregar(["turmas"]);
    }
  }

  return (
    <>
      <Titulo
        titulo="Turmas"
        acoes={pode("turmas", "criar") && escolaId && (
          <Button onClick={() => setEdit({ id: null, dados: { escola_id: escolaId, nome: "", serie: "", turno: "manha", num_alunos: 0, fim_max_min: null, grade_id: grades[0]?.id ?? 0 }, fim: "" })}>
            <Plus className="h-4 w-4" />Nova turma
          </Button>
        )}
      />
      <div className="mb-3 flex gap-2">
        <Input className="max-w-xs" placeholder="Buscar por nome ou série…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select className="w-44" value={turno} onChange={(e) => setTurno(e.target.value)}>
          <option value="">Todos os turnos</option>
          {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {pode("turmas", "excluir") && (
        <div className="mb-3 empty:hidden">
          <ExcluirLote s={selecao} singular="turma" plural="turmas" aviso="As aulas delas também serão removidas." excluirUm={api.excluirTurma} depois={() => carregar(["turmas", "grupos", "aulas"])} />
        </div>
      )}
      {lista.length === 0 ? <Vazio texto="Nenhuma turma encontrada." /> : (
        <Tabela>
          <thead><tr>{pode("turmas", "excluir") && <ThSel s={selecao} />}<Th>Nome</Th><Th>Série</Th><Th>Turno</Th>{grades.length > 1 && <Th>Grade</Th>}<Th>Termina às</Th><Th>Alunos</Th><Th>Grupos</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id}>
                {pode("turmas", "excluir") && <TdSel s={selecao} id={t.id} nome={t.nome} />}
                <Td className="font-medium">{t.nome}</Td>
                <Td>{t.serie || "—"}</Td>
                <Td><Badge>{TURNOS[t.turno]}</Badge></Td>
                {grades.length > 1 && <Td>{grades.find((g) => g.id === t.grade_id)?.nome ?? "—"}</Td>}
                <Td className="tabular-nums text-muted-foreground">{t.fim_max_min ? fmtMin(t.fim_max_min) : "fim do turno"}</Td>
                <Td>{t.num_alunos}</Td>
                <Td className="text-muted-foreground">{grupos.filter((g) => g.turma_id === t.id).map((g) => g.nome).join(", ") || "—"}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("turmas", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: t.id, dados: { escola_id: t.escola_id, nome: t.nome, serie: t.serie ?? "", turno: t.turno, num_alunos: t.num_alunos, fim_max_min: t.fim_max_min, grade_id: t.grade_id }, fim: t.fim_max_min ? fmtMin(t.fim_max_min) : "" })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("turmas", "excluir") && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(t)}>
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

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar turma" : "Nova turma"}>
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input placeholder="Ex.: 6º A" value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <Campo label="Série"><Input placeholder="Ex.: 6º ano" value={edit.dados.serie ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, serie: e.target.value } })} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Turno">
                <Select value={edit.dados.turno} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, turno: e.target.value as Turno } })}>
                  {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Campo>
              <Campo label="Nº de alunos">
                <Input type="number" min={0} value={edit.dados.num_alunos} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, num_alunos: Number(e.target.value) } })} />
              </Campo>
            </div>
            {grades.length > 1 && (
              <Campo label="Grade de horários" dica="Conjunto de faixas usado por esta turma (cadastre em Horários e intervalos). Para trocar de grade, a turma não pode ter aulas na grade atual.">
                <Select aria-label="Grade de horários" value={edit.dados.grade_id} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, grade_id: Number(e.target.value) } })}>
                  {grades.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </Select>
              </Campo>
            )}
            <Campo label="Termina às (opcional)" dica="Para turmas com jornada diferente do turno, ex.: Integrado que vai das 07:00 às 14:30 num turno da manhã que termina às 12:40. A turma passa a usar também os horários seguintes até esse limite. Vazio = termina com o turno.">
              <Input placeholder="Ex.: 14:30" value={edit.fim} onChange={(e) => setEdit({ ...edit, fim: e.target.value })} />
            </Campo>
            {edit.id ? (
              <Campo label="Grupos (divisão da turma)">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Use quando a turma se divide (ex.: Grupo 1 na sala e Grupo 2 no laboratório, no mesmo horário).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {grupos.filter((g) => g.turma_id === edit.id).map((g) => (
                      <span key={g.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
                        {g.nome}
                        {pode("turmas", "editar") && (
                          <button
                            type="button"
                            aria-label={`Remover ${g.nome}`}
                            className="text-destructive"
                            onClick={async () => {
                              if (confirm(`Remover “${g.nome}”? As aulas deste grupo também serão removidas.`) &&
                                  (await executar(() => api.excluirGrupo(g.id), "Grupo removido."))) {
                                await carregar(["grupos", "aulas"]);
                              }
                            }}
                          >×</button>
                        )}
                      </span>
                    ))}
                  </div>
                  {pode("turmas", "editar") && escolaId && (
                    <div className="flex gap-2">
                      <Input placeholder="Ex.: Grupo 1" value={novoGrupo} onChange={(e) => setNovoGrupo(e.target.value)} />
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!novoGrupo.trim()) return;
                          if (await executar(() => api.criarGrupo({ escola_id: escolaId, turma_id: edit.id!, nome: novoGrupo }), "Grupo criado.")) {
                            setNovoGrupo("");
                            await carregar(["grupos"]);
                          }
                        }}
                      >Adicionar</Button>
                    </div>
                  )}
                </div>
              </Campo>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir turma"
        mensagem={`Excluir “${excluir?.nome}”? As aulas dela também serão removidas.`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirTurma(excluir.id), "Turma excluída."))) {
            setExcluir(null);
            await carregar(["turmas", "grupos", "aulas"]);
          }
        }}
      />
    </>
  );
}
