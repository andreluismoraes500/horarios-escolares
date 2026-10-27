// Configuração dos horários da escola, por turno (manhã, tarde e noite).
// Início livre (07:10, 07:30, 09:15...), duração da aula (ex.: 50 min)
// e intervalos (ex.: 15 min após a 3ª aula, almoço etc.).

import { Fragment, useMemo, useState } from "react";
import { Layers, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Card, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo } from "@/components/ui";
import { fmtMin, gerarFaixas, INICIO_PADRAO, ORDEM_TURNOS, parseHora, TURNOS } from "@/lib/tempo";
import type { Horario, IntervaloCfg, Turno } from "@/types";

export default function ConfigHorarios() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, horarios: todosHorarios, grades, turmas, aulas, carregar } = useDados();

  // Grade de horários em edição (cada grade tem suas faixas, que podem se sobrepor às de outras grades).
  const [gradeSel, setGradeSel] = useState<number | null>(null);
  const gradeId = grades.find((g) => g.id === gradeSel)?.id ?? grades[0]?.id ?? null;
  const gradeAtual = grades.find((g) => g.id === gradeId);
  const horarios = useMemo(() => todosHorarios.filter((h) => h.grade_id === gradeId), [todosHorarios, gradeId]);
  const [gradeEdit, setGradeEdit] = useState<{ modo: "nova" | "renomear"; nome: string; copiar: number | null } | null>(null);
  const [excluirGrade, setExcluirGrade] = useState(false);

  // Parâmetros do gerador
  const [turno, setTurno] = useState<Turno>("manha");
  const [inicio, setInicio] = useState(INICIO_PADRAO.manha);
  const [duracao, setDuracao] = useState(50);
  const [qtd, setQtd] = useState(6);
  const [modo, setModo] = useState<"substituir" | "adicionar">("adicionar");
  const [intervalos, setIntervalos] = useState<IntervaloCfg[]>([{ apos_aula: 3, duracao_min: 15, rotulo: "Intervalo" }]);
  const [confirmarGerar, setConfirmarGerar] = useState(false);

  // Edição manual de uma faixa
  const [edit, setEdit] = useState<{ id: number | null; rotulo: string; ini: string; fim: string; tipo: "aula" | "intervalo"; turno: Turno } | null>(null);
  const [excluir, setExcluir] = useState<Horario | null>(null);
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [excluirLote, setExcluirLote] = useState(false);
  const alternar = (ids: number[], ligar: boolean) =>
    setMarcadas((m) => (ligar ? [...new Set([...m, ...ids])] : m.filter((x) => !ids.includes(x))));

  const inicioMin = parseHora(inicio);
  const previa = useMemo(() => {
    if (inicioMin == null) return { faixas: [], erro: "Horário de início inválido (use ex.: 07:10)." };
    return gerarFaixas(inicioMin, duracao, qtd, intervalos);
  }, [inicioMin, duracao, qtd, intervalos]);

  const podeCriar = pode("horarios", "criar");
  const podeEditar = pode("horarios", "editar");
  const podeExcluir = pode("horarios", "excluir");

  const faixasDoTurno = horarios.filter((h) => h.turno === turno);
  const aulasDoTurno = aulas.filter((a) => faixasDoTurno.some((h) => h.id === a.horario_id)).length;

  function trocarGrade(id: number) {
    setGradeSel(id);
    setMarcadas([]);
  }

  async function salvarGrade() {
    if (!gradeEdit || !escolaId) return;
    let novaId: number | null = null;
    const ok = await executar(async () => {
      if (gradeEdit.modo === "nova") {
        const g = await api.criarGrade(escolaId, gradeEdit.nome, gradeEdit.copiar);
        novaId = g.id;
        return g;
      }
      return api.renomearGrade(gradeId!, gradeEdit.nome);
    }, gradeEdit.modo === "nova" ? "Grade criada." : "Grade renomeada.");
    if (ok) {
      setGradeEdit(null);
      await carregar(["grades", "horarios"]);
      if (novaId) trocarGrade(novaId);
    }
  }

  function mudarTurno(t: Turno) {
    // Só troca o início sugerido se o usuário ainda não personalizou o horário.
    if (Object.values(INICIO_PADRAO).includes(inicio)) setInicio(INICIO_PADRAO[t]);
    setTurno(t);
  }

  function setInt(i: number, patch: Partial<IntervaloCfg>) {
    setIntervalos(intervalos.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }

  async function gerar(confirmar: boolean) {
    if (!escolaId || inicioMin == null || previa.erro) return;
    const ok = await executar(
      () => api.gerarHorarios({
        escola_id: escolaId, grade_id: gradeId, inicio_min: inicioMin, duracao_min: duracao, qtd_aulas: qtd,
        intervalos, turno, modo, prefixo: null, confirmar_exclusao: confirmar,
      }),
      `Horários da ${TURNOS[turno].toLowerCase()} gerados.`,
    );
    if (ok) {
      setConfirmarGerar(false);
      await carregar(["horarios", "aulas"]);
    }
  }

  function pedirGerar() {
    if (modo === "substituir" && aulasDoTurno > 0) setConfirmarGerar(true);
    else void gerar(false);
  }

  async function salvarFaixa() {
    if (!edit || !escolaId) return;
    const ini = parseHora(edit.ini);
    const fim = parseHora(edit.fim);
    if (ini == null || fim == null) return toast.error("Horário inválido. Use o formato 07:10.");
    if (fim <= ini) return toast.error("O término deve ser depois do início.");
    const dados = { escola_id: escolaId, grade_id: gradeId ?? 0, rotulo: edit.rotulo, inicio_min: ini, fim_min: fim, tipo: edit.tipo, turno: edit.turno };
    const ok = await executar(() => (edit.id ? api.atualizarHorario(edit.id, dados) : api.criarHorario(dados)), "Faixa salva.");
    if (ok) {
      setEdit(null);
      await carregar(["horarios"]);
    }
  }

  return (
    <>
      <Titulo
        titulo="Horários e intervalos"
        subtitulo="Cada turno (manhã, tarde, noite) tem seus próprios horários. Qualquer início é aceito (07:10, 07:30, 09:15…)."
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium"><Layers className="h-4 w-4" />Grade de horários</span>
          {grades.map((g) => (
            <Button key={g.id} size="sm" variant={g.id === gradeId ? "default" : "outline"} aria-pressed={g.id === gradeId} onClick={() => trocarGrade(g.id)}>
              {g.nome}
            </Button>
          ))}
          {podeCriar && (
            <Button size="sm" variant="outline" onClick={() => setGradeEdit({ modo: "nova", nome: "", copiar: null })}>
              <Plus className="h-3 w-3" />Nova grade
            </Button>
          )}
          {podeEditar && gradeAtual && (
            <Button size="sm" variant="ghost" onClick={() => setGradeEdit({ modo: "renomear", nome: gradeAtual.nome, copiar: null })}>
              <Pencil className="h-3 w-3" />Renomear
            </Button>
          )}
          {podeExcluir && grades.length > 1 && gradeAtual && (
            <Button size="sm" variant="ghost" onClick={() => setExcluirGrade(true)}>
              <Trash2 className="h-3 w-3 text-destructive" />Excluir grade
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Uma grade é um conjunto de faixas usado por certas turmas. Crie uma grade para turmas com horários diferentes
          (ex.: Integrado 07:00–14:30 e Enfermagem a partir das 13:00): faixas de grades diferentes podem se sobrepor no relógio, e
          professor e sala nunca ficam em dois lugares ao mesmo tempo. Escolha a grade de cada turma em <b>Turmas</b>.
          {turmas.length > 0 && gradeAtual && <> Turmas nesta grade: {turmas.filter((t) => t.grade_id === gradeId).map((t) => t.nome).join(", ") || "nenhuma"}.</>}
        </p>
      </Card>

      {podeCriar && (
        <Card className="mb-6 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-medium"><Wand2 className="h-4 w-4" />Gerador de horários</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Campo label="Turno">
              <Select value={turno} onChange={(e) => mudarTurno(e.target.value as Turno)}>
                {ORDEM_TURNOS.map((t) => <option key={t} value={t}>{TURNOS[t]}</option>)}
              </Select>
            </Campo>
            <Campo label="1ª aula começa às"><Input value={inicio} onChange={(e) => setInicio(e.target.value)} placeholder="07:00" /></Campo>
            <Campo label="Duração da aula (min)"><Input type="number" min={1} max={480} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))} /></Campo>
            <Campo label="Quantidade de aulas"><Input type="number" min={1} max={30} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></Campo>
            <Campo label={`Faixas já existentes (${TURNOS[turno].toLowerCase()})`}>
              <Select value={modo} onChange={(e) => setModo(e.target.value as "substituir" | "adicionar")}>
                <option value="adicionar">Manter e adicionar</option>
                <option value="substituir">Substituir as do turno</option>
              </Select>
            </Campo>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Intervalos (lanche, recreio, almoço…)</span>
              <Button size="sm" variant="outline" onClick={() => setIntervalos([...intervalos, { apos_aula: Math.max(1, Math.min(qtd - 1, intervalos.length + 1)), duracao_min: 15, rotulo: "Intervalo" }])}>
                <Plus className="h-3 w-3" />Adicionar intervalo
              </Button>
            </div>
            {intervalos.length === 0 && <p className="text-sm text-muted-foreground">Sem intervalos — as aulas ficam seguidas.</p>}
            <div className="space-y-2">
              {intervalos.map((iv, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Campo label="Depois da aula nº"><Input className="w-28" type="number" min={1} value={iv.apos_aula} onChange={(e) => setInt(i, { apos_aula: Number(e.target.value) })} /></Campo>
                  <Campo label="Duração (min)"><Input className="w-28" type="number" min={1} value={iv.duracao_min} onChange={(e) => setInt(i, { duracao_min: Number(e.target.value) })} /></Campo>
                  <Campo label="Nome"><Input className="w-44" value={iv.rotulo ?? ""} onChange={(e) => setInt(i, { rotulo: e.target.value })} placeholder="Intervalo" /></Campo>
                  <Button size="icon" variant="ghost" aria-label="Remover intervalo" onClick={() => setIntervalos(intervalos.filter((_, k) => k !== i))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-sm font-medium">Prévia — {TURNOS[turno]}</div>
            {previa.erro ? (
              <p className="text-sm text-destructive">{previa.erro}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {previa.faixas.map((f, i) => (
                  <div key={i} className={`rounded-md border px-3 py-1.5 text-xs ${f.tipo === "intervalo" ? "border-dashed bg-muted text-muted-foreground" : "bg-card"}`}>
                    <div className="font-medium">{f.rotulo}</div>
                    <div className="tabular-nums">{fmtMin(f.inicio_min)} – {fmtMin(f.fim_min)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button disabled={!escolaId || !!previa.erro} onClick={pedirGerar}>Gerar horários da {TURNOS[turno].toLowerCase()}</Button>
          </div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Faixas cadastradas</h2>
        <div className="flex gap-2">
          {podeExcluir && marcadas.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMarcadas([])}>Limpar seleção</Button>
              <Button variant="outline" size="sm" onClick={() => setExcluirLote(true)}>
                <Trash2 className="h-3 w-3 text-destructive" />Excluir selecionadas ({marcadas.length})
              </Button>
            </>
          )}
          {podeCriar && (
            <Button variant="outline" size="sm" onClick={() => setEdit({ id: null, rotulo: "", ini: "", fim: "", tipo: "aula", turno })}>
              <Plus className="h-3 w-3" />Faixa manual
            </Button>
          )}
        </div>
      </div>
      {horarios.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum horário configurado. Gere os horários de cada turno acima.</Card>
      ) : (
        <Tabela>
          <thead><tr><Th className="w-10">{podeExcluir && <input type="checkbox" aria-label="Selecionar todas" checked={marcadas.length > 0 && marcadas.length === horarios.length} onChange={(e) => alternar(horarios.map((h) => h.id), e.target.checked)} />}</Th><Th>#</Th><Th>Nome</Th><Th>Início</Th><Th>Fim</Th><Th>Duração</Th><Th>Tipo</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {ORDEM_TURNOS.filter((t) => horarios.some((h) => h.turno === t)).map((t) => (
              <Fragment key={t}>
                <tr>
                  <td colSpan={8} className="border-b bg-secondary px-3 py-1.5 text-xs font-semibold tracking-wide uppercase">
                    {podeExcluir && (
                      <input type="checkbox" className="mr-3 align-middle" aria-label={`Selecionar todas da ${TURNOS[t].toLowerCase()}`}
                        checked={horarios.filter((h) => h.turno === t).every((h) => marcadas.includes(h.id))}
                        onChange={(e) => alternar(horarios.filter((h) => h.turno === t).map((h) => h.id), e.target.checked)} />
                    )}
                    {TURNOS[t]}
                  </td>
                </tr>
                {horarios.filter((h) => h.turno === t).map((h) => (
                  <tr key={h.id} className={h.tipo === "intervalo" ? "bg-muted/50" : ""}>
                    <Td>{podeExcluir && <input type="checkbox" aria-label={`Selecionar ${h.rotulo}`} checked={marcadas.includes(h.id)} onChange={(e) => alternar([h.id], e.target.checked)} />}</Td>
                    <Td>{h.ordem}</Td>
                    <Td className="font-medium">{h.rotulo}</Td>
                    <Td className="tabular-nums">{fmtMin(h.inicio_min)}</Td>
                    <Td className="tabular-nums">{fmtMin(h.fim_min)}</Td>
                    <Td>{h.fim_min - h.inicio_min} min</Td>
                    <Td><Badge>{h.tipo === "aula" ? "Aula" : "Intervalo"}</Badge></Td>
                    <Td>
                      <div className="flex gap-1">
                        {podeEditar && (
                          <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: h.id, rotulo: h.rotulo, ini: fmtMin(h.inicio_min), fim: fmtMin(h.fim_min), tipo: h.tipo, turno: h.turno })}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {podeExcluir && (
                          <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(h)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Tabela>
      )}

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar faixa" : "Nova faixa"} largura="max-w-md">
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome"><Input value={edit.rotulo} onChange={(e) => setEdit({ ...edit, rotulo: e.target.value })} placeholder="Ex.: 1ª aula, Recreio, Almoço" /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Início"><Input value={edit.ini} onChange={(e) => setEdit({ ...edit, ini: e.target.value })} placeholder="07:10" /></Campo>
              <Campo label="Fim"><Input value={edit.fim} onChange={(e) => setEdit({ ...edit, fim: e.target.value })} placeholder="08:00" /></Campo>
              <Campo label="Turno">
                <Select value={edit.turno} onChange={(e) => setEdit({ ...edit, turno: e.target.value as Turno })}>
                  {ORDEM_TURNOS.map((t) => <option key={t} value={t}>{TURNOS[t]}</option>)}
                </Select>
              </Campo>
              <Campo label="Tipo">
                <Select value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value as "aula" | "intervalo" })}>
                  <option value="aula">Aula</option>
                  <option value="intervalo">Intervalo</option>
                </Select>
              </Campo>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvarFaixa}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!gradeEdit} onFechar={() => setGradeEdit(null)} titulo={gradeEdit?.modo === "nova" ? "Nova grade de horários" : "Renomear grade"} largura="max-w-md">
        {gradeEdit && (
          <div className="space-y-3">
            <Campo label="Nome"><Input autoFocus value={gradeEdit.nome} onChange={(e) => setGradeEdit({ ...gradeEdit, nome: e.target.value })} placeholder="Ex.: Integrado, Enfermagem" /></Campo>
            {gradeEdit.modo === "nova" && (
              <Campo label="Começar com">
                <Select aria-label="Copiar faixas de" value={gradeEdit.copiar ?? ""} onChange={(e) => setGradeEdit({ ...gradeEdit, copiar: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Grade vazia</option>
                  {grades.map((g) => <option key={g.id} value={g.id}>Copiar as faixas de “{g.nome}”</option>)}
                </Select>
              </Campo>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setGradeEdit(null)}>Cancelar</Button>
              <Button onClick={salvarGrade}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar
        aberto={excluirGrade}
        titulo="Excluir grade de horários"
        rotulo="Excluir grade"
        mensagem={`Excluir a grade “${gradeAtual?.nome}” com ${horarios.length} faixa(s)? As aulas alocadas nelas serão removidas. (Só é possível se nenhuma turma usar a grade.)`}
        onCancelar={() => setExcluirGrade(false)}
        onConfirmar={async () => {
          setExcluirGrade(false);
          if (gradeId && (await executar(() => api.excluirGrade(gradeId), "Grade excluída."))) {
            setGradeSel(null);
            setMarcadas([]);
            await carregar(["grades", "horarios", "aulas"]);
          }
        }}
      />
      <Confirmar
        aberto={!!excluir}
        titulo="Excluir faixa"
        mensagem={`Excluir “${excluir?.rotulo}” (${excluir ? TURNOS[excluir.turno] : ""})? As aulas alocadas nela serão removidas.`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirHorario(excluir.id), "Faixa excluída."))) {
            setExcluir(null);
            await carregar(["horarios", "aulas"]);
          }
        }}
      />
      <Confirmar
        aberto={excluirLote}
        titulo="Excluir faixas selecionadas"
        rotulo="Excluir"
        mensagem={`Excluir ${marcadas.length} faixa(s)? As ${aulas.filter((a) => marcadas.includes(a.horario_id)).length} aula(s) alocadas nelas também serão removidas.`}
        onCancelar={() => setExcluirLote(false)}
        onConfirmar={async () => {
          setExcluirLote(false);
          if (await executar(() => api.excluirHorarios(marcadas), `${marcadas.length} faixa(s) excluída(s).`)) {
            setMarcadas([]);
            await carregar(["horarios", "aulas"]);
          }
        }}
      />
      <Confirmar
        aberto={confirmarGerar}
        titulo={`Substituir horários da ${TURNOS[turno].toLowerCase()}`}
        rotulo="Substituir e apagar aulas"
        mensagem={`Existem ${aulasDoTurno} aula(s) alocadas neste turno. Substituir os horários apagará todas elas. Os outros turnos não são afetados.`}
        onCancelar={() => setConfirmarGerar(false)}
        onConfirmar={() => void gerar(true)}
      />
    </>
  );
}
