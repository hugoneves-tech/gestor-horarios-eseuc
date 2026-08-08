/**
 * TAREFA 2 — dimensão real do problema, medida (não estimada de cabeça).
 *
 * Corre o inventário existente e conta: blocos, manchas, e o produto que dá o
 * número de variáveis de decisão do modelo, para a JANELA e para o ANO INTEIRO.
 */

import { blocosDaJanela, blocosParciais, carregarContexto, resumoLimites } from "./dados";

const ctx = carregarContexto();
const { inventario: inv, regras } = ctx;
const lim = resumoLimites(regras);

console.log("ESTRUTURA");
console.log("---------");
console.log(
  `  famílias ${lim.familias} · ${lim.quartos} desdobramentos TP · ${lim.plPorQuarto} PL por TP ` +
    `=> ${lim.folhasPorFamilia} folhas-aluno por família`,
);
console.log(
  `  limites de composição: máx ${lim.maxTPporUC} TP/UC, ${lim.maxPLporUC} PL/UC, ` +
    `${lim.maxPLporBloco} PL no bloco inteiro`,
);
console.log(
  `  grelha: ${regras.grelha.dias.length} dias × ${regras.grelha.horasInicio.length} horas ` +
    `(${regras.grelha.horasInicio.join(",")}), bloco ${regras.grelha.duracaoBlocoHoras}h`,
);
console.log(
  `  carga diária: alvo ${regras.cargaDiaria.transversal.alvoHoras}h, teto ` +
    `${regras.cargaDiaria.transversal.maxHoras}h, máx ${regras.cargaDiaria.transversal.maxDiasNoMaximoPorSemana} dias no teto`,
);
console.log(`  pausa almoço: ${JSON.stringify(regras.grelha.pausaAlmoco)}`);

console.log("\nINVENTÁRIO COMPLETO (30 semanas)");
console.log("--------------------------------");
console.log(`  blocos inventariados: ${inv.blocos.length}`);
console.log(`  carga não inventariada: ${inv.naoInventariada.length} entradas`);
console.log(
  `  confronto: necessário ${inv.confronto.necessario} · disponível@alvo ${inv.confronto.disponivelNoAlvo} ` +
    `· disponível@teto ${inv.confronto.disponivelNoTeto} · veredicto "${inv.confronto.veredicto}"`,
);

const porForma = new Map<string, number>();
for (const b of inv.blocos) porForma.set(b.forma, (porForma.get(b.forma) ?? 0) + 1);
console.log("  formas:");
for (const [f, n] of [...porForma].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${f.padEnd(22)} ${n}`);
}

// ---------------------------------------------------------------------------
// Manchas disponíveis
// ---------------------------------------------------------------------------

const horas = regras.grelha.horasInicio;
let manchasTotais = 0;
const diasPorSemana = new Map<number, number>();
for (const [, semanas] of ctx.calendario) {
  for (const s of semanas) {
    diasPorSemana.set(s.global, s.dias.length);
    manchasTotais += s.dias.length * horas.length;
  }
}
console.log(`\n  manchas (semana×dia×hora) em todo o ano: ${manchasTotais}`);

// ---------------------------------------------------------------------------
// A JANELA: 1.º semestre, semanas 1-7
// ---------------------------------------------------------------------------

const DE = 1;
const ATE = 7;
const naJanela = blocosDaJanela(inv, DE, ATE);
const parciais = blocosParciais(inv, DE, ATE);

console.log(`\nJANELA: semanas ${DE}-${ATE}`);
console.log("---------------------");
const diasJanela = [...diasPorSemana.entries()]
  .filter(([w]) => w >= DE && w <= ATE)
  .sort((a, b) => a[0] - b[0]);
const totalDias = diasJanela.reduce((a, [, d]) => a + d, 0);
console.log(`  dias úteis: ${diasJanela.map(([w, d]) => `s${w}:${d}`).join(" ")} = ${totalDias} dias`);

const blocosPorDiaAlvo = regras.cargaDiaria.transversal.alvoHoras / regras.grelha.duracaoBlocoHoras;
const blocosPorDiaTeto = regras.cargaDiaria.transversal.maxHoras / regras.grelha.duracaoBlocoHoras;
console.log(
  `  teto por família: ${totalDias}×${blocosPorDiaAlvo} = ${totalDias * blocosPorDiaAlvo} blocos @alvo · ` +
    `${totalDias}×${blocosPorDiaTeto} = ${totalDias * blocosPorDiaTeto} blocos @teto`,
);

for (const fam of ctx.familias) {
  const bs = naJanela.filter((b) => b.familia === fam);
  const ps = parciais.filter((b) => b.familia === fam);
  const fporForma = new Map<string, number>();
  for (const b of bs) fporForma.set(b.forma, (fporForma.get(b.forma) ?? 0) + 1);
  console.log(`\n  família ${fam}: ${bs.length} blocos exclusivos da janela (+${ps.length} parciais)`);
  for (const [f, n] of [...fporForma].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${f.padEnd(22)} ${n}`);
  }
  const sess = bs.reduce((a, b) => a + b.sessoes.length, 0);
  console.log(`      => ${sess} sessões (aulas individuais)`);
}

// ---------------------------------------------------------------------------
// Dimensão do modelo
// ---------------------------------------------------------------------------

const manchasJanela = totalDias * horas.length;
console.log(`\nDIMENSÃO DO MODELO`);
console.log("------------------");
console.log(`  JANELA  : ${naJanela.length} blocos × ${manchasJanela} manchas = ${naJanela.length * manchasJanela} booleanos x[b][m] (limite superior, antes de podar)`);
console.log(`  ANO INTEIRO: ${inv.blocos.length} blocos × ${manchasTotais} manchas = ${inv.blocos.length * manchasTotais} booleanos (limite superior)`);

// Poda por semanas viáveis: um bloco só pode ir às manchas das suas semanas.
let podadoJanela = 0;
for (const b of naJanela) {
  for (const w of b.semanasViaveis) podadoJanela += (diasPorSemana.get(w) ?? 0) * horas.length;
}
let podadoAno = 0;
for (const b of inv.blocos) {
  for (const w of b.semanasViaveis) podadoAno += (diasPorSemana.get(w) ?? 0) * horas.length;
}
console.log(`  JANELA  , podado por semanas viáveis: ${podadoJanela} booleanos`);
console.log(`  ANO INTEIRO, podado por semanas viáveis: ${podadoAno} booleanos`);

console.log(`\n  UCs no catálogo: ${ctx.ucs.length} · anos curriculares: ${ctx.anos.join(",")}`);
const ucsJanela = new Set(naJanela.flatMap((b) => b.sessoes.map((s) => s.ucSigla)));
console.log(`  UCs que vivem na janela: ${ucsJanela.size}`);
