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
   mostra em qual está conectada. Sem login, aparecem **Abrir o CRM** e **Tentar de novo**.
5. No painel da extensão, clique em **Liberar microfone** uma vez.

O ID da extensão é fixo (`eohffkhganngbodiakbkccchdjndkjpf`), definido pela chave do `manifest.json`.
O CRM só aceita pedidos que venham desse ID (`lib/reunioes-extensao.ts`). Trocar a chave exige trocar o ID lá.
O ID não é senha: a chave está no repositório. Ele barra pedidos de páginas da web, e quem autentica é a sessão do CRM.

## Usar

1. Abra a reunião no Meet ou no Zoom do navegador (`app.zoom.us/wc/...` ou outro `*.zoom.us/wc/...`).
2. Clique no ícone da extensão ou use <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>. O painel lateral abre.
3. Avise os participantes que a reunião será gravada e transcrita. Marque a confirmação e clique em **Começar a gravar**.
   O ícone mostra **REC** enquanto grava. Se o painel disser **Falta um clique**, clique no ícone da extensão de novo,
   com a aba da reunião aberta: o Chrome só libera o áudio da aba por esse clique, e a gravação começa na hora.
4. O painel procura o lead pela reunião marcada no CRM. Quando não acha, lista as reuniões de hoje e uma busca de lead.
   Clicar numa reunião (ou num lead da busca) pede confirmação. Só depois de **Anexar** a gravação passa a usar a
   ficha desse lead. **Trocar** volta a mostrar a lista.
5. Quando o lead fala, o copiloto atualiza a **Condução** no máximo uma vez por minuto.
   **Analisar agora** força a atualização.
6. **Parar** encerra a gravação. Depois, escolha **Baixar gravação**, que salva em `Downloads/AmaanOffice`, ou **Descartar**.
7. **Gerar resumo** traz um rascunho. Revise, corrija e clique em **Salvar na ficha**: ele vira uma anotação no contato.

A gravação para sozinha:
- quando a aba da reunião fecha ou vai para outro endereço;
- depois de 15 minutos sem som da reunião, se ninguém clicar em **A reunião continua** em 2 minutos.
  No Meet e no Zoom, sair da chamada não muda o endereço, e sem isso o microfone continuaria gravando a sala;
- depois de 3 horas.

Uma fala do lead durante a espera de 1 minuto entre análises fica agendada para o fim dela.
**Parar** espera as últimas transcrições, para o fim da reunião entrar no resumo.

Ao compartilhar a tela, compartilhe **só a aba** da reunião. Com a janela ou a tela inteira, o lead vê o painel,
com a objeção e as sugestões.

## O que sai do computador

- **Áudio:** vai ao CRM em trechos de 15 s só para transcrever. A transcrição é feita pela Groq, e o áudio não fica guardado no servidor.
- **Texto:** a transcrição vai ao copiloto (Anthropic) com a ficha do lead. É isso que gera as sugestões e o resumo.
- **Arquivo da reunião:** fica só neste computador e só se você clicar em Baixar.
- **Na ficha:** só o resumo que você salvar.

## Limitações

- O Zoom de desktop não é capturado: o Chrome só grava o que toca numa aba dele.
- Use fone de ouvido. Sem fone, o microfone capta a voz do lead e ela aparece duas vezes na transcrição.
- O assistente exige o módulo **Agenda**. Ver e escolher o lead exige **Dashboard** ou **Contatos**.
  A conversa do WhatsApp do lead só entra na análise para quem tem o **Chat**.
- O painel escolhe entre o CRM de **Produção** e o **Local** (`localhost:3000`, o servidor de desenvolvimento).
  A escolha volta para Produção quando o navegador fecha.

## Verificar

- `node scripts/testar-extensao-reunioes.mjs` confere o service worker com um `chrome` falso:
  - os estados da reunião;
  - os comandos aceitos;
  - a parada automática.
- O áudio de verdade só se confere no Chrome, numa sala entre duas contas internas, com o CRM **Local**.
  É preciso ver que o painel fica "Pronta", o REC aparece na aba, Parar e Condução aparecem, o arquivo baixado toca
  e a anotação é salva num contato de teste.
