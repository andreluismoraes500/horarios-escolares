// Wrappers tipados para `invoke` do Tauri. O token da sessão é injetado automaticamente.
// Atenção: parâmetros de nível superior vão em camelCase (regra do Tauri v2);
// os campos dentro de `dados` seguem o snake_case do Rust.

import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/stores/auth";
import type {
  Aula, AulaInput, Feriado, FeriadoInput, ConfigBackup, Demanda, DemandaInput, ResultadoGeracao, EntradaAuditoria, EntradaBackup, Escola, Grade, Grupo, Horario,
  IntervaloCfg, Materia, Professor, Resumo, Sala, Turma, Turno, Usuario, Verificacao,
} from "@/types";

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = useAuth.getState().token ?? "";
  try {
    return await invoke<T>(cmd, { token, ...args });
  } catch (e) {
    const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
    // Sessão expirada/invalidada no backend → volta para o login
    if (msg.startsWith("Sessão inválida")) void useAuth.getState().sair();
    throw new Error(msg);
  }
}

export type EscolaInput = Omit<Escola, "id">;
export type ProfessorInput = Omit<Professor, "id">;
export type MateriaInput = Omit<Materia, "id">;
export type SalaInput = Omit<Sala, "id">;
export type TurmaInput = Omit<Turma, "id">;
export type HorarioInput = Omit<Horario, "id" | "ordem">;
export interface UsuarioInput {
  nome: string;
  email: string;
  senha?: string | null;
  papel: Usuario["papel"];
  escola_id: number | null;
  professor_id: number | null;
  ativo: boolean;
}
export interface GerarParams {
  escola_id: number;
  inicio_min: number;
  duracao_min: number;
  qtd_aulas: number;
  intervalos: IntervaloCfg[];
  grade_id: number | null;
  turno: Turno;
  modo: "substituir" | "adicionar";
  prefixo: string | null;
  confirmar_exclusao: boolean;
}

