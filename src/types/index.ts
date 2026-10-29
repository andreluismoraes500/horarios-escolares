// Tipos espelhando os modelos do backend (Rust).

export type Papel = "super_admin" | "admin_escola" | "coordenador" | "professor" | "visualizador";

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  escola_id: number | null;
  professor_id: number | null;
  ativo: boolean;
}

export interface Escola {
  id: number;
  nome: string;
  endereco: string | null;
  cnpj: string | null;
  logo: string | null;
}

export interface Professor {
  id: number;
  escola_id: number;
  nome: string;
  email: string | null;
  telefone: string | null;
  /** JSON: períodos indisponíveis [{dia, horario_id}] */
  disponibilidade: string;
  /** #RRGGBB */
  cor: string;
  /** null = sem limite */
  max_aulas_semana: number | null;
  max_aulas_dia: number | null;
  /** minutos de deslocamento até/de outro local de trabalho */
  deslocamento_min: number;
  /** descanso mínimo (horas) entre o fim de um dia e o início do seguinte */
  intersticio_horas: number;
  da_aula_sabado: boolean;
  materia_ids: number[];
}

export interface Materia {
  id: number;
  escola_id: number;
  nome: string;
  cor: string;
}

export type TipoSala = "sala_aula" | "laboratorio" | "quadra" | "biblioteca" | "auditorio" | "outro";

export interface Sala {
  id: number;
  escola_id: number;
  nome: string;
  tipo: TipoSala;
  capacidade: number;
  observacoes: string | null;
}

export type Turno = "manha" | "tarde" | "noite";

export interface Turma {
  id: number;
  escola_id: number;
  nome: string;
  serie: string | null;
  turno: Turno;
  num_alunos: number;
  /** Horário de término da turma em minutos (null = termina com o turno). */
  fim_max_min: number | null;
  /** Grade de horários usada pela turma. */
  grade_id: number;
}

/** Conjunto de faixas de horário (ex.: "Integrado", "Enfermagem"). */
export interface Grade {
  id: number;
  escola_id: number;
  nome: string;
}

/** Faixa de horário; tempos em minutos desde 00:00. */
export interface Horario {
  id: number;
  escola_id: number;
  grade_id: number;
  ordem: number;
  rotulo: string;
  inicio_min: number;
  fim_min: number;
  tipo: "aula" | "intervalo";
  turno: Turno;
}

export interface Aula {
  id: number;
  escola_id: number;
  dia_semana: number;
  horario_id: number;
  sala_id: number | null;
  professor_id: number | null;
  materia_id: number | null;
  turmas: TurmaRef[];
  observacao: string | null;
}

/** Turma participante de uma aula; grupo_id null = turma inteira. */
export interface TurmaRef {
  turma_id: number;
  grupo_id: number | null;
}

export interface Grupo {
  id: number;
  escola_id: number;
  turma_id: number;
  nome: string;
}

export type AulaInput = Omit<Aula, "id">;

export interface Conflito {
  tipo: "sala" | "professor" | "turma";
  aula_id: number;
  mensagem: string;
}

export interface Verificacao {
  conflitos: Conflito[];
  avisos: string[];
}

export interface Resumo {
  professores: number;
  materias: number;
  salas: number;
  turmas: number;
  faixas_aula: number;
  aulas: number;
  aulas_livres: number;
  capacidade_grade: number;
}

export interface EntradaBackup {
  id: number;
  data: string;
  tipo: string;
  arquivo: string;
  tamanho: number;
  usuario: string;
  sucesso: boolean;
  detalhe: string | null;
}

export interface ConfigBackup {
  auto: "off" | "diario" | "semanal";
  pasta: string;
  senha: string | null;
  tem_senha: boolean;
  pasta_padrao: string;
  ultimo: string | null;
}

export interface EntradaAuditoria {
  id: number;
  data: string;
  usuario: string;
  acao: string;
  entidade: string;
  entidade_id: number | null;
  detalhe: string | null;
}

export interface IntervaloCfg {
  apos_aula: number;
  duracao_min: number;
  rotulo: string | null;
}

export interface Demanda {
  id: number;
  escola_id: number;
  turma_id: number;
  materia_id: number;
  aulas_semana: number;
  professor_id: number | null;
  sala_id: number | null;
  max_por_dia: number;
}
export type DemandaInput = Omit<Demanda, "id">;

export interface Alocacao {
  turma_id: number;
  materia_id: number;
  professor_id: number | null;
  sala_id: number | null;
  dia: number;
  horario_id: number;
}
export interface Pendencia {
  turma_id: number;
  materia_id: number;
  faltam: number;
  motivo: string;
}
export interface ResultadoGeracao {
  alocacoes: Alocacao[];
  pendencias: Pendencia[];
  total_demandado: number;
  total_alocado: number;
  sem_sala: number;
  removidas: number;
  gravadas: number;
  aplicado: boolean;
}

export interface Feriado {
  id: number;
  escola_id: number;
  /** AAAA-MM-DD */
  data_ini: string;
  data_fim: string;
  nome: string;
  tipo: string;
  bloqueia_assinatura: boolean;
}
export type FeriadoInput = Omit<Feriado, "id">;
