// Lista de presença dos professores (semanal ou mensal) + cadastro de feriados e recessos.

import { Fragment, useEffect, useMemo, useState } from "react";
import { FileDown, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Card, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import SelectBusca from "@/components/SelectBusca";
import { cn } from "@/lib/utils";
import { feriadosNacionais, iso, segundaDaSemana, somarDias, TIPOS_FERIADO } from "@/lib/feriados";
import { dataBr, folhaMensal, folhaSemanal, MESES, type Dados, type Folha } from "@/lib/presenca";
import type { Feriado, FeriadoInput } from "@/types";

function paraBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function Presenca() {
  const pode = useAuth((s) => s.pode);
  const { escolaId, escolas, professores, aulas, horarios, turmas, grupos, materias } = useDados();
  const escola = escolas.find((e) => e.id === escolaId);
  const [aba, setAba] = useState<"lista" | "feriados">("lista");
  const [feriados, setFeriados] = useState<Feriado[]>([]);

  async function carregarFeriados() {
    if (!escolaId) return;
    try { setFeriados(await api.listarFeriados(escolaId)); } catch (e) { toast.error((e as Error).message); }
  }
  useEffect(() => { void carregarFeriados(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [escolaId]);

  // ---------------- Lista ----------------
  const hoje = iso(new Date());
  const [periodo, setPeriodo] = useState<"mensal" | "semanal">("mensal");
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [semana, setSemana] = useState(segundaDaSemana(hoje));
  const [profId, setProfId] = useState<string>("todos");
  const [sabado, setSabado] = useState(false);

  const dados: Dados = { aulas, horarios, turmas, grupos, materias, feriados };
  const folhas: Folha[] = useMemo(() => {
    if (periodo === "semanal") {
      const alvo = profId === "todos" ? professores : professores.filter((p) => String(p.id) === profId);
      return [folhaSemanal(alvo, semana, sabado, dados)];
    }
    const alvo = profId === "todos" ? professores : professores.filter((p) => String(p.id) === profId);
    return alvo.map((p) => folhaMensal(p, mes, sabado, dados));
  }, [periodo, mes, semana, profId, sabado, professores, aulas, horarios, turmas, grupos, materias, feriados]); // eslint-disable-line react-hooks/exhaustive-deps
  const vazio = folhas.length === 0 || folhas.every((f) => f.linhas.length === 0);

  async function exportarPdf() {
    const nome = periodo === "mensal" ? `presenca-${mes}` : `presenca-semana-${semana}`;
    const caminho = await save({ defaultPath: `${nome}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!caminho) return;
    const doc = new jsPDF({ orientation: periodo === "semanal" ? "landscape" : "portrait", unit: "mm", format: "a4" });
    folhas.forEach((f, i) => {
      if (i > 0) doc.addPage();
      let x = 14;
      if (escola?.logo) { try { doc.addImage(escola.logo, "PNG", 14, 6, 14, 14); x = 32; } catch { /* sem logo */ } }
      doc.setFontSize(13); doc.text(escola?.nome ?? "Escola", x, 12);
      doc.setFontSize(10); doc.text(`${f.titulo}   |   ${f.subtitulo}`, x, 18);
      const semanal = periodo === "semanal";
      autoTable(doc, {
        startY: 25,
        head: [f.head],
        body: f.linhas.map((l) => l.map((c) => ({
          content: c.tipo === "ass" && !semanal ? "" : c.t,
          colSpan: c.span,
          styles: c.tipo === "bloq"
            ? { fillColor: [203, 213, 225] as [number, number, number], textColor: [71, 85, 105] as [number, number, number], fontStyle: "italic" as const, halign: "center" as const }
            : c.tipo === "vazio" ? { fillColor: [241, 245, 249] as [number, number, number], textColor: [148, 163, 184] as [number, number, number], halign: "center" as const }
            : {},
        }))) as never,
        styles: { fontSize: semanal ? 7.5 : 8.5, cellPadding: 1.6, valign: "middle", lineColor: [148, 163, 184], lineWidth: 0.2, minCellHeight: semanal ? 15 : 8.5 },
        headStyles: { fillColor: [37, 99, 235] },
        columnStyles: semanal ? { 0: { cellWidth: 38 } } : { 0: { cellWidth: 24 }, 2: { cellWidth: 62 } },
        // Semanal: o texto sobe e deixa a parte de baixo da célula livre para a assinatura.
        didParseCell: (d) => { if (semanal && d.section === "body" && d.column.index > 0) d.cell.styles.valign = "top"; },
      });
      const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      doc.setFontSize(8.5);
      if (f.resumo) doc.text(f.resumo, 14, y + 6);
      const base = Math.min(doc.internal.pageSize.getHeight() - 14, y + 26);
      doc.line(14, base, 90, base); doc.text("Direção / Coordenação", 14, base + 4);
      doc.setFontSize(7); doc.setTextColor(120);
      doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, doc.internal.pageSize.getHeight() - 6);
      doc.setTextColor(0);
    });
    await executar(() => api.salvarArquivo(caminho, paraBase64(new Uint8Array(doc.output("arraybuffer")))), "PDF exportado.");
  }

  // ---------------- Feriados ----------------
  const [edit, setEdit] = useState<{ id: number | null; dados: FeriadoInput } | null>(null);
  const [excluir, setExcluir] = useState<Feriado | null>(null);
  const [ano, setAno] = useState(new Date().getFullYear());
  const novo = (): FeriadoInput => ({ escola_id: escolaId!, data_ini: hoje, data_fim: hoje, nome: "", tipo: "feriado", bloqueia_assinatura: true });
  const nacionais = useMemo(() => [...feriadosNacionais(ano).entries()].sort(([a], [b]) => a.localeCompare(b)), [ano]);
  const doAno = feriados.filter((f) => f.data_ini.slice(0, 4) <= String(ano) && f.data_fim.slice(0, 4) >= String(ano));

  async function salvarFeriado() {
    if (!edit) return;
    if (!edit.dados.nome.trim()) return toast.error("Informe o nome.");
    if (edit.dados.data_fim < edit.dados.data_ini) return toast.error("A data final não pode ser anterior à inicial.");
    const ok = await executar(() => (edit.id ? api.atualizarFeriado(edit.id, edit.dados) : api.criarFeriado(edit.dados)), "Salvo.");
    if (ok) { setEdit(null); await carregarFeriados(); }
  }

  if (!escolaId) return <Vazio texto="Selecione ou cadastre uma escola." />;
  const podeFeriado = pode("horarios", "criar");

  return (
    <>
      <div className="no-print">
        <Titulo
          titulo="Lista de presença"
          subtitulo="Folha de assinatura dos professores (semanal ou mensal), respeitando feriados e recessos"
          acoes={aba === "lista" && (
            <>
              <Button variant="outline" disabled={vazio} onClick={() => void exportarPdf().catch((e: Error) => toast.error(e.message))}><FileDown className="h-4 w-4" />PDF</Button>
              <Button disabled={vazio} onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</Button>
            </>
          )}
        />
        <div className="mb-4 flex w-fit rounded-md border bg-card p-0.5 text-sm">
          {([["lista", "Lista de presença"], ["feriados", "Feriados e recessos"]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setAba(k)} className={cn("rounded px-3 py-1", aba === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{r}</button>
          ))}
        </div>
      </div>

      {aba === "lista" ? (
        <>
          <div className="no-print mb-4 flex flex-wrap items-center gap-2">
            <Select className="w-36" aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value as "mensal" | "semanal")}>
              <option value="mensal">Mensal</option>
              <option value="semanal">Semanal</option>
            </Select>
            {periodo === "mensal" ? (
              <Input type="month" className="w-44" aria-label="Mês" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
            ) : (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" aria-label="Semana anterior" onClick={() => setSemana(somarDias(semana, -7))}>‹</Button>
                <Input type="date" className="w-44" aria-label="Semana" value={semana} onChange={(e) => e.target.value && setSemana(segundaDaSemana(e.target.value))} />
                <Button size="sm" variant="outline" aria-label="Próxima semana" onClick={() => setSemana(somarDias(semana, 7))}>›</Button>
              </div>
            )}
            <SelectBusca className="w-64" ariaLabel="Professor" value={profId} onChange={setProfId}
              opcoes={[{ value: "todos", label: periodo === "mensal" ? "Todos (uma folha por professor)" : "Todos os professores" },
                ...professores.map((p) => ({ value: String(p.id), label: p.nome, cor: p.cor }))]} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sabado} onChange={(e) => setSabado(e.target.checked)} /> Incluir sábado</label>
          </div>
          {vazio ? <Vazio texto="Nenhum professor com aulas neste período. Monte a grade semanal primeiro." /> : (
            <div className="area-impressao space-y-6">
              {folhas.map((f, i) => (
                <Card key={i} className="pagina-impressao overflow-x-auto p-4">
                  <div className="mb-3 flex items-center gap-3">
                    {escola?.logo && <img src={escola.logo} alt="" className="h-10 w-10 object-contain" />}
                    <div>
                      <div className="font-semibold">{escola?.nome}</div>
                      <div className="text-sm text-muted-foreground">{f.titulo} · {f.subtitulo}</div>
                    </div>
                  </div>
                  <table className="w-full border-collapse text-xs">
                    <thead><tr>{f.head.map((h) => <th key={h} className="border bg-muted p-1.5 text-left">{h}</th>)}</tr></thead>
                    <tbody>
                      {f.linhas.map((l, r) => (
                        <tr key={r}>
                          {l.map((c, k) => (
                            <td key={k} colSpan={c.span}
                              className={cn("border p-1.5 align-top whitespace-pre-line",
                                c.tipo === "bloq" && "bg-muted text-center text-muted-foreground italic [print-color-adjust:exact]",
                                c.tipo === "vazio" && "bg-muted/40 text-center text-muted-foreground",
                                c.tipo === "ass" && "h-10 min-w-[120px]")}>
                              {c.t}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {f.resumo && <p className="mt-2 text-xs text-muted-foreground">{f.resumo}</p>}
                  <div className="mt-8 w-72 border-t pt-1 text-xs text-muted-foreground">Direção / Coordenação</div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAno(ano - 1)}>‹</Button>
            <span className="w-16 text-center font-semibold">{ano}</span>
            <Button size="sm" variant="outline" onClick={() => setAno(ano + 1)}>›</Button>
            {podeFeriado && <Button className="ml-auto" onClick={() => setEdit({ id: null, dados: novo() })}><Plus className="h-4 w-4" />Novo feriado / recesso</Button>}
          </div>

          <section>
            <h2 className="mb-1 font-semibold">Da escola ({doAno.length})</h2>
            <p className="mb-2 text-xs text-muted-foreground">Use um intervalo de datas (ex.: recesso de 20/12 a 05/01) ou um dia só. Estes cadastros têm prioridade sobre os feriados nacionais: por exemplo, um “Dia letivo extra” libera a assinatura num feriado ou sábado.</p>
            {doAno.length === 0 ? <Vazio texto="Nenhum feriado local cadastrado neste ano." /> : (
              <Tabela>
                <thead><tr><Th>Período</Th><Th>Nome</Th><Th>Tipo</Th><Th>Assinatura</Th><Th className="w-24" /></tr></thead>
                <tbody>
                  {doAno.map((f) => (
                    <tr key={f.id}>
                      <Td className="whitespace-nowrap">{f.data_ini === f.data_fim ? dataBr(f.data_ini) : `${dataBr(f.data_ini)} a ${dataBr(f.data_fim)}`}</Td>
                      <Td className="font-medium">{f.nome}</Td>
                      <Td><Badge>{TIPOS_FERIADO[f.tipo]?.rotulo ?? f.tipo}</Badge></Td>
                      <Td>{f.bloqueia_assinatura ? <span className="text-destructive">Bloqueada</span> : <span className="text-success">Liberada</span>}</Td>
                      <Td>
                        {podeFeriado && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: f.id, dados: { escola_id: f.escola_id, data_ini: f.data_ini, data_fim: f.data_fim, nome: f.nome, tipo: f.tipo, bloqueia_assinatura: f.bloqueia_assinatura } })}><Pencil className="h-4 w-4" /></Button>
                            {pode("horarios", "excluir") && <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(f)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </section>

          <section>
            <h2 className="mb-1 font-semibold">Nacionais (automáticos)</h2>
            <p className="mb-2 text-xs text-muted-foreground">Calculados pelo sistema, inclusive os que mudam de data (Carnaval, Sexta-feira Santa, Corpus Christi). Se algo for diferente na sua cidade, cadastre acima o ajuste.</p>
            <Tabela>
              <thead><tr><Th className="w-40">Data</Th><Th>Nome</Th><Th>Tipo</Th></tr></thead>
              <tbody>
                {nacionais.map(([d, s]) => (
                  <Fragment key={d}>
                    <tr><Td className="whitespace-nowrap">{dataBr(d)}</Td><Td>{s.nome}</Td><Td className="text-muted-foreground">{s.tipo === "nacional" ? "Feriado nacional" : "Ponto facultativo"}</Td></tr>
                  </Fragment>
                ))}
              </tbody>
            </Tabela>
          </section>
        </div>
      )}

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar feriado / recesso" : "Novo feriado / recesso"} largura="max-w-md">
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input value={edit.dados.nome} placeholder="Ex.: Dia do Professor" onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="De"><Input type="date" value={edit.dados.data_ini} onChange={(e) => e.target.value && setEdit({ ...edit, dados: { ...edit.dados, data_ini: e.target.value, data_fim: edit.dados.data_fim < e.target.value ? e.target.value : edit.dados.data_fim } })} /></Campo>
              <Campo label="Até"><Input type="date" value={edit.dados.data_fim} min={edit.dados.data_ini} onChange={(e) => e.target.value && setEdit({ ...edit, dados: { ...edit.dados, data_fim: e.target.value } })} /></Campo>
            </div>
            <Campo label="Tipo">
              <Select value={edit.dados.tipo} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, tipo: e.target.value, bloqueia_assinatura: TIPOS_FERIADO[e.target.value]?.bloqueia ?? true } })}>
                {Object.entries(TIPOS_FERIADO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
              </Select>
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.dados.bloqueia_assinatura} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, bloqueia_assinatura: e.target.checked } })} />
              Bloquear assinatura nesses dias (o professor não assina)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvarFeriado}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar
        aberto={!!excluir} titulo="Excluir feriado" mensagem={`Excluir “${excluir?.nome}”?`} onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirFeriado(excluir.id), "Excluído."))) { setExcluir(null); await carregarFeriados(); }
        }}
      />
    </>
  );
}
