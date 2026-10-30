// Um .zip simples, montado em memória, sem dependência: os arquivos vão
// "guardados" (sem compressão), o formato mais básico que todo descompactador
// abre. Serve para arquivos pequenos (a extensão de reuniões tem ~100 KB), não
// para acervo.
//
// Formato: cada arquivo leva um cabeçalho local + os bytes, e no fim vem o
// diretório central e o registro de fim (PKWARE APPNOTE, seções 4.3 e 4.4).
// Nomes em UTF-8 (bit 11 das flags), data fixa: o conteúdo é que importa.

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 2026-01-01 00:00 no formato do DOS: (ano - 1980) << 9 | mês << 5 | dia.
const DATA_DOS = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8 = 0x0800;

export type ArquivoDoZip = { nome: string; bytes: Uint8Array };

/** O .zip com os arquivos dados, na ordem dada. `nome` pode ter pastas ("pasta/arquivo.js"). */
export function criarZip(arquivos: ArquivoDoZip[]): Uint8Array<ArrayBuffer> {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let posicao = 0;

  for (const a of arquivos) {
    const nome = new TextEncoder().encode(a.nome);
    const crc = crc32(a.bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versão necessária: 2.0
    local.setUint16(6, UTF8, true);
    local.setUint16(8, 0, true); // método: guardado
    local.setUint16(10, 0, true); // hora
    local.setUint16(12, DATA_DOS, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, a.bytes.length, true);
    local.setUint32(22, a.bytes.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, a.bytes);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true); // feito por: 2.0
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, DATA_DOS, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, a.bytes.length, true);
    c.setUint32(24, a.bytes.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, posicao, true); // onde começa o cabeçalho local
    central.push(new Uint8Array(c.buffer), nome);

    posicao += 30 + nome.length + a.bytes.length;
  }

  const tamanhoCentral = central.reduce((n, p) => n + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, posicao, true);

  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of todas) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}
