import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Escolas from "@/pages/Escolas/Escolas";
import Professores from "@/pages/Professores/Professores";
import Materias from "@/pages/Materias/Materias";
import Salas from "@/pages/Salas/Salas";
import Turmas from "@/pages/Turmas/Turmas";
import ConfigHorarios from "@/pages/Horarios/ConfigHorarios";
import Gerador from "@/pages/Gerador/Gerador";
import GradeSemanal from "@/pages/Horarios/GradeSemanal";
import Usuarios from "@/pages/Usuarios/Usuarios";
import Backups from "@/pages/Backups/Backups";
import Auditoria from "@/pages/Auditoria/Auditoria";
import Presenca from "@/pages/Presenca/Presenca";
import Apoio from "@/pages/Apoio/Apoio";
import Relatorios from "@/pages/Relatorios/Relatorios";

/** Protege rotas por permissão de leitura do recurso. */
function Protegida({ recurso, children }: { recurso: string; children: React.ReactNode }) {
  const pode = useAuth((s) => s.pode);
  return pode(recurso, "ver") ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { token, pronto, restaurar, usuario } = useAuth();
  const { carregarEscolas, limpar } = useDados();

  useEffect(() => {
    void restaurar();
  }, [restaurar]);

  // Ao autenticar, carrega as escolas (e os dados da escola ativa).
  useEffect(() => {
    if (token && usuario) {
      carregarEscolas().catch((e: Error) => toast.error(e.message));
    } else {
      limpar();
    }
  }, [token, usuario, carregarEscolas, limpar]);

  if (!pronto) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Carregando…</div>;
  }
  if (!token) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="grade" element={<Protegida recurso="aulas"><GradeSemanal /></Protegida>} />
        <Route path="gerador" element={<Protegida recurso="aulas"><Gerador /></Protegida>} />
        <Route path="horarios" element={<Protegida recurso="horarios"><ConfigHorarios /></Protegida>} />
        <Route path="professores" element={<Protegida recurso="professores"><Professores /></Protegida>} />
        <Route path="materias" element={<Protegida recurso="materias"><Materias /></Protegida>} />
        <Route path="salas" element={<Protegida recurso="salas"><Salas /></Protegida>} />
        <Route path="turmas" element={<Protegida recurso="turmas"><Turmas /></Protegida>} />
        <Route path="relatorios" element={<Protegida recurso="relatorios"><Relatorios /></Protegida>} />
        <Route path="escolas" element={<Protegida recurso="escolas"><Escolas /></Protegida>} />
        <Route path="usuarios" element={<Protegida recurso="usuarios"><Usuarios /></Protegida>} />
        <Route path="backups" element={<Protegida recurso="backup"><Backups /></Protegida>} />
        <Route path="auditoria" element={<Protegida recurso="auditoria"><Auditoria /></Protegida>} />
        <Route path="presenca" element={<Protegida recurso="horarios"><Presenca /></Protegida>} />
        <Route path="apoio" element={<Apoio />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
