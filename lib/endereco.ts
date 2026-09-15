// De onde sai "o endereço público deste CRM".
//
// A resposta é sempre o DOMÍNIO DO REQUEST. Não há variável de ambiente aqui, e
// isso é uma decisão: quando você está vendo crm.suaempresa.com, não faz sentido
// perguntar a um `.env` onde o CRM mora — o próprio request acabou de dizer. O
// `CRM_BASE_URL` que existia no lugar disto foi removido em 2026-09-11, porque
// em produção ele só podia repetir o que o request já trazia, e fora dela só
// tinha como estar errado (esquecido, apontando para um domínio antigo).
//
// Os dois usos precisam disto pelo mesmo motivo — montar uma URL absoluta que
// ALGUÉM DE FORA vai chamar:
//   · app/webhooks         → a URL de captação e o prompt de implementação
//   · /api/blogs/rss/workflow → o endereço que o n8n usa para chamar o CRM
//
// Os dois nascem de um request de navegador, então sempre há cabeçalho de onde
// tirar. Nenhum código que rode fora de um request (cron, script) pode usar
// isto — e nenhum precisa.

export type EnderecoCrm = {
  /** Sem barra no fim. Ex.: "https://crm.suaempresa.com.br" */
  url: string;
  /** false quando é localhost/rede local — não serve para entregar a ninguém. */
  publico: boolean;
  host: string;
};

function ehLocal(host: string) {
  return (
    !host ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/.test(host) ||
    /\.local(:|$)/.test(host) ||
    // Redes privadas: alcançáveis no escritório, não da internet.
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  );
}

/**
 * Monta o endereço a partir dos cabeçalhos do request.
 *
 * `x-forwarded-host` antes de `host`: atrás de proxy é ele que carrega o
 * domínio público, enquanto `host` pode ser o hostname interno do contêiner.
 *
 * CONFIAR NO CABEÇALHO é seguro nestes dois usos e não seria em qualquer um:
 * o valor só volta para quem já está logado, derivado do request que essa
 * mesma pessoa fez, e nada é decidido com ele — não vira link de recuperação
 * de senha nem redirect, que são os casos em que envenenar o `Host` machuca.
 */
export function enderecoDoCrm(cabecalhos: Headers): EnderecoCrm {
  const host = (
    cabecalhos.get("x-forwarded-host") ??
    cabecalhos.get("host") ??
    ""
  ).trim();

  const local = ehLocal(host);
  const proto = cabecalhos.get("x-forwarded-proto") ?? (local ? "http" : "https");

  return {
    url: `${proto}://${host || "localhost:3000"}`,
    publico: !local,
    host,
  };
}
