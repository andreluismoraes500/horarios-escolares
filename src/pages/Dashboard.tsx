import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { nomeTurmas } from "@/lib/turmas";
import { Card, Titulo, Vazio } from "@/components/ui";
import { DIAS, diaDeHoje, faixaTexto } from "@/lib/tempo";
import type { Resumo } from "@/types";

export default function Dashboard() {
  const { usuario, pode } = useAuth();
  const { escolaId, escolas, aulas, horarios, turmas, grupos, materias, salas, professores } = useDados();
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    if (!escolaId) return setResumo(null);
    api.obterResumo(escolaId).then(setResumo).catch(() => setResumo(null));
  }, [escolaId, aulas.length]);

  if (escolas.length === 0) {
    return (
      <>
        <Titulo titulo={`Olá, ${usuario?.nome ?? ""}`} />
        <Vazio texto={pode("escolas", "criar") ? "Nenhuma escola cadastrada. Comece em “Escolas”." : "Nenhuma escola disponível para o seu usuário."} />
      </>
    );
  }

  const hoje = diaDeHoje();
  const aulasHoje = aulas
    .filter((a) => a.dia_semana === hoje)
    .map((a) => ({ a, h: horarios.find((h) => h.id === a.horario_id) }))
    .filter((x) => x.h)
    .sort((x, y) => x.h!.inicio_min - y.h!.inicio_min);

  const cards: [string, number | string][] = resumo
    ? [
        ["Professores", resumo.professores],
        ["Matérias", resumo.materias],
        ["Salas e espaços", resumo.salas],
        ["Turmas", resumo.turmas],
        ["Aulas alocadas", `${resumo.aulas}${resumo.capacidade_grade ? ` / ${resumo.capacidade_grade}` : ""}`],
        ["Aulas livres", resumo.aulas_livres],
      ]
    : [];

  return (
    <>
      <Titulo titulo={`Olá, ${usuario?.nome ?? ""}`} subtitulo="Visão geral da escola ativa" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([rot, val]) => (
          <Card key={rot} className="p-4">
            <div className="text-2xl font-semibold">{val}</div>
            <div className="text-xs text-muted-foreground">{rot}</div>
          </Card>
        ))}
      </div>

      {resumo && resumo.faixas_aula === 0 && pode("horarios", "criar") && (
        <Card className="mb-6 border-warning p-4 text-sm">
          Esta escola ainda não tem horários de aula.{" "}
          <Link to="/horarios" className="font-medium text-primary underline">Configurar horários e intervalos</Link>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-3 font-medium">
          Aulas de hoje ({DIAS.find((d) => d.n === hoje)?.longo ?? "domingo"})
        </h2>
        {aulasHoje.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma aula alocada para hoje.</p>
        ) : (
          <ul className="divide-y text-sm">
            {aulasHoje.map(({ a, h }) => {
              const mat = materias.find((m) => m.id === a.materia_id);
              return (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{faixaTexto(h!)}</span>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: mat?.cor ?? "#94a3b8" }} />
                  <span className="font-medium">{mat?.nome ?? "Aula livre"}</span>
                  <span className="text-muted-foreground">
                    · {nomeTurmas(a.turmas, turmas, grupos)} · {salas.find((s) => s.id === a.sala_id)?.nome ?? "sem sala"} ·{" "}
                    {professores.find((p) => p.id === a.professor_id)?.nome ?? "sem professor"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
