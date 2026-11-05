import type { Metadata } from "next";
import { headers } from "next/headers";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { listarBlogs } from "@/lib/blog";
import { enderecoDoCrm } from "@/lib/endereco";
import Blogs from "./blogs";

export const metadata: Metadata = { title: "Blog · AmaanOffice" };

// A lista vem do servidor, já com as contagens (em revisão, postados, fontes):
// é uma consulta só e pinta pronta. Criar e configurar mexem no estado local da
// tela, sem recarregar a rota.
export default async function Page() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação (guia de autenticação do Next).
  const { usuario } = await exigirModulo("blog");
  const [blogs, cabecalhos] = await Promise.all([listarBlogs(), headers()]);
  const endereco = enderecoDoCrm(cabecalhos);

  return (
    <Blogs
      iniciais={blogs}
      base={endereco.url}
      basePublica={endereco.publico}
      pode={{
        criar: podeOperar(usuario, "blog", "criar"),
        editar: podeOperar(usuario, "blog", "editar"),
        excluir: podeOperar(usuario, "blog", "excluir"),
      }}
    />
  );
}
