import { create } from "zustand";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import type { Aula, Demanda, Escola, Grade, Grupo, Horario, Materia, Professor, Sala, Turma } from "@/types";

const CHAVE_ESCOLA = "hs_escola";

export type ChaveDados = "professores" | "materias" | "salas" | "turmas" | "grupos" | "demandas" | "horarios" | "grades" | "aulas";

interface DadosState {
  escolas: Escola[];
  escolaId: number | null;
  professores: Professor[];
  materias: Materia[];
  salas: Sala[];
  turmas: Turma[];
  grupos: Grupo[];
  demandas: Demanda[];
  horarios: Horario[];
  grades: Grade[];
  aulas: Aula[];
  carregando: boolean;
  carregarEscolas: () => Promise<void>;
  selecionarEscola: (id: number) => Promise<void>;
  /** Recarrega as listas da escola ativa (todas, ou só as informadas). */
  carregar: (chaves?: ChaveDados[]) => Promise<void>;
  limpar: () => void;
}

const vazio = { professores: [], materias: [], salas: [], turmas: [], grupos: [], demandas: [], horarios: [], grades: [], aulas: [] };

export const useDados = create<DadosState>((set, get) => ({
  escolas: [],
  escolaId: null,
  ...vazio,
  carregando: false,

  carregarEscolas: async () => {
    const escolas = await api.listarEscolas();
    const salva = Number(localStorage.getItem(CHAVE_ESCOLA));
    const usuarioEscola = useAuth.getState().usuario?.escola_id ?? null;
    const atual = get().escolaId;
    const candidata = [atual, usuarioEscola, salva].find((id) => id && escolas.some((e) => e.id === id));
    const escolaId = candidata ?? escolas[0]?.id ?? null;
    set({ escolas, escolaId });
    if (escolaId) await get().carregar();
    else set({ ...vazio });
  },

  selecionarEscola: async (id) => {
    localStorage.setItem(CHAVE_ESCOLA, String(id));
    set({ escolaId: id, ...vazio });
    await get().carregar();
  },

  carregar: async (chaves) => {
    const { escolaId } = get();
    if (!escolaId) return;
    const todas: ChaveDados[] = ["professores", "materias", "salas", "turmas", "grupos", "demandas", "horarios", "grades", "aulas"];
    const alvo = chaves ?? todas;
    const loaders: Record<ChaveDados, () => Promise<unknown>> = {
      professores: () => api.listarProfessores(escolaId),
      materias: () => api.listarMaterias(escolaId),
      salas: () => api.listarSalas(escolaId),
      turmas: () => api.listarTurmas(escolaId),
      grupos: () => api.listarGrupos(escolaId),
      demandas: () => api.listarDemandas(escolaId),
      horarios: () => api.listarHorarios(escolaId),
      grades: () => api.listarGrades(escolaId),
      aulas: () => api.listarAulas(escolaId),
    };
    set({ carregando: true });
    try {
      const resultados = await Promise.all(alvo.map((k) => loaders[k]()));
      // Ignora respostas de uma escola que não é mais a ativa (troca rápida)
      if (get().escolaId !== escolaId) return;
      const patch: Record<string, unknown> = {};
      alvo.forEach((k, i) => (patch[k] = resultados[i]));
      set(patch as Partial<DadosState>);
    } finally {
      set({ carregando: false });
    }
  },

  limpar: () => set({ escolas: [], escolaId: null, ...vazio }),
}));
