import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type UsuarioInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Badge, Button, Campo, Confirmar, Input, Modal, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import type { Papel, Professor, Usuario } from "@/types";
import SelectBusca from "@/components/SelectBusca";

const PAPEIS: Record<Papel, string> = {
  super_admin: "Super Admin",
  admin_escola: "Admin da escola",
  coordenador: "Coordenador",
  professor: "Professor",
  visualizador: "Visualizador",
};

export default function Usuarios() {
  const { usuario: eu, pode } = useAuth();
  const { escolas } = useDados();
  const souSuper = eu?.papel === "super_admin";
  const [lista, setLista] = useState<Usuario[]>([]);
  const [edit, setEdit] = useState<{ id: number | null; dados: UsuarioInput } | null>(null);
  const [excluir, setExcluir] = useState<Usuario | null>(null);
  const [profsEscola, setProfsEscola] = useState<Professor[]>([]);

  const recarregar = () => api.listarUsuarios().then(setLista).catch((e: Error) => toast.error(e.message));
  useEffect(() => { void recarregar(); }, []);

  // Professores da escola do usuário em edição (para vincular o papel "professor").
  const escolaDoForm = edit ? (souSuper ? edit.dados.escola_id : eu?.escola_id ?? null) : null;
  useEffect(() => {
    if (!escolaDoForm) return setProfsEscola([]);
    api.listarProfessores(escolaDoForm).then(setProfsEscola).catch(() => setProfsEscola([]));
  }, [escolaDoForm]);

  const papeisDisponiveis = (Object.keys(PAPEIS) as Papel[]).filter((p) => souSuper || p !== "super_admin");
  const nomeEscola = (id: number | null) => (id ? escolas.find((e) => e.id === id)?.nome ?? `#${id}` : "Todas");

  async function salvar() {
    if (!edit) return;
    const d = edit.dados;
    if (!d.nome.trim() || !d.email.trim()) return toast.error("Informe nome e e-mail.");
    if (!edit.id && (d.senha ?? "").length < 6) return toast.error("A senha deve ter pelo menos 6 caracteres.");
    const ok = await executar(
      () => (edit.id ? api.atualizarUsuario(edit.id, d) : api.criarUsuario(d)),
      "Usuário salvo.",
    );
    if (ok) {
      setEdit(null);
      await recarregar();
    }
  }

  const novo = (): UsuarioInput => ({
    nome: "", email: "", senha: "", papel: "coordenador",
    escola_id: souSuper ? escolas[0]?.id ?? null : eu?.escola_id ?? null, professor_id: null, ativo: true,
  });

  return (
    <>
      <Titulo
        titulo="Usuários"
        subtitulo="Contas de acesso e papéis (permissões)"
        acoes={pode("usuarios", "criar") && <Button onClick={() => setEdit({ id: null, dados: novo() })}><Plus className="h-4 w-4" />Novo usuário</Button>}
      />
      {lista.length === 0 ? <Vazio texto="Nenhum usuário." /> : (
        <Tabela>
          <thead><tr><Th>Nome</Th><Th>E-mail</Th><Th>Papel</Th><Th>Escola</Th><Th>Situação</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.nome}</Td>
                <Td>{u.email}</Td>
                <Td><Badge>{PAPEIS[u.papel]}</Badge></Td>
                <Td>{nomeEscola(u.escola_id)}</Td>
                <Td>{u.ativo ? "Ativo" : <span className="text-destructive">Inativo</span>}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("usuarios", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar"
                        onClick={() => setEdit({ id: u.id, dados: { nome: u.nome, email: u.email, senha: "", papel: u.papel, escola_id: u.escola_id, professor_id: u.professor_id, ativo: u.ativo } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("usuarios", "excluir") && u.id !== eu?.id && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(u)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar usuário" : "Novo usuário"}>
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <Campo label="E-mail *"><Input type="email" value={edit.dados.email} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, email: e.target.value } })} /></Campo>
            <Campo label={edit.id ? "Nova senha" : "Senha *"} dica={edit.id ? "Deixe em branco para manter a atual." : "Mínimo de 6 caracteres."}>
              <Input type="password" autoComplete="new-password" value={edit.dados.senha ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, senha: e.target.value } })} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Papel">
                <Select value={edit.dados.papel} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, papel: e.target.value as Papel, professor_id: null } })}>
                  {papeisDisponiveis.map((p) => <option key={p} value={p}>{PAPEIS[p]}</option>)}
                </Select>
              </Campo>
              {souSuper && edit.dados.papel !== "super_admin" && (
                <Campo label="Escola">
                  <SelectBusca ariaLabel="Escola" value={edit.dados.escola_id} onChange={(v) => setEdit({ ...edit, dados: { ...edit.dados, escola_id: Number(v), professor_id: null } })}
                    opcoes={escolas.map((e) => ({ value: String(e.id), label: e.nome }))} />
                </Campo>
              )}
            </div>
            {edit.dados.papel === "professor" && (
              <Campo label="Professor vinculado" dica="O usuário verá somente a grade deste professor.">
                <SelectBusca ariaLabel="Professor vinculado" value={edit.dados.professor_id} placeholder="— Selecione —"
                  onChange={(v) => setEdit({ ...edit, dados: { ...edit.dados, professor_id: v ? Number(v) : null } })}
                  opcoes={[{ value: "", label: "— Selecione —" }, ...profsEscola.map((p) => ({ value: String(p.id), label: p.nome, cor: p.cor }))]} />
              </Campo>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.dados.ativo} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, ativo: e.target.checked } })} /> Usuário ativo
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir usuário"
        mensagem={`Excluir o acesso de “${excluir?.nome}” (${excluir?.email})?`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirUsuario(excluir.id), "Usuário excluído."))) {
            setExcluir(null);
            await recarregar();
          }
        }}
      />
    </>
  );
}
