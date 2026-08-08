/**
 * SONDA DE CORTES — não resolve nada. Só responde a uma pergunta:
 * onde é que o semestre se pode cortar em janelas SEM perder blocos?
 *
 * Um bloco só entra numa janela se TODAS as suas semanas viáveis lá couberem
 * (é o critério de `blocosDaJanela`). Um corte mal escolhido parte a janela de
 * viabilidade de um bloco ao meio e esse bloco fica órfão: nenhuma janela o
 * reclama. Esta sonda mede exatamente isso antes de gastarmos minutos de solver.
 */

import { carregarContexto, blocosDaJanela } from "./dados";

const ctx = carregarContexto();
const inv = ctx.inventario;

console.log(`inventário total: ${inv.blocos.length} blocos`);

// Distribuição das janelas de viabilidade — mostra onde há fronteiras naturais.
const porExtremos = new Map<string, number>();
for (const b of inv.blocos) {
  if (b.semanasViaveis.length === 0) continue;
  const de = Math.min(...b.semanasViaveis);
  const ate = Math.max(...b.semanasViaveis);
  const k = `${de}-${ate}`;
  porExtremos.set(k, (porExtremos.get(k) ?? 0) + 1);
}
console.log(`\njanelas de viabilidade distintas (${porExtremos.size}):`);
for (const [k, n] of [...porExtremos].sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]))) {
  console.log(`  semanas ${k.padEnd(8)} ${n} blocos`);
}

// Um corte em `c` é limpo se nenhum bloco tem semanas viáveis dos dois lados.
console.log(`\ncortes limpos (bloco nenhum atravessa):`);
const limpos: number[] = [];
for (let c = 2; c <= 29; c++) {
  const atravessam = inv.blocos.filter(
    (b) => b.semanasViaveis.some((s) => s < c) && b.semanasViaveis.some((s) => s >= c),
  ).length;
  if (atravessam === 0) limpos.push(c);
}
console.log(`  ${limpos.join(", ") || "(nenhum)"}`);

// Cobertura de um conjunto candidato de janelas.
function cobertura(janelas: [number, number][]) {
  const reclamados = new Set<number>();
  const linhas: string[] = [];
  for (const [de, ate] of janelas) {
    const bs = blocosDaJanela(inv, de, ate);
    for (const b of bs) reclamados.add(inv.blocos.indexOf(b));
    const manchas = [...ctx.calendario.values()]
      .flat()
      .filter((s) => s.global >= de && s.global <= ate);
    linhas.push(`  ${String(de).padStart(2)}-${String(ate).padStart(2)}: ${String(bs.length).padStart(4)} blocos, ${manchas.length} semanas-ano`);
  }
  const orfaos = inv.blocos.filter((_, i) => !reclamados.has(i));
  return { linhas, orfaos };
}

for (const cand of [
  [[1, 7], [8, 15], [16, 22], [23, 29]],
  [[1, 7], [8, 15], [16, 29]],
  [[1, 15], [16, 29]],
] as [number, number][][]) {
  console.log(`\ncandidato ${JSON.stringify(cand)}`);
  const { linhas, orfaos } = cobertura(cand);
  for (const l of linhas) console.log(l);
  console.log(`  ÓRFÃOS: ${orfaos.length}` + (orfaos.length ? ` — ex.: ${orfaos.slice(0, 3).map((b) => `${b.familia} [${b.semanasViaveis[0]}..${b.semanasViaveis[b.semanasViaveis.length - 1]}]`).join(" | ")}` : ""));
}
