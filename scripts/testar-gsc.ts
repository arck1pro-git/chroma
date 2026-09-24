// Confere, contra a API de verdade, que a credencial de serviço abre o Search
// Console — e mostra o que volta para a propriedade pedida. Sem navegador.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-gsc.ts [amaan.com.br]
//
// Pelo runner e não pelo jiti-cli direto: lib/ usa o alias "@/" e importa
// "server-only", e é scripts/jiti.mjs que ensina os dois ao jiti.
import { propriedades, consultar, inspecionar } from "../lib/search-console";

// "YYYY-MM-DD" de N dias atrás. O Search Console atrasa de 2 a 3 dias, então
// a janela padrão termina anteontem — pedir até hoje só traz linha vazia.
function dia(atras: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - atras);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const alvo = process.argv[2] ?? "amaan.com.br";

  console.log("→ propriedades visíveis para a service account:");
  const lista = await propriedades();
  if (lista.length === 0) {
    console.log(
      "  (nenhuma) — o e-mail da service account não foi adicionado como\n" +
        "  usuário em nenhuma propriedade do Search Console.",
    );
    return;
  }
  for (const p of lista) console.log(`  ${p.siteUrl}  [${p.permissao}]`);

  // A propriedade pode estar cadastrada como domínio ou como prefixo de URL —
  // aceitar as duas evita ter que saber de antemão qual delas o cliente criou.
  const achada = lista.find((p) => p.siteUrl.includes(alvo));
  if (!achada) {
    console.log(`\n✗ "${alvo}" não está na lista acima.`);
    return;
  }
  console.log(`\n→ usando ${achada.siteUrl}`);

  const linhas = await consultar(achada.siteUrl, {
    inicio: dia(30),
    fim: dia(3),
    dimensoes: ["page"],
    limite: 15,
  });

  console.log(`\n→ páginas com clique/impressão nos últimos 28 dias (${linhas.length}):`);
  for (const l of linhas) {
    console.log(
      `  ${l.cliques} cliques · ${l.impressoes} impr · ` +
        `CTR ${(l.ctr * 100).toFixed(1)}% · pos ${l.posicao.toFixed(1)}  ${l.chaves[0]}`,
    );
  }

  const url = achada.siteUrl.startsWith("sc-domain:")
    ? `https://${alvo}/`
    : achada.siteUrl;
  console.log(`\n→ indexação de ${url}:`);
  console.log(await inspecionar(achada.siteUrl, url));
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
