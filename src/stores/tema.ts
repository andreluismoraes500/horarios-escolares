import { create } from "zustand";

type Tema = "claro" | "escuro";
const CHAVE = "hs_tema";

function aplicar(t: Tema) {
  document.documentElement.classList.toggle("dark", t === "escuro");
}

function inicial(): Tema {
  const salvo = localStorage.getItem(CHAVE) as Tema | null;
  if (salvo === "claro" || salvo === "escuro") return salvo;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

interface TemaState {
  tema: Tema;
  alternar: () => void;
}

const t0 = inicial();
aplicar(t0);

export const useTema = create<TemaState>((set, get) => ({
  tema: t0,
  alternar: () => {
    const novo: Tema = get().tema === "claro" ? "escuro" : "claro";
    localStorage.setItem(CHAVE, novo);
    aplicar(novo);
    set({ tema: novo });
  },
}));
