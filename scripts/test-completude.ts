// Ciclo de teste: gera com o motor real + mockData e mede a completude por UC/tipo.
import { gerarSessoesConjunto, calcularSemanas, type EntradaUC } from "../src/utils/distribuicao";
import { ucsIniciais, anosSemestresIniciais, feriadosIniciais } from "../src/mockData";

function build(sem: number) {
  const ent: EntradaUC[] = [];
  for (const uc of ucsIniciais) {
    if (!uc.turmasConfig?.length || Number(uc.anoCurricular) === 3 || uc.semestre !== sem) continue;
    const a = anosSemestresIniciais.find(s => s.semestre === uc.semestre);
    if (!a?.dataInicioSemestre) continue;
    const di = uc.dataInicio || a.dataInicioSemestre;
    const ss = uc.semanaInicio || 1;
    const se = ss + (uc.numSemanas || 15) - 1;
    ent.push({ uc, semanas: calcularSemanas(di, ss, se, feriadosIniciais), semanaGlobalOffset: sem === 2 ? 15 : 0 });
  }
  return ent;
}
const anoDe: Record<string, number> = {};
for (const u of ucsIniciais) anoDe[u.sigla] = Number(u.anoCurricular);
// Dias bloqueados por semana global (ano inteiro), para o transbordo da recuperação.
const diasBloqueadosPorSemana: Record<number, string[]> = {};
for (const sem of [1, 2] as const) {
  const a = anosSemestresIniciais.find(s => s.semestre === sem);
  if (!a?.dataInicioSemestre) continue;
  const off = sem === 2 ? 15 : 0;
  for (const w of calcularSemanas(a.dataInicioSemestre, 1, 15, feriadosIniciais)) {
    diasBloqueadosPorSemana[w.numero + off] = w.diasBloqueados;
  }
}
const opts = {
  maxTPporMancha: null, ucConflitos: [["ESDAC", "EIG"]],
  // 8-15 só T1 (Turma A) presente; 16-23 só T2 (Turma B). T1 de manhã nas 1-15, T2 nas 16-30.
  semanasSoTurmaA: [8, 9, 10, 11, 12, 13, 14, 15],
  semanasSoTurmaB: [16, 17, 18, 19, 20, 21, 22, 23],
  diasBloqueadosPorSemana,
  plPendentesEntreSemestres: [],
} as any;
const oc = new Set<string>(), pc = new Map<string, number>();
const s1 = gerarSessoesConjunto(build(1) as any, 1, 0, oc, pc, opts);
const s2 = gerarSessoesConjunto(build(2) as any, 2, s1.length, oc, pc, opts);
const all = [...s1, ...s2];

