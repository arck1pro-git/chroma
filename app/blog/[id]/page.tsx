import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { artigosDoBlog, blogPorId } from "@/lib/blog";
import { enderecoDoCrm } from "@/lib/endereco";
import TelaBlog, { type Aba } from "./tela-blog";
import { demonstracao } from "./demo";

export const metadata: Metadata = { title: "Blog · AmaanOffice" };

const ABAS: Aba[] = ["artigos", "desempenho", "automacao"];

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// O blog e os artigos vêm daqui, do servidor: o quadro pinta pronto, sem
// esqueleto. O que é de fora (Google, n8n, feeds) a tela busca depois, cada
// um no seu tempo — ver o cabeçalho de ./tela-blog.tsx.
//
// O ENDEREÇO DO CRM TAMBÉM VEM DAQUI: a URL de conexão do blog é absoluta e o
// site vai chamá-la. Montá-la no cliente com `window.location` daria
// divergência de hidratação.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string | string[]; demo?: string | string[] }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação (guia de autenticação do Next).
  const { usuario } = await exigirModulo("blog");
  const [{ id }, busca, cabecalhos] = await Promise.all([params, searchParams, headers()]);

  const endereco = enderecoDoCrm(cabecalhos);
  const aba = ABAS.find((a) => a === um(busca.aba)) ?? "artigos";
  // O que cada um pode é decidido aqui e nas rotas; a tela só esconde o botão.
  const pode = {
    criar: podeOperar(usuario, "blog", "criar"),
    editar: podeOperar(usuario, "blog", "editar"),
    excluir: podeOperar(usuario, "blog", "excluir"),
  };

  // ?demo=1 — só em desenvolvimento: a tela cheia com dados fictícios.
  if (um(busca.demo) === "1" && process.env.NODE_ENV !== "production") {
    const demo = demonstracao();
    return (
      <TelaBlog
        blogInicial={demo.blog}
        artigosIniciais={demo.artigos}
        base={endereco.url}
        basePublica={endereco.publico}
        pode={pode}
        abaInicial={aba}
        demo={demo.tela}
      />
    );
  }

  const blog = /^\d+$/.test(id) ? await blogPorId(Number(id)) : null;
  if (!blog) notFound();

  return (
    <TelaBlog
      blogInicial={blog}
      artigosIniciais={await artigosDoBlog(blog.id)}
      base={endereco.url}
      basePublica={endereco.publico}
      pode={pode}
      abaInicial={aba}
    />
  );
}
