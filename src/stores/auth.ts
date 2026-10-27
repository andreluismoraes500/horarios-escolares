import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Usuario } from "@/types";

const CHAVE_TOKEN = "hs_token";

interface AuthState {
  token: string | null;
  usuario: Usuario | null;
  permissoes: Set<string>;
  /** false enquanto tenta restaurar a sessão salva ao abrir o app */
  pronto: boolean;
  restaurar: () => Promise<void>;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  /** Verifica permissão "recurso:acao" (só para a interface; o backend valida de verdade). */
  pode: (recurso: string, acao: "ver" | "criar" | "editar" | "excluir") => boolean;
}

async function carregarPermissoes(token: string): Promise<Set<string>> {
  const lista = await invoke<string[]>("minhas_permissoes", { token });
  return new Set(lista);
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  usuario: null,
  permissoes: new Set(),
  pronto: false,

  // Sessão persistente: reaproveita o token salvo localmente, se ainda for válido.
  restaurar: async () => {
    const token = localStorage.getItem(CHAVE_TOKEN);
    if (!token) return set({ pronto: true });
    try {
      const usuario = await invoke<Usuario>("sessao_atual", { token });
      const permissoes = await carregarPermissoes(token);
      set({ token, usuario, permissoes, pronto: true });
    } catch {
      localStorage.removeItem(CHAVE_TOKEN);
      set({ token: null, usuario: null, permissoes: new Set(), pronto: true });
    }
  },

  entrar: async (email, senha) => {
    const r = await invoke<{ token: string; usuario: Usuario }>("login", { email, senha });
    const permissoes = await carregarPermissoes(r.token);
    localStorage.setItem(CHAVE_TOKEN, r.token);
    set({ token: r.token, usuario: r.usuario, permissoes, pronto: true });
  },

  sair: async () => {
    const { token } = get();
    localStorage.removeItem(CHAVE_TOKEN);
    set({ token: null, usuario: null, permissoes: new Set() });
    if (token) {
      try {
        await invoke("logout", { token });
      } catch {
        /* sessão já inválida */
      }
    }
  },

  pode: (recurso, acao) => get().permissoes.has(`${recurso}:${acao}`),
}));
