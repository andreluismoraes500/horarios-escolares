import { toast } from "sonner";

/** Executa uma ação assíncrona mostrando toast de sucesso/erro. Retorna true se deu certo. */
export async function executar(fn: () => Promise<unknown>, sucesso?: string): Promise<boolean> {
  try {
    await fn();
    if (sucesso) toast.success(sucesso);
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}
