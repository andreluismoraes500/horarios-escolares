// Monta as folhas da lista de presença (mensal e semanal; professores e coordenadores) como tabelas genéricas,
// usadas tanto na prévia/impressão (HTML) quanto no PDF, para saírem idênticas.
// A assinatura é POR PERÍODO (manhã/tarde/noite): quem vem de manhã e falta à noite deixa só a da noite em branco.

import { fmtMin } from "@/lib/tempo";
import { nomeTurmas } from "@/lib/turmas";
import { deIso, diasUteis, fimDoMes, somarDias, statusDoDia, TIPOS_FERIADO } from "@/lib/feriados";
import { lerExpediente, periodoTexto } from "@/lib/expediente";
import type { Aula, Coordenador, Feriado, Grupo, Horario, Materia, Professor, Turma } from "@/types";

export interface Cel {
  t: string;
  /** bloq = feriado/sem assinatura; vazio = sem aulas; ass = espaço para assinar; txt = texto comum */
  tipo: "bloq" | "vazio" | "ass" | "txt";
  span?: number;
}
export interface Folha {
  titulo: string;
  subtitulo: string;
  head: string[];
  linhas: Cel[][];
  /** larguras (mm) por coluna; null = automática */
  larg: (number | null)[];
  paisagem: boolean;
  /** altura mínima das linhas (mm) */
  altura: number;
  resumo?: string;
}
export interface Dados {
  aulas: Aula[]; horarios: Horario[]; turmas: Turma[]; grupos: Grupo[]; materias: Materia[]; feriados: Feriado[]; coordenadores: Coordenador[];
}

const SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const dataBr = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const curto = (s: string) => `${SEM[deIso(s).getDay()]} ${s.slice(8, 10)}/${s.slice(5, 7)}`;
const diaSem = (s: string) => deIso(s).getDay(); // 1..6

export type Per = "Manhã" | "Tarde" | "Noite";
export const periodoDe = (min: number): Per => (min < 720 ? "Manhã" : min < 1080 ? "Tarde" : "Noite");
const ORDEM: Per[] = ["Manhã", "Tarde", "Noite"];

interface Bloco { ini: number; fim: number; turma: string; turmaIds: number[]; materias: string[]; n: number }

/** Aulas do professor no dia da semana (1=seg…6=sáb), juntando as consecutivas da mesma turma. */
function blocosDoDia(p: Professor, diaSemana: number, d: Dados): Bloco[] {
  const lista = d.aulas
    .filter((a) => a.professor_id === p.id && a.dia_semana === diaSemana)
    .map((a) => ({ a, h: d.horarios.find((x) => x.id === a.horario_id)! }))
    .filter((x) => x.h && x.h.tipo === "aula")
    .sort((x, y) => x.h.inicio_min - y.h.inicio_min);
  const out: Bloco[] = [];
  for (const { a, h } of lista) {
    const turma = nomeTurmas(a.turmas, d.turmas, d.grupos);
    const mat = d.materias.find((m) => m.id === a.materia_id)?.nome ?? "Aula";
    const ult = out[out.length - 1];
    if (ult && ult.turma === turma && h.inicio_min - ult.fim <= 30) {
      ult.fim = h.fim_min; ult.n++;
      if (!ult.materias.includes(mat)) ult.materias.push(mat);
    } else out.push({ ini: h.inicio_min, fim: h.fim_min, turma, turmaIds: a.turmas.map((t) => t.turma_id), materias: [mat], n: 1 });
  }
  return out;
}
const textoBloco = (b: Bloco) => `${fmtMin(b.ini)}–${fmtMin(b.fim)} · ${b.turma} · ${b.materias.join("/")}`;
const nAulas = (bs: Bloco[]) => bs.reduce((s, b) => s + b.n, 0);
const porPeriodo = (bs: Bloco[]) => ORDEM.map((per) => ({ per, bs: bs.filter((b) => periodoDe(b.ini) === per) })).filter((x) => x.bs.length > 0);

/** Nomes dos coordenadores responsáveis pelas turmas informadas. */
function coordenadoresDe(turmaIds: number[], d: Dados): string {
  const nomes = d.coordenadores.filter((c) => c.turma_ids.some((t) => turmaIds.includes(t))).map((c) => c.nome);
  return [...new Set(nomes)].join(", ");
}

