// Monta a matriz da grade (faixas × dias) para uma turma, professor ou sala.
// Usada pela tela de relatórios (PDF, CSV e impressão).

import type { Aula, Grupo, Horario, Materia, Professor, Sala, Turma } from "@/types";
import { aulaTemTurma, horariosDaTurma, nomeRef, nomeTurmas } from "@/lib/turmas";
import { DIAS, fmtMin, TURNOS } from "@/lib/tempo";

export type Visao = "turma" | "professor" | "sala";

export interface DadosGrade {
  aulas: Aula[];
  horarios: Horario[];
  materias: Materia[];
  professores: Professor[];
  salas: Sala[];
  turmas: Turma[];
  grupos: Grupo[];
}

export interface Celula {
  linhas: string[]; // textos, ex.: ["Matemática", "6º A · Sala 101"]
  cor: string | null;
  /** Uma entrada por aula na célula (turma dividida em grupos tem mais de uma). */
  blocos: { linhas: string[]; cor: string | null }[];
}

export interface LinhaGrade {
  horario: Horario;
  celulas: (Celula | null)[]; // uma por dia
}

/** A aula pertence à entidade da visão? (turma: inclusive em grupos e aulas conjuntas) */
export function aulaDaEntidade(a: Aula, v: Visao, id: number): boolean {
  return v === "turma" ? aulaTemTurma(a, id) : v === "professor" ? a.professor_id === id : a.sala_id === id;
}

export function nomeEntidade(d: DadosGrade, v: Visao, id: number): string {
  const lista = v === "turma" ? d.turmas : v === "professor" ? d.professores : d.salas;
  return lista.find((x) => x.id === id)?.nome ?? "—";
}

/** Horários que fazem sentido para a entidade: turma = seu turno; professor/sala = turnos com aulas. */
export function horariosDaEntidade(d: DadosGrade, v: Visao, id: number): Horario[] {
  if (v === "turma") {
    const t = d.turmas.find((x) => x.id === id);
    return t ? horariosDaTurma(t, d.horarios) : [];
  }
  // Professor/sala: faixas das grades (e turnos) em que a entidade tem aulas, em ordem de horário.
  const usados = new Set(
    d.aulas
      .filter((a) => aulaDaEntidade(a, v, id))
      .map((a) => {
        const h = d.horarios.find((x) => x.id === a.horario_id);
        return h ? `${h.grade_id}:${h.turno}` : "";
      }),
  );
  return d.horarios
    .filter((h) => usados.has(`${h.grade_id}:${h.turno}`))
    .sort((a, b) => a.inicio_min - b.inicio_min || a.grade_id - b.grade_id);
}

export function montarGrade(d: DadosGrade, v: Visao, id: number, dias: number[]): LinhaGrade[] {
  return horariosDaEntidade(d, v, id).map((h) => ({
    horario: h,
    celulas: dias.map((dia) => {
      if (h.tipo === "intervalo") return null;
      // Na visão de turma pode haver várias aulas no mesmo horário (grupos).
      const aulas = d.aulas.filter((x) => x.dia_semana === dia && x.horario_id === h.id && aulaDaEntidade(x, v, id));
      if (aulas.length === 0) return null;
      const linhas: string[] = [];
      const blocos: { linhas: string[]; cor: string | null }[] = [];
      aulas.forEach((a, i) => {
        if (i > 0) linhas.push("—");
        const ini = linhas.length;
        const mat = d.materias.find((m) => m.id === a.materia_id);
        const prof = d.professores.find((p) => p.id === a.professor_id);
        const sala = d.salas.find((s) => s.id === a.sala_id);
        linhas.push(mat?.nome ?? "Aula livre");
        const extra: string[] = [];
        if (v === "turma") {
          const meu = a.turmas.find((t) => t.turma_id === id)!;
          if (meu.grupo_id != null) extra.push(nomeRef(meu, [], d.grupos).replace(/^— · /, ""));
          const outras = a.turmas.filter((t) => t.turma_id !== id);
          if (outras.length) extra.push("com " + nomeTurmas(outras, d.turmas, d.grupos));
        } else {
          extra.push(nomeTurmas(a.turmas, d.turmas, d.grupos));
        }
        if (v !== "professor") extra.push(prof?.nome ?? "sem professor");
        if (v !== "sala") extra.push(sala?.nome ?? "sem sala");
        linhas.push(extra.join(" · "));
        blocos.push({ linhas: linhas.slice(ini), cor: mat?.cor ?? null });
      });
      // Com mais de uma aula na célula, o fundo da célula fica neutro e cada bloco usa a sua cor.
      return { linhas, cor: blocos.length === 1 ? blocos[0].cor : null, blocos };
    }),
  }));
}

export function cabecalho(dias: number[]): string[] {
  return ["Horário", ...dias.map((n) => DIAS.find((d) => d.n === n)?.longo ?? String(n))];
}

/** Gera o CSV (separador ";" e BOM UTF-8 para abrir corretamente no Excel pt-BR). */
export function gradeParaCsv(linhas: LinhaGrade[], dias: number[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const out = [cabecalho(dias).map(esc).join(";")];
  for (const l of linhas) {
    const hora = `${TURNOS[l.horario.turno]} ${fmtMin(l.horario.inicio_min)} - ${fmtMin(l.horario.fim_min)} (${l.horario.rotulo})`;
    const cols = l.celulas.map((c) =>
      c ? c.linhas.filter(Boolean).join(" | ") : l.horario.tipo === "intervalo" ? l.horario.rotulo : "",
    );
    out.push([hora, ...cols].map(esc).join(";"));
  }
  return "﻿" + out.join("\r\n");
}
