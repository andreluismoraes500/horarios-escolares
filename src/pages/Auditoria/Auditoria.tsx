import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Input, Select, Tabela, Td, Th, Titulo, Vazio } from "@/components/ui";
import { formatarDataHora } from "@/lib/utils";
import type { EntradaAuditoria } from "@/types";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hojeIso = () => iso(new Date());
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ROTULO_ENTIDADE: Record<string, string> = {
  aulas: "Aulas", professores: "Professores", materias: "Matérias", salas: "Salas", turmas: "Turmas", grupos: "Grupos",
  horarios_base: "Horários", grades: "Grades de horário", demandas: "Aulas por semana", escolas: "Escolas", usuarios: "Usuários",
  backup: "Backup", config_backup: "Config. de backup",
};
const ROTULO_ACAO: Record<string, string> = {
  criar: "Criou", editar: "Editou", excluir: "Excluiu", login: "Entrou", alterar_senha: "Alterou senha", redefinir_senha: "Redefiniu senha",
  mudar_permissao: "Mudou permissão", exportar_backup: "Exportou backup", restaurar: "Restaurou backup",
};
const ent = (e: string) => ROTULO_ENTIDADE[e] ?? e;
const aca = (a: string) => ROTULO_ACAO[a] ?? a;

export default function Auditoria() {
  const [lista, setLista] = useState<EntradaAuditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [de, setDe] = useState(diasAtras(7));
  const [ate, setAte] = useState(hojeIso());
  const [usuario, setUsuario] = useState("");
  const [acao, setAcao] = useState("");
  const [entidade, setEntidade] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    setCarregando(true);
    api.listarAuditoria(5000, de, ate).then(setLista).catch((e: Error) => toast.error(e.message)).finally(() => setCarregando(false));
  }, [de, ate]);

  const usuarios = useMemo(() => [...new Set(lista.map((l) => l.usuario))].sort(), [lista]);
  const acoes = useMemo(() => [...new Set(lista.map((l) => l.acao))].sort(), [lista]);
  const entidades = useMemo(() => [...new Set(lista.map((l) => l.entidade))].sort(), [lista]);

  const filtrada = useMemo(() => {
    const q = norm(busca.trim());
    return lista.filter((l) =>
      (!usuario || l.usuario === usuario) && (!acao || l.acao === acao) && (!entidade || l.entidade === entidade) &&
      (!q || norm(`${l.usuario} ${aca(l.acao)} ${ent(l.entidade)} ${l.detalhe ?? ""}`).includes(q)));
  }, [lista, usuario, acao, entidade, busca]);

  // Agrupa por dia (a lista já vem do mais novo para o mais antigo).
  const grupos = useMemo(() => {
    const m = new Map<string, EntradaAuditoria[]>();
    for (const l of filtrada) {
      const d = new Date(l.data.includes("T") ? l.data : l.data.replace(" ", "T") + "Z");
      const k = isNaN(d.getTime()) ? l.data.slice(0, 10) : iso(d);
      (m.get(k) ?? m.set(k, []).get(k)!).push(l);
    }
    return [...m.entries()];
  }, [filtrada]);

  const rotuloDia = (k: string) => {
    if (k === hojeIso()) return "Hoje";
    if (k === diasAtras(1)) return "Ontem";
    const [a, m, d] = k.split("-");
    return new Date(Number(a), Number(m) - 1, Number(d)).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  };

  function exportarCsv() {
    const esc = (t: string) => `"${t.replace(/"/g, '""')}"`;
    const linhas = [["Data", "Usuário", "Ação", "Entidade", "Id", "Detalhe"].join(";"),
      ...filtrada.map((l) => [formatarDataHora(l.data), l.usuario, aca(l.acao), ent(l.entidade), l.entidade_id ?? "", l.detalhe ?? ""].map((x) => esc(String(x))).join(";"))];
    const blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria_${de}_${ate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const atalho = (rotulo: string, ini: string, fim: string) => (
    <Button size="sm" variant={de === ini && ate === fim ? "default" : "outline"} onClick={() => { setDe(ini); setAte(fim); }}>{rotulo}</Button>
  );

  return (
    <>
      <Titulo titulo="Auditoria" subtitulo="O que foi feito, por quem e quando: exclusões, edições, backups, permissões e logins"
        acoes={<Button variant="outline" disabled={filtrada.length === 0} onClick={exportarCsv}><Download className="h-4 w-4" />CSV</Button>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {atalho("Hoje", hojeIso(), hojeIso())}
        {atalho("Ontem", diasAtras(1), diasAtras(1))}
        {atalho("7 dias", diasAtras(7), hojeIso())}
        {atalho("30 dias", diasAtras(30), hojeIso())}
        <label className="ml-2 flex items-center gap-1 text-sm">De <Input type="date" className="w-40" aria-label="De" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-sm">até <Input type="date" className="w-40" aria-label="Até" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Pesquisar no detalhe…" aria-label="Pesquisar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select className="w-48" aria-label="Usuário" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Todos os usuários</option>
          {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
        <Select className="w-44" aria-label="Ação" value={acao} onChange={(e) => setAcao(e.target.value)}>
          <option value="">Todas as ações</option>
          {acoes.map((a) => <option key={a} value={a}>{aca(a)}</option>)}
        </Select>
        <Select className="w-48" aria-label="Entidade" value={entidade} onChange={(e) => setEntidade(e.target.value)}>
          <option value="">Todas as telas</option>
          {entidades.map((x) => <option key={x} value={x}>{ent(x)}</option>)}
        </Select>
        {(usuario || acao || entidade || busca) && (
          <Button variant="ghost" size="sm" onClick={() => { setUsuario(""); setAcao(""); setEntidade(""); setBusca(""); }}>Limpar filtros</Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">{carregando ? "Carregando…" : `${filtrada.length} registro(s) em ${grupos.length} dia(s)`}</span>
      </div>

      {filtrada.length === 0 ? <Vazio texto={carregando ? "Carregando…" : "Nenhum registro neste período/filtro."} /> : (
        <div className="space-y-4">
          {grupos.map(([dia, itens]) => (
            <div key={dia}>
              <h3 className="mb-1 text-sm font-semibold first-letter:uppercase">{rotuloDia(dia)} <span className="font-normal text-muted-foreground">· {itens.length}</span></h3>
              <Tabela>
                <thead><tr><Th className="w-24">Hora</Th><Th>Usuário</Th><Th>Ação</Th><Th>Onde</Th><Th>Detalhe</Th></tr></thead>
                <tbody>
                  {itens.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatarDataHora(l.data).split(" ").pop()?.slice(0, 5)}</Td>
                      <Td>{l.usuario}</Td>
                      <Td><Badge>{aca(l.acao)}</Badge></Td>
                      <Td>{ent(l.entidade)}{l.entidade_id ? ` #${l.entidade_id}` : ""}</Td>
                      <Td className="text-muted-foreground">{l.detalhe}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
