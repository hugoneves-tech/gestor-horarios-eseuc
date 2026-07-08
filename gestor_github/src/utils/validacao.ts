// Validação de um horário (gerado OU importado) contra as regras pedagógicas do motor.
// Fonte única de verdade partilhada pelo módulo de importação e pelos testes.
import type { UC, SessaoHorario } from "../types";

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const HORAS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

// Grupos-folha de alunos (a unidade que não pode ter sobreposição nem >8h/dia):
//  Turma A → PL1-12 ; Turma B → PL13-24 ; TPn → as suas 3 PL ; PLn → a própria.
export function gruposFolha(turma: string): string[] {
  if (turma === "Turma A") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 1));
  if (turma === "Turma B") return Array.from({ length: 12 }, (_, i) => "PL" + (i + 13));
  const m = turma.match(/^TP(\d+)$/);
  if (m) { const n = +m[1]; const s = (n - 1) * 3 + 1; return ["PL" + s, "PL" + (s + 1), "PL" + (s + 2)]; }
  if (/^PL\d+$/.test(turma)) return [turma];
  return [];
}

// Família (A/B) a que uma turma pertence — para a cronologia por (UC, família).
export function familiaDe(turma: string): "A" | "B" {
  if (turma === "Turma A") return "A";
  if (turma === "Turma B") return "B";
  const tp = turma.match(/^TP(\d+)$/); if (tp) return +tp[1] <= 4 ? "A" : "B";
  const pl = turma.match(/^PL(\d+)$/); if (pl) return +pl[1] <= 12 ? "A" : "B";
  return "A";
}

const ordMomento = (semana: number, dia: string, hora: string) =>
  semana * 1000 + DIAS.indexOf(dia) * 10 + HORAS.indexOf(hora);

export interface RelatorioValidacao {
  ok: boolean;                       // true se não há violações de regras (completude à parte)
  totalBlocos: number;
  completude: {
    pct: number; colocados: number; alvo: number;
    incompletas: { sigla: string; pct: number; detalhe: string }[];
    sobreColocadas: { sigla: string; colocados: number; alvo: number }[];
  };
  sobreposicoes: number;             // mesmo aluno em dois sítios no mesmo bloco
  maxBlocosDia: number;              // máx blocos/aluno/dia (×2 = horas)
  excedeu8h: boolean;
  violacoesAlmoco: number;           // aluno com 12:00 e 14:00 no mesmo dia
  violacoesCronologia: { sigla: string; familia: string; problema: string }[];
  tpPlMesmaUC: string[];             // chaves ano|semana|dia|hora|UC com TP e PL juntas
}

// alvo (nº de blocos) por (UC, tipo), considerando que as UCs "-I"/"-II" do 2.º ano só
// têm uma família. Espelha o cálculo do motor (carga/2 × nº de turmas).
function alvoUC(uc: UC) {
  const tc = uc.turmasConfig || [];
  const nT = tc.filter(t => t.tipo === "Teórica").length;
  const nTP = tc.filter(t => t.tipo === "TeoricoPratica").length;
  const nPL = tc.filter(t => t.tipo === "Prática").length;
  const nS = tc.filter(t => t.tipo === "Seminário").length;
  const soUmaFam = Number(uc.anoCurricular) === 2 && /-(I|II)$/.test(uc.sigla);
  const fT = soUmaFam ? Math.ceil(nT / 2) : nT;
  const fTP = soUmaFam ? nTP / 2 : nTP;
  const fPL = soUmaFam ? nPL / 2 : nPL;
  const bloco = (carga: number | undefined, n: number) => Math.floor((carga || 0) / 2) * n;
  return {
    T: bloco(uc.cargaHorariaTeorica, fT),
    TP: bloco(uc.cargaHorariaTP, fTP),
    PL: bloco(uc.cargaHorariaPratica, fPL),
    S: bloco(uc.cargaHorariaS, nS),
  };
}

