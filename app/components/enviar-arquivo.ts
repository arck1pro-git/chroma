// O envio direto do navegador para o Storage, na URL que o servidor assinou
// (lib/armazenamento.ts, urlDeEnvio). Usado pelos vídeos, pelos documentos da
// biblioteca e pelos anexos de demandas: nenhum desses bytes passa pelo CRM,
// porque a Vercel corta o corpo da requisição em ~4,5 MB.
//
// PUT simples com o arquivo no corpo. O Content-Type tem que ser o MESMO mime que
// foi para a assinatura, e o tamanho, o mesmo que o servidor aprovou: o Storage
// recusa com 403 qualquer diferença. XMLHttpRequest e não fetch por causa da
// barra de progresso dos vídeos (fetch não informa o progresso do envio).

/** Sobe o arquivo; `aoProgredir` recebe de 0 a 1. Rejeita com o motivo em português. */
export function enviarArquivo(
  url: string,
  arquivo: Blob,
  mime: string,
  aoProgredir?: (fracao: number) => void,
): Promise<void> {
  return new Promise((pronto, falhou) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 300) return pronto();
      // O S3 responde XML; o <Message> é o que diz alguma coisa.
      const motivo = /<Message>([^<]*)<\/Message>/.exec(xhr.responseText)?.[1];
      falhou(new Error(xhr.status === 403 ? "o link de envio expirou ou o arquivo mudou; tente de novo" : motivo || `erro ${xhr.status}`));
    };
    xhr.onerror = () => falhou(new Error("a conexão caiu no meio do envio"));
    xhr.send(arquivo);
  });
}
