// Valor reservado de config.instancia_id: resolve a instância do responsável
// da oportunidade a cada envio, em vez de guardar um UUID fixo no fluxo.
export const INSTANCIA_RESPONSAVEL = "responsavel";

// Valor reservado de config.usuario_id no aviso à equipe: quem recebe é o
// responsável da oportunidade NO MOMENTO do aviso, não uma pessoa fixa
// (pedido dele, 2026-10-16: trocar o responsável leva o aviso junto).
export const USUARIO_RESPONSAVEL = "responsavel";
