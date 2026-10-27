import { useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { api, type EscolaInput } from "@/lib/api";
import { executar } from "@/lib/acao";
import { useAuth } from "@/stores/auth";
import { useDados } from "@/stores/dados";
import { Button, Campo, Confirmar, Input, Modal, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { lerImagemReduzida } from "@/lib/imagem";
import type { Escola } from "@/types";

const schema = z.object({
  nome: z.string().trim().min(1, "Informe o nome da escola.").max(120),
  endereco: z.string().trim().max(200).optional(),
  cnpj: z.string().trim().refine((v) => v === "" || v.replace(/\D/g, "").length === 14, "CNPJ deve ter 14 dígitos."),
});

const vazio: EscolaInput = { nome: "", endereco: "", cnpj: "", logo: null };

export default function Escolas() {
  const pode = useAuth((s) => s.pode);
  const { escolas, carregarEscolas } = useDados();
  const [edit, setEdit] = useState<{ id: number | null; dados: EscolaInput } | null>(null);
  const [excluir, setExcluir] = useState<Escola | null>(null);

  async function salvar() {
    if (!edit) return;
    const r = schema.safeParse(edit.dados);
    if (!r.success) return toast.error(r.error.issues[0].message);
    const ok = await executar(
      () => (edit.id ? api.atualizarEscola(edit.id, edit.dados) : api.criarEscola(edit.dados)),
      "Escola salva.",
    );
    if (ok) {
      setEdit(null);
      await carregarEscolas();
    }
  }

  const inputModal = useRef<HTMLInputElement>(null);
  const inputLinha = useRef<HTMLInputElement>(null);
  const [escolaLogo, setEscolaLogo] = useState<Escola | null>(null);

  async function lerLogo(f: File | undefined) {
    if (!f || !edit) return;
    try {
      const logo = await lerImagemReduzida(f);
      setEdit({ ...edit, dados: { ...edit.dados, logo } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Troca a logo direto pela lista, sem abrir o formulário. */
  async function trocarLogoDaLinha(f: File | undefined) {
    const e = escolaLogo;
    setEscolaLogo(null);
    if (!f || !e) return;
    try {
      const logo = await lerImagemReduzida(f);
      const ok = await executar(
        () => api.atualizarEscola(e.id, { nome: e.nome, endereco: e.endereco ?? "", cnpj: e.cnpj ?? "", logo }),
        "Logo atualizada.",
      );
      if (ok) await carregarEscolas();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <Titulo
        titulo="Escolas"
        subtitulo="Cada escola tem seus próprios cadastros e horários"
        acoes={pode("escolas", "criar") && (
          <Button onClick={() => setEdit({ id: null, dados: vazio })}><Plus className="h-4 w-4" />Nova escola</Button>
        )}
      />
      <input ref={inputLinha} type="file" accept="image/*" className="hidden" aria-label="Arquivo da logo"
        onChange={(ev) => { void trocarLogoDaLinha(ev.target.files?.[0]); ev.target.value = ""; }} />
      {escolas.length === 0 ? <Vazio texto="Nenhuma escola cadastrada." /> : (
        <Tabela>
          <thead><tr><Th>Logo</Th><Th>Nome</Th><Th>CNPJ</Th><Th>Endereço</Th><Th className="w-24" /></tr></thead>
          <tbody>
            {escolas.map((e) => (
              <tr key={e.id}>
                <Td>
                  {pode("escolas", "editar") ? (
                    <button type="button" title={e.logo ? "Trocar logo" : "Adicionar logo"} aria-label={e.logo ? "Trocar logo" : "Adicionar logo"}
                      onClick={() => { setEscolaLogo(e); inputLinha.current?.click(); }}
                      className="flex h-10 w-10 items-center justify-center rounded border border-dashed hover:bg-muted">
                      {e.logo ? <img src={e.logo} alt="" className="h-9 w-9 rounded object-contain" /> : <ImagePlus className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  ) : e.logo ? <img src={e.logo} alt="" className="h-9 w-9 rounded object-contain" /> : "—"}
                </Td>
                <Td className="font-medium">{e.nome}</Td>
                <Td>{e.cnpj || "—"}</Td>
                <Td>{e.endereco || "—"}</Td>
                <Td>
                  <div className="flex gap-1">
                    {pode("escolas", "editar") && (
                      <Button size="icon" variant="ghost" aria-label="Editar"
                        onClick={() => setEdit({ id: e.id, dados: { nome: e.nome, endereco: e.endereco ?? "", cnpj: e.cnpj ?? "", logo: e.logo } })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {pode("escolas", "excluir") && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(e)}>
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

      <Modal aberto={!!edit} onFechar={() => setEdit(null)} titulo={edit?.id ? "Editar escola" : "Nova escola"}>
        {edit && (
          <div className="space-y-3">
            <Campo label="Nome *"><Input value={edit.dados.nome} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, nome: e.target.value } })} /></Campo>
            <Campo label="CNPJ"><Input placeholder="00.000.000/0000-00" value={edit.dados.cnpj ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, cnpj: e.target.value } })} /></Campo>
            <Campo label="Endereço"><Input value={edit.dados.endereco ?? ""} onChange={(e) => setEdit({ ...edit, dados: { ...edit.dados, endereco: e.target.value } })} /></Campo>
            <Campo label="Logo (opcional)">
              <input ref={inputModal} type="file" accept="image/*" className="hidden" aria-label="Arquivo da logo (formulário)"
                onChange={(e) => { void lerLogo(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="flex items-center gap-3">
                {edit.dados.logo ? (
                  <img src={edit.dados.logo} alt="Logo da escola" className="h-16 w-16 rounded border object-contain" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>
                )}
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="outline" onClick={() => inputModal.current?.click()}>
                    <ImagePlus className="h-4 w-4" />{edit.dados.logo ? "Trocar imagem" : "Adicionar logo"}
                  </Button>
                  {edit.dados.logo && (
                    <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, dados: { ...edit.dados, logo: null } })}>Remover</Button>
                  )}
                </div>
              </div>
            </Campo>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={salvar}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir escola"
        mensagem={`Excluir “${excluir?.nome}” apagará TODOS os dados dela (professores, salas, turmas, horários e aulas). Esta ação não pode ser desfeita.`}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          if (excluir && (await executar(() => api.excluirEscola(excluir.id), "Escola excluída."))) {
            setExcluir(null);
            await carregarEscolas();
          }
        }}
      />
    </>
  );
}
