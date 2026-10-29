// Expediente (horários de trabalho) do coordenador: períodos por dia da semana.
export interface Periodo { dia: number; ini: number; fim: number }

export function lerExpediente(json: string): Periodo[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((p) => p && p.dia >= 1 && p.dia <= 6 && p.fim > p.ini).map((p) => ({ dia: p.dia, ini: p.ini, fim: p.fim }))
      : [];
  } catch { return []; }
}
export const gravarExpediente = (p: Periodo[]) =>
  JSON.stringify([...p].sort((a, b) => a.dia - b.dia || a.ini - b.ini));

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const horaTexto = hm;
export const parseHm = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const periodoTexto = (p: { ini: number; fim: number }) => `${hm(p.ini)}–${hm(p.fim)}`;

/** Resumo curto: "Seg–Sex 07:00–12:00 · Qua 18:00–22:00". */
export function resumoExpediente(json: string): string {
  const ps = lerExpediente(json);
  if (ps.length === 0) return "—";
  const nomes = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const porHorario = new Map<string, number[]>();
  for (const p of ps) { const k = periodoTexto(p); porHorario.set(k, [...(porHorario.get(k) ?? []), p.dia]); }
  return [...porHorario.entries()].map(([h, dias]) => {
    const d = [...dias].sort();
    const seq = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    const rot = d.length > 2 && seq ? `${nomes[d[0]]}–${nomes[d[d.length - 1]]}` : d.map((x) => nomes[x]).join(", ");
    return `${rot} ${h}`;
  }).join(" · ");
}
