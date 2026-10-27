// Detecção de conflitos no cliente — feedback imediato ao arrastar aulas.
// O backend refaz a validação (fonte da verdade); aqui só antecipamos a resposta.

import type { Aula, Grupo, Horario, Materia, Professor, Sala, Turma, TurmaRef } from "@/types";
import { faixasSobrepoem, nomeTurmas, turmasColidem } from "@/lib/turmas";

export interface Lookups {
  professores: Professor[];
  salas: Sala[];
  turmas: Turma[];
  grupos?: Grupo[];
  materias: Materia[];
  horarios: Horario[];
}

export interface PosicaoAula {
  dia_semana: number;
  horario_id: number;
  sala_id: number | null;
  professor_id: number | null;
  turmas: TurmaRef[];
}

export interface ConflitoLocal {
  tipo: "sala" | "professor" | "turma";
  aulaId: number;
  mensagem: string;
}

/**
 * Compara a posição proposta com as aulas existentes no mesmo dia/horário.
 * `ignorar` lista aulas que serão movidas junto (a própria aula, ou o par de uma troca).
 */
export function conflitosLocais(
  aulas: Aula[],
  nova: PosicaoAula,
  ignorar: number[],
  lk: Lookups,
): ConflitoLocal[] {
  const out: ConflitoLocal[] = [];
  const nomeSala = (id: number | null) => lk.salas.find((s) => s.id === id)?.nome ?? "—";
  const nomeProf = (id: number | null) => lk.professores.find((p) => p.id === id)?.nome ?? "—";
  const nomeTurma = (refs: TurmaRef[]) => nomeTurmas(refs, lk.turmas, lk.grupos ?? []);
  const faixaNova = lk.horarios.find((h) => h.id === nova.horario_id);
  for (const e of aulas) {
    if (ignorar.includes(e.id) || e.dia_semana !== nova.dia_semana) continue;
    // Mesmo horário real: a mesma faixa ou faixas (de outra grade) que se sobrepõem no relógio.
    if (e.horario_id !== nova.horario_id) {
      const fe = lk.horarios.find((h) => h.id === e.horario_id);
      if (!faixaNova || !fe || !faixasSobrepoem(faixaNova, fe)) continue;
    }
    if (nova.sala_id != null && e.sala_id === nova.sala_id) {
      out.push({ tipo: "sala", aulaId: e.id, mensagem: `Sala ${nomeSala(e.sala_id)} já ocupada pela turma ${nomeTurma(e.turmas)}` });
    }
    if (nova.professor_id != null && e.professor_id === nova.professor_id) {
      out.push({ tipo: "professor", aulaId: e.id, mensagem: `${nomeProf(e.professor_id)} já está na turma ${nomeTurma(e.turmas)} (${nomeSala(e.sala_id)})` });
    }
    if (turmasColidem(e.turmas, nova.turmas)) {
      out.push({ tipo: "turma", aulaId: e.id, mensagem: `Turma ${nomeTurma(e.turmas)} já tem aula neste horário` });
    }
  }
  return out;
}

/** Aviso (não bloqueia): professor marcado como indisponível. */
export function avisoIndisponivel(p: Professor | undefined, dia: number, horarioId: number, _horarios: Horario[] = []): string | null {
  if (!p) return null;
  try {
    const lista = JSON.parse(p.disponibilidade) as { dia: number; horario_id: number }[];
    const marcado = (x: { dia: number; horario_id: number }) => x.dia === dia && x.horario_id === horarioId;
    if (lista.some(marcado)) {
      return `${p.nome} está marcado(a) como indisponível neste horário`;
    }
  } catch {
    /* disponibilidade malformada: ignora */
  }
  return null;
}
