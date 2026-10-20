// A peneira de SSRF única do CRM (2026-10-20, auditoria de segurança).
//
// Onde o servidor busca um endereço que veio de fora — mídia de post pelo MCP,
// feed RSS do blog, base_url da instância uazapi — ele não pode ser levado a
// chamar a rede interna (localhost, metadados da nuvem em 169.254.169.254,
// 10.x/192.168.x). Cada lugar tinha a sua conferência (ou nenhuma); a das
// mídias deixava passar IPv6 com IPv4 em hexa (`[::ffff:7f00:1]`) e faixas como
// 198.18/15 e 224/4. Esta usa a BlockList do próprio Node, com as faixas
// reservadas da IANA.
//
// O que NÃO resolve: o DNS é consultado de novo no fetch (rebinding). Exigir
// https com certificado válido já torna isso quase inviável na prática.
import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const internos = new BlockList();
for (const [rede, prefixo] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) internos.addSubnet(rede, prefixo, "ipv4");
for (const [rede, prefixo] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) internos.addSubnet(rede, prefixo, "ipv6");

/** O IP é de rede interna, reservada ou não roteável? Texto que não é IP conta como interno. */
export function ipInterno(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, "");
  const versao = isIP(limpo);
  if (versao === 4) return internos.check(limpo, "ipv4");
  if (versao === 6) {
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(limpo);
    return mapeado ? internos.check(mapeado[1], "ipv4") : internos.check(limpo, "ipv6");
  }
  return true;
}

export class EnderecoRecusado extends Error {}

/**
 * Confere que o endereço é público ANTES de o servidor buscá-lo: esquema,
 * nome e todos os IPs para os quais o nome resolve. Devolve a URL já lida.
 */
export async function urlExternaSegura(bruto: string, opcoes: { exigirHttps?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    throw new EnderecoRecusado(`Link inválido: ${bruto.slice(0, 120)}`);
  }
  const esquemas = opcoes.exigirHttps === false ? ["https:", "http:"] : ["https:"];
  if (!esquemas.includes(url.protocol)) {
    throw new EnderecoRecusado(`O link precisa ser ${esquemas.join(" ou ").replace(/:/g, "")}: ${url.href.slice(0, 120)}`);
  }
  if (url.username || url.password) throw new EnderecoRecusado("Link com usuário e senha embutidos não é aceito.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) {
    throw new EnderecoRecusado(`Endereço interno não é aceito: ${host}`);
  }
  const enderecos = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((e) => e.address);
  if (enderecos.length === 0) throw new EnderecoRecusado(`Não encontrei o endereço ${host}.`);
  if (enderecos.some(ipInterno)) throw new EnderecoRecusado(`Endereço interno não é aceito: ${host}`);
  return url;
}