export const api = {
  // Escolas
  listarEscolas: () => call<Escola[]>("listar_escolas"),
  criarEscola: (dados: EscolaInput) => call<Escola>("criar_escola", { dados }),
  atualizarEscola: (id: number, dados: EscolaInput) => call<Escola>("atualizar_escola", { id, dados }),
  excluirEscola: (id: number) => call<void>("excluir_escola", { id }),

  // Usuários e auditoria
  listarUsuarios: () => call<Usuario[]>("listar_usuarios"),
  criarUsuario: (dados: UsuarioInput) => call<Usuario>("criar_usuario", { dados }),
  atualizarUsuario: (id: number, dados: UsuarioInput) => call<Usuario>("atualizar_usuario", { id, dados }),
  excluirUsuario: (id: number) => call<void>("excluir_usuario", { id }),
  listarAuditoria: (limite = 200, de?: string, ate?: string) => call<EntradaAuditoria[]>("listar_auditoria", { limite, de: de || null, ate: ate || null }),
  alterarMinhaSenha: (senhaAtual: string, senhaNova: string) =>
    call<void>("alterar_minha_senha", { senhaAtual, senhaNova }),

  // Cadastros
  listarProfessores: (escolaId: number) => call<Professor[]>("listar_professores", { escolaId }),
  criarProfessor: (dados: ProfessorInput) => call<Professor>("criar_professor", { dados }),
  atualizarProfessor: (id: number, dados: ProfessorInput) => call<Professor>("atualizar_professor", { id, dados }),
  excluirProfessor: (id: number) => call<void>("excluir_professor", { id }),

  listarMaterias: (escolaId: number) => call<Materia[]>("listar_materias", { escolaId }),
  criarMateria: (dados: MateriaInput) => call<Materia>("criar_materia", { dados }),
  atualizarMateria: (id: number, dados: MateriaInput) => call<Materia>("atualizar_materia", { id, dados }),
  excluirMateria: (id: number) => call<void>("excluir_materia", { id }),

  listarSalas: (escolaId: number) => call<Sala[]>("listar_salas", { escolaId }),
  criarSala: (dados: SalaInput) => call<Sala>("criar_sala", { dados }),
  atualizarSala: (id: number, dados: SalaInput) => call<Sala>("atualizar_sala", { id, dados }),
  excluirSala: (id: number) => call<void>("excluir_sala", { id }),

  listarTurmas: (escolaId: number) => call<Turma[]>("listar_turmas", { escolaId }),
  criarTurma: (dados: TurmaInput) => call<Turma>("criar_turma", { dados }),
  atualizarTurma: (id: number, dados: TurmaInput) => call<Turma>("atualizar_turma", { id, dados }),
  excluirTurma: (id: number) => call<void>("excluir_turma", { id }),

  listarGrupos: (escolaId: number) => call<Grupo[]>("listar_grupos", { escolaId }),
  criarGrupo: (dados: { escola_id: number; turma_id: number; nome: string }) => call<Grupo>("criar_grupo", { dados }),
  atualizarGrupo: (id: number, nome: string) => call<Grupo>("atualizar_grupo", { id, nome }),
  excluirGrupo: (id: number) => call<void>("excluir_grupo", { id }),

  // Demandas e geração automática
  listarDemandas: (escolaId: number) => call<Demanda[]>("listar_demandas", { escolaId }),
  salvarDemanda: (dados: DemandaInput) => call<Demanda>("salvar_demanda", { dados }),
  excluirDemanda: (id: number) => call<void>("excluir_demanda", { id }),
  copiarDemandas: (turmaOrigem: number, turmasDestino: number[]) =>
    call<number>("copiar_demandas", { turmaOrigem, turmasDestino }),
  gerarGradeAuto: (p: { escolaId: number; turmaIds: number[]; modo: "preencher" | "refazer"; incluirSabado: boolean; aplicar: boolean }) =>
    call<ResultadoGeracao>("gerar_grade_auto", p),

  // Grades de horário
  listarGrades: (escolaId: number) => call<Grade[]>("listar_grades", { escolaId }),
  criarGrade: (escolaId: number, nome: string, copiarDe: number | null) =>
    call<Grade>("criar_grade", { escolaId, nome, copiarDe }),
  renomearGrade: (id: number, nome: string) => call<Grade>("renomear_grade", { id, nome }),
  excluirGrade: (id: number) => call<void>("excluir_grade", { id }),

  // Horários (faixas)
  listarHorarios: (escolaId: number) => call<Horario[]>("listar_horarios", { escolaId }),
  gerarHorarios: (dados: GerarParams) => call<Horario[]>("gerar_horarios", { dados }),
  criarHorario: (dados: HorarioInput) => call<Horario>("criar_horario", { dados }),
  atualizarHorario: (id: number, dados: HorarioInput) => call<Horario>("atualizar_horario", { id, dados }),
  excluirHorario: (id: number) => call<void>("excluir_horario", { id }),
  excluirHorarios: (ids: number[]) => call<number>("excluir_horarios", { ids }),

  // Aulas
  listarAulas: (escolaId: number) => call<Aula[]>("listar_aulas", { escolaId }),
  verificarAula: (dados: AulaInput, ignorarId?: number) =>
    call<Verificacao>("verificar_aula", { dados, ignorarId: ignorarId ?? null }),
  criarAula: (dados: AulaInput) => call<Aula>("criar_aula", { dados }),
  atualizarAula: (id: number, dados: AulaInput) => call<Aula>("atualizar_aula", { id, dados }),
  moverAula: (id: number, diaSemana: number, horarioId: number) =>
    call<Aula>("mover_aula", { id, diaSemana, horarioId }),
  trocarAulas: (idA: number, idB: number) => call<void>("trocar_aulas", { idA, idB }),
  listarFeriados: (escolaId: number) => call<Feriado[]>("listar_feriados", { escolaId }),
  criarFeriado: (dados: FeriadoInput) => call<Feriado>("criar_feriado", { dados }),
  atualizarFeriado: (id: number, dados: FeriadoInput) => call<Feriado>("atualizar_feriado", { id, dados }),
  excluirFeriado: (id: number) => call<void>("excluir_feriado", { id }),
  excluirAula: (id: number) => call<void>("excluir_aula", { id }),
  moverAulas: (ids: number[], diaSemana: number, horarioId: number) => call<Aula[]>("mover_aulas", { ids, diaSemana, horarioId }),
  copiarAulas: (ids: number[], diaSemana: number, horarioId: number, rodizio: boolean) => call<Aula[]>("copiar_aulas", { ids, diaSemana, horarioId, rodizio }),
  excluirAulas: (ids: number[]) => call<number>("excluir_aulas", { ids }),
  limparGrade: (escolaId: number) => call<number>("limpar_grade", { escolaId }),
  obterResumo: (escolaId: number) => call<Resumo>("obter_resumo", { escolaId }),

  // Backup
  exportarBackup: (caminho: string, senha: string) => call<number>("exportar_backup", { caminho, senha }),
  importarBackup: (caminho: string, senha: string, criarSnapshot: boolean) =>
    call<string | null>("importar_backup", { caminho, senha, criarSnapshot }),
  listarBackups: () => call<EntradaBackup[]>("listar_backups"),
  obterConfigBackup: () => call<ConfigBackup>("obter_config_backup"),
  salvarConfigBackup: (config: ConfigBackup) => call<void>("salvar_config_backup", { config }),

  // Arquivos de relatório
  salvarArquivo: (caminho: string, conteudoBase64: string) =>
    call<void>("salvar_arquivo", { caminho, conteudoBase64 }),
};
