// Dados de exemplo do módulo E-mails, que ainda não tem tabela no banco.
//
// SOBROU DO MOCK de app/data.ts (removido em 2026-10-21): era o único trecho
// dele que alguma tela ainda lia. Quando o módulo ganhar tabela, este arquivo
// sai e a lista vem de uma consulta — a tela já recebe `Email[]`.
import type { Usuario } from "@/lib/entidades";

// ⚠ Tabela inteira ausente do schema — nenhuma coluna destas existe no banco.
// Modelei pelo que a tela do módulo precisa mostrar e nada além disso; a
// modelagem de verdade (quem envia, pra quem, quando, o que aconteceu com cada
// envio) é sua. Os buracos que já vejo daqui:
//   · não há envio: isto guarda o e-mail escrito, não o disparo. Destinatário,
//     data de envio, abertura e clique não têm onde morar.
//   · `status` aqui é só rascunho/pronto. Se um dia enviar, vira máquina de
//     estados e provavelmente tabela própria de envios.
//   · html é o corpo inteiro em text. Funciona, mas não dá pra buscar dentro.
export type Email = {
  id: string;
  nome: string; // rótulo interno, não sai no e-mail
  assunto: string;
  remetente: string;
  html: string;
  status: "rascunho" | "pronto";
  autor_id: string;
  data_criacao: string;
  data_atualizacao: string | null;
};

// Autores dos e-mails de exemplo. Não são as contas reais de `usuarios`.
const usuarios: Usuario[] = [
  { id: "u-fa", nome: "Fabrício", iniciais: "FA" },
  { id: "u-rs", nome: "Renan Sampaio", iniciais: "RS" },
  { id: "u-cl", nome: "Carla Lemos", iniciais: "CL" },
  { id: "u-am", nome: "Alice Moura", iniciais: "AM" },
  { id: "u-jp", nome: "João Pedro Rocha", iniciais: "JP" },
  { id: "u-mk", nome: "Marina Klein", iniciais: "MK" },
  { id: "u-tl", nome: "Thiago Lins", iniciais: "TL" },
  { id: "u-dn", nome: "Daniela Nunes", iniciais: "DN" },
];

// HTML de e-mail é feio por obrigação: tabela, style inline e largura fixa. É o
// que Gmail e Outlook renderizam igual — flex e <style> no topo, não.
export const emails: Email[] = [
  {
    id: "e-boas-vindas",
    nome: "Boas-vindas · trial",
    assunto: "Bem-vindo ao AmaanOffice, {{nome}}",
    remetente: "AmaanOffice <ola@amaan.com.br>",
    status: "pronto",
    autor_id: "u-mk",
    data_criacao: "2026-06-02T10:00:00Z",
    data_atualizacao: "2026-07-08T14:30:00Z",
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 0">
            <h1 style="margin:0;font-size:24px;color:#18181b">Bem-vindo ao AmaanOffice</h1>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#52525b">
              Olá {{nome}}, sua conta está no ar. Você tem 14 dias para testar tudo —
              funil, contatos e automações — sem cartão.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 40px">
            <a href="https://app.chroma.com.br/funil"
               style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;
                      padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
              Abrir meu funil
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-proposta",
    nome: "Follow-up de proposta",
    assunto: "Sobre a proposta que enviamos",
    remetente: "Renan Sampaio <renan@amaan.com.br>",
    status: "pronto",
    autor_id: "u-rs",
    data_criacao: "2026-06-19T09:20:00Z",
    data_atualizacao: null,
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 40px">
            <p style="margin:0;font-size:15px;line-height:24px;color:#3f3f46">
              Oi {{nome}}, tudo bem?
            </p>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#3f3f46">
              Passando para saber se a proposta chegou e se ficou alguma dúvida sobre
              prazo ou escopo. Qualquer ajuste, é só responder este e-mail.
            </p>
            <hr style="border:0;border-top:1px solid #e4e4e7;margin:28px 0" />
            <p style="margin:0;font-size:13px;color:#a1a1aa">
              Renan Sampaio · AmaanOffice
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-evento",
    nome: "Convite · Construir 2026",
    assunto: "Te esperamos no Construir 2026 (estande 42)",
    remetente: "AmaanOffice Eventos <eventos@amaan.com.br>",
    status: "rascunho",
    autor_id: "u-jp",
    data_criacao: "2026-07-05T16:45:00Z",
    data_atualizacao: "2026-07-14T11:10:00Z",
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;padding:40px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:0 40px">
            <h1 style="margin:0;font-size:32px;color:#fafafa;letter-spacing:-0.5px">
              Construir 2026
            </h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:24px;color:#a1a1aa">
              18 a 20 de agosto · São Paulo Expo · Estande 42
            </p>
            <a href="https://chroma.com.br/construir"
               style="display:inline-block;margin-top:28px;background:#fafafa;color:#18181b;
                      text-decoration:none;padding:12px 28px;border-radius:999px;
                      font-size:14px;font-weight:600">
              Garantir meu ingresso
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
  {
    id: "e-reengajar",
    nome: "Reengajamento · 60 dias",
    assunto: "Faz um tempo que a gente não se fala",
    remetente: "Carla Lemos <carla@amaan.com.br>",
    status: "rascunho",
    autor_id: "u-cl",
    data_criacao: "2026-07-11T08:15:00Z",
    data_atualizacao: null,
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 40px">
            <p style="margin:0;font-size:15px;line-height:24px;color:#3f3f46">
              Oi {{nome}}, aqui é a Carla.
            </p>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#3f3f46">
              Vi que sua última conversa com a gente foi há um tempo. Mudou bastante
              coisa por aqui desde então — se fizer sentido retomar, me diz um horário
              e eu te mostro em 15 minutos.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
  },
];

export const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));
