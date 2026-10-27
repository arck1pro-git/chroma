import type { AutomacaoComentarioInstagram } from "./instagram-tipos";

export const AUTOMACAO_COMENTARIO_PADRAO: AutomacaoComentarioInstagram = {
  modo: "ia", palavras: [], mensagemDirect: "", respostaPublica: "", continuarComIa: true,
};

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Qualquer palavra ou expressão inteira; não dispara “oi” dentro de “coisa”. */
export function correspondeAoComentario(texto: string, palavras: string[]): boolean {
  const comentario = ` ${normalizar(texto)} `;
  return palavras.length === 0 || palavras.some((palavra) => {
    const termo = normalizar(palavra);
    return termo.length > 0 && comentario.includes(` ${termo} `);
  });
}

/** JSON legado vazio equivale à IA existente. Entrada de gravação é validada separadamente. */
export function automacaoDoRegistro(valor: Partial<AutomacaoComentarioInstagram> | null | undefined): AutomacaoComentarioInstagram {
  return { ...AUTOMACAO_COMENTARIO_PADRAO, ...valor };
}

export function validarAutomacaoComentario(valor: unknown): AutomacaoComentarioInstagram {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Error("Automação inválida.");
  const v = valor as Record<string, unknown>;
  if (v.modo !== "ia" && v.modo !== "mensagem") throw new Error("Escolha o tipo da automação.");
  if (!Array.isArray(v.palavras) || v.palavras.length > 30 ||
      v.palavras.some((p) => typeof p !== "string" || !normalizar(p) || p.length > 80)) {
    throw new Error("Use até 30 palavras ou expressões, com até 80 caracteres cada.");
  }
  if (typeof v.mensagemDirect !== "string" || v.mensagemDirect.length > 1000 ||
      typeof v.respostaPublica !== "string" || v.respostaPublica.length > 2200 ||
      typeof v.continuarComIa !== "boolean") throw new Error("Textos ou configuração da automação inválidos.");
  const palavras = [...new Map(v.palavras.map((p: string) => [normalizar(p), p.trim()])).values()];
  if (v.modo === "mensagem" && (!palavras.length || !v.mensagemDirect.trim())) {
    throw new Error("Informe pelo menos uma palavra e a mensagem que será enviada no Direct.");
  }
  return { modo: v.modo, palavras, mensagemDirect: v.mensagemDirect.trim(),
    respostaPublica: v.respostaPublica.trim(), continuarComIa: v.modo === "ia" || v.continuarComIa };
}
