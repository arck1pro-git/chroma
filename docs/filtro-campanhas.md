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
IDs explícitos prevalecem sobre nomes. Para UTMs, a convenção adotada é
`utm_campaign` para campanha, `utm_term` para conjunto e `utm_content` para anúncio.
Os webhooks devem mapear esses valores para os campos personalizados do contato
ou da oportunidade; consultar a Meta não preenche retroativamente a origem dos leads.

Os conjuntos e anúncios são consultados no cadastro da Meta, sem depender de
veiculação nos últimos 30 dias.

Validação: `node scripts/jiti.mjs scripts/testar-filtro-campanhas.ts`.
