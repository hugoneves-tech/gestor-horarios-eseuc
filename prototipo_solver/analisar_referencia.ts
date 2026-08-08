/**
 * Como é que o horário do COORDENADOR empacota as semanas 1-7?
 * Serve de linha de base para o protótipo: quantas manchas usa por família,
 * que horas, quantos blocos por dia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carregarContexto } from "./dados";

const ctx = carregarContexto();
const r = ctx.regras;
const bruto = JSON.parse(
  readFileSync(join(import.meta.dirname ?? ".", "..", "referencia_sessoes.json"), "utf8"),
) as { semana: number; diaSemana: string; horaInicio: string; ucSigla: string; tipoAula: string; turma: string }[];

const nomes = r.estruturaTurmas.nomesTurmasTeoricas;
const pref = r.estruturaTurmas.prefixos;
/** Família de uma turma da referência (T1/TP1/PL7 ...). */
function familiaDe(t: string): string {
  let m = t.match(new RegExp(`^${pref.teorica}(\\d+)$`));
  if (m) return nomes[Number(m[1]) - 1] ?? t;
  m = t.match(new RegExp(`^${pref.tp}(\\d+)$`));
  if (m) return nomes[Math.floor((Number(m[1]) - 1) / r.estruturaTurmas.tpPorTurmaTeorica)] ?? "?";
  m = t.match(new RegExp(`^${pref.pl}(\\d+)$`));
  if (m) {
    const porFamilia = r.estruturaTurmas.tpPorTurmaTeorica * r.estruturaTurmas.plPorTP;
    return nomes[Math.floor((Number(m[1]) - 1) / porFamilia)] ?? "?";
  }
  return "?";
}

// manchas ocupadas por família
const manchas = new Map<string, Set<string>>();
const horasPorFamilia = new Map<string, Map<string, number>>();
const blocosPorDia = new Map<string, number>(); // familia|semana|dia -> nº manchas
const sessoesPorMancha = new Map<string, number>();
const plPorMancha = new Map<string, number>();

for (const s of bruto) {
  const f = familiaDe(s.turma);
  const chaveM = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
  const chaveFM = `${f}|${chaveM}`;
  if (!manchas.has(f)) manchas.set(f, new Set());
  manchas.get(f)!.add(chaveM);
  if (!horasPorFamilia.has(f)) horasPorFamilia.set(f, new Map());
  const hm = horasPorFamilia.get(f)!;
  sessoesPorMancha.set(chaveFM, (sessoesPorMancha.get(chaveFM) ?? 0) + 1);
  if (s.tipoAula === "PL") plPorMancha.set(chaveM, (plPorMancha.get(chaveM) ?? 0) + 1);
  void hm;
}
for (const [f, set] of manchas) {
  const hm = new Map<string, number>();
  const bd = new Map<string, number>();
  for (const k of set) {
    const [sem, dia, hora] = k.split("|");
    hm.set(hora, (hm.get(hora) ?? 0) + 1);
    bd.set(`${sem}|${dia}`, (bd.get(`${sem}|${dia}`) ?? 0) + 1);
  }
  horasPorFamilia.set(f, hm);
  for (const [k, v] of bd) blocosPorDia.set(`${f}|${k}`, v);
}

console.log("REFERÊNCIA DO COORDENADOR — semanas 1-7");
console.log("=======================================");
console.log(`sessões: ${bruto.length}`);
for (const [f, set] of [...manchas].sort()) {
  console.log(`\nfamília ${f}: ${set.size} manchas ocupadas`);
  const hm = horasPorFamilia.get(f)!;
  console.log("  por hora de início:");
  for (const h of r.grelha.horasInicio) console.log(`    ${h}  ${hm.get(h) ?? 0}`);
  const dias = [...blocosPorDia].filter(([k]) => k.startsWith(f + "|"));
  const dist = new Map<number, number>();
  for (const [, n] of dias) dist.set(n, (dist.get(n) ?? 0) + 1);
  console.log(`  dias com aulas: ${dias.length}`);
  console.log(
    "  blocos por dia: " +
      [...dist].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} blocos ×${c} dias`).join(" · "),
  );
}

// composição das manchas
console.log("\nComposição das manchas (nº de sessões por mancha/família):");
const distSess = new Map<number, number>();
for (const [, n] of sessoesPorMancha) distSess.set(n, (distSess.get(n) ?? 0) + 1);
for (const [n, c] of [...distSess].sort((a, b) => a[0] - b[0])) console.log(`   ${n} sessões  ×${c}`);

console.log("\nPL em simultâneo (bloco inteiro, ambas as famílias) — máx permitido " + r.capacidade.maxPLporMancha + ":");
const distPL = new Map<number, number>();
for (const [, n] of plPorMancha) distPL.set(n, (distPL.get(n) ?? 0) + 1);
for (const [n, c] of [...distPL].sort((a, b) => a[0] - b[0])) console.log(`   ${n} PL  ×${c} manchas`);

// sextas
const sextas = new Set(bruto.filter((s) => s.diaSemana === "Sexta").map((s) => `${s.semana}`));
console.log(`\nsemanas com aulas à Sexta: ${[...sextas].sort().join(",")}`);
