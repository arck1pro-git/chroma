# Filtro de origem no dashboard

O filtro combina campanha, conjunto e anúncio com os demais filtros do quadro.
Os totais e métricas usam as oportunidades visíveis. Clicar novamente na seleção
remove aquele nível; trocar a campanha limpa conjunto e anúncio. Desmarcar a
campanha remove o filtro de origem e preserva os outros filtros.

A atribuição usa os campos personalizados da oportunidade. Na ausência de
campanha na oportunidade, usa a origem do contato. Não combina atribuições de
captações diferentes e não inclui leads sem origem correspondente.

| Nível | IDs (prioridade) | Nomes ou IDs nos campos alternativos |
| --- | --- | --- |
| Campanha | `campaign_id`, `campanha_id`, `utm_id` | `campaign_name`, `utm_campaign` |
| Conjunto | `adset_id`, `conjunto_id` | `adset_name`, `utm_term` |
| Anúncio | `ad_id`, `anuncio_id` | `ad_name`, `utm_content` |

A comparação é exata, removendo espaços nas extremidades dos valores gravados.
IDs explícitos prevalecem sobre nomes, mas só valem se forem número (`idDaMeta`
em `lib/meta-ads-calculos.ts`). Para UTMs, a convenção adotada é
`utm_campaign` para campanha, `utm_term` para conjunto e `utm_content` para anúncio.
Os webhooks devem mapear esses valores para os campos personalizados do contato
ou da oportunidade.

Parâmetros automáticos de URL da Meta (a conta ARCK1PRO usa desde outubro de
2026): `utm_campaign`, `utm_term` e `utm_content` chegam com os IDs de campanha,
conjunto e anúncio, e casam pelo ID na coluna da direita. O `utm_id` chega como
`<conjunto>_v2_s04_i…`, que não é ID de campanha, e por isso é ignorado. Até
2026-10-26 ele passava na frente do `utm_campaign` e o lead ficava sem campanha.

Na entrada, a captação grava `campaign_id` no lead consultando a Meta
(`lib/campanha-do-lead.ts`). Para leads antigos, use
`scripts/carimbar-campanhas.ts`, que primeiro só mostra o que faria.

Os conjuntos e anúncios são consultados no cadastro da Meta, sem depender de
veiculação nos últimos 30 dias.

Validação: `node scripts/jiti.mjs scripts/testar-filtro-campanhas.ts`.