let alvoTot = 0, colocTot = 0;
const linhas: string[] = [];
for (const u of ucsIniciais) {
  if (!u.turmasConfig?.length || Number(u.anoCurricular) === 3) continue;
  const tc = u.turmasConfig;
  const nT = tc.filter((t: any) => t.tipo === "Teórica").length;
  const nTP = tc.filter((t: any) => t.tipo === "TeoricoPratica").length;
  const nPL = tc.filter((t: any) => t.tipo === "Prática").length;
  const nS = tc.filter((t: any) => t.tipo === "Seminário").length;
  // UCs lecionadas só por uma turma (bloco-2 "-I" → só B; "-II" → só A): alvo = metade.
  const soUmaFam = Number(u.anoCurricular) === 2 && /-(I|II)$/.test(u.sigla);
  const fT = soUmaFam ? Math.ceil(nT / 2) : nT, fTP = soUmaFam ? nTP / 2 : nTP, fPL = soUmaFam ? nPL / 2 : nPL;
  const alvo = Math.floor((u.cargaHorariaTeorica || 0) / 2) * fT + Math.floor((u.cargaHorariaTP || 0) / 2) * fTP
    + Math.floor((u.cargaHorariaPratica || 0) / 2) * fPL + Math.floor((u.cargaHorariaS || 0) / 2) * nS;
  const coloc = all.filter(s => s.ucSigla === u.sigla).length;
  alvoTot += alvo; colocTot += coloc;
  const pct = alvo ? Math.round((coloc / alvo) * 100) : 100;
  if (coloc > alvo) linhas.push(`  ${u.sigla.padEnd(8)} SOBRE-COLOCADA: ${coloc}/${alvo}`);
  if (pct < 100) {
    // detalhe por tipo
    const det: string[] = [];
    for (const [tipo, n, carga] of [["T", fT, u.cargaHorariaTeorica], ["TP", fTP, u.cargaHorariaTP], ["PL", fPL, u.cargaHorariaPratica], ["S", nS, u.cargaHorariaS]] as any[]) {
      const a2 = Math.floor((carga || 0) / 2) * n;
      if (!a2) continue;
      const c2 = all.filter(s => s.ucSigla === u.sigla && s.tipoAula === tipo).length;
      if (c2 < a2) det.push(`${tipo} ${c2}/${a2}`);
    }
    linhas.push(`  ${u.sigla.padEnd(8)} ${pct}%  (${det.join(", ")})`);
  }
}
console.log(`COMPLETUDE GLOBAL: ${Math.round((colocTot / alvoTot) * 100)}%  (${colocTot}/${alvoTot} blocos)`);
if (linhas.length) { console.log("UCs incompletas:"); for (const l of linhas) console.log(l); }
else console.log("TODAS AS UCs A 100%! 🎉");

// invariantes
function folhas(t: string): string[] {
  if (t === "Turma A") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 1));
  if (t === "Turma B") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 13));
  const m = t.match(/^TP(\d+)$/); if (m) { const n = +m[1]; const s = (n - 1) * 3 + 1; return [s, s + 1, s + 2].map(i => "PL" + i); }
  if (/^PL\d+$/.test(t)) return [t];
  return [];
}
const cnt: Record<string, number> = {};
const dups = new Set<string>(); let dupN = 0;
const occ = new Set<string>();
for (const s of all) {
  const ano = anoDe[s.ucSigla];
  for (const g of folhas(s.turma)) {
    cnt[`${ano}|${s.semana}|${s.diaSemana}|${g}`] = (cnt[`${ano}|${s.semana}|${s.diaSemana}|${g}`] || 0) + 1;
    const k = `${ano}|${s.semana}|${s.diaSemana}|${s.horaInicio}|${g}`;
    if (occ.has(k)) { dupN++; dups.add(k); } else occ.add(k);
  }
}
const mx = Math.max(0, ...Object.values(cnt));
console.log(`Máx blocos/aluno/dia: ${mx} (${mx * 2}h) | sobreposições de aluno: ${dupN}`);
// almoço: aluno com 12 e 14 no mesmo dia
let almoco = 0;
const horasAluno: Record<string, Set<string>> = {};
for (const s of all) { const ano = anoDe[s.ucSigla]; for (const g of folhas(s.turma)) { const k = `${ano}|${s.semana}|${s.diaSemana}|${g}`; (horasAluno[k] = horasAluno[k] || new Set()).add(s.horaInicio); } }
for (const k of Object.keys(horasAluno)) if (horasAluno[k].has("12:00") && horasAluno[k].has("14:00")) almoco++;
console.log(`Violações de almoço (12h+14h): ${almoco}`);

// Regra: nunca TP e PL da MESMA UC (sigla) na mesma mancha (ano|semana|dia|hora),
// mesmo entre turmas diferentes (docentes partilhados entre a TP e a PL da UC).
const tipoNaMancha: Record<string, Set<string>> = {};
for (const s of all) {
  if (s.tipoAula !== "TP" && s.tipoAula !== "PL") continue;
  const ano = anoDe[s.ucSigla];
  const k = `${ano}|${s.semana}|${s.diaSemana}|${s.horaInicio}|${s.ucSigla}`;
  (tipoNaMancha[k] = tipoNaMancha[k] || new Set()).add(s.tipoAula);
}
let tpPlMesmaUC = 0; const exTpPl: string[] = [];
for (const k of Object.keys(tipoNaMancha)) {
  const set = tipoNaMancha[k];
  if (set.has("TP") && set.has("PL")) { tpPlMesmaUC++; if (exTpPl.length < 10) exTpPl.push(k); }
}
console.log(`TP+PL da mesma UC no mesmo bloco: ${tpPlMesmaUC}`);
for (const e of exTpPl) console.log("  ✗ " + e);

