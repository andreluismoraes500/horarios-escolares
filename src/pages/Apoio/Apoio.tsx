// Página de apoio ao projeto: doação voluntária por PIX (chave + QR Code).

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Heart } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Titulo } from "@/components/ui";

const CHAVE_PIX = "eb076378-eef6-4504-8b12-713f19d1c510"; // chave aleatória
const NOME = "Horarios Escolares";
const CIDADE = "BRASIL";

const campo = (id: string, valor: string) => id + String(valor.length).padStart(2, "0") + valor;
function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
/** PIX "copia e cola" estático (sem valor): o doador digita quanto quiser. */
export function payloadPix(chave: string, nome: string, cidade: string): string {
  const base =
    campo("00", "01") +
    campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave)) +
    campo("52", "0000") + campo("53", "986") + campo("58", "BR") +
    campo("59", nome.slice(0, 25)) + campo("60", cidade.slice(0, 15)) +
    campo("62", campo("05", "***")) + "6304";
  return base + crc16(base);
}

export default function Apoio() {
  const copiaECola = payloadPix(CHAVE_PIX, NOME, CIDADE);
  const [qr, setQr] = useState("");
  const [copiado, setCopiado] = useState<"chave" | "codigo" | null>(null);

  useEffect(() => {
    QRCode.toDataURL(copiaECola, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(""));
  }, [copiaECola]);

  async function copiar(texto: string, qual: "chave" | "codigo") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
      toast.success(qual === "chave" ? "Chave PIX copiada. Obrigado pelo carinho!" : "Código PIX copiado. Obrigado pelo carinho!");
      setTimeout(() => setCopiado(null), 2500);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  }

  return (
    <>
      <Titulo titulo="Apoie o projeto" subtitulo="Este sistema é gratuito e feito com dedicação. Se ele ajuda a sua escola, considere contribuir." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="space-y-4 p-6 text-sm leading-relaxed">
          <div className="flex items-center gap-2 text-base font-semibold"><Heart className="h-5 w-5 text-destructive" />Obrigado por usar o Horários Escolares</div>
          <p>
            Montar a grade de uma escola é um trabalho que consome dias de planilhas, conflitos e remendos. O objetivo deste projeto é
            devolver esse tempo para quem cuida de educação: horários flexíveis, gerador automático, aulas conjuntas, relatórios prontos
            para imprimir e muito mais, tudo funcionando no seu computador, com os dados sob o seu controle.
          </p>
          <p>
            O programa é e continuará sendo <b>gratuito</b>, e usá-lo não exige nenhuma contribuição. Mas manter, corrigir e criar novidades
            leva tempo, estudo e café. Se ele facilitou a sua rotina e você quiser retribuir, qualquer valor ajuda a manter o projeto vivo,
            pagar as ferramentas de publicação e dedicar mais horas às próximas versões.
          </p>
          <p>Algumas ideias que as doações ajudam a tornar realidade:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>novos recursos pedidos pelos usuários (importação de planilhas, mais relatórios, mais regras para os professores);</li>
            <li>correções rápidas e atualizações automáticas sem custo;</li>
            <li>manual e vídeos de apoio para quem está começando.</li>
          </ul>
          <p className="text-muted-foreground">
            Não pode contribuir agora? Sem problema: indicar o sistema para outra escola e mandar sugestões também ajudam muito. 💙
          </p>
        </Card>

        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-sm font-medium">Doe via PIX</div>
          {qr ? <img src={qr} alt="QR Code PIX para doação" className="h-56 w-56 rounded-md border bg-white p-1" /> : <div className="h-56 w-56 rounded-md border" />}
          <p className="text-xs text-muted-foreground">Abra o app do seu banco, escolha PIX → Ler QR Code e informe o valor que desejar.</p>
          <div className="w-full">
            <div className="mb-1 text-left text-xs text-muted-foreground">Chave PIX (aleatória)</div>
            <div className="rounded-md border bg-muted/40 p-2 font-mono text-xs break-all select-all">{CHAVE_PIX}</div>
          </div>
          <Button className="w-full" onClick={() => void copiar(CHAVE_PIX, "chave")}>
            {copiado === "chave" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}Copiar chave PIX
          </Button>
          <Button variant="outline" className="w-full" onClick={() => void copiar(copiaECola, "codigo")}>
            {copiado === "codigo" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}Copiar "PIX copia e cola"
          </Button>
          <p className="text-[11px] text-muted-foreground">Confira o nome do recebedor no seu banco antes de confirmar.</p>
        </Card>
      </div>
    </>
  );
}
