/** Lê uma imagem, reduz para no máximo `max` px e devolve um data URL PNG (mantém o banco leve). */
export function lerImagemReduzida(arquivo: File, max = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!arquivo.type.startsWith("image/")) return reject(new Error("Escolha um arquivo de imagem (PNG, JPG, SVG…)."));
    const rd = new FileReader();
    rd.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    rd.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida."));
      img.onload = () => {
        const esc = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * esc));
        const h = Math.max(1, Math.round(img.height * esc));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.src = String(rd.result);
    };
    rd.readAsDataURL(arquivo);
  });
}
