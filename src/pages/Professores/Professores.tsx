import { Fragment, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ProfessorInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import SelectBusca from "@/components/SelectBusca";
import { Button, Campo, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { DIAS, faixaTexto, TURNOS } from "@/lib/tempo";
import { corTexto, PALETA_PROFESSORES } from "@/lib/utils";
import { ExcluirLote, TdSel, ThSel, useSelecao } from "@/components/Lote";
import type { Professor } from "@/types";

type Indisp = { dia: number; horario_id: number };

function lerIndisp(json: string): Indisp[] {
  try {
    return JSON.parse(json) as Indisp[];
  } catch {
    return [];
  }
}

export default function Professores() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, professores, materias, horarios, grades, carregar } = useDados();
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState<{ id: number | null; dados: ProfessorInput; indisp: Indisp[] } | null>(null);
  const [excluir, setExcluir] = useState<Professor | null>(null);

  const faixasAula = horarios.filter((h) => h.tipo === "aula");
  const lista = useMemo(
    () => professores.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase())),
    [professores, busca],
  );

  const novo = (): ProfessorInput => ({ escola_id: escolaId!, nome: "", email: "", telefone: "", disponibilidade: "[]", cor: PALETA_PROFESSORES[professores.length % PALETA_PROFESSORES.length], max_aulas_semana: null, max_aulas_dia: null, deslocamento_min: 0, intersticio_horas: 0, da_aula_sabado: true, materia_ids: [] });

  const selecao = useSelecao(lista);

  async function salvar() {
    if (!edit) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome do professor.");
    const dados = { ...edit.dados, disponibilidade: JSON.stringify(edit.indisp) };
    const ok = await executar(
      () => (edit.id ? api.atualizarProfessor(edit.id, dados) : api.criarProfessor(dados)),
      "Professor salvo.",
    );
    if (ok) {
      setEdit(null);
      await carregar(["professores"]);
    }
  }

  function alternarMateria(id: number) {
    if (!edit) return;
    const ids = edit.dados.materia_ids.includes(id)
      ? edit.dados.materia_ids.filter((x) => x !== id)
      : [...edit.dados.materia_ids, id];
    setEdit({ ...edit, dados: { ...edit.dados, materia_ids: ids } });
  }

  /** Marca todos os períodos informados; se todos já estiverem marcados, desmarca. */
  function alternarLote(itens: Indisp[]) {
    if (!edit) return;
    const tem = (i: Indisp) => edit.indisp.some((x) => x.dia === i.dia && x.horario_id === i.horario_id);
    const todos = itens.every(tem);
    setEdit({
      ...edit,
      indisp: todos
        ? edit.indisp.filter((x) => !itens.some((i) => i.dia === x.dia && i.horario_id === x.horario_id))
        : [...edit.indisp, ...itens.filter((i) => !tem(i))],
    });
  }

  function alternarIndisp(dia: number, horario_id: number) {
    if (!edit) return;
    const existe = edit.indisp.some((x) => x.dia === dia && x.horario_id === horario_id);
    setEdit({
      ...edit,
      indisp: existe
        ? edit.indisp.filter((x) => !(x.dia === dia && x.horario_id === horario_id))
        : [...edit.indisp, { dia, horario_id }],
    });
  }

  return (
    <>
      <Titulo
        titulo="Professores"
        acoes={pode("professores", "criar") && escolaId && (
          <Button onClick={() => setEdit({ id: null, dados: novo(), indisp: [] })}><Plus className="h-4 w-4" />Novo professor</Button>
        )}
      />
      <Input className="mb-3 max-w-xs" placeholder="Buscar por nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {pode("professores", "excluir") && (
        <div className="mb-3 empty:hidden">
          <ExcluirLote s={selecao} singular="professor" plural="professores" aviso="As aulas deles ficarão como aulas livres (sem professor)." excluirUm={api.excluirProfessor} depois={() => carregar(["professores", "aulas"])} />
        </div>
      )}
      {lista.length === 0 ? <Vazio texto="Nenhum professor encontrado." /> : (
        <Tabela>
          <thead><tr>{pode("professores", "excluir") && <ThSel s={selecao} />}<Th>Nome</Th><Th>Contato</Th><Th>Disciplinas</Th><Th>Regras</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id}>
                {pode("professores", "excluir") && <TdSel s={selecao} id={p.id} nome={p.nome} />}
                <Td className="font-medium"><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: p.cor }} />{p.nome}</Td>
                <Td className="text-muted-foreground">{[p.email, p.telefone].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.materia_ids.map((id) => materias.find((m) => m.id === id)).filter(Boolean).map((m) => (
                      <span key={m!.id} className="rounded-full px-2 py-0.5 text-xs" style={{ background: m!.cor, color: corTexto(m!.cor) }}>{m!.nome}</span>
                    ))}
                  </div>
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {[
                    p.max_aulas_semana ? `${p.max_aulas_semana}/sem` : null,
                    p.max_aulas_dia ? `${p.max_aulas_dia}/dia` : null,
                    p.deslocamento_min ? `desloc. ${p.deslocamento_min} min` : null,
                    p.intersticio_horas ? `inters. ${p.intersticio_horas} h` : null,
                    !p.da_aula_sabado ? "sem sábado" : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("professores", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar"
                        onClick={() => setEdit({ id: p.id, indisp: lerIndisp(p.disponibilidade), dados: { escola_id: p.escola_id, nome: p.nome, email: p.email ?? "", telefone: p.telefone ?? "", disponibilidade: p.disponibilidade, cor: p.cor, max_aulas_semana: p.max_aulas_semana, max_aulas_dia: p.max_aulas_dia, deslocamento_min: p.deslocamento_min, intersticio_horas: p.intersticio_horas, da_aula_sabado: p.da_aula_sabado, materia_ids: p.materia_ids } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("professores", "excluir") && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(p)}>
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

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar professor" : "Novo professor"} largura="max-w-2xl">
        {edit && (
          <div className="space-y-4">
            <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <Campo label="Cor do professor" dica="Usada para colorir as aulas dele na grade.">
              <div className="flex flex-wrap items-center gap-2">
                {PALETA_PROFESSORES.map((c) => (
                  <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setEdit({ ...edit, dados: { ...edit.dados, cor: c } })}
                    className="h-6 w-6 rounded-full border-2" style={{ background: c, borderColor: edit.dados.cor === c ? "var(--foreground)" : "transparent" }} />
                ))}
                <input type="color" aria-label="Escolher outra cor" value={edit.dados.cor ?? "#64748b"}
                  onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, cor: e.target.value } })} className="h-7 w-9 cursor-pointer rounded border bg-transparent" />
              </div>
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="E-mail"><Input type="email" value={edit.dados.email ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, email: e.target.value } })} /></Campo>
              <Campo label="Telefone"><Input value={edit.dados.telefone ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, telefone: e.target.value } })} /></Campo>
            </div>
            <Campo label="Carga e regras de trabalho" dica="Usadas pelo gerador automático e como aviso na grade. Deixe vazio para sem limite.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-xs">Máx. aulas/semana
                  <Input type="number" min={1} max={60} value={edit.dados.max_aulas_semana ?? ""}
                    onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, max_aulas_semana: e.target.value ? Number(e.target.value) : null } })} />
                </label>
                <label className="text-xs">Máx. aulas/dia
                  <Input type="number" min={1} max={12} value={edit.dados.max_aulas_dia ?? ""}
                    onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, max_aulas_dia: e.target.value ? Number(e.target.value) : null } })} />
                </label>
                <label className="text-xs" title="Tempo para ir/voltar de outro local de trabalho. Aulas muito coladas aos períodos marcados como indisponíveis ficam bloqueadas.">Deslocamento (min)
                  <Input type="number" min={0} max={240} value={edit.dados.deslocamento_min}
                    onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, deslocamento_min: Number(e.target.value) || 0 } })} />
                </label>
                <label className="text-xs" title="Descanso mínimo entre o fim da jornada de um dia e o início da do dia seguinte (ex.: 11 h).">Interstício (horas)
                  <Input type="number" min={0} max={24} value={edit.dados.intersticio_horas}
                    onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, intersticio_horas: Number(e.target.value) || 0 } })} />
                </label>
              </div>
              <p className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                <b>Deslocamento:</b> use quando o professor trabalha em outro lugar. Marque esse horário como <b>indisponível</b> na grade abaixo
                (ex.: terça das 08:40 às 09:30 na outra escola) e informe os minutos para ir/voltar. O sistema evita colocar aula colada nesse
                compromisso (ex.: 60 min bloqueia a aula anterior e a seguinte), e avisa se você tentar à mão.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.dados.da_aula_sabado}
                  onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, da_aula_sabado: e.target.checked } })} />
                Dá aula aos sábados
              </label>
            </Campo>
            <Campo label="Disciplinas que leciona">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {edit.dados.materia_ids.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma disciplina adicionada.</span>}
                  {edit.dados.materia_ids.map((id) => materias.find((m) => m.id === id)).filter((m) => !!m).map((m) => (
                    <span key={m!.id} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs" style={{ background: m!.cor, color: corTexto(m!.cor) }}>
                      {m!.nome}
                      <button type="button" aria-label={`Remover ${m!.nome}`} className="opacity-80 hover:opacity-100" onClick={() => alternarMateria(m!.id)}>×</button>
                    </span>
                  ))}
                </div>
                {materias.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Cadastre matérias primeiro.</span>
                ) : (
                  <SelectBusca ariaLabel="Adicionar disciplina" className="w-full" value={null}
                    placeholder={materias.every((m) => edit.dados.materia_ids.includes(m.id)) ? "Todas as disciplinas já foram adicionadas" : "Adicionar disciplina…"}
                    disabled={materias.every((m) => edit.dados.materia_ids.includes(m.id))}
                    onChange={(v) => alternarMateria(Number(v))}
                    opcoes={materias.filter((m) => !edit.dados.materia_ids.includes(m.id)).map((m) => ({ value: String(m.id), label: m.nome, cor: m.cor }))} />
                )}
              </div>
            </Campo>
            <Campo label="Disponibilidade" dica="Clique nos horários em que o professor NÃO pode dar aula (vermelho). Clique no dia (cabeçalho) ou no horário (linha) para marcar tudo de uma vez. Cada grade de horários aparece em separado e a indisponibilidade vale só para a grade em que foi marcada (ex.: indisponível na grade Padrão, mas disponível na Integral). Use “Marcar toda a grade” para bloquear uma grade inteira.">
              {faixasAula.length === 0 ? (
                <span className="text-sm text-muted-foreground">Configure os horários da escola primeiro.</span>
              ) : (
                <div className="max-h-[22rem] overflow-auto rounded-md border">
                  <table className="w-full min-w-[30rem] border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr>
                        <th className="p-1.5 text-left">Horário</th>
                        {DIAS.map((d) => (
                          <th key={d.n} className="p-1">
                            <button type="button" title={`Marcar/desmarcar ${d.longo} inteiro`} className="w-full rounded px-1 py-0.5 hover:bg-muted"
                              onClick={() => alternarLote(faixasAula.map((h) => ({ dia: d.n, horario_id: h.id })))}>{d.curto}</button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grades.filter((g) => faixasAula.some((h) => h.grade_id === g.id)).map((g) => (
                        <Fragment key={g.id}>
                          {(
                            <tr>
                              <td colSpan={DIAS.length + 1} className="bg-secondary px-2 py-1 text-[11px] font-semibold uppercase">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{g.nome}</span>
                                  <button type="button" className="rounded border bg-card px-2 py-0.5 text-[11px] font-normal normal-case hover:bg-muted"
                                    aria-label={`Marcar toda a grade ${g.nome}`}
                                    onClick={() => alternarLote(faixasAula.filter((h) => h.grade_id === g.id).flatMap((h) => DIAS.map((d) => ({ dia: d.n, horario_id: h.id }))))}>
                                    {faixasAula.filter((h) => h.grade_id === g.id).every((h) => DIAS.every((d) => edit.indisp.some((x) => x.dia === d.n && x.horario_id === h.id)))
                                      ? "Liberar toda a grade" : "Marcar toda a grade"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {faixasAula.filter((h) => h.grade_id === g.id).sort((x, y) => x.inicio_min - y.inicio_min).map((h) => (
                            <tr key={h.id} className="border-t">
                              <td className="p-1.5">
                                <button type="button" title="Marcar/desmarcar a semana inteira neste horário" className="text-left text-muted-foreground hover:text-foreground"
                                  onClick={() => alternarLote(DIAS.map((d) => ({ dia: d.n, horario_id: h.id })))}>
                                  {TURNOS[h.turno]} · {faixaTexto(h)}
                                </button>
                              </td>
                              {DIAS.map((d) => {
                                const off = edit.indisp.some((x) => x.dia === d.n && x.horario_id === h.id);
                                return (
                                  <td key={d.n} className="p-1 text-center">
                                    <button type="button" onClick={() => alternarIndisp(d.n, h.id)} aria-label={`${d.curto} ${faixaTexto(h)}`}
                                      className={`h-6 w-full min-w-6 rounded ${off ? "bg-destructive/80" : "bg-muted hover:bg-secondary"}`} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
        titulo="Excluir professor"
        mensagem={`Excluir “${excluir?.nome}”? As aulas dele ficarão como aulas livres (sem professor).`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirProfessor(excluir.id), "Professor excluído."))) {
            setExcluir(null);
            await carregar(["professores", "aulas"]);
          }
        }}
      />
    </>
  );
}
