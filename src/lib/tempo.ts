// Utilidades de horário. Todos os tempos são minutos desde 00:00.

import type { Horario, IntervaloCfg, Turno } from "@/types";

export const TURNOS: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
export const ORDEM_TURNOS: Turno[] = ["manha", "tarde", "noite"];
/** Início sugerido para cada turno ao gerar horários. */
export const INICIO_PADRAO: Record<Turno, string> = { manha: "07:00", tarde: "13:00", noite: "19:00" };

/** 430 → "07:10" */
export function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "7:10", "07:10", "710", "7h10" → 430. Retorna null se inválido. */
export function parseHora(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace("h", ":");
  let h: number, m: number;
  if (/^\d{1,2}:\d{1,2}$/.test(t)) {
    [h, m] = t.split(":").map(Number);
  } else if (/^\d{3,4}$/.test(t)) {
    const n = t.padStart(4, "0");
    h = Number(n.slice(0, 2));
    m = Number(n.slice(2));
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number(t);
    m = 0;
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function faixaTexto(h: Pick<Horario, "inicio_min" | "fim_min">): string {
  return `${fmtMin(h.inicio_min)} – ${fmtMin(h.fim_min)}`;
}

export interface FaixaGerada {
  rotulo: string;
  inicio_min: number;
  fim_min: number;
  tipo: "aula" | "intervalo";
}

/**
 * Prévia da geração de faixas (mesma regra do backend):
 * aulas consecutivas de `duracao` minutos; intervalos entram após a aula N.
 * Ex.: 07:00, 50 min → 1ª 07:00–07:50, 2ª 07:50–08:40...
 */
export function gerarFaixas(
  inicio: number,
  duracao: number,
  qtd: number,
  intervalos: IntervaloCfg[],
  prefixo?: string,
): { faixas: FaixaGerada[]; erro?: string } {
  if (!(duracao >= 1 && duracao <= 480)) return { faixas: [], erro: "Duração da aula inválida (1 a 480 min)." };
  if (!(qtd >= 1 && qtd <= 30)) return { faixas: [], erro: "Quantidade de aulas inválida (1 a 30)." };
  for (const i of intervalos) {
    if (i.apos_aula < 1 || i.apos_aula >= qtd) return { faixas: [], erro: `Intervalo após a aula ${i.apos_aula} é inválido (use de 1 a ${qtd - 1}).` };
    if (!(i.duracao_min >= 1 && i.duracao_min <= 240)) return { faixas: [], erro: "Duração do intervalo inválida (1 a 240 min)." };
  }
  const pre = prefixo?.trim() ? `${prefixo.trim()} · ` : "";
  const faixas: FaixaGerada[] = [];
  let atual = inicio;
  for (let n = 1; n <= qtd; n++) {
    faixas.push({ rotulo: `${pre}${n}ª aula`, inicio_min: atual, fim_min: atual + duracao, tipo: "aula" });
    atual += duracao;
    for (const i of intervalos.filter((x) => x.apos_aula === n)) {
      faixas.push({ rotulo: `${pre}${i.rotulo?.trim() || "Intervalo"}`, inicio_min: atual, fim_min: atual + i.duracao_min, tipo: "intervalo" });
      atual += i.duracao_min;
    }
  }
  if (atual > 1440) return { faixas, erro: `A sequência passa da meia-noite (terminaria às ${fmtMin(atual % 1440)}).` };
  return { faixas };
}

export const DIAS = [
  { n: 1, curto: "Seg", longo: "Segunda-feira" },
  { n: 2, curto: "Ter", longo: "Terça-feira" },
  { n: 3, curto: "Qua", longo: "Quarta-feira" },
  { n: 4, curto: "Qui", longo: "Quinta-feira" },
  { n: 5, curto: "Sex", longo: "Sexta-feira" },
  { n: 6, curto: "Sáb", longo: "Sábado" },
] as const;

/** Dia da semana de hoje no padrão do sistema (1=segunda ... 7=domingo). */
export function diaDeHoje(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}
