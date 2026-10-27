// Seleção em lote para as listas de cadastro: caixa por linha, "selecionar todas" e exclusão em lote.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Confirmar, Td, Th } from "@/components/ui";

export function useSelecao(lista: { id: number }[]) {
  const [sel, setSel] = useState<number[]>([]);
  // Descarta da seleção o que saiu da lista (filtro, exclusão).
  useEffect(() => {
    setSel((s) => {
      const ids = new Set(lista.map((x) => x.id));
      const n = s.filter((i) => ids.has(i));
      return n.length === s.length ? s : n;
    });
  }, [lista]);
  const todas = lista.length > 0 && lista.every((x) => sel.includes(x.id));
  return {
    sel,
    todas,
    marcada: (id: number) => sel.includes(id),
    alternar: (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    alternarTodas: () => setSel(todas ? [] : lista.map((x) => x.id)),
    limpar: () => setSel([]),
  };
}
type Selecao = ReturnType<typeof useSelecao>;

export const ThSel = ({ s }: { s: Selecao }) => (
  <Th className="w-10"><input type="checkbox" aria-label="Selecionar todos" checked={s.todas} onChange={s.alternarTodas} /></Th>
);
export const TdSel = ({ s, id, nome }: { s: Selecao; id: number; nome: string }) => (
  <Td><input type="checkbox" aria-label={`Selecionar ${nome}`} checked={s.marcada(id)} onChange={() => s.alternar(id)} /></Td>
);

/** Botão "Excluir selecionados" + confirmação; exclui um a um e informa quantos deram certo. */
export function ExcluirLote({ s, singular, plural, aviso, excluirUm, depois }: {
  s: Selecao; singular: string; plural: string; aviso?: string;
  excluirUm: (id: number) => Promise<unknown>; depois: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  if (s.sel.length === 0) return null;
  const n = s.sel.length;
  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />Excluir selecionados ({n})
      </Button>
      <Confirmar
        aberto={aberto}
        titulo={`Excluir ${n} ${n === 1 ? singular : plural}`}
        mensagem={`${n} ${n === 1 ? singular : plural} será(ão) excluído(s). ${aviso ?? ""} Esta ação não pode ser desfeita. Continuar?`}
        onCancelar={() => setAberto(false)}
        onConfirmar={async () => {
          setAberto(false);
          let ok = 0;
          let erro = "";
          for (const id of s.sel) {
            try { await excluirUm(id); ok++; } catch (e) { erro = (e as Error).message; }
          }
          s.limpar();
          if (ok === n) toast.success(`${ok} ${ok === 1 ? singular : plural} excluído(s).`);
          else toast.error(`${ok} de ${n} excluídos. ${erro}`);
          await depois();
        }}
      />
    </>
  );
}
