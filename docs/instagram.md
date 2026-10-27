# Canal de Instagram no chat

Desde 2026-10-26. As três contas de `lib/social/perfis.ts` (@fabhricioari, @amaanincorporadora, @arck1pro)
aparecem no trilho do `/chat`, cada uma com duas abas:

- **Direct:** as DMs. Cada pessoa vira uma conversa comum (`atendimentos.canal = 'instagram'`,
  `numero_instancia` = id da conta). Só texto, com janela de 24 h desde a última mensagem dela.
- **Comentários:** as postagens recentes da conta, lidas da Graph API e sem cópia no banco, e os comentários de
  cada uma em thread. Os comentários ficam em `instagram_comentarios`.

## Entrada

`POST /api/meta/instagram/webhook` (`app/api/meta/instagram/webhook/route.ts`, processamento em
`lib/instagram-webhook.ts`).

- A tranca é a assinatura `X-Hub-Signature-256` com `META_APP_SECRET` (`lib/meta-assinatura.ts`).
- O GET verifica com `META_WEBHOOK_VERIFY_TOKEN`.
- Só aceita `object=instagram` e contas de `PERFIS`; o resto responde 200 e é ignorado.
- Eventos inválidos ou ignorados recebem 200. Falha de persistência recebe 503 para a Meta reenviar.
  Em lote parcial, o trabalho dos itens já gravados é preservado; a reentrega não duplica esses inserts.
  O corpo nunca vai ao log. O processamento posterior (`after`) ainda não é uma fila durável.
- DM e comentário são idempotentes pelo id da Meta.
- O eco de mensagem enviada pela própria conta casa pelo `mid` com o envio pendente; sem casar, vira
  `enviada_por = 'aparelho'`.
- Identidade da pessoa: o IGSID, em `contatos.campos.instagram_id`, com índice único. O @ fica em
  `campos.instagram_usuario` e é só exibição.
- O contato só nasce quando há direct. Quem só comentou fica na linha do comentário.

## Saída

- Todo envio sai pelo ponto único de `lib/instagram.ts`: direct, resposta pública e direct a partir de comentário.
- O texto vai no corpo do POST. Ids da Meta só numéricos. Token de página só para as páginas de `PERFIS`.
- `lib/conversa-envio.ts` escolhe o caminho por canal. O Instagram não tem áudio, documento nem template.
- **Trava de desenvolvimento:** fora de `VERCEL_ENV=production`, nada sai para o Instagram, salvo direct para os
  IGSIDs de `INSTAGRAM_SO_PARA`. Resposta pública nunca sai fora da produção. Nunca criar essa variável na Vercel.

## IA

### Automações no Chat

Em **Comentários → Criar automação/Editar**, configure uma regra para a conta ou para uma publicação.
A regra da publicação substitui a regra da conta, inclusive quando desligada.

- **Mensagem pronta:** informe uma ou várias palavras/expressões alternativas e a mensagem do Direct
  (até 1.000 caracteres, com link para o material). A resposta pública é opcional.
  Pode entregar o material sem IA ou selecionar uma IA para continuar quando a pessoa responder no Direct.
- **IA:** seleciona uma frase pública aprovada, abre o Direct e segue com a IA escolhida.
  Palavras são opcionais; sem palavras, avalia todos os comentários elegíveis.
- Basta uma expressão inteira corresponder, sem distinguir maiúsculas ou acentos. “material” não casa com “materialista”.
- **Salvar desligada** guarda a configuração. **Salvar e ativar** autoriza os próximos disparos;
  não processa comentários antigos. **Desligar** preserva os textos e as palavras.
- Uma entrega por pessoa por publicação, com as mesmas reservas, teto e proteção de atendimento humano.
  A IA só assume contatos sem definição anterior; respeita IA desligada e atendimento humano.
- O envio do material ocorre antes da resposta pública. Mensagem pronta não chama o modelo.

Persistência: `instagram_ia_regras.automacao` (JSON), criada por `migration-instagram-automacoes.sql`.
Aplicar depois de `migration-instagram.sql`, antes do deploy. Regras antigas continuam com o modo IA.
Recebimento depende da assinatura do Instagram na Meta; criar uma regra não altera o app externo.

