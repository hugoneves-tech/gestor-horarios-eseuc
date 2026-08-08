/** Despejo das regras que tocam a janela 1-7 — para derivar o modelo formal. */
import { carregarContexto } from "./dados";

const { regras: r } = carregarContexto();
const j = (x: unknown) => JSON.stringify(x);

console.log("turnos:", j(r.turnos));
console.log("limiarTardeHora:", r.grelha.limiarTardeHora);
console.log("\njanelasPorTipo:");
for (const w of r.janelasPorTipo) {
  console.log(`  ${w.tipo} modo=${w.modo} ordem=[${w.ordemPreferenciaDias}] origem=${w.origem}`);
  for (const d of w.janelas) console.log(`      ${d.dia}: periodos=[${d.periodos}] horas=[${d.horas}]`);
}
console.log("\nprecedencias:", r.precedencias.length);
for (const p of r.precedencias) console.log("  ", j(p));
console.log("\nprecedenciasEscalonadas:", r.precedenciasEscalonadas.length);
for (const p of r.precedenciasEscalonadas) console.log("  ", j(p));
console.log("\nracioTPPL:", j(r.racioTPPL));
console.log("ritmoTP:", j(r.ritmoTP));
console.log("maratonaUC:", j(r.maratonaUC));
console.log("tpPLmesmaUC:", j(r.tpPLmesmaUC));
console.log("\nrestricoesUC:", r.restricoesUC.length);
for (const x of r.restricoesUC) console.log("  ", j(x));
console.log("\nlayoutsFixos:", r.layoutsFixos.length);
for (const l of r.layoutsFixos) console.log(`   ano=${l.ano} sem=${l.semestre} sessoes=${l.sessoes.length} origem=${l.origem}`);
console.log("\naulasTConjuntas:", r.aulasTConjuntas.length);
for (const a of r.aulasTConjuntas) console.log("  ", j(a));
console.log("\nconflitosUC:", r.conflitosUC.length);
for (const c of r.conflitosUC) console.log("  ", j(c));
console.log("\npreferencias:", j(r.preferencias));
console.log("capacidade:", j({ ...r.capacidade, poolsSala: r.capacidade.poolsSala.length }));
console.log("poolsSala:");
for (const p of r.capacidade.poolsSala) console.log("  ", j(p));
console.log("\ncalendario:", j({ ...r.calendario, bloqueios: r.calendario.bloqueios.length, semanasPersonalizadas: r.calendario.semanasPersonalizadas.length }));
