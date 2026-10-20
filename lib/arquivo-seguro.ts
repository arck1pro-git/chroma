// Os cabeçalhos de um arquivo servido pelo CRM (2026-10-20, auditoria de
// segurança). Anexo de WhatsApp e documento da biblioteca vinham "inline", com
// o tipo que o REMETENTE declarou: um `proposta.html` (ou `.svg`) mandado por
// qualquer pessoa para o número da empresa abria no domínio do CRM e rodava
// script com a sessão de quem clicou. XSS armazenado, sem login nem segredo.
//
// A regra agora: só abre no navegador o que é inofensivo de abrir (imagem que
// não é SVG, áudio, vídeo, PDF). Todo o resto vai como DOWNLOAD, com `sandbox`
// por cima — mesmo que alguém o abra, não roda script nem fala com a origem.
// `nosniff` em tudo, para o navegador não "adivinhar" HTML num arquivo que diz
// ser outra coisa.
const ABRE_NO_NAVEGADOR =
  /^(image\/(jpeg|pjpeg|png|gif|webp|avif|heic|heif|bmp)|audio\/[\w.+-]+|video\/(mp4|webm|ogg|quicktime|3gpp|x-m4v)|application\/pdf)$/i;

export function cabecalhosDeArquivo(o: {
  mime: string | null | undefined;
  nome: string;
  tamanho: number;
  /** Forçar o "salvar como" mesmo para o que abriria. */
  baixar?: boolean;
  cache?: string;
}): Record<string, string> {
  const mime = (o.mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const abre = !o.baixar && ABRE_NO_NAVEGADOR.test(mime);
  // Nome sem aspas, barras e caracteres de controle (quebra de linha no nome
  // viraria um cabeçalho a mais); o UTF-8 vai no filename*.
  const nome = o.nome.replace(/["\\\r\n\u0000-\u001f]/g, "").slice(0, 180) || "arquivo";
  return {
    "content-type": mime,
    "content-length": String(o.tamanho),
    "content-disposition": `${abre ? "inline" : "attachment"}; filename="${nome.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    "x-content-type-options": "nosniff",
    ...(abre ? {} : { "content-security-policy": "sandbox; default-src 'none'" }),
    "cache-control": o.cache ?? "private, max-age=31536000, immutable",
  };
}