// Diagnóstico de turnos: que família está presente (e quantos blocos à tarde) por bloco.
const famDe = (t: string): "A" | "B" => {
  if (t === "Turma A") return "A"; if (t === "Turma B") return "B";
  const tp = t.match(/^TP(\d+)$/); if (tp) return +tp[1] <= 4 ? "A" : "B";
  const pl = t.match(/^PL(\d+)$/); if (pl) return +pl[1] <= 12 ? "A" : "B";
  return "A";
};
const ehManha = (h: string) => ["08:00", "10:00", "12:00"].includes(h);
const resumoBloco = (lo: number, hi: number) => {
  const ss = all.filter(s => s.semana! >= lo && s.semana! <= hi);
  const fams = [...new Set(ss.map(s => famDe(s.turma)))].sort().join(",");
  const tarde = ss.filter(s => !ehManha(s.horaInicio)).length;
  return `famílias={${fams}} · ${ss.length} blocos · ${tarde} à tarde`;
};
console.log(`\n[turnos] sem 8-15  → ${resumoBloco(8, 15)}   (esperado só T1=A, 0 à tarde)`);
console.log(`[turnos] sem 16-23 → ${resumoBloco(16, 23)}   (esperado só T2=B, 0 à tarde)`);
const t1TardeS1 = all.filter(s => s.semana! >= 2 && s.semana! <= 7 && famDe(s.turma) === "A" && !ehManha(s.horaInicio)).length;
const t2TardeS2 = all.filter(s => s.semana! >= 24 && s.semana! <= 30 && famDe(s.turma) === "B" && !ehManha(s.horaInicio)).length;
console.log(`[turnos] sem 2-7: T1(A) à tarde = ${t1TardeS1} (esperado 0)  |  sem 24-30: T2(B) à tarde = ${t2TardeS2} (esperado 0)`);

// === v2: SEMEADURA de sessões fixas — o motor gera só o que falta, à volta delas ========
function gerarComFixas(fixas: any[]) {
  const oc2 = new Set<string>(), pc2 = new Map<string, number>();
  const o = { ...opts, sessoesFixas: fixas };
  const g1 = gerarSessoesConjunto(build(1) as any, 1, 0, oc2, pc2, o);
  const g2 = gerarSessoesConjunto(build(2) as any, 2, g1.length, oc2, pc2, o);
  return [...g1, ...g2];
}
const sobreposicoes = (lst: any[]) => {
  const occ2 = new Set<string>(); let dup = 0;
  for (const s of lst) { const ano = anoDe[s.ucSigla]; for (const g of folhas(s.turma)) {
    const k = `${ano}|${s.semana}|${s.diaSemana}|${s.horaInicio}|${g}`;
    if (occ2.has(k)) dup++; else occ2.add(k);
  } }
  return dup;
};
// (1) TODAS as sessões como fixas → o motor não deve gerar praticamente nada.
const genTodas = gerarComFixas(all);
console.log(`\n[v2] Fixas = TODAS → o motor gerou ${genTodas.length} blocos (esperado 0).`);
// (2) METADE fixa → gerado + fixas deve cobrir tudo, sem sobreposições de aluno.
const metade = all.filter((_, i) => i % 2 === 0);
const genMetade = gerarComFixas(metade);
const combinado = [...metade, ...genMetade];
console.log(`[v2] Fixas = metade (${metade.length}) → motor gerou ${genMetade.length}; combinado ${combinado.length}/${all.length} blocos, sobreposições: ${sobreposicoes(combinado)}.`);