function rotuloBloqueio(st: { nome: string; tipo: string }): string {
  const rot = st.tipo === "nacional" ? "Feriado nacional" : st.tipo === "facultativo" ? "Ponto facultativo" : TIPOS_FERIADO[st.tipo]?.rotulo.split(" (")[0] ?? "Feriado";
  return st.nome.toLowerCase() === rot.toLowerCase() ? st.nome : `${st.nome} — ${rot}`;
}
const intervaloMes = (mes: string, sabado: boolean) => diasUteis(`${mes}-01`, fimDoMes(mes), sabado);
const tituloMes = (mes: string) => { const [a, m] = mes.split("-").map(Number); return `Lista de presença — ${MESES[m - 1]}/${a}`; };

/** Mensal de um professor: uma linha por período do dia, cada uma com a sua assinatura (+ visto do coordenador). */
export function folhaMensal(p: Professor, mes: string, sabado: boolean, d: Dados, visto: boolean): Folha {
  const dias = intervaloMes(mes, sabado);
  const ncol = visto ? 5 : 4;
  let diasAula = 0, aulas = 0, bloqueados = 0, assinaturas = 0;
  const linhas: Cel[][] = [];
  for (const dt of dias) {
    const st = statusDoDia(dt, d.feriados);
    const data: Cel = { t: curto(dt), tipo: "txt" };
    if (st?.bloqueia) { bloqueados++; linhas.push([data, { t: rotuloBloqueio(st), tipo: "bloq", span: ncol - 1 }]); continue; }
    const bs = blocosDoDia(p, diaSem(dt), d);
    if (bs.length === 0) { linhas.push([data, { t: st ? st.nome : "Sem aulas", tipo: "vazio", span: ncol - 1 }]); continue; }
    diasAula++; aulas += nAulas(bs);
    for (const g of porPeriodo(bs)) {
      assinaturas++;
      const linha: Cel[] = [data, { t: g.per, tipo: "txt" }, { t: g.bs.map(textoBloco).join("\n"), tipo: "txt" }, { t: "", tipo: "ass" }];
      if (visto) { const c = coordenadoresDe(g.bs.flatMap((b) => b.turmaIds), d); linhas.push([...linha, { t: c ? `Coord.: ${c}` : "", tipo: "ass" }]); } else linhas.push(linha);
    }
  }
  return {
    titulo: tituloMes(mes), subtitulo: `Professor(a): ${p.nome}`, paisagem: false, altura: 10,
    head: visto ? ["Data", "Período", "Horário · Turma · Matéria", "Assinatura do professor", "Visto do coordenador"] : ["Data", "Período", "Horário · Turma · Matéria", "Assinatura do professor"],
    larg: visto ? [22, 16, null, 36, 36] : [22, 16, null, 50],
    linhas,
    resumo: `Dias com aula: ${diasAula} · Aulas no mês: ${aulas} · Assinaturas (por período): ${assinaturas}${bloqueados ? ` · Dias sem assinatura (feriados/recessos): ${bloqueados}` : ""}`,
  };
}

/** Semanal: uma linha por professor e período, uma coluna por dia; cada célula é uma assinatura. */
export function folhaSemanal(profs: Professor[], segunda: string, sabado: boolean, d: Dados, visto: boolean): Folha {
  const dias = diasUteis(segunda, somarDias(segunda, 6), sabado);
  const st = dias.map((dt) => statusDoDia(dt, d.feriados));
  const linhas: Cel[][] = [];
  for (const p of profs) {
    const porDia = dias.map((dt, i) => (st[i]?.bloqueia ? [] : blocosDoDia(p, diaSem(dt), d)));
    for (const per of ORDEM) {
      const doPer = porDia.map((bs) => bs.filter((b) => periodoDe(b.ini) === per));
      if (doPer.every((x) => x.length === 0)) continue;
      const cels: Cel[] = [{ t: p.nome, tipo: "txt" }, { t: per, tipo: "txt" }];
      dias.forEach((_, i) => {
        if (st[i]?.bloqueia) cels.push({ t: st[i]!.nome, tipo: "bloq" });
        else if (doPer[i].length === 0) cels.push({ t: "—", tipo: "vazio" });
        else cels.push({ t: `${fmtMin(doPer[i][0].ini)}–${fmtMin(doPer[i][doPer[i].length - 1].fim)}\n${nAulas(doPer[i])} aula(s)`, tipo: "ass" });
      });
      if (visto) cels.push({ t: coordenadoresDe(doPer.flat().flatMap((b) => b.turmaIds), d), tipo: "txt" });
      linhas.push(cels);
    }
  }
  const fim = dias[dias.length - 1] ?? segunda;
  return {
    titulo: "Lista de presença semanal", subtitulo: `Semana de ${dataBr(dias[0] ?? segunda)} a ${dataBr(fim)}`, paisagem: true, altura: 15,
    head: ["Professor(a)", "Período", ...dias.map(curto), ...(visto ? ["Coordenação"] : [])],
    larg: [38, 16, ...dias.map(() => null), ...(visto ? [34] : [])],
    linhas,
  };
}

