import type { Aula, Grupo, Horario, Turma, TurmaRef } from "@/types";

/** Duas listas colidem se há a mesma turma e (uma é a turma inteira ou o grupo é o mesmo). */
export function turmasColidem(a: TurmaRef[], b: TurmaRef[]): boolean {
  return a.some((x) =>
    b.some((y) => x.turma_id === y.turma_id && (x.grupo_id == null || y.grupo_id == null || x.grupo_id === y.grupo_id)),
  );
}

export function nomeRef(r: TurmaRef, turmas: Turma[], grupos: Grupo[]): string {
  const t = turmas.find((x) => x.id === r.turma_id)?.nome ?? "—";
  if (r.grupo_id == null) return t;
  return `${t} · ${grupos.find((g) => g.id === r.grupo_id)?.nome ?? "grupo"}`;
}

/** Ex.: "6º A · Grupo 1 + 7º A". */
export function nomeTurmas(refs: TurmaRef[], turmas: Turma[], grupos: Grupo[]): string {
  return refs.map((r) => nomeRef(r, turmas, grupos)).join(" + ");
}

export function aulaTemTurma(a: Aula, turmaId: number): boolean {
  return a.turmas.some((t) => t.turma_id === turmaId);
}

/**
 * A turma tem aula nesta faixa? A faixa precisa começar depois do início do turno da turma e terminar
 * até o horário de término da turma (padrão: fim do turno). Faixas de outro turno só valem depois do fim
 * do turno da turma (jornada estendida, ex.: Integrado das 07:00 às 14:30).
 */
export function podeNaFaixa(
  t: Turma,
  h: Pick<Horario, "turno" | "inicio_min" | "fim_min" | "grade_id">,
  horarios: Horario[],
): boolean {
  // Só as faixas da grade da turma (grades diferentes podem se sobrepor no relógio).
  if (h.grade_id !== t.grade_id) return false;
  const proprias = horarios.filter((x) => x.grade_id === t.grade_id && x.turno === t.turno && x.tipo === "aula");
  if (proprias.length === 0) return false;
  const ini = Math.min(...proprias.map((x) => x.inicio_min));
  const fim = Math.max(...proprias.map((x) => x.fim_min));
  const limite = t.fim_max_min ?? fim;
  return h.inicio_min >= ini && h.fim_min <= limite && (h.turno === t.turno || h.inicio_min >= fim);
}

/** Duas faixas (de qualquer grade) se sobrepõem no relógio? Encostar não conta. */
export function faixasSobrepoem(a: Pick<Horario, "inicio_min" | "fim_min">, b: Pick<Horario, "inicio_min" | "fim_min">): boolean {
  return a.inicio_min < b.fim_min && a.fim_min > b.inicio_min;
}

/** Faixas (aulas e intervalos) da jornada da turma, em ordem de horário. */
export function horariosDaTurma(t: Turma, horarios: Horario[]): Horario[] {
  return horarios.filter((h) => podeNaFaixa(t, h, horarios)).sort((a, b) => a.inicio_min - b.inicio_min);
}
