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
  semanasSoTurmaB: [8, 9, 10, 11, 12, 13, 14, 15],
  semanasSoTurmaA: [16, 17, 18, 19, 20, 21, 22, 23],
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
