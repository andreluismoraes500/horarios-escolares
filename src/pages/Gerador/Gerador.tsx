// Gerador automático da grade: define quantas aulas por semana cada turma tem de cada matéria
// e monta a grade respeitando disponibilidade dos professores, salas e conflitos.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Card, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { TURNOS } from "@/lib/tempo";
import type { ResultadoGeracao } from "@/types";
import SelectBusca from "@/components/SelectBusca";

interface Linha {
  aulas: string;
  professor: string; // "" = automático
  sala: string; // "" = qualquer
  max: string;
}
const VAZIA: Linha = { aulas: "", professor: "", sala: "", max: "2" };

export default function Gerador() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, turmas, materias, professores, salas, demandas, carregar } = useDados();
  const [turmaId, setTurmaId] = useState<number | null>(null);
  const [linhas, setLinhas] = useState<Record<number, Linha>>({});
  const [copiar, setCopiar] = useState<number[] | null>(null);
  const [ativas, setAtivas] = useState<number[]>([]); // matérias listadas para a turma
  const [marcadas, setMarcadas] = useState<number[]>([]);

  const [escopo, setEscopo] = useState<string>(""); // "" = todas as turmas
  const [modo, setModo] = useState<"preencher" | "refazer">("preencher");
  const [sabado, setSabado] = useState(false);
  const [res, setRes] = useState<ResultadoGeracao | null>(null);
  const [gerando, setGerando] = useState(false);
  const [confirmarRefazer, setConfirmarRefazer] = useState(false);

  const podeEditar = pode("turmas", "editar");
  const podeGerar = pode("aulas", "criar");

  useEffect(() => {
    if (!turmas.some((t) => t.id === turmaId)) setTurmaId(turmas[0]?.id ?? null);
  }, [turmas, turmaId]);

  // Carrega as linhas editáveis da turma escolhida a partir das demandas salvas.
  useEffect(() => {
    if (turmaId == null) return;
    const m: Record<number, Linha> = {};
    for (const mat of materias) {
      const d = demandas.find((x) => x.turma_id === turmaId && x.materia_id === mat.id);
      m[mat.id] = d
        ? { aulas: String(d.aulas_semana), professor: d.professor_id ? String(d.professor_id) : "", sala: d.sala_id ? String(d.sala_id) : "", max: String(d.max_por_dia) }
        : { ...VAZIA };
    }
    setLinhas(m);
    setAtivas(materias.filter((mat) => demandas.some((x) => x.turma_id === turmaId && x.materia_id === mat.id)).map((x) => x.id));
    setMarcadas([]);
  }, [turmaId, demandas, materias]);

  const turma = turmas.find((t) => t.id === turmaId);
  const totalTurma = useMemo(() => Object.values(linhas).reduce((s, l) => s + (Number(l.aulas) || 0), 0), [linhas]);
  const nomeTurma = (id: number) => turmas.find((t) => t.id === id)?.nome ?? "—";
  const nomeMat = (id: number) => materias.find((m) => m.id === id)?.nome ?? "—";

  function set(matId: number, campo: keyof Linha, v: string) {
    setLinhas((l) => ({ ...l, [matId]: { ...l[matId], [campo]: v } }));
  }

  function adicionar(v: string) {
    const id = Number(v);
    if (!v || ativas.includes(id)) return;
    setAtivas((a) => [...a, id]);
    setLinhas((l) => ({ ...l, [id]: { ...(l[id] ?? VAZIA), aulas: l[id]?.aulas || "2" } }));
  }
  function remover(ids: number[]) {
    setAtivas((a) => a.filter((x) => !ids.includes(x)));
    setLinhas((l) => { const n = { ...l }; for (const i of ids) n[i] = { ...VAZIA }; return n; });
    setMarcadas((m) => m.filter((x) => !ids.includes(x)));
  }
  const listadas = materias.filter((m) => ativas.includes(m.id));
  const todasMarcadas = listadas.length > 0 && listadas.every((m) => marcadas.includes(m.id));

  async function salvar() {
    if (!escolaId || turmaId == null) return;
    const ok = await executar(async () => {
      for (const mat of materias) {
        const l = linhas[mat.id];
        const existente = demandas.find((x) => x.turma_id === turmaId && x.materia_id === mat.id);
        const n = Number(l.aulas) || 0;
        if (n <= 0) {
          if (existente) await api.excluirDemanda(existente.id);
          continue;
        }
        await api.salvarDemanda({
          escola_id: escolaId, turma_id: turmaId, materia_id: mat.id, aulas_semana: n,
          professor_id: l.professor ? Number(l.professor) : null,
          sala_id: l.sala ? Number(l.sala) : null,
          max_por_dia: Number(l.max) || 2,
        });
      }
    }, "Aulas por semana salvas.");
    if (ok) await carregar(["demandas"]);
  }

  async function gerar(aplicar: boolean) {
    if (!escolaId) return;
    setGerando(true);
    try {
      let r: ResultadoGeracao | null = null;
      const ok = await executar(async () => {
        r = await api.gerarGradeAuto({ escolaId, turmaIds: escopo ? [Number(escopo)] : [], modo, incluirSabado: sabado, aplicar });
      });
      if (!ok || !r) return;
      const resultado: ResultadoGeracao = r;
      setRes(resultado);
      if (aplicar) {
        toast.success(`${resultado.gravadas} aulas gravadas na grade.`);
        await carregar(["aulas"]);
      }
    } finally {
      setGerando(false);
    }
  }

  if (!escolaId) return <Vazio texto="Selecione ou cadastre uma escola." />;
  if (turmas.length === 0 || materias.length === 0) {
    return <Vazio texto="Cadastre turmas e matérias (e professores com suas matérias) para usar o gerador." />;
  }

  return (
    <>
      <Titulo titulo="Gerador automático" subtitulo="Informe quantas aulas por semana cada turma tem de cada matéria; o sistema monta a grade respeitando a disponibilidade dos professores." />

      <Card className="mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">1. Aulas por semana</h2>
          <SelectBusca className="w-72" ariaLabel="Turma" value={turmaId} onChange={(v) => setTurmaId(Number(v))}
            opcoes={turmas.map((t) => ({ value: String(t.id), label: t.nome, hint: TURNOS[t.turno] }))} />
          <span className="text-sm text-muted-foreground">Total: {totalTurma} aulas/semana</span>
          {podeEditar && (
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setCopiar([])}><Copy className="h-4 w-4" />Copiar para outras turmas</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          )}
        </div>
        {podeEditar && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SelectBusca className="w-80" ariaLabel="Adicionar matéria" value="" onChange={adicionar} placeholder="Pesquisar matéria para adicionar…"
              opcoes={materias.filter((m) => !ativas.includes(m.id)).map((m) => ({ value: String(m.id), label: m.nome }))} />
            <Button variant="outline" disabled={marcadas.length === 0} onClick={() => remover(marcadas)}>
              <Trash2 className="h-4 w-4" />Excluir selecionadas{marcadas.length > 0 ? ` (${marcadas.length})` : ""}
            </Button>
            <span className="text-xs text-muted-foreground">{listadas.length} matéria(s) nesta turma. Lembre de clicar em Salvar.</span>
          </div>
        )}
        <Tabela>
          <thead><tr><Th className="w-10"><input type="checkbox" aria-label="Selecionar todas" checked={todasMarcadas}
            onChange={(e) => setMarcadas(e.target.checked ? listadas.map((m) => m.id) : [])} /></Th><Th>Matéria</Th><Th className="w-28">Aulas/semana</Th><Th>Professor</Th><Th>Sala</Th><Th className="w-28">Máx. por dia</Th><Th className="w-10"></Th></tr></thead>
          <tbody>
            {listadas.length === 0 && <tr><Td colSpan={6} className="text-center text-muted-foreground">Nenhuma matéria nesta turma. Pesquise acima para adicionar.</Td></tr>}
            {listadas.map((m) => {
              const l = linhas[m.id] ?? VAZIA;
              const elegiveis = professores.filter((p) => p.materia_ids.includes(m.id));
              return (
                <tr key={m.id}>
                  <Td><input type="checkbox" aria-label={`Selecionar ${m.nome}`} checked={marcadas.includes(m.id)}
                    onChange={(e) => setMarcadas(e.target.checked ? [...marcadas, m.id] : marcadas.filter((x) => x !== m.id))} /></Td>
                  <Td><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: m.cor }} />{m.nome}</Td>
                  <Td><Input type="number" min={0} max={30} disabled={!podeEditar} aria-label={`Aulas de ${m.nome}`} value={l.aulas} onChange={(e) => set(m.id, "aulas", e.target.value)} /></Td>
                  <Td>
                    <SelectBusca disabled={!podeEditar} ariaLabel={`Professor de ${m.nome}`} value={l.professor} onChange={(v) => set(m.id, "professor", v)}
                      placeholder="Automático"
                      opcoes={[{ value: "", label: `Automático${elegiveis.length === 0 ? " (nenhum professor cadastrado)" : ` (${elegiveis.length})`}` },
                        ...elegiveis.map((p) => ({ value: String(p.id), label: p.nome, cor: p.cor }))]} />
                  </Td>
                  <Td>
                    <SelectBusca disabled={!podeEditar} ariaLabel={`Sala de ${m.nome}`} value={l.sala} onChange={(v) => set(m.id, "sala", v)}
                      placeholder="Qualquer sala livre"
                      opcoes={[{ value: "", label: "Qualquer sala livre" }, ...salas.map((x) => ({ value: String(x.id), label: x.nome }))]} />
                  </Td>
                  <Td><Input type="number" min={1} max={6} disabled={!podeEditar} value={l.max} onChange={(e) => set(m.id, "max", e.target.value)} /></Td>
                  <Td>{podeEditar && <button className="text-muted-foreground hover:text-destructive" aria-label={`Excluir ${m.nome}`} onClick={() => remover([m.id])}><Trash2 className="h-4 w-4" /></button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
        {turma && <p className="mt-2 text-xs text-muted-foreground">Só as matérias listadas entram na turma. Escolha uma sala só quando for necessária (ex.: laboratório).</p>}
      </Card>

      {podeGerar && (
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">2. Gerar a grade</h2>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SelectBusca className="w-60" ariaLabel="Escopo" value={escopo} onChange={(v) => { setEscopo(v); setRes(null); }}
              opcoes={[{ value: "", label: "Todas as turmas" }, ...turmas.map((t) => ({ value: String(t.id), label: t.nome, hint: TURNOS[t.turno] }))]} />
            <Select className="w-80" aria-label="Modo" value={modo} onChange={(e) => { setModo(e.target.value as "preencher" | "refazer"); setRes(null); }}>
              <option value="preencher">Preencher o que falta (mantém as aulas já montadas)</option>
              <option value="refazer">Refazer do zero (apaga as aulas das turmas selecionadas)</option>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sabado} onChange={(e) => { setSabado(e.target.checked); setRes(null); }} /> Usar sábado
            </label>
            <Button disabled={gerando} onClick={() => gerar(false)}><Wand2 className="h-4 w-4" />Gerar prévia</Button>
          </div>

          {res && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge>{res.total_alocado} de {res.total_demandado} aulas {res.aplicado ? "gravadas" : "se encaixam"}</Badge>
                {res.pendencias.length === 0
                  ? <span className="text-success">Toda a demanda coube.</span>
                  : <span className="text-warning">{res.pendencias.reduce((s, p) => s + p.faltam, 0)} aula(s) não couberam.</span>}
                {res.sem_sala > 0 && <span className="text-muted-foreground">{res.sem_sala} aula(s) ficaram sem sala (não havia sala livre).</span>}
              </div>
              {res.pendencias.length > 0 && (
                <Tabela>
                  <thead><tr><Th>Turma</Th><Th>Matéria</Th><Th className="w-20">Faltam</Th><Th>Motivo</Th></tr></thead>
                  <tbody>
                    {res.pendencias.map((p, i) => (
                      <tr key={i}><Td>{nomeTurma(p.turma_id)}</Td><Td>{nomeMat(p.materia_id)}</Td><Td>{p.faltam}</Td><Td className="text-muted-foreground">{p.motivo}</Td></tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
              {!res.aplicado ? (
                <Button disabled={gerando || res.total_alocado === 0} onClick={() => (modo === "refazer" ? setConfirmarRefazer(true) : gerar(true))}>
                  Aplicar na grade
                </Button>
              ) : (
                <p className="text-sm">
                  Pronto! {res.removidas > 0 && `${res.removidas} aula(s) antigas foram substituídas. `}
                  <Link className="text-primary underline" to="/grade">Ver a grade semanal</Link>. Os ajustes finais podem ser feitos arrastando as aulas.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <Modal aberto={copiar !== null} onFechar={() => setCopiar(null)} titulo="Copiar para outras turmas" descricao={`Copia as aulas por semana de ${turma?.nome ?? ""} (substitui as das turmas marcadas).`}>
        {copiar && (
          <div className="space-y-3">
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {turmas.filter((t) => t.id !== turmaId).map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={copiar.includes(t.id)}
                    onChange={(e) => setCopiar(e.target.checked ? [...copiar, t.id] : copiar.filter((x) => x !== t.id))} />
                  {t.nome} <span className="text-muted-foreground">— {TURNOS[t.turno]}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCopiar(null)}>Cancelar</Button>
              <Button disabled={copiar.length === 0} onClick={async () => {
                if (turmaId != null && (await executar(() => api.copiarDemandas(turmaId, copiar), "Aulas por semana copiadas."))) {
                  setCopiar(null);
                  await carregar(["demandas"]);
                }
              }}>Copiar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={confirmarRefazer}
        titulo="Refazer a grade"
        mensagem="As aulas atuais das turmas selecionadas serão apagadas e substituídas pela grade gerada. Continuar?"
        onCancelar={() => setConfirmarRefazer(false)}
        onConfirmar={async () => { setConfirmarRefazer(false); await gerar(true); }}
      />
    </>
  );
}
