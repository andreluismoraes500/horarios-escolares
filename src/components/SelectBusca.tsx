// Select com pesquisa: digite para filtrar (sem diferenciar acentos/maiúsculas), setas + Enter para escolher.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OpcaoBusca {
  value: string;
  label: string;
  /** Texto auxiliar à direita (ex.: turno) e usado também na busca. */
  hint?: string;
  /** Bolinha de cor ao lado do nome (professor/matéria). */
  cor?: string | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function SelectBusca({
  value, onChange, opcoes, placeholder = "Selecione…", disabled, className, ariaLabel,
}: {
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  opcoes: OpcaoBusca[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const v = value == null ? "" : String(value);
  const atual = opcoes.find((o) => o.value === v);

  const filtradas = useMemo(() => {
    const n = norm(q.trim());
    return n ? opcoes.filter((o) => norm(o.label + " " + (o.hint ?? "")).includes(n)) : opcoes;
  }, [opcoes, q]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  useEffect(() => setAtivo(0), [q, aberto]);
  useEffect(() => {
    lista.current?.children[ativo]?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  function abrir() {
    if (disabled) return;
    setQ("");
    setAberto(true);
    // posiciona a seleção atual como item ativo
    const i = opcoes.findIndex((o) => o.value === v);
    if (i >= 0) setTimeout(() => setAtivo(i), 0);
  }
  function escolher(o: OpcaoBusca) {
    onChange(o.value);
    setAberto(false);
  }

  return (
    <div ref={raiz} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        disabled={disabled}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-card px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2">
          {atual?.cor && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: atual.cor }} />}
          <span className={cn("truncate", !atual && "text-muted-foreground")}>{atual?.label ?? placeholder}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {aberto && (
        <div className="absolute left-0 z-[60] mt-1 w-full min-w-[220px] rounded-md border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="h-4 w-4 shrink-0 opacity-60" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar…"
              aria-label="Pesquisar"
              className="h-9 w-full bg-transparent text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, filtradas.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (filtradas[ativo]) escolher(filtradas[ativo]); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAberto(false); }
              }}
            />
          </div>
          <ul ref={lista} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtradas.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nada encontrado</li>}
            {filtradas.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === v}
                onMouseEnter={() => setAtivo(i)}
                onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", i === ativo && "bg-muted")}
              >
                {o.cor ? <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.cor }} /> : null}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
                {o.value === v && <Check className="h-4 w-4 shrink-0" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