export function validarHorario(sessoes: SessaoHorario[], ucs: UC[]): RelatorioValidacao {
  const ucPorSigla = new Map(ucs.map(u => [u.sigla, u]));
  const anoDe = (sigla: string) => Number(ucPorSigla.get(sigla)?.anoCurricular) || 0;

  // --- Sobreposições e carga diária por aluno-folha ---
  const ocup = new Set<string>();
  const blocosDia = new Map<string, number>();   // ano|semana|dia|folha → nº blocos
  const horasAluno = new Map<string, Set<string>>(); // ano|semana|dia|folha → horas
  let sobreposicoes = 0;
  for (const s of sessoes) {
    const ano = anoDe(s.ucSigla);
    for (const g of gruposFolha(s.turma)) {
      const dk = `${ano}|${s.semana}|${s.diaSemana}|${g}`;
      blocosDia.set(dk, (blocosDia.get(dk) || 0) + 1);
      const hk = `${dk}|${s.horaInicio}`;
      if (ocup.has(hk)) sobreposicoes++; else ocup.add(hk);
      let hs = horasAluno.get(dk); if (!hs) { hs = new Set(); horasAluno.set(dk, hs); }
      hs.add(s.horaInicio);
    }
  }
  const maxBlocosDia = Math.max(0, ...blocosDia.values());
  let violacoesAlmoco = 0;
  for (const hs of horasAluno.values()) if (hs.has("12:00") && hs.has("14:00")) violacoesAlmoco++;

  // --- TP e PL da mesma UC no mesmo bloco (docente partilhado) ---
  const tipoNaMancha = new Map<string, Set<string>>();
  for (const s of sessoes) {
    if (s.tipoAula !== "TP" && s.tipoAula !== "PL") continue;
    const k = `${anoDe(s.ucSigla)}|${s.semana}|${s.diaSemana}|${s.horaInicio}|${s.ucSigla}`;
    let set = tipoNaMancha.get(k); if (!set) { set = new Set(); tipoNaMancha.set(k, set); }
    set.add(s.tipoAula);
  }
  const tpPlMesmaUC: string[] = [];
  for (const [k, set] of tipoNaMancha) if (set.has("TP") && set.has("PL")) tpPlMesmaUC.push(k);

  // --- Cronologia T→TP→PL por (UC, família) ---
  const minT = new Map<string, number>(), minTP = new Map<string, number>(), minPL = new Map<string, number>();
  for (const s of sessoes) {
    if (s.semana == null) continue;
    const k = `${s.ucSigla}|${familiaDe(s.turma)}`;
    const o = ordMomento(s.semana, s.diaSemana, s.horaInicio);
    const alvo = s.tipoAula === "T" ? minT : s.tipoAula === "TP" ? minTP : s.tipoAula === "PL" ? minPL : null;
    if (!alvo) continue;
    const cur = alvo.get(k);
    if (cur === undefined || o < cur) alvo.set(k, o);
  }
  const violacoesCronologia: { sigla: string; familia: string; problema: string }[] = [];
  const chaves = new Set([...minT.keys(), ...minTP.keys(), ...minPL.keys()]);
  for (const k of chaves) {
    const [sigla, familia] = k.split("|");
    const t = minT.get(k), tp = minTP.get(k), pl = minPL.get(k);
    if (tp !== undefined && t !== undefined && tp < t) violacoesCronologia.push({ sigla, familia, problema: "1.ª TP antes da 1.ª T" });
    if (pl !== undefined && tp !== undefined && pl < tp) violacoesCronologia.push({ sigla, familia, problema: "1.ª PL antes da 1.ª TP" });
    if (pl !== undefined && tp === undefined && t !== undefined && pl < t) violacoesCronologia.push({ sigla, familia, problema: "1.ª PL antes da 1.ª T" });
  }

  // --- Completude por UC/tipo ---
  let colocTot = 0, alvoTot = 0;
  const incompletas: { sigla: string; pct: number; detalhe: string }[] = [];
  const sobreColocadas: { sigla: string; colocados: number; alvo: number }[] = [];
  for (const uc of ucs) {
    if (!uc.turmasConfig?.length || Number(uc.anoCurricular) === 3) continue;
    const a = alvoUC(uc);
    const alvoSig = a.T + a.TP + a.PL + a.S;
    if (alvoSig === 0) continue;
    const colocSig = sessoes.filter(s => s.ucSigla === uc.sigla).length;
    colocTot += colocSig; alvoTot += alvoSig;
    if (colocSig > alvoSig) sobreColocadas.push({ sigla: uc.sigla, colocados: colocSig, alvo: alvoSig });
    const pct = alvoSig ? Math.round((colocSig / alvoSig) * 100) : 100;
    if (pct < 100) {
      const det: string[] = [];
      for (const tipo of ["T", "TP", "PL", "S"] as const) {
        const a2 = a[tipo]; if (!a2) continue;
        const c2 = sessoes.filter(s => s.ucSigla === uc.sigla && s.tipoAula === tipo).length;
        if (c2 < a2) det.push(`${tipo} ${c2}/${a2}`);
      }
      incompletas.push({ sigla: uc.sigla, pct, detalhe: det.join(", ") });
    }
  }
  const pctGlobal = alvoTot ? Math.round((colocTot / alvoTot) * 100) : 100;

  const ok = sobreposicoes === 0 && maxBlocosDia <= 4 && violacoesAlmoco === 0
    && violacoesCronologia.length === 0 && tpPlMesmaUC.length === 0;

  return {
    ok,
    totalBlocos: sessoes.length,
    completude: { pct: pctGlobal, colocados: colocTot, alvo: alvoTot, incompletas, sobreColocadas },
    sobreposicoes,
    maxBlocosDia,
    excedeu8h: maxBlocosDia > 4,
    violacoesAlmoco,
    violacoesCronologia,
    tpPlMesmaUC,
  };
}
