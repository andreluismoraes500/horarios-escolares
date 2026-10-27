// Componentes de UI no estilo shadcn/ui (Radix + Tailwind + cva).

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ------------------------------- Button -------------------------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-input bg-card hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-80",
        ghost: "hover:bg-muted",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 px-3 text-xs", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

// ------------------------------ Campos --------------------------------
const campo =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(campo, "h-9", className)} {...p} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(campo, "min-h-[72px]", className)} {...p} />,
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => <select ref={ref} className={cn(campo, "h-9 pr-8", className)} {...p} />,
);
Select.displayName = "Select";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium", className)} {...p} />;
}

/** Rótulo + campo + dica/erro. */
export function Campo({
  label, children, dica, className,
}: { label: string; children: React.ReactNode; dica?: string; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

// -------------------------------- Card --------------------------------
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...p} />;
}

export function Badge({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium", className)}
      {...p}
    />
  );
}

// ------------------------------- Dialog -------------------------------
export function Modal({
  aberto, onFechar, titulo, descricao, children, largura = "max-w-lg",
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  largura?: string;
}) {
  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-card p-6 shadow-xl",
            largura,
          )}
        >
          <DialogPrimitive.Title className="text-lg font-semibold">{titulo}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mb-4 mt-1 text-sm text-muted-foreground">
            {descricao ?? " "}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded p-1 opacity-70 hover:opacity-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmação de ação destrutiva. */
export function Confirmar({
  aberto, titulo, mensagem, rotulo = "Excluir", onConfirmar, onCancelar,
}: {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  rotulo?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Modal aberto={aberto} onFechar={onCancelar} titulo={titulo} descricao={mensagem} largura="max-w-md">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button variant="destructive" onClick={onConfirmar}>{rotulo}</Button>
      </div>
    </Modal>
  );
}

// ------------------------------- Tabela -------------------------------
export function Tabela({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("border-b bg-muted px-3 py-2 text-left font-medium text-muted-foreground", className)} {...p} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("border-b px-3 py-2 align-middle", className)} {...p} />
);

export function Vazio({ texto }: { texto: string }) {
  return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{texto}</div>;
}

export function Titulo({
  titulo, subtitulo, acoes,
}: { titulo: string; subtitulo?: string; acoes?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