- **Direct:** a mesma IA de atendimento do WhatsApp (`lib/ia/atendente.ts`), com as mesmas travas.
  - Contato novo do Instagram nasce sem IA (`ia = NULL`, sem etapa), então ela não responde por padrão.
  - No prompt, o texto e o nome do contato do Instagram entram marcados como dado (`comoDado`).
- **Comentários** (`lib/ia/comentarios.ts`): só com regra ligada em `instagram_ia_regras`, por conta ou por
  postagem; a da postagem vence.
  - A resposta pública é uma frase FIXA aprovada; o modelo só escolhe qual, ou decide não responder.
  - A abertura do direct passa por filtro de saída.
  - Só comentário raiz, novo e recente (10 min, conferido também pela hora que a Meta devolve).
  - Nunca responde a nossas contas, a comentário com link, menção ou só emoji, a comentário oculto, nem em anúncio
    pela regra da conta.
  - Uma resposta pública por pessoa por postagem, com reserva antes de chamar o modelo e teto por conta por hora.
  - Não responde quem a equipe tirou da IA nem conversa em atendimento humano.
- Reunião marcada e pedido de atendente vindos do Instagram avisam a equipe por **demanda**, não por WhatsApp.

## Permissão

- Ver comentários, carregar anteriores, buscar na Meta e marcar os itens exibidos como lidos: módulo `chat`.
- Enviar mensagens no WhatsApp/Direct e chamar um comentarista no Direct: **Criar** em `chat`.
- Responder em público: **Criar** em `chat` e **Criar** em `meta`.
- Configurar a IA de comentários: **Editar** em `chat` e **Editar** em `meta`.
- A tela acompanha as mesmas regras; cada ação confere novamente no servidor.

## Leitura e demonstração

- A thread carrega 100 comentários por página, incluindo os ancestrais necessários para entender as respostas.
  **Carregar comentários anteriores** busca o restante sem perder o ponto da rolagem.
- Abrir marca como lidos somente os comentários carregados, não a postagem inteira.
- **Buscar comentários** percorre a paginação da Meta, tanto das raízes quanto das respostas; não chama a IA.
- O Direct a partir de comentário avisa quando o prazo de 7 dias terminou, a identidade está ausente ou a
  pessoa já foi chamada pela mesma postagem. Quando há conversa, ela pode ser aberta para continuar por lá.
- Trocar de conversa isola o compositor; durante envio de comentário, alvo e texto ficam bloqueados. Falhas
  mostram erro e preservam o rascunho. O polling reconcilia também as mensagens chegadas antes da primeira consulta.
- Em desenvolvimento, `/chat?demo=1` inclui WhatsApp e três contas Instagram com postagens, comentários e DMs
  inteiramente fictícios. Nenhuma ação de envio é executada na demonstração.

## Produção (cada passo com o OK do usuário)

1. Conferir que não há `campos.instagram_id` repetido em `contatos`. Senão, o índice único da migration falha.
2. Rodar `migration-instagram.sql` **antes** do deploy (Postgres 15+, por causa do `NULLS NOT DISTINCT`).
3. Deploy.
4. Em cada conta do Instagram: Configurações → Mensagens → Ferramentas conectadas → permitir acesso a mensagens.
5. Assinar o objeto `instagram` no app da Meta, pela função `inscreverInstagramNoApp()` de
   `lib/instagram-inscricao.ts`.
   - Ela recusa se o objeto já aponta para outro callback.
   - Não mexe nas assinaturas page e whatsapp, nem instala o app em página.
   - O app é compartilhado com o WhatsApp oficial e os leads.
6. A IA de comentários nasce desligada. Admin ou TI ligam por conta ou por postagem na tela.
   - Já existe outro robô respondendo essas contas: conferir antes de ligar, senão os dois respondem.

Verificação: `node --env-file=.env scripts/jiti.mjs scripts/testar-instagram.ts`.

Sem banco nem contas reais: `node --test scripts/testar-chat-ui.mjs scripts/testar-instagram-webhook.mjs`.
