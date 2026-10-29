// Feriados nacionais (calculados) + feriados/recessos da escola (intervalos de datas) para a lista de presença.

import type { Feriado } from "@/types";

export const TIPOS_FERIADO: Record<string, { rotulo: string; bloqueia: boolean }> = {
  feriado: { rotulo: "Feriado (municipal/estadual)", bloqueia: true },
  recesso: { rotulo: "Recesso escolar / férias", bloqueia: true },
  dia_professor: { rotulo: "Dia do Professor", bloqueia: true },
  facultativo: { rotulo: "Ponto facultativo", bloqueia: true },
  evento: { rotulo: "Evento / reunião (sem aula, mas assina)", bloqueia: false },
  letivo: { rotulo: "Dia letivo extra (libera feriado/sábado)", bloqueia: false },
};

export interface StatusDia {
  nome: string;
  tipo: string; // "nacional" | chave de TIPOS_FERIADO
  bloqueia: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const deIso = (s: string) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
const somar = (d: Date, dias: number) => { const n = new Date(d); n.setDate(n.getDate() + dias); return n; };

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const cache = new Map<number, Map<string, StatusDia>>();
/** Feriados nacionais do ano (fixos + Carnaval, Sexta-feira Santa e Corpus Christi). */
export function feriadosNacionais(ano: number): Map<string, StatusDia> {
  const c = cache.get(ano);
  if (c) return c;
  const m = new Map<string, StatusDia>();
  const fixo = (mes: number, dia: number, nome: string) => m.set(`${ano}-${pad(mes)}-${pad(dia)}`, { nome, tipo: "nacional", bloqueia: true });
  fixo(1, 1, "Confraternização Universal");
  fixo(4, 21, "Tiradentes");
  fixo(5, 1, "Dia do Trabalho");
  fixo(9, 7, "Independência do Brasil");
  fixo(10, 12, "Nossa Sra. Aparecida");
  fixo(11, 2, "Finados");
  fixo(11, 15, "Proclamação da República");
  if (ano >= 2024) fixo(11, 20, "Consciência Negra");
  fixo(12, 25, "Natal");
  const p = pascoa(ano);
  m.set(iso(somar(p, -48)), { nome: "Carnaval", tipo: "facultativo", bloqueia: true });
  m.set(iso(somar(p, -47)), { nome: "Carnaval", tipo: "facultativo", bloqueia: true });
  m.set(iso(somar(p, -2)), { nome: "Sexta-feira Santa", tipo: "nacional", bloqueia: true });
  m.set(iso(somar(p, 60)), { nome: "Corpus Christi", tipo: "facultativo", bloqueia: true });
  cache.set(ano, m);
  return m;
}

/**
 * Situação de uma data. Os cadastros da escola têm prioridade sobre os nacionais:
 * se algum libera a assinatura (evento/dia letivo), ela é liberada; se algum bloqueia, é bloqueada.
 * Retorna null para um dia comum.
 */
export function statusDoDia(data: string, escola: Feriado[]): StatusDia | null {
  const doDia = escola.filter((f) => f.data_ini <= data && data <= f.data_fim);
  if (doDia.length) {
    const bloq = doDia.find((f) => f.bloqueia_assinatura);
    const base = bloq ?? doDia[0];
    return { nome: doDia.map((f) => f.nome).join(" / "), tipo: base.tipo, bloqueia: !!bloq };
  }
  return feriadosNacionais(Number(data.slice(0, 4))).get(data) ?? null;
}

/** Datas (AAAA-MM-DD) de segunda a sexta (e sábado, se pedido) entre duas datas. */
export function diasUteis(ini: string, fim: string, sabado: boolean): string[] {
  const out: string[] = [];
  for (let d = deIso(ini); iso(d) <= fim; d = somar(d, 1)) {
    const w = d.getDay();
    if (w >= 1 && w <= 5) out.push(iso(d));
    else if (w === 6 && sabado) out.push(iso(d));
  }
  return out;
}

export const segundaDaSemana = (data: string): string => {
  const d = deIso(data);
  return iso(somar(d, -((d.getDay() + 6) % 7)));
};
export const somarDias = (data: string, n: number) => iso(somar(deIso(data), n));
export const fimDoMes = (mes: string) => { const [a, m] = mes.split("-").map(Number); return iso(new Date(a, m, 0)); };
