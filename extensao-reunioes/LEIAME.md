# AmaanOffice · Reuniões (extensão do Chrome)

Grava a reunião do Google Meet ou do Zoom pelo navegador e transcreve o que é dito.
Mostra quem é o lead e, quando ele levanta uma objeção, sugere como conduzir a conversa.
No fim, gera um resumo que o vendedor revisa e salva como anotação na ficha do lead.

## Instalar

1. No Chrome, abra `chrome://extensions` e ligue o **Modo do desenvolvedor**, no canto de cima.
2. Clique em **Carregar sem compactação** e escolha esta pasta (`extensao-reunioes`).
3. Fixe o ícone da extensão na barra.
4. Entre no AmaanOffice neste mesmo navegador, por `amaanoffice.amaan.com.br` ou por `chromacrm.vercel.app`.
   A extensão usa a sessão do CRM e não tem senha própria. Ela procura o login nos dois endereços, e o topo do painel
   mostra em qual está conectada. Sem login, aparecem **Entrar no AmaanOffice** e **Tentar de novo**.
5. No painel da extensão, clique em **Liberar o microfone** uma vez.

O ID da extensão é fixo (`eohffkhganngbodiakbkccchdjndkjpf`), definido pela chave do `manifest.json`.
O CRM só aceita pedidos que venham desse ID (`lib/reunioes-extensao.ts`). Trocar a chave exige trocar o ID lá.
O ID não é senha: a chave está no repositório. Ele barra pedidos de páginas da web, e quem autentica é a sessão do CRM.

## Usar

1. Abra a reunião no Meet ou no Zoom do navegador (`app.zoom.us/wc/...` ou outro `*.zoom.us/wc/...`).
2. Clique no ícone da extensão ou use <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>. O painel lateral abre.
3. **Reunião:** o painel traz do CRM as reuniões marcadas para hoje, com a hora, o nome do lead e o selo **agora** ou
   **em 20 min**. Quando o link do Meet casa com uma reunião do CRM, ela já vem anexada. Senão, clique na reunião e em
   **Anexar**: só então a gravação passa a usar a ficha desse lead. **Trocar** volta a mostrar a lista, e o botão de
   atualizar busca de novo. Não há busca livre: a gravação se anexa a uma reunião marcada.
4. Avise os participantes que a reunião será gravada e transcrita e clique em **Gravar**. A hora do clique fica
   guardada como a hora do aviso. Com o painel aberto por outra aba, o Gravar grava a reunião aberta na janela.
   O ícone mostra **REC** enquanto grava. Se o painel disser **Falta um clique**, clique no ícone da extensão
   com a aba da reunião aberta: o Chrome só libera o áudio da aba por esse clique, e a gravação começa na hora.
5. **Transcrição:** o que é dito aparece em balões, o lead à esquerda e você à direita, logo depois de cada frase.
   O áudio é cortado na pausa da fala, e os três pontos (**…**) mostram o trecho sendo transcrito.
6. **Sugestão:** quando o lead fala, o copiloto analisa a conversa no máximo a cada 20 segundos. Se a análise traz
   algo novo a fazer, ela aparece num card preto com brilho azul por cima do painel, com a objeção, o que dizer e o
   próximo passo. O card some sozinho em 25 segundos (o mouse em cima segura), no ✕ ou no <kbd>Esc</kbd>, e a mesma
   sugestão continua no cartão **Condução**. **Analisar agora** força a análise e reabre o card.
7. **Parar** encerra a gravação. Depois, escolha **Baixar**, que salva em `Downloads/AmaanOffice`, ou **Descartar**.
8. **Gerar resumo** traz um rascunho. Revise, corrija e clique em **Salvar na ficha do lead**: ele vira uma anotação no contato.

A gravação para sozinha:
- quando a aba da reunião fecha ou vai para outro endereço;
- depois de 15 minutos sem som da reunião, se ninguém clicar em **A reunião continua** em 2 minutos.
  No Meet e no Zoom, sair da chamada não muda o endereço, e sem isso o microfone continuaria gravando a sala;
- depois de 3 horas.

Uma fala do lead durante a espera de 20 segundos entre análises fica agendada para o fim dela.
**Parar** espera as últimas transcrições, para o fim da reunião entrar no resumo.

Ao compartilhar a tela, compartilhe **só a aba** da reunião. Com a janela ou a tela inteira, o lead vê o painel,
com a objeção e as sugestões. Por isso o card de sugestão fica no painel, e não na página do Meet.

## O que sai do computador

- **Áudio:** vai ao CRM em trechos de 4 a 12 s, cortados na pausa da fala, só para transcrever. Trecho em silêncio não sai. A transcrição é feita pela Groq, e o áudio não fica guardado no servidor.
- **Texto:** a transcrição vai ao copiloto (Anthropic) com a ficha do lead. É isso que gera as sugestões e o resumo.
- **Arquivo da reunião:** fica só neste computador e só se você clicar em Baixar.
- **Na ficha:** só o resumo que você salvar.

## Limitações

- O Zoom de desktop não é capturado: o Chrome só grava o que toca numa aba dele.
- Use fone de ouvido. Sem fone, o microfone capta a voz do lead e ela aparece duas vezes na transcrição.
- O assistente exige o módulo **Agenda**. Ver e escolher o lead exige **Dashboard** ou **Contatos**.
  A conversa do WhatsApp do lead só entra na análise para quem tem o **Chat**.
- O painel fala com o CRM de **Produção**. Para desenvolver contra o **Local** (`localhost:3000`), rode no console do
  painel `chrome.storage.session.set({ crm: "local" })` e reabra o painel. A escolha volta para Produção quando o
  navegador fecha.

## Verificar

- `node scripts/testar-extensao-reunioes.mjs` confere o service worker com um `chrome` falso:
  - os estados da reunião;
  - os comandos aceitos;
  - a parada automática.
- O áudio de verdade só se confere no Chrome, numa sala entre duas contas internas, com o CRM **Local**.
  É preciso ver que o painel fica "Pronta", o REC aparece na aba, Parar e Condução aparecem, as frases chegam logo
  depois de ditas, o card de sugestão aparece quando o lead levanta uma objeção, o arquivo baixado toca e a anotação
  é salva num contato de teste.
