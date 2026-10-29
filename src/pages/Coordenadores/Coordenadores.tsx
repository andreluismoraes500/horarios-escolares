// Coordenadores: turmas que coordenam (com as matérias delas) e expediente com horários variados.

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Confirmar, Input, Modal, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import SelectBusca from "@/components/SelectBusca";
import { ExcluirLote, TdSel, ThSel, useSelecao } from "@/components/Lote";
import { DIAS } from "@/lib/tempo";
import { gravarExpediente, horaTexto, lerExpediente, parseHm, periodoTexto, resumoExpediente, type Periodo } from "@/lib/expediente";
import type { Coordenador, CoordenadorInput } from "@/types";

const PRESETS: { rotulo: string; ini: string; fim: string }[] = [
  { rotulo: "Manhã 07:00–12:00", ini: "07:00", fim: "12:00" },
  { rotulo: "Tarde 13:00–18:00", ini: "13:00", fim: "18:00" },
  { rotulo: "Noite 18:30–22:30", ini: "18:30", fim: "22:30" },
];

/** Editor do expediente: períodos por dia, com atalhos para aplicar de segunda a sexta. */
function EditorExpediente({ valor, onChange }: { valor: Periodo[]; onChange: (p: Periodo[]) => void }) {
  const [novo, setNovo] = useState<Record<number, { ini: string; fim: string }>>({});
  const add = (dia: number, ini: string, fim: string) => {
    const a = parseHm(ini), b = parseHm(fim);
    if (!(b > a)) return toast.error("O fim precisa ser depois do início.");
    if (valor.some((p) => p.dia === dia && a < p.fim && b > p.ini)) return toast.error("Esse período se sobrepõe a outro do mesmo dia.");
    onChange([...valor, { dia, ini: a, fim: b }]);
  };
  const addSemana = (ini: string, fim: string) => {
    const a = parseHm(ini), b = parseHm(fim);
    const extra = [1, 2, 3, 4, 5].filter((d) => !valor.some((p) => p.dia === d && a < p.fim && b > p.ini)).map((d) => ({ dia: d, ini: a, fim: b }));
    onChange([...valor, ...extra]);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground">Atalhos (seg–sex):</span>
        {PRESETS.map((p) => <Button key={p.rotulo} type="button" size="sm" variant="outline" onClick={() => addSemana(p.ini, p.fim)}>+ {p.rotulo}</Button>)}
        {valor.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Limpar tudo</Button>}
      </div>
      <div className="rounded-md border">
        {DIAS.map((d) => {
          const ps = valor.filter((p) => p.dia === d.n).sort((a, b) => a.ini - b.ini);
          const n = novo[d.n] ?? { ini: "07:00", fim: "12:00" };
          return (
            <div key={d.n} className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
              <div className="w-12 text-sm font-medium">{d.curto}</div>
              <div className="flex min-w-[8rem] flex-1 flex-wrap gap-1">
                {ps.length === 0 && <span className="text-xs text-muted-foreground">sem expediente</span>}
                {ps.map((p) => (
                  <span key={p.ini} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums">
                    {periodoTexto(p)}
                    <button type="button" aria-label={`Remover ${d.curto} ${periodoTexto(p)}`} onClick={() => onChange(valor.filter((x) => x !== p))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
              <input type="time" aria-label={`Início ${d.curto}`} className="h-8 rounded border bg-card px-1 text-xs" value={n.ini} onChange={(e) => setNovo({ ...novo, [d.n]: { ...n, ini: e.target.value } })} />
              <span className="text-xs">às</span>
              <input type="time" aria-label={`Fim ${d.curto}`} className="h-8 rounded border bg-card px-1 text-xs" value={n.fim} onChange={(e) => setNovo({ ...novo, [d.n]: { ...n, fim: e.target.value } })} />
              <Button type="button" size="sm" variant="outline" onClick={() => add(d.n, n.ini, n.fim)}><Plus className="h-3 w-3" />Período</Button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Vários períodos por dia são permitidos (ex.: 07:00–12:00 e 18:30–22:30). Cada período tem a sua assinatura na lista de presença.</p>
    </div>
  );
}

export default function Coordenadores() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, turmas, materias, demandas, aulas } = useDados();
  const [lista, setLista] = useState<Coordenador[]>([]);
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState<{ id: number | null; dados: CoordenadorInput; expediente: Periodo[] } | null>(null);
  const [excluir, setExcluir] = useState<Coordenador | null>(null);

  async function carregar() {
    if (!escolaId) return;
    try { setLista(await api.listarCoordenadores(escolaId)); } catch (e) { toast.error((e as Error).message); }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [escolaId]);

  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filtrada = useMemo(() => lista.filter((c) => norm(c.nome).includes(norm(busca.trim()))), [lista, busca]);
  const selecao = useSelecao(filtrada);
  const nomeTurma = (id: number) => turmas.find((t) => t.id === id)?.nome ?? "—";

  /** Matérias das turmas coordenadas (da demanda de aulas por semana e das aulas já montadas). */
  const materiasDe = (turmaIds: number[]) => {
    const ids = new Set<number>();
    demandas.filter((d) => turmaIds.includes(d.turma_id)).forEach((d) => ids.add(d.materia_id));
    aulas.filter((a) => a.materia_id != null && a.turmas.some((t) => turmaIds.includes(t.turma_id))).forEach((a) => ids.add(a.materia_id!));
    return materias.filter((m) => ids.has(m.id));
  };

  async function salvar() {
    if (!edit) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome do coordenador.");
    const dados = { ...edit.dados, expediente: gravarExpediente(edit.expediente) };
    const ok = await executar(() => (edit.id ? api.atualizarCoordenador(edit.id, dados) : api.criarCoordenador(dados)), "Coordenador salvo.");
    if (ok) { setEdit(null); await carregar(); }
  }
  const novo = (): CoordenadorInput => ({ escola_id: escolaId!, nome: "", email: "", telefone: "", expediente: "[]", turma_ids: [] });

  if (!escolaId) return <Vazio texto="Selecione ou cadastre uma escola." />;
  const podeCriar = pode("professores", "criar");

  return (
    <>
      <Titulo
        titulo="Coordenadores"
        subtitulo="Turmas que cada coordenador acompanha e o expediente dele; entram na lista de presença"
        acoes={podeCriar && <Button onClick={() => setEdit({ id: null, dados: novo(), expediente: [] })}><Plus className="h-4 w-4" />Novo coordenador</Button>}
      />
      <Input className="mb-3 max-w-xs" placeholder="Buscar por nome…" aria-label="Buscar coordenador" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {pode("professores", "excluir") && <div className="mb-3 empty:hidden"><ExcluirLote s={selecao} singular="coordenador" plural="coordenadores" excluirUm={api.excluirCoordenador} depois={carregar} /></div>}
      {lista.length === 0 ? <Vazio texto="Nenhum coordenador cadastrado." /> : filtrada.length === 0 ? <Vazio texto="Nenhum coordenador encontrado." /> : (
        <Tabela>
          <thead><tr>{pode("professores", "excluir") && <ThSel s={selecao} />}<Th>Nome</Th><Th>Turmas</Th><Th>Matérias das turmas</Th><Th>Expediente</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {filtrada.map((c) => (
              <tr key={c.id}>
                {pode("professores", "excluir") && <TdSel s={selecao} id={c.id} nome={c.nome} />}
                <Td className="font-medium">{c.nome}<div className="text-xs font-normal text-muted-foreground">{c.email || c.telefone || ""}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{c.turma_ids.length === 0 ? "—" : c.turma_ids.map((id) => <Badge key={id}>{nomeTurma(id)}</Badge>)}</div></Td>
                <Td><div className="flex flex-wrap gap-1">{materiasDe(c.turma_ids).map((m) => <span key={m.id} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: m.cor }}>{m.nome}</span>)}</div></Td>
                <Td className="text-xs text-muted-foreground">{resumoExpediente(c.expediente)}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("professores", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: c.id, dados: { escola_id: c.escola_id, nome: c.nome, email: c.email ?? "", telefone: c.telefone ?? "", expediente: c.expediente, turma_ids: c.turma_ids }, expediente: lerExpediente(c.expediente) })}><Pencil className="h-4 w-4" /></Button>
                    )}
                    {pode("professores", "excluir") && <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar coordenador" : "Novo coordenador"} largura="max-w-2xl">
        {edit && (
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
              <Campo label="E-mail"><Input value={edit.dados.email ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, email: e.target.value } })} /></Campo>
              <Campo label="Telefone"><Input value={edit.dados.telefone ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, telefone: e.target.value } })} /></Campo>
            </div>
            <Campo label="Turmas que coordena">
              <SelectBusca ariaLabel="Adicionar turma" value="" placeholder="Pesquisar turma para adicionar…" onChange={(v) => v && !edit.dados.turma_ids.includes(Number(v)) && setEdit({ ...edit, dados: { ...edit.dados, turma_ids: [...edit.dados.turma_ids, Number(v)] } })}
                opcoes={turmas.filter((t) => !edit.dados.turma_ids.includes(t.id)).map((t) => ({ value: String(t.id), label: t.nome }))} />
              <div className="mt-2 flex flex-wrap gap-1">
                {edit.dados.turma_ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {nomeTurma(id)}
                    <button type="button" aria-label={`Remover ${nomeTurma(id)}`} onClick={() => setEdit({ ...edit, dados: { ...edit.dados, turma_ids: edit.dados.turma_ids.filter((x) => x !== id) } })}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Matérias dessas turmas:</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {materiasDe(edit.dados.turma_ids).length === 0 ? <span className="text-xs text-muted-foreground">— (aparecem quando a turma tem aulas por semana ou aulas na grade)</span>
                  : materiasDe(edit.dados.turma_ids).map((m) => <span key={m.id} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: m.cor }}>{m.nome}</span>)}
              </div>
            </Campo>
            <Campo label="Expediente (horários de trabalho)">
              <EditorExpediente valor={edit.expediente} onChange={(p) => setEdit({ ...edit, expediente: p })} />
            </Campo>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir coordenador" mensagem={`Excluir “${excluir?.nome}”?`} onCancelar={() => setExcluir(null)}
        onConfirmar={async () => { if (excluir && (await executar(() => api.excluirCoordenador(excluir.id), "Coordenador excluído."))) { setExcluir(null); await carregar(); } }} />
    </>
  );
}
