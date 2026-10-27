// Relatórios: visualização da grade, exportação para PDF/CSV e impressão direta.

import { Fragment, useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Button, Card, Select, Titulo, Vazio } from "@/components/ui";
import { DIAS, faixaTexto, TURNOS } from "@/lib/tempo";
import { cabecalho, gradeParaCsv, montarGrade, nomeEntidade, type Visao } from "@/lib/grade";
import { corTexto } from "@/lib/utils";
import SelectBusca from "@/components/SelectBusca";

/** Bytes → base64 (em blocos, para não estourar a pilha). */
function paraBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function textoBase64(t: string): string {
  return paraBase64(new TextEncoder().encode(t));
}
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export default function Relatorios() {
  const usuario = useAuth((s) => s.usuario);
  const dados = useDados();
  const { escolas, escolaId, turmas, professores, salas } = dados;
  const soProfessor = usuario?.papel === "professor";
  const [visao, setVisao] = useState<Visao>(soProfessor ? "professor" : "turma");
  const [entId, setEntId] = useState<number | null>(null);
  const [sabado, setSabado] = useState(false);

  const opcoes = visao === "turma" ? turmas : visao === "professor" ? professores : salas;
  useEffect(() => {
    if (soProfessor && usuario?.professor_id) return setEntId(usuario.professor_id);
    if (!opcoes.some((o) => o.id === entId)) setEntId(opcoes[0]?.id ?? null);
  }, [opcoes, entId, soProfessor, usuario?.professor_id]);

  const dias = DIAS.filter((d) => sabado || d.n <= 5).map((d) => d.n);
  const linhas = useMemo(() => (entId == null ? [] : montarGrade(dados, visao, entId, dias)), [dados, visao, entId, sabado]); // eslint-disable-line react-hooks/exhaustive-deps
  const escola = escolas.find((e) => e.id === escolaId);
  const variosTurnos = new Set(linhas.map((l) => l.horario.turno)).size > 1;
  const titulo = entId == null ? "" : `Grade — ${visao === "turma" ? "Turma" : visao === "professor" ? "Professor(a)" : "Sala"} ${nomeEntidade(dados, visao, entId)}`;
  const nomeArq = `grade-${visao}-${entId == null ? "" : nomeEntidade(dados, visao, entId)}`.replace(/[^\w-]+/g, "_");

  async function exportarCsv() {
    const caminho = await save({ defaultPath: `${nomeArq}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!caminho) return;
    await executar(() => api.salvarArquivo(caminho, textoBase64(gradeParaCsv(linhas, dias))), "CSV exportado.");
  }

  async function exportarPdf() {
    const caminho = await save({ defaultPath: `${nomeArq}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!caminho) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let xTexto = 14;
    if (escola?.logo) {
      try {
        doc.addImage(escola.logo, "PNG", 14, 6, 14, 14);
        xTexto = 32;
      } catch {
        /* logo inválida: segue sem ela */
      }
    }
    doc.setFontSize(14);
    doc.text(escola?.nome ?? "Escola", xTexto, 12);
    doc.setFontSize(11);
    doc.text(titulo, xTexto, 19);
    const corpo: unknown[] = [];
    linhas.forEach((l, i) => {
      if (variosTurnos && (i === 0 || linhas[i - 1].horario.turno !== l.horario.turno)) {
        corpo.push([{ content: TURNOS[l.horario.turno].toUpperCase(), colSpan: dias.length + 1, styles: { fillColor: [226, 232, 240] as [number, number, number], fontStyle: "bold" as const } }]);
      }
      corpo.push(((): unknown => {
      if (l.horario.tipo === "intervalo") {
        return [
          { content: faixaTexto(l.horario), styles: { fillColor: [241, 245, 249] as [number, number, number] } },
          { content: l.horario.rotulo.toUpperCase(), colSpan: dias.length, styles: { halign: "center" as const, fillColor: [241, 245, 249] as [number, number, number], textColor: [100, 116, 139] as [number, number, number] } },
        ];
      }
      return [
        `${l.horario.rotulo}\n${faixaTexto(l.horario)}`,
        ...l.celulas.map((c) =>
          c ? { content: c.linhas.filter(Boolean).join("\n"), blocos: c.blocos, styles: c.blocos.length > 1 ? { fillColor: [241, 245, 249] as [number, number, number], textColor: [15, 23, 42] as [number, number, number] } : c.cor ? { fillColor: hexRgb(c.cor), textColor: hexRgb(corTexto(c.cor)) } : {} } : "",
        ),
      ];
      })());
    });
    autoTable(doc, {
      startY: 25,
      head: [cabecalho(dias)],
      body: corpo as never,
      styles: { fontSize: 8, cellPadding: 1.5, valign: "middle" },
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: { 0: { cellWidth: 32 } },
      // O texto padrão é apagado antes de desenhar: os blocos coloridos (abaixo) mostram o conteúdo.
      willDrawCell: (d) => {
        const blocos = (d.cell.raw as { blocos?: unknown[] } | null)?.blocos;
        if (d.section === "body" && blocos && blocos.length > 1) d.cell.text = [];
      },
      // Turma dividida em grupos: cada grupo vira um bloco colorido (cor da matéria) dentro da célula.
      didDrawCell: (d) => {
        const blocos = (d.cell.raw as { blocos?: { linhas: string[]; cor: string | null }[] } | null)?.blocos;
        if (d.section !== "body" || !blocos || blocos.length < 2) return;
        const { x, y, width, height } = d.cell;
        const h = height / blocos.length;
        blocos.forEach((b, k) => {
          const by = y + k * h;
          if (b.cor) {
            doc.setFillColor(...hexRgb(b.cor));
          } else {
            doc.setFillColor(241, 245, 249);
          }
          doc.rect(x + 0.3, by + 0.3, width - 0.6, h - 0.6, "F");
          const [r, g, bl] = b.cor ? hexRgb(corTexto(b.cor)) : ([15, 23, 42] as [number, number, number]);
          doc.setTextColor(r, g, bl);
          doc.setFontSize(8);
          const texto = doc.splitTextToSize(b.linhas.filter(Boolean).join("\n"), width - 3) as string[];
          const alturaLinha = 3.3;
          const topo = by + h / 2 - (texto.length * alturaLinha) / 2 + 2.3;
          doc.text(texto, x + 1.5, topo);
        });
        doc.setTextColor(0, 0, 0);
      },
    });
    doc.setFontSize(8);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, doc.internal.pageSize.getHeight() - 8);
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    await executar(() => api.salvarArquivo(caminho, paraBase64(bytes)), "PDF exportado.");
  }

  if (!escolaId) return <Vazio texto="Selecione uma escola." />;

  return (
    <>
      <div className="no-print">
        <Titulo
          titulo="Relatórios"
          subtitulo="Exporte ou imprima a grade de uma turma, professor ou sala"
          acoes={
            <>
              <Button variant="outline" onClick={exportarCsv} disabled={entId == null}><FileSpreadsheet className="h-4 w-4" />CSV</Button>
              <Button variant="outline" onClick={() => void exportarPdf().catch((e: Error) => toast.error(e.message))} disabled={entId == null}><FileDown className="h-4 w-4" />PDF</Button>
              <Button onClick={() => window.print()} disabled={entId == null}><Printer className="h-4 w-4" />Imprimir</Button>
            </>
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!soProfessor && (
            <>
              <Select className="w-40" value={visao} onChange={(e) => setVisao(e.target.value as Visao)}>
                <option value="turma">Por turma</option>
                <option value="professor">Por professor</option>
                <option value="sala">Por sala</option>
              </Select>
              <SelectBusca className="w-72" ariaLabel="Selecionar" value={entId} onChange={(v) => setEntId(Number(v))}
                opcoes={opcoes.map((o) => ({ value: String(o.id), label: o.nome, cor: visao === "professor" ? (o as { cor?: string }).cor : undefined }))} />
            </>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sabado} onChange={(e) => setSabado(e.target.checked)} /> Incluir sábado</label>
        </div>
      </div>

      {entId == null || linhas.length === 0 ? (
        <Vazio texto="Nada para exibir. Cadastre horários e selecione uma turma, professor ou sala." />
      ) : (
        <Card className="area-impressao overflow-x-auto p-4">
          <div className="mb-3 flex items-center gap-3">
            {escola?.logo && <img src={escola.logo} alt="" className="h-10 w-10 object-contain" />}
            <div>
              <div className="font-semibold">{escola?.nome}</div>
              <div className="text-sm text-muted-foreground">{titulo}</div>
            </div>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>{cabecalho(dias).map((c) => <th key={c} className="border bg-muted p-1.5 text-left">{c}</th>)}</tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <Fragment key={l.horario.id}>
                  {variosTurnos && (i === 0 || linhas[i - 1].horario.turno !== l.horario.turno) && (
                    <tr><td colSpan={dias.length + 1} className="border bg-secondary p-1.5 font-semibold uppercase">{TURNOS[l.horario.turno]}</td></tr>
                  )}
                  {l.horario.tipo === "intervalo" ? (
                  <tr>
                    <td className="border bg-muted/60 p-1.5 tabular-nums">{faixaTexto(l.horario)}</td>
                    <td colSpan={dias.length} className="border bg-muted/60 p-1.5 text-center uppercase text-muted-foreground">{l.horario.rotulo}</td>
                  </tr>
                ) : (
                  <tr>
                    <td className="border p-1.5"><div className="font-medium">{l.horario.rotulo}</div><div className="tabular-nums text-muted-foreground">{faixaTexto(l.horario)}</div></td>
                    {l.celulas.map((c, i) => (
                      <td key={i} className={c && c.blocos.length > 1 ? "border p-0.5" : "border p-1.5"} style={c?.cor ? { background: c.cor, color: corTexto(c.cor), printColorAdjust: "exact" } : undefined}>
                        {c && c.blocos.length === 1 && (<><div className="font-semibold">{c.linhas[0]}</div><div className="opacity-90">{c.linhas[1]}</div></>)}
                        {c && c.blocos.length > 1 && (
                          <div className="flex flex-col gap-0.5">
                            {c.blocos.map((b, k) => (
                              <div key={k} className="rounded-sm p-1" style={b.cor ? { background: b.cor, color: corTexto(b.cor), printColorAdjust: "exact" } : { border: "1px dashed currentColor" }}>
                                <div className="font-semibold">{b.linhas[0]}</div>
                                <div className="opacity-90">{b.linhas.slice(1).join(" ")}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
