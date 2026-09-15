// Cria (ou reencontra) o workflow do n8n que gera os artigos por RSS.
//
// CRIA DESATIVADO, sempre. A instância é a de produção, compartilhada com os
// workflows do SprintHub — um agendamento que começa a rodar sozinho porque
// alguém clicou num botão do CRM é exatamente o tipo de surpresa que não se faz
// numa instância de outra gente. Quem ativa é uma pessoa, olhando o cron e a
// credencial na tela do n8n.
//
// É IDEMPOTENTE: se o workflow com este nome já existe, devolve o que existe em
// vez de criar um segundo. Dois agendamentos iguais gerariam 20 artigos na
// segunda, não 10.
import { sql } from "@/lib/db";
import {
  acharWorkflowPorNome,
  criarCredencial,
  criarWorkflow,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { credencialDoMotor } from "@/lib/automacoes/repositorio";
import { enderecoDoCrm } from "@/lib/endereco";
import {
  CRON_SEMANAL,
  NOME_WORKFLOW,
  montarWorkflowRss,
} from "@/lib/blog-rss-workflow";

export const dynamic = "force-dynamic";

/** Apelido em motor_credenciais — o mesmo que o comentário da tabela sugere. */
const CHAVE_CRED = "crm_callback";
const NOME_CRED = "Chroma · CRM (token de serviço)";

// O endereço que vai assado dentro dos nós de HTTP Request do workflow sai do
// DOMÍNIO DESTE REQUEST (lib/endereco.ts), não mais de CRM_BASE_URL — a
// variável foi removida em 2026-09-11. Funciona porque quem chama esta rota é o
// botão em app/blog/painel-rss.tsx, no navegador: se você clicou nele estando
// em crm.suaempresa.com, é esse o endereço que o n8n tem que usar, e o request
// já o trouxe.
//
// Endereço LOCAL continua sendo recusado, e é a mesma recusa de antes com outro
// motivo escrito: um workflow apontando para localhost não falha aqui, falha na
// segunda-feira de madrugada, dentro da instância do n8n compartilhada com o
// SprintHub. Publique pelo domínio público.
export async function POST(req: Request) {
  const { url: crmBaseUrl, publico, host } = enderecoDoCrm(req.headers);
  const token = process.env.CRM_SERVICE_TOKEN;

  if (!publico) {
    return Response.json(
      {
        error:
          `Você está em "${host}", um endereço local — o n8n não alcança isso. ` +
          "Abra o CRM pelo domínio público e crie o workflow de lá, ou use um " +
          "túnel (cloudflared, ngrok) e acesse o CRM pela URL do túnel.",
      },
      { status: 400 },
    );
  }
  if (!token) {
    return Response.json(
      { error: "CRM_SERVICE_TOKEN não definido. Sem ele o n8n não consegue chamar o CRM." },
      { status: 400 },
    );
  }

  try {
    // ── Credencial ────────────────────────────────────────────────────────
    // A API pública do n8n não lista credenciais, então quem lembra o id é o
    // CRM: motor_credenciais é um MAPA de apelido → id lá dentro, não um cofre.
    let cred = await credencialDoMotor("n8n", CHAVE_CRED);

    if (!cred) {
      const id = await criarCredencial(NOME_CRED, "httpHeaderAuth", {
        name: "Authorization",
        value: `Bearer ${token}`,
      });
      await sql`
        INSERT INTO motor_credenciais (chave, motor, motor_cred_id, motor_cred_tipo, descricao)
        VALUES (${CHAVE_CRED}, 'n8n', ${id}, 'httpHeaderAuth',
                'Header Auth com o CRM_SERVICE_TOKEN, usada pelos workflows que chamam o CRM de volta')
        ON CONFLICT (motor, chave) DO NOTHING`;
      cred = { id, nome: CHAVE_CRED };
    }

    // ── Workflow ──────────────────────────────────────────────────────────
    const existente = await acharWorkflowPorNome(NOME_WORKFLOW);
    if (existente) {
      return Response.json({
        ok: true,
        criado: false,
        workflowId: existente.id,
        ativo: existente.active,
        nome: NOME_WORKFLOW,
        cron: CRON_SEMANAL,
      });
    }

    const id = await criarWorkflow(
      montarWorkflowRss({
        crmBaseUrl,
        credencialId: cred.id,
        credencialNome: NOME_CRED,
      }),
    );

    return Response.json({
      ok: true,
      criado: true,
      workflowId: id,
      ativo: false,
      nome: NOME_WORKFLOW,
      cron: CRON_SEMANAL,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
