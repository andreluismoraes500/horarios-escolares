// Monta as folhas da lista de presença (mensal por professor, semanal com todos) como tabelas genéricas,
// usadas tanto na prévia/impressão (HTML) quanto no PDF.

import { fmtMin } from "@/lib/tempo";
import { nomeTurmas } from "@/lib/turmas";
import { deIso, diasUteis, fimDoMes, somarDias, statusDoDia, TIPOS_FERIADO } from "@/lib/feriados";
import type { Aula, Feriado, Grupo, Horario, Materia, Professor, Turma } from "@/types";

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
  resumo?: string;
}
export interface Dados {
  aulas: Aula[]; horarios: Horario[]; turmas: Turma[]; grupos: Grupo[]; materias: Materia[]; feriados: Feriado[];
}

const SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const dataBr = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const curto = (s: string) => `${SEM[deIso(s).getDay()]} ${s.slice(8, 10)}/${s.slice(5, 7)}`;

interface Bloco { ini: number; fim: number; turma: string; materias: string[]; n: number }

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
    } else out.push({ ini: h.inicio_min, fim: h.fim_min, turma, materias: [mat], n: 1 });
  }
  return out;
}
const textoBloco = (b: Bloco) => `${fmtMin(b.ini)}–${fmtMin(b.fim)} · ${b.turma} · ${b.materias.join("/")}`;
const nAulas = (bs: Bloco[]) => bs.reduce((s, b) => s + b.n, 0);
const diaSem = (s: string) => deIso(s).getDay(); // 1..6

/** Folha mensal de um professor: uma linha por dia útil, com horários/turmas e espaço para assinar. */
export function folhaMensal(p: Professor, mes: string, sabado: boolean, d: Dados): Folha {
  const [a, m] = mes.split("-").map(Number);
  const dias = diasUteis(`${mes}-01`, fimDoMes(mes), sabado);
  let diasAula = 0, aulas = 0, feriados = 0;
  const linhas: Cel[][] = dias.map((dt) => {
    const st = statusDoDia(dt, d.feriados);
    const bs = blocosDoDia(p, diaSem(dt), d);
    if (st?.bloqueia) {
      feriados++;
      const rot = st.tipo === "nacional" ? "Feriado nacional" : st.tipo === "facultativo" ? "Ponto facultativo" : TIPOS_FERIADO[st.tipo]?.rotulo.split(" (")[0] ?? "Feriado";
      return [{ t: curto(dt), tipo: "txt" }, { t: st.nome.toLowerCase() === rot.toLowerCase() ? st.nome : `${st.nome} — ${rot}`, tipo: "bloq", span: 2 }];
    }
    if (bs.length === 0) return [{ t: curto(dt), tipo: "txt" }, { t: st ? st.nome : "Sem aulas", tipo: "vazio", span: 2 }];
    diasAula++; aulas += nAulas(bs);
    return [{ t: curto(dt), tipo: "txt" }, { t: (st ? `${st.nome}\n` : "") + bs.map(textoBloco).join("\n"), tipo: "txt" }, { t: "", tipo: "ass" }];
  });
  return {
    titulo: `Lista de presença — ${MESES[m - 1]}/${a}`,
    subtitulo: `Professor(a): ${p.nome}`,
    head: ["Data", "Horário · Turma · Matéria", "Assinatura"],
    linhas,
    resumo: `Dias com aula: ${diasAula} · Aulas no mês: ${aulas}${feriados ? ` · Dias sem assinatura (feriados/recessos): ${feriados}` : ""}`,
  };
}

/** Folha semanal com todos os professores que têm aula na semana (segunda = `segunda`). */
export function folhaSemanal(profs: Professor[], segunda: string, sabado: boolean, d: Dados): Folha {
  const dias = diasUteis(segunda, somarDias(segunda, 6), sabado);
  const stDias = dias.map((dt) => statusDoDia(dt, d.feriados));
  const linhas: Cel[][] = [];
  for (const p of profs) {
    const cels: Cel[] = [{ t: p.nome, tipo: "txt" }];
    let total = 0;
    dias.forEach((dt, i) => {
      const st = stDias[i];
      const bs = blocosDoDia(p, diaSem(dt), d);
      if (st?.bloqueia) cels.push({ t: st.nome, tipo: "bloq" });
      else if (bs.length === 0) cels.push({ t: "—", tipo: "vazio" });
      else {
        total += nAulas(bs);
        cels.push({ t: `${fmtMin(bs[0].ini)}–${fmtMin(bs[bs.length - 1].fim)}\n${nAulas(bs)} aula(s)`, tipo: "ass" });
      }
    });
    if (total > 0) linhas.push(cels);
  }
  const fim = dias[dias.length - 1] ?? segunda;
  return {
    titulo: "Lista de presença semanal",
    subtitulo: `Semana de ${dataBr(dias[0] ?? segunda)} a ${dataBr(fim)}`,
    head: ["Professor(a)", ...dias.map(curto)],
    linhas,
  };
}
