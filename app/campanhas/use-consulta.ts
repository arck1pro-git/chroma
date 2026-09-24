"use client";

import { useCallback, useEffect, useState } from "react";

export async function consultar<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { cache: "no-store", ...init });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível carregar os dados.");
  return dados as T;
}

export function useConsulta<T>(url: string | null) {
  const [estado, setEstado] = useState<{ url: string | null; dados: T | null; erro: string; carregando: boolean }>({ url, dados: null, erro: "", carregando: Boolean(url) });
  const [versao, setVersao] = useState(0);
  const atualizar = useCallback(async () => { setEstado(e => ({ ...e, carregando: true, erro: "" })); setVersao(v => v + 1); }, []);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    consultar<T>(url, { signal: controller.signal }).then(
      dados => { if (!controller.signal.aborted) setEstado({ url, dados, erro: "", carregando: false }); },
      erro => { if (!controller.signal.aborted) setEstado({ url, dados: null, erro: erro instanceof Error ? erro.message : "Falha na consulta.", carregando: false }); },
    );
    return () => controller.abort();
  }, [url, versao]);
  return { dados: estado.url === url ? estado.dados : null, erro: estado.url === url ? estado.erro : "", carregando: Boolean(url) && (estado.url !== url || estado.carregando), atualizar };
}
