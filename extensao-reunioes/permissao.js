// Liberar o microfone para a extensão. O gravador (documento invisível) não
// consegue mostrar o pedido de permissão do Chrome; esta página, aberta numa aba,
// consegue. Liberado aqui, vale para a origem da extensão inteira.
const resultado = document.getElementById("resultado");

document.getElementById("pedir").addEventListener("click", async () => {
  try {
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
    fluxo.getTracks().forEach((t) => t.stop());
    resultado.textContent = "Microfone liberado. Pode fechar esta aba.";
  } catch {
    resultado.textContent = "O Chrome não liberou o microfone. Clique no cadeado da barra de endereço, permita o microfone e tente de novo.";
  }
});
