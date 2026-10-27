// Grade semanal com arrastar e soltar (dnd-kit), validação de conflitos em
// tempo real e visões por turma, professor e sala.

import { Fragment, useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { AlertTriangle, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import SelectBusca from "@/components/SelectBusca";
import { Button, Campo, Card, Confirmar, Input, Modal, Select, Titulo, Vazio } from "@/components/ui";
import { DIAS, faixaTexto, ORDEM_TURNOS, TURNOS } from "@/lib/tempo";
import { avisoIndisponivel, conflitosLocais } from "@/lib/conflitos";
import { aulaDaEntidade, type Visao } from "@/lib/grade";
import { horariosDaTurma, nomeTurmas, podeNaFaixa } from "@/lib/turmas";
import { cn, corTexto } from "@/lib/utils";
import type { Aula, AulaInput, Turno, TurmaRef } from "@/types";

type Alvo = { dia: number; horarioId: number };

function CartaoAula({ aula, visao, entId, colorirPor, arrastavel, onClick, destaque }: {
  aula: Aula; visao: Visao; entId: number | null; colorirPor: "materia" | "professor"; arrastavel: boolean; onClick: () => void; destaque: boolean;
}) {
  const { materias, professores, salas, turmas, grupos } = useDados();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `aula:${aula.id}`, disabled: !arrastavel });
  const mat = materias.find((m) => m.id === aula.materia_id);
  const prof = professores.find((p) => p.id === aula.professor_id);
  const sala = salas.find((s) => s.id === aula.sala_id);
  // Visão de turma: mostra o grupo e as outras turmas (aula conjunta); demais visões: todas as turmas.
  const meu = visao === "turma" ? aula.turmas.find((t) => t.turma_id === entId) : undefined;
  const outras = visao === "turma" ? aula.turmas.filter((t) => t.turma_id !== entId) : aula.turmas;
  const textoTurmas = [
    meu?.grupo_id != null ? grupos.find((g) => g.id === meu.grupo_id)?.nome : null,
    outras.length ? (visao === "turma" ? "com " : "") + nomeTurmas(outras, turmas, grupos) : null,
  ].filter(Boolean).join(" · ");
  const cor = (colorirPor === "professor" ? prof?.cor : mat?.cor) ?? "#94a3b8";
  const extra = [
    textoTurmas || null,
    visao !== "professor" ? prof?.nome ?? "sem professor" : null,
    visao !== "sala" ? sala?.nome ?? "sem sala" : null,
  ].filter(Boolean).join(" · ");
  return (
    <div
      ref={setNodeRef}
      // O cartão inteiro é a área de arrastar (o clique simples ainda abre a edição).
      {...(arrastavel ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      title={aula.observacao ?? undefined}
      className={cn(
        "flex h-full min-h-[52px] items-start gap-1 rounded-md px-2 py-1.5 text-xs leading-tight shadow-sm select-none",
        arrastavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-40",
        destaque && "ring-2 ring-ring",
        !mat && !prof && "border border-dashed",
      )}
      style={(colorirPor === "professor" ? prof : mat) ? { background: cor, color: corTexto(cor) } : undefined}
    >
      {arrastavel && <span className="mt-0.5 shrink-0 opacity-70"><GripVertical className="h-3 w-3" /></span>}
      <div className="min-w-0">
        <div className="truncate font-semibold">{mat?.nome ?? "Aula livre"}</div>
        <div className="truncate opacity-90">{extra}</div>
      </div>
    </div>
  );
}

function Celula({ dia, horarioId, estado, children, vazia, onVazioClick, podeCriar }: {
  dia: number; horarioId: number; estado: "ok" | "erro" | null; children: React.ReactNode;
  vazia: boolean; onVazioClick: () => void; podeCriar: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `cel:${dia}:${horarioId}` });
  const clicavel = vazia && podeCriar;
  return (
    <td
      ref={setNodeRef}
      // Célula vazia: clicar em qualquer ponto dela abre o formulário de nova aula.
      onClick={clicavel ? onVazioClick : undefined}
      title={clicavel ? "Clique para adicionar uma aula" : undefined}
      className={cn(
        "group h-16 min-w-[130px] border p-1 align-top transition-colors",
        clicavel && "cursor-pointer hover:bg-muted/60",
        estado === "ok" && "bg-success/20",
        estado === "erro" && "bg-destructive/25",
      )}
    >
      {children}
      {clicavel && (
        <span className="flex h-full min-h-[52px] items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100">
          <Plus className="h-4 w-4" />
        </span>
      )}
    </td>
  );
}

export default function GradeSemanal() {
  const pode = useAuth((s) => s.pode);
  const usuario = useAuth((s) => s.usuario);
  const dados = useDados();
  const { escolaId, aulas, horarios, grades, turmas, grupos, professores, salas, materias, carregar } = dados;

  const [visao, setVisao] = useState<Visao>("turma");
  const [entId, setEntId] = useState<number | null>(null);
  const [sabado, setSabado] = useState(false);
  const [colorirPor, setColorirPor] = useState<"materia" | "professor">(() => {
    try { return localStorage.getItem("hs_colorir") === "professor" ? "professor" : "materia"; } catch { return "materia"; }
  });
  function mudarColorir(v: "materia" | "professor") {
    setColorirPor(v);
    try { localStorage.setItem("hs_colorir", v); } catch { /* sem armazenamento */ }
  }
  const [filtroTurno, setFiltroTurno] = useState<"" | Turno>("");
  const [filtroGrade, setFiltroGrade] = useState<number | "">("");
  const [sobre, setSobre] = useState<{ alvo: Alvo; erros: string[]; avisos: string[] } | null>(null);
  const [form, setForm] = useState<{ id: number | null; dados: AulaInput } | null>(null);
  const [dica, setDica] = useState<string[]>([]);
  const [avisosServidor, setAvisosServidor] = useState<string[]>([]);
  const [modoArrasto, setModoArrasto] = useState<"mover" | "copiar">("mover");
  const [rodizio, setRodizio] = useState(true);
  const [limpar, setLimpar] = useState<"visao" | "tudo" | null>(null);

  const podeEditar = pode("aulas", "editar");
  const podeCriar = pode("aulas", "criar");
  const podeExcluir = pode("aulas", "excluir");
  const dias = DIAS.filter((d) => sabado || d.n <= 5);

  // Professor logado vê apenas a própria grade.
  const soProfessor = usuario?.papel === "professor";
  useEffect(() => {
    if (soProfessor && usuario?.professor_id) {
      setVisao("professor");
      setEntId(usuario.professor_id);
    }
  }, [soProfessor, usuario?.professor_id]);

  const opcoes = visao === "turma" ? turmas : visao === "professor" ? professores : salas;
  // Mantém uma entidade válida selecionada ao trocar de visão/escola.
  useEffect(() => {
    if (soProfessor) return;
    if (!opcoes.some((o) => o.id === entId)) setEntId(opcoes[0]?.id ?? null);
  }, [opcoes, entId, soProfessor]);

  // Turma: só os horários do seu turno. Professor/sala: todos (ou o turno escolhido no filtro).
  const turmaSel = visao === "turma" ? turmas.find((t) => t.id === entId) : undefined;
  const faixas = useMemo(() => {
    if (visao === "turma") return turmaSel ? horariosDaTurma(turmaSel, horarios) : [];
    // Professor/sala: faixas de todas as grades (que podem se sobrepor), em ordem de horário.
    return horarios
      .filter((h) => (!filtroTurno || h.turno === filtroTurno) && (!filtroGrade || h.grade_id === filtroGrade))
      .sort((a, b) => a.inicio_min - b.inicio_min || a.grade_id - b.grade_id);
  }, [horarios, visao, turmaSel, filtroTurno, filtroGrade]);
  const mostrarGrade = visao !== "turma" && grades.length > 1 && !filtroGrade;
  const nomeGrade = (id: number) => grades.find((g) => g.id === id)?.nome ?? "";
  const turnosVisiveis = ORDEM_TURNOS.filter((t) => faixas.some((h) => h.turno === t));
  const mostrarTitulosTurno = visao !== "turma" && turnosVisiveis.length > 1;
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const lk = { professores, salas, turmas, grupos, materias, horarios };

  // Pode haver várias aulas na mesma célula (turma dividida em grupos).
  const aulasNaCelula = (dia: number, horarioId: number) =>
    entId == null ? [] : aulas.filter((a) => a.dia_semana === dia && a.horario_id === horarioId && aulaDaEntidade(a, visao, entId));

  // Bloco de aulas arrastado junto: as do mesmo dia/horário que dividem a(s) turma(s) em grupos.
  function blocoDe(a: Aula): Aula[] {
    const turmasDiv = a.turmas.filter((t) => t.grupo_id != null).map((t) => t.turma_id);
    if (turmasDiv.length === 0) return [a];
    return aulas
      .filter((x) => x.dia_semana === a.dia_semana && x.horario_id === a.horario_id && x.turmas.some((t) => t.grupo_id != null && turmasDiv.includes(t.turma_id)))
      .sort((p, q) => p.id - q.id);
  }

  // ---- Arrastar e soltar ----
  function simular(aulaId: number, alvo: Alvo) {
    const origem = aulas.find((a) => a.id === aulaId);
    if (!origem) return null;
    const checaTurno = (a: Aula, hid: number, erros: string[]) => {
      const h = horarios.find((x) => x.id === hid);
      for (const r of a.turmas) {
        const t = turmas.find((x) => x.id === r.turma_id);
        if (t && h && !podeNaFaixa(t, h, horarios)) erros.push(`A turma ${t.nome} não tem aula neste horário (fora da jornada dela)`);
      }
    };
    // Turma dividida (ou modo copiar): o arrasto leva o bloco inteiro de aulas do mesmo horário.
    const bloco = blocoDe(origem);
    if (modoArrasto === "copiar" || bloco.length > 1) {
      const erros: string[] = [];
      const avisos: string[] = [];
      const copias = bloco.map((a, i) => {
        const o = modoArrasto === "copiar" && rodizio && bloco.length > 1 ? bloco[(i + 1) % bloco.length] : a;
        return { ...a, materia_id: o.materia_id, professor_id: o.professor_id, sala_id: o.sala_id, dia_semana: alvo.dia, horario_id: alvo.horarioId };
      });
      copias.forEach((c, i) => {
        erros.push(...conflitosLocais(aulas, c, modoArrasto === "mover" ? bloco.map((b) => b.id) : [], lk).map((x) => x.mensagem));
        checaTurno(c, alvo.horarioId, erros);
        const av = avisoIndisponivel(professores.find((p) => p.id === c.professor_id), alvo.dia, alvo.horarioId, horarios);
        if (av && !avisos.includes(av)) avisos.push(av);
        void i;
      });
      // Cópias do mesmo bloco não podem colidir entre si (mesmo professor/sala).
      for (let i = 0; i < copias.length; i++) for (let j = i + 1; j < copias.length; j++) {
        const a = copias[i], b = copias[j];
        if (a.professor_id != null && a.professor_id === b.professor_id) erros.push("O mesmo professor ficaria em dois grupos ao mesmo tempo");
        if (a.sala_id != null && a.sala_id === b.sala_id) erros.push("A mesma sala ficaria em dois grupos ao mesmo tempo");
      }
      return { origem, ocupante: undefined as Aula | undefined, bloco, erros: [...new Set(erros)], avisos };
    }
    // 1) Tenta simplesmente mover a aula.
    const errosMover: string[] = conflitosLocais(aulas, { ...origem, dia_semana: alvo.dia, horario_id: alvo.horarioId }, [origem.id], lk).map((c) => c.mensagem);
    checaTurno(origem, alvo.horarioId, errosMover);
    const aviso1 = avisoIndisponivel(professores.find((p) => p.id === origem.professor_id), alvo.dia, alvo.horarioId, horarios);
    const avisos = aviso1 ? [aviso1] : [];
    const ocupantes = aulasNaCelula(alvo.dia, alvo.horarioId).filter((a) => a.id !== origem.id);
    if (errosMover.length === 0 || ocupantes.length !== 1) {
      return { origem, ocupante: undefined as Aula | undefined, erros: [...new Set(errosMover)], avisos };
    }
    // 2) Há exatamente uma aula no destino e mover não cabe: tenta trocar as duas de lugar.
    const ocupante = ocupantes[0];
    const ignorar = [origem.id, ocupante.id];
    const erros: string[] = conflitosLocais(aulas, { ...origem, dia_semana: alvo.dia, horario_id: alvo.horarioId }, ignorar, lk).map((c) => c.mensagem);
    checaTurno(origem, alvo.horarioId, erros);
    checaTurno(ocupante, origem.horario_id, erros);
    erros.push(...conflitosLocais(aulas, { ...ocupante, dia_semana: origem.dia_semana, horario_id: origem.horario_id }, ignorar, lk).map((c) => c.mensagem));
    const a2 = avisoIndisponivel(professores.find((p) => p.id === ocupante.professor_id), origem.dia_semana, origem.horario_id, horarios);
    if (a2) avisos.push(a2);
    return { origem, ocupante, erros: [...new Set(erros)], avisos };
  }

  function alvoDe(id: unknown): Alvo | null {
    const m = /^cel:(\d+):(\d+)$/.exec(String(id ?? ""));
    return m ? { dia: Number(m[1]), horarioId: Number(m[2]) } : null;
  }
  function aulaDe(id: unknown): number | null {
    const m = /^aula:(\d+)$/.exec(String(id));
    return m ? Number(m[1]) : null;
  }

  function aoPassar(e: DragOverEvent) {
    const aulaId = aulaDe(e.active.id);
    const alvo = alvoDe(e.over?.id);
    if (aulaId == null || !alvo) return setSobre(null);
    const s = simular(aulaId, alvo);
    setSobre(s ? { alvo, erros: s.erros, avisos: s.avisos } : null);
  }

  async function aoSoltar(e: DragEndEvent) {
    setSobre(null);
    const aulaId = aulaDe(e.active.id);
    const alvo = alvoDe(e.over?.id);
    if (aulaId == null || !alvo) return;
    const s = simular(aulaId, alvo);
    if (!s) return;
    if (modoArrasto === "mover" && s.origem.dia_semana === alvo.dia && s.origem.horario_id === alvo.horarioId) return;
    if (modoArrasto === "copiar" && s.origem.dia_semana === alvo.dia && s.origem.horario_id === alvo.horarioId) return toast.error("Solte em outro horário para copiar.");
    if (s.erros.length) return toast.error("Conflito: " + s.erros.join(" • "));
    const ids = s.bloco?.map((b) => b.id);
    const copiando = modoArrasto === "copiar";
    const ok = await executar(() =>
      ids ? (copiando ? api.copiarAulas(ids, alvo.dia, alvo.horarioId, rodizio) : api.moverAulas(ids, alvo.dia, alvo.horarioId))
        : s.ocupante ? api.trocarAulas(s.origem.id, s.ocupante.id) : api.moverAula(s.origem.id, alvo.dia, alvo.horarioId));
    if (ok) {
      const n = ids && ids.length > 1 ? ` (${ids.length} aulas)` : "";
      if (s.avisos.length) toast.warning(s.avisos.join(" • "));
      else toast.success(copiando ? `Aula copiada${n}${rodizio && ids && ids.length > 1 ? " com rodízio" : ""}.` : s.ocupante ? "Aulas trocadas." : `Aula movida${n}.`);
    }
    await carregar(["aulas"]);
  }

  // ---- Formulário de aula ----
  function abrirNova(dia: number, horarioId: number, grupoLivre?: number) {
    if (!escolaId || entId == null) return;
    const h = horarios.find((x) => x.id === horarioId);
    const turmasDoTurno = turmas.filter((t) => h && podeNaFaixa(t, h, horarios));
    if (visao !== "turma" && turmasDoTurno.length === 0) {
      return toast.error("Nenhuma turma tem aula neste horário (confira o turno e o término das turmas).");
    }
    setForm({
      id: null,
      dados: {
        escola_id: escolaId, dia_semana: dia, horario_id: horarioId,
        turmas: [{
          turma_id: visao === "turma" ? entId : turmasDoTurno[0].id,
          grupo_id: visao === "turma" ? grupoLivre ?? null : null,
        }],
        professor_id: visao === "professor" ? entId : null,
        sala_id: visao === "sala" ? entId : null,
        materia_id: null, observacao: "",
      },
    });
  }

  const conflitosForm = useMemo(
    () => (form ? conflitosLocais(aulas, form.dados, form.id ? [form.id] : [], lk) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, aulas, professores, salas, turmas, grupos],
  );
  const avisoForm = form ? avisoIndisponivel(professores.find((p) => p.id === form.dados.professor_id), form.dados.dia_semana, form.dados.horario_id, horarios) : null;

  useEffect(() => {
    // Confirma com o backend (fonte da verdade) quando o formulário muda
    if (!form || form.dados.turmas.length === 0) { setDica([]); setAvisosServidor([]); return; }
    const t = setTimeout(() => {
      api.verificarAula(form.dados, form.id ?? undefined)
        .then((v) => { setDica(v.conflitos.map((c) => c.mensagem)); setAvisosServidor(v.avisos); })
        .catch(() => { setDica([]); setAvisosServidor([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [form]);

  async function salvarForm() {
    if (!form) return;
    if (form.dados.turmas.length === 0) return toast.error("Selecione ao menos uma turma.");
    const d = { ...form.dados, observacao: form.dados.observacao?.trim() || null };
    const ok = await executar(() => (form.id ? api.atualizarAula(form.id, d) : api.criarAula(d)), "Aula salva.");
    if (ok) {
      setForm(null);
      await carregar(["aulas"]);
    }
  }

  async function excluirForm() {
    if (!form?.id) return;
    if (await executar(() => api.excluirAula(form.id!), "Aula removida da grade.")) {
      setForm(null);
      await carregar(["aulas"]);
    }
  }

  async function confirmarLimpar() {
    const modo = limpar;
    setLimpar(null);
    if (!escolaId || !modo) return;
    const ok = await executar(async () => {
      if (modo === "tudo") await api.limparGrade(escolaId);
      else await api.excluirAulas(aulasDaVisao.map((a) => a.id));
    }, modo === "tudo" ? "Grade limpa." : "Aulas removidas.");
    if (ok) await carregar(["aulas"]);
  }
  const aulasDaVisao = entId == null ? [] : aulas.filter((a) => aulaDaEntidade(a, visao, entId));

  if (!escolaId) return <Vazio texto="Selecione ou cadastre uma escola." />;
  const faixasAula = faixas.filter((h) => h.tipo === "aula");

  return (
    <>
      <Titulo
        titulo="Grade semanal"
        subtitulo={podeEditar ? "Arraste uma aula para outro horário (turma dividida leva todos os grupos juntos). Soltar sobre outra aula troca as duas." : undefined}
        acoes={
          <div className="flex items-center gap-4">
          <div className="flex rounded-md border bg-card p-0.5 text-sm" role="group" aria-label="Colorir por">
            {(["materia", "professor"] as const).map((v) => (
              <button key={v} type="button" onClick={() => mudarColorir(v)}
                className={cn("rounded px-2 py-0.5", colorirPor === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                Cor: {v === "materia" ? "matéria" : "professor"}
              </button>
            ))}
          </div>
          {podeEditar && (
            <div className="flex items-center gap-2 text-sm">
              <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="Ao arrastar">
                {(["mover", "copiar"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setModoArrasto(v)}
                    className={cn("rounded px-2 py-0.5", modoArrasto === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {v === "mover" ? "Mover" : "Copiar"}
                  </button>
                ))}
              </div>
              {modoArrasto === "copiar" && (
                <label className="flex items-center gap-1" title="Em turma dividida, inverte matéria/professor/sala entre os grupos a cada cópia">
                  <input type="checkbox" checked={rodizio} onChange={(e) => setRodizio(e.target.checked)} /> Alternar grupos
                </label>
              )}
            </div>
          )}
          {podeExcluir && aulas.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" onClick={() => setLimpar("visao")}><Trash2 className="h-4 w-4" />Limpar {visao === "turma" ? "turma" : visao}</Button>
              <Button variant="outline" onClick={() => setLimpar("tudo")}><Trash2 className="h-4 w-4" />Limpar grade</Button>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sabado} onChange={(e) => setSabado(e.target.checked)} /> Mostrar sábado
          </label>
          </div>
        }
      />

      {!soProfessor && (
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="flex rounded-md border bg-card p-0.5">
            {(["turma", "professor", "sala"] as Visao[]).map((v) => (
              <button key={v} onClick={() => setVisao(v)}
                className={cn("rounded px-3 py-1 text-sm", visao === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                Por {v}
              </button>
            ))}
          </div>
          <SelectBusca className="w-72" ariaLabel="Selecionar" value={entId} onChange={(v) => setEntId(Number(v))}
            placeholder="Nada cadastrado"
            opcoes={opcoes.map((o) => ({
              value: String(o.id), label: o.nome,
              hint: visao === "turma" ? TURNOS[(o as { turno: Turno }).turno] : undefined,
              cor: visao === "professor" ? (o as { cor?: string }).cor : undefined,
            }))} />
          {visao !== "turma" && (
            <Select className="w-44" value={filtroTurno} onChange={(e) => setFiltroTurno(e.target.value as "" | Turno)} aria-label="Turno">
              <option value="">Todos os turnos</option>
              {ORDEM_TURNOS.map((t) => <option key={t} value={t}>{TURNOS[t]}</option>)}
            </Select>
          )}
          {visao !== "turma" && grades.length > 1 && (
            <Select className="w-44" value={filtroGrade} onChange={(e) => setFiltroGrade(e.target.value ? Number(e.target.value) : "")} aria-label="Grade de horários">
              <option value="">Todas as grades</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </Select>
          )}
        </div>
      )}

      {faixasAula.length === 0 ? (
        <Vazio texto={turmaSel ? `Configure os horários do turno da ${TURNOS[turmaSel.turno].toLowerCase()} em “Horários e intervalos”.` : "Configure os horários da escola em “Horários e intervalos”."} />
      ) : entId == null ? (
        <Vazio texto={soProfessor ? "Seu usuário não está vinculado a um professor." : "Cadastre turmas, professores ou salas para montar a grade."} />
      ) : (
        <Card className="overflow-x-auto">
          <DndContext sensors={sensores} onDragOver={aoPassar} onDragEnd={aoSoltar} onDragCancel={() => setSobre(null)}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-32 border bg-muted p-2 text-left font-medium">Horário</th>
                  {dias.map((d) => <th key={d.n} className="border bg-muted p-2 font-medium">{d.longo}</th>)}
                </tr>
              </thead>
              <tbody>
                {faixas.map((h, idx) => (
                  <Fragment key={h.id}>
                    {mostrarTitulosTurno && (idx === 0 || faixas[idx - 1].turno !== h.turno) && (
                      <tr>
                        <td colSpan={dias.length + 1} className="border bg-secondary px-2 py-1 text-xs font-semibold tracking-wide uppercase">{TURNOS[h.turno]}</td>
                      </tr>
                    )}
                    {h.tipo === "intervalo" ? (
                    <tr>
                      <td className="border bg-muted/60 p-1.5 text-xs tabular-nums text-muted-foreground">{faixaTexto(h)}{mostrarGrade && <span className="ml-1 text-[10px]">({nomeGrade(h.grade_id)})</span>}</td>
                      <td colSpan={dias.length} className="border bg-muted/60 p-1.5 text-center text-xs tracking-wide text-muted-foreground uppercase">{h.rotulo}</td>
                    </tr>
                  ) : (
                    <tr>
                      <td className="border bg-muted/40 p-2 text-xs">
                        <div className="font-medium">{h.rotulo}</div>
                        <div className="tabular-nums text-muted-foreground">{faixaTexto(h)}</div>
                        {mostrarGrade && <div className="text-[10px] text-muted-foreground">{nomeGrade(h.grade_id)}</div>}
                      </td>
                      {dias.map((d) => {
                        const lista = aulasNaCelula(d.n, h.id);
                        const turmaDaVisao = visao === "turma" ? turmas.find((t) => t.id === entId) : undefined;
                        const gruposTurma = turmaDaVisao ? grupos.filter((g) => g.turma_id === turmaDaVisao.id) : [];
                        const usados = new Set(lista.map((x) => x.turmas.find((t) => t.turma_id === entId)?.grupo_id));
                        const grupoLivre = !usados.has(null) ? gruposTurma.find((g) => !usados.has(g.id)) : undefined;
                        const ativo = sobre && sobre.alvo.dia === d.n && sobre.alvo.horarioId === h.id;
                        return (
                          <Celula key={d.n} dia={d.n} horarioId={h.id} podeCriar={podeCriar} vazia={lista.length === 0}
                            estado={ativo ? (sobre!.erros.length ? "erro" : "ok") : null}
                            onVazioClick={() => abrirNova(d.n, h.id)}>
                            <div className="flex flex-col gap-1">
                              {lista.map((a) => (
                                <CartaoAula key={a.id} aula={a} visao={visao} entId={entId} colorirPor={colorirPor} arrastavel={podeEditar}
                                  destaque={false} onClick={() => podeEditar && setForm({ id: a.id, dados: { ...a, observacao: a.observacao ?? "" } })} />
                              ))}
                            </div>
                            {podeCriar && grupoLivre && lista.length > 0 && (
                              <button type="button" onClick={() => abrirNova(d.n, h.id, grupoLivre.id)}
                                className="mt-1 w-full rounded border border-dashed py-0.5 text-[10px] text-muted-foreground hover:bg-muted">
                                + {grupoLivre.nome}
                              </button>
                            )}
                            {ativo && (sobre!.erros.length > 0 || sobre!.avisos.length > 0) && (
                              <div className={cn("mt-1 flex gap-1 text-[10px] leading-tight", sobre!.erros.length ? "text-destructive" : "text-warning")}>
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>{(sobre!.erros.length ? sobre!.erros : sobre!.avisos).join(" • ")}</span>
                              </div>
                            )}
                          </Celula>
                        );
                      })}
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </DndContext>
        </Card>
      )}

      <Modal aberto={!!form} onFechar={() => setForm(null)} titulo={form?.id ? "Editar aula" : "Nova aula"}
        descricao={form ? `${DIAS.find((d) => d.n === form.dados.dia_semana)?.longo} · ${faixaTexto(horarios.find((h) => h.id === form.dados.horario_id) ?? { inicio_min: 0, fim_min: 0 })}` : undefined}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Matéria" dica="Vazio = aula livre">
                <SelectBusca ariaLabel="Matéria" value={form.dados.materia_id} placeholder="— Livre —"
                  onChange={(v) => setForm({ ...form, dados: { ...form.dados, materia_id: v ? Number(v) : null } })}
                  opcoes={[{ value: "", label: "— Livre —" }, ...materias.map((m) => ({ value: String(m.id), label: m.nome, cor: m.cor }))]} />
              </Campo>
              <Campo label="Professor" dica="Vazio = sem professor">
                <SelectBusca ariaLabel="Professor" value={form.dados.professor_id} placeholder="— Sem professor —"
                  onChange={(v) => setForm({ ...form, dados: { ...form.dados, professor_id: v ? Number(v) : null } })}
                  opcoes={[
                    { value: "", label: "— Sem professor —" },
                    ...professores
                      .slice()
                      .sort((a, b) => Number(b.materia_ids.includes(form.dados.materia_id ?? -1)) - Number(a.materia_ids.includes(form.dados.materia_id ?? -1)))
                      .map((p) => ({
                        value: String(p.id), label: p.nome, cor: p.cor,
                        hint: form.dados.materia_id && p.materia_ids.includes(form.dados.materia_id) ? "★ dá a matéria" : undefined,
                      })),
                  ]} />
              </Campo>
              <Campo label="Sala">
                <SelectBusca ariaLabel="Sala" value={form.dados.sala_id} placeholder="— Sem sala —"
                  onChange={(v) => setForm({ ...form, dados: { ...form.dados, sala_id: v ? Number(v) : null } })}
                  opcoes={[{ value: "", label: "— Sem sala —" }, ...salas.map((x) => ({ value: String(x.id), label: x.nome }))]} />
              </Campo>
            </div>
            <Campo label="Turma(s) *" dica="Mais de uma turma = aula conjunta. Grupo = parte da turma.">
              <div className="space-y-2">
                {form.dados.turmas.map((r, i) => {
                  const hSel = horarios.find((h) => h.id === form.dados.horario_id);
                  const gs = grupos.filter((g) => g.turma_id === r.turma_id);
                  const set = (novo: TurmaRef) =>
                    setForm({ ...form, dados: { ...form.dados, turmas: form.dados.turmas.map((x, j) => (j === i ? novo : x)) } });
                  return (
                    <div key={i} className="flex gap-2">
                      <SelectBusca ariaLabel="Turma" value={r.turma_id} onChange={(v) => set({ turma_id: Number(v), grupo_id: null })}
                        opcoes={turmas.filter((t) => hSel && podeNaFaixa(t, hSel, horarios)).map((t) => ({ value: String(t.id), label: t.nome }))} />
                      <SelectBusca ariaLabel="Grupo" value={r.grupo_id} disabled={gs.length === 0}
                        onChange={(v) => set({ ...r, grupo_id: v ? Number(v) : null })}
                        opcoes={[{ value: "", label: "Turma inteira" }, ...gs.map((x) => ({ value: String(x.id), label: x.nome }))]} />
                      {form.dados.turmas.length > 1 && (
                        <Button size="icon" variant="ghost" aria-label="Remover turma"
                          onClick={() => setForm({ ...form, dados: { ...form.dados, turmas: form.dados.turmas.filter((_, j) => j !== i) } })}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => {
                  const hSel = horarios.find((h) => h.id === form.dados.horario_id);
                  const livre = turmas.find((t) => hSel && podeNaFaixa(t, hSel, horarios) && !form.dados.turmas.some((r) => r.turma_id === t.id));
                  if (!livre) return toast.error("Não há outra turma deste turno para juntar.");
                  setForm({ ...form, dados: { ...form.dados, turmas: [...form.dados.turmas, { turma_id: livre.id, grupo_id: null }] } });
                }}>
                  <Plus className="h-4 w-4" />Juntar outra turma
                </Button>
              </div>
            </Campo>
            <Campo label="Observação"><Input value={form.dados.observacao ?? ""} onChange={(e) => setForm({ ...form, dados: { ...form.dados, observacao: e.target.value } })} /></Campo>

            {(conflitosForm.length > 0 || dica.length > 0) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                {[...new Set([...conflitosForm.map((c) => c.mensagem), ...dica])].map((m) => <div key={m}>• {m}</div>)}
              </div>
            )}
            {(() => {
              const todos = [...new Set([...(avisoForm ? [avisoForm] : []), ...avisosServidor])];
              return todos.length > 0 && (
                <div className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm text-warning">
                  {todos.map((m) => <div key={m}>• {m}</div>)}
                </div>
              );
            })()}

            <div className="flex justify-between gap-2 pt-2">
              <div>
                {form.id && podeExcluir && (
                  <Button variant="outline" onClick={excluirForm}><Trash2 className="h-4 w-4 text-destructive" />Remover</Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
                <Button onClick={salvarForm} disabled={conflitosForm.length > 0}>Salvar</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar
        aberto={limpar !== null}
        titulo={limpar === "tudo" ? "Limpar a grade inteira" : "Limpar aulas da seleção"}
        mensagem={limpar === "tudo" ? `Todas as ${aulas.length} aulas da escola serão apagadas. Esta ação não pode ser desfeita. Continuar?` : `${aulasDaVisao.length} aula(s) da seleção atual serão apagadas. Continuar?`}
        onCancelar={() => setLimpar(null)}
        onConfirmar={confirmarLimpar}
      />
    </>
  );
}
