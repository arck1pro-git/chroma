// Fade de entrada a cada troca de módulo, para todas as rotas.
//
// É template.tsx e não layout.tsx porque o template recebe uma key própria do
// router e remonta na navegação — o DOM é recriado, então a animação CSS roda
// de novo sem key manual, sem estado e sem virar client component.
//
// Um detalhe que vem de graça: searchParams não remontam o template. Ir de
// /funil?op=a para /funil?op=b (o link que a ficha do contato usa) não
// re-anima a tela inteira; só a navegação entre módulos anima.
//
// As classes de flex repetem as do wrapper de layout.tsx de propósito: este div
// entra ENTRE aquele wrapper e a página, e telas que usam `flex-1` para ocupar
// a altura (a home e o ModuloEmBreve de /dashboard e /meta) colapsariam se o
// nível novo não repassasse o mesmo contexto de flex.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="pagina-surge flex min-w-0 flex-1 flex-col">{children}</div>
  );
}