/** Mensal de um coordenador: períodos do expediente de cada dia, cada um com a sua assinatura. */
export function folhaMensalCoord(c: Coordenador, mes: string, sabado: boolean, d: Dados): Folha {
  const exp = lerExpediente(c.expediente);
  let diasTrab = 0, bloqueados = 0, assinaturas = 0;
  const linhas: Cel[][] = [];
  for (const dt of intervaloMes(mes, sabado)) {
    const stt = statusDoDia(dt, d.feriados);
    const data: Cel = { t: curto(dt), tipo: "txt" };
    if (stt?.bloqueia) { bloqueados++; linhas.push([data, { t: rotuloBloqueio(stt), tipo: "bloq", span: 3 }]); continue; }
    const ps = exp.filter((x) => x.dia === diaSem(dt)).sort((a, b) => a.ini - b.ini);
    if (ps.length === 0) { linhas.push([data, { t: stt ? stt.nome : "Sem expediente", tipo: "vazio", span: 3 }]); continue; }
    diasTrab++;
    for (const x of ps) { assinaturas++; linhas.push([data, { t: periodoDe(x.ini), tipo: "txt" }, { t: periodoTexto(x), tipo: "txt" }, { t: "", tipo: "ass" }]); }
  }
  const turmas = c.turma_ids.map((id) => d.turmas.find((t) => t.id === id)?.nome).filter(Boolean).join(", ");
  return {
    titulo: tituloMes(mes), subtitulo: `Coordenador(a): ${c.nome}${turmas ? ` · Turmas: ${turmas}` : ""}`, paisagem: false, altura: 10,
    head: ["Data", "Período", "Expediente", "Assinatura do coordenador"], larg: [22, 16, 40, null], linhas,
    resumo: `Dias de expediente: ${diasTrab} · Assinaturas (por período): ${assinaturas}${bloqueados ? ` · Dias sem assinatura (feriados/recessos): ${bloqueados}` : ""}`,
  };
}

/** Semanal dos coordenadores: uma linha por coordenador e período. */
export function folhaSemanalCoord(cs: Coordenador[], segunda: string, sabado: boolean, d: Dados): Folha {
  const dias = diasUteis(segunda, somarDias(segunda, 6), sabado);
  const st = dias.map((dt) => statusDoDia(dt, d.feriados));
  const linhas: Cel[][] = [];
  for (const c of cs) {
    const exp = lerExpediente(c.expediente);
    const porDia = dias.map((dt) => exp.filter((x) => x.dia === diaSem(dt)));
    for (const per of ORDEM) {
      const doPer = porDia.map((ps) => ps.filter((x) => periodoDe(x.ini) === per));
      if (doPer.every((x) => x.length === 0)) continue;
      const cels: Cel[] = [{ t: c.nome, tipo: "txt" }, { t: per, tipo: "txt" }];
      dias.forEach((_, i) => {
        if (st[i]?.bloqueia) cels.push({ t: st[i]!.nome, tipo: "bloq" });
        else if (doPer[i].length === 0) cels.push({ t: "—", tipo: "vazio" });
        else cels.push({ t: doPer[i].map(periodoTexto).join("\n"), tipo: "ass" });
      });
      linhas.push(cels);
    }
  }
  const fim = dias[dias.length - 1] ?? segunda;
  return {
    titulo: "Lista de presença semanal — coordenação", subtitulo: `Semana de ${dataBr(dias[0] ?? segunda)} a ${dataBr(fim)}`, paisagem: true, altura: 15,
    head: ["Coordenador(a)", "Período", ...dias.map(curto)], larg: [40, 16, ...dias.map(() => null)], linhas,
  };
}
