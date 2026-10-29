import { NavLink, Outlet } from "react-router-dom";
import {
  Archive, Building2, CalendarDays, Clock, DoorOpen, FileText, GraduationCap, LayoutDashboard,
  LogOut, Moon, Wand2, Sun, Users, UserCog, BookOpen, ShieldCheck,
  Heart,
  ClipboardCheck,
} from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { useTema } from "@/stores/tema";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import Atualizacao from "@/components/Atualizacao";
import SelectBusca from "@/components/SelectBusca";

const ROTULO_PAPEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin_escola: "Admin da escola",
  coordenador: "Coordenador",
  professor: "Professor",
  visualizador: "Visualizador",
};

interface Item { para: string; rotulo: string; icone: React.ReactNode; recurso?: string }

const ITENS: Item[] = [
  { para: "/", rotulo: "Painel", icone: <LayoutDashboard className="h-4 w-4" /> },
  { para: "/escolas", rotulo: "Escolas", icone: <Building2 className="h-4 w-4" />, recurso: "escolas" },
  { para: "/horarios", rotulo: "Horários e intervalos", icone: <Clock className="h-4 w-4" />, recurso: "horarios" },
  { para: "/materias", rotulo: "Matérias", icone: <BookOpen className="h-4 w-4" />, recurso: "materias" },
  { para: "/salas", rotulo: "Salas e espaços", icone: <DoorOpen className="h-4 w-4" />, recurso: "salas" },
  { para: "/professores", rotulo: "Professores", icone: <Users className="h-4 w-4" />, recurso: "professores" },
  { para: "/turmas", rotulo: "Turmas", icone: <GraduationCap className="h-4 w-4" />, recurso: "turmas" },
  { para: "/gerador", rotulo: "Gerador automático", icone: <Wand2 className="h-4 w-4" />, recurso: "aulas" },
  { para: "/grade", rotulo: "Grade semanal", icone: <CalendarDays className="h-4 w-4" />, recurso: "aulas" },
  { para: "/relatorios", rotulo: "Relatórios", icone: <FileText className="h-4 w-4" />, recurso: "relatorios" },
  { para: "/presenca", rotulo: "Lista de presença", icone: <ClipboardCheck className="h-4 w-4" />, recurso: "horarios" },
  { para: "/usuarios", rotulo: "Usuários", icone: <UserCog className="h-4 w-4" />, recurso: "usuarios" },
  { para: "/backups", rotulo: "Backups", icone: <Archive className="h-4 w-4" />, recurso: "backup" },
  { para: "/auditoria", rotulo: "Auditoria", icone: <ShieldCheck className="h-4 w-4" />, recurso: "auditoria" },
  { para: "/apoio", rotulo: "Apoie o projeto", icone: <Heart className="h-4 w-4" /> },
];

export default function Layout() {
  const { usuario, sair, pode } = useAuth();
  const { escolas, escolaId, selecionarEscola } = useDados();
  const { tema, alternar } = useTema();
  const escolaAtual = escolas.find((e) => e.id === escolaId);

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          {escolaAtual?.logo ? (
            <img src={escolaAtual.logo} alt="Logo da escola" className="h-8 w-8 shrink-0 rounded object-contain" />
          ) : (
            <CalendarDays className="h-5 w-5 text-primary" />
          )}
          <span className="truncate">{escolaAtual?.logo ? escolaAtual.nome : "Horários Escolares"}</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {ITENS.filter((i) => !i.recurso || pode(i.recurso, "ver")).map((i) => (
            <NavLink
              key={i.para}
              to={i.para}
              end={i.para === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                  isActive && "bg-accent font-medium text-accent-foreground",
                )
              }
            >
              {i.icone}
              {i.rotulo}
            </NavLink>
          ))}
        </nav>
        <Atualizacao />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <SelectBusca
              ariaLabel="Escola ativa"
              className="w-72"
              value={escolaId}
              placeholder="Nenhuma escola cadastrada"
              disabled={escolas.length === 0}
              onChange={(v) => void selecionarEscola(Number(v))}
              opcoes={escolas.map((e) => ({ value: String(e.id), label: e.nome }))}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={alternar}
              className="rounded-md p-2 hover:bg-muted"
              title={tema === "claro" ? "Tema escuro" : "Tema claro"}
              aria-label="Alternar tema"
            >
              {tema === "claro" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <div className="text-right text-xs leading-tight">
              <div className="font-medium">{usuario?.nome}</div>
              <div className="text-muted-foreground">{usuario ? ROTULO_PAPEL[usuario.papel] : ""}</div>
            </div>
            <button
              onClick={() => void sair()}
              className="rounded-md p-2 hover:bg-muted"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <footer className="no-print flex h-8 shrink-0 items-center justify-center gap-1 border-t bg-card px-4 text-xs text-muted-foreground">
          Desenvolvido por <b className="font-medium text-foreground">André Luis de Moraes</b>
          <span aria-hidden>·</span>
          <NavLink to="/apoio" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
            <Heart className="h-3 w-3" />Apoie o projeto
          </NavLink>
        </footer>
      </div>
    </div>
  );
}
