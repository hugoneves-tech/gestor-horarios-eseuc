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
  excessosDias8h: { chave: string; total: number }[];
  violacoesAlmoco: number;           // aluno com 12:00 e 14:00 no mesmo dia
  violacoesCronologia: { sigla: string; familia: string; problema: string }[];
  tpPlMesmaUC: string[];             // chaves ano|semana|dia|hora|UC com TP e PL juntas
  excessosPLPorBloco: { chave: string; total: number }[]; // capacidade física global de laboratórios
  violacoesTSimultaneas: string[];    // UCs configuradas cujas turmas T não estão juntas/no bloco permitido
  violacoesTConjuntas: string[];      // janelas em que T1/T2 não têm mesma UC/bloco/sala
}

export interface RegraTConjunta {
  anos?: number[];
  semanas: number[];
  dias: string[];
  horarios?: string[];
  sala?: string;
  obrigatoriaPorDia?: boolean;
  siglasObrigatorias?: string[];
}

// alvo (nº de blocos) por (UC, tipo), considerando que as UCs "-I"/"-II" do 2.º ano só
// têm uma família. Espelha o cálculo do motor (carga/2 × nº de turmas).
function alvoUC(uc: UC) {
  const tc = uc.turmasConfig || [];
  const nT = tc.filter(t => t.tipo === "Teórica").length;
  const nTP = tc.filter(t => t.tipo === "TeoricoPratica").length;
  const nPL = tc.filter(t => t.tipo === "Prática").length;
  const nS = tc.filter(t => t.tipo === "Seminário").length;
  const bloco = (carga: number | undefined, n: number) => Math.floor((carga || 0) / 2) * n;
  return {
    T: bloco(uc.cargaHorariaTeorica, nT),
    TP: bloco(uc.cargaHorariaTP, nTP),
    PL: bloco(uc.cargaHorariaPratica, nPL),
    S: bloco(uc.cargaHorariaS, nS),
  };
}

export function validarHorario(
  sessoes: SessaoHorario[],
  ucs: UC[],
  maxPLporMancha = 6,
  aulasTConjuntas: RegraTConjunta[] = [],
): RelatorioValidacao {
  const ucPorSigla = new Map(ucs.map(u => [u.sigla, u]));
  const normalizarSigla = (sigla: string) => String(sigla || "").trim().toLocaleUpperCase("pt-PT");
  const listaTemSigla = (siglas: string[] | undefined, sigla: string) =>
    !!siglas?.some(s => normalizarSigla(s) === normalizarSigla(sigla));
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
  const dias8hPorSemanaAluno = new Map<string, number>();
  for (const [chave, blocos] of blocosDia) {
    if (blocos < 4) continue;
    const [ano, semana, , folha] = chave.split("|");
    const semanaAluno = `${ano}|${semana}|${folha}`;
    dias8hPorSemanaAluno.set(semanaAluno, (dias8hPorSemanaAluno.get(semanaAluno) || 0) + 1);
  }
  const excessosDias8h = [...dias8hPorSemanaAluno]
    .filter(([, total]) => total > 5)
    .map(([chave, total]) => ({ chave, total }));
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

  // --- Capacidade física GLOBAL: no máximo 6 PL em semana+dia+hora ---
  // A chave não inclui ano, turma, UC ou tipologia de sala.
  const plPorBloco = new Map<string, number>();
  for (const s of sessoes) {
    if (s.tipoAula !== "PL" || s.semana == null) continue;
    const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
    plPorBloco.set(k, (plPorBloco.get(k) || 0) + 1);
  }
  const excessosPLPorBloco = [...plPorBloco]
    .filter(([, total]) => total > maxPLporMancha)
    .map(([chave, total]) => ({ chave, total }));

  // --- Turmas T simultâneas e horários permitidos (configuração por UC) ---
  const violacoesTSimultaneas: string[] = [];
  for (const uc of ucs.filter(u => u.turmasTSimultaneas)) {
    const turmasT = (uc.turmasConfig || []).filter(t => t.tipo === "Teórica").map(t => t.nome);
    const permitidos = new Set(uc.horariosTSimultaneas?.length ? uc.horariosTSimultaneas : ["10:00", "16:00"]);
    const sessoesT = sessoes.filter(s => s.ucSigla === uc.sigla && s.tipoAula === "T");
    const porMomento = new Map<string, SessaoHorario[]>();
    for (const s of sessoesT) {
      const k = `${s.semana}|${s.diaSemana}|${s.horaInicio}`;
      if (!porMomento.has(k)) porMomento.set(k, []);
      porMomento.get(k)!.push(s);
      const diaHoraPermitidos = ["Segunda", "Quarta"].includes(s.diaSemana)
        || (s.diaSemana === "Sexta" && (
          s.horaInicio === "10:00"
          || (s.semana === 1 && ["08:00", "12:00"].includes(s.horaInicio))
        ));
      if (!diaHoraPermitidos || !permitidos.has(s.horaInicio)) {
        violacoesTSimultaneas.push(`${uc.sigla}: ${k} fora dos blocos permitidos`);
      }
    }
    for (const [momento, grupo] of porMomento) {
      const presentes = new Set(grupo.map(s => s.turma));
      const faltam = turmasT.filter(t => !presentes.has(t));
      const duplicadas = grupo.length !== presentes.size;
      if (faltam.length || duplicadas || presentes.size !== turmasT.length) {
        violacoesTSimultaneas.push(`${uc.sigla}: ${momento} não reúne todas as turmas T (${[...presentes].join(", ") || "nenhuma"})`);
      }
    }
  }

  // --- Janelas T conjuntas provenientes das regras do Supabase ---
  const violacoesTConjuntas: string[] = [];
  for (const regra of aulasTConjuntas) {
    for (const semana of regra.semanas) for (const dia of regra.dias) {
      const candidatas = sessoes.filter(s =>
        s.tipoAula === "T" && s.semana === semana && s.diaSemana === dia
        && (!regra.horarios?.length || regra.horarios.includes(s.horaInicio))
        && (!regra.anos?.length || regra.anos.includes(anoDe(s.ucSigla)))
      );
      const porHora = new Map<string, SessaoHorario[]>();
      for (const s of candidatas) {
        const grupo = porHora.get(s.horaInicio) || [];
        grupo.push(s);
        porHora.set(s.horaInicio, grupo);
      }
      const temUcObrigatoria = [...porHora.values()].some(grupo => {
        const siglas = new Set(grupo.map(s => s.ucSigla));
        return siglas.size === 1
          && (!regra.siglasObrigatorias?.length || listaTemSigla(regra.siglasObrigatorias, [...siglas][0]));
      });
      if (regra.obrigatoriaPorDia && !temUcObrigatoria) {
        const uc = regra.siglasObrigatorias?.join("/") || "a UC definida";
        violacoesTConjuntas.push(`Semana ${semana}, ${dia}: falta o bloco T conjunto obrigatório de ${uc}`);
      }
      for (const [hora, grupo] of porHora) {
        const ucsNoBloco = new Set(grupo.map(s => s.ucSigla));
        const familias = new Set(grupo.map(s => familiaDe(s.turma)));
        const salasNoBloco = new Set(grupo.map(s => s.sala));
        if (grupo.length !== 2 || ucsNoBloco.size !== 1 || !familias.has("A") || !familias.has("B") || familias.size !== 2) {
          violacoesTConjuntas.push(`Semana ${semana}, ${dia} ${hora}: T1/T2 não têm exatamente a mesma UC`);
        }
        if (salasNoBloco.size !== 1 || (regra.sala && !salasNoBloco.has(regra.sala))) {
          violacoesTConjuntas.push(`Semana ${semana}, ${dia} ${hora}: T1/T2 não têm a mesma sala`);
        }
      }
    }
  }

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

  const ok = sobreposicoes === 0 && maxBlocosDia <= 4 && excessosDias8h.length === 0 && violacoesAlmoco === 0
    && violacoesCronologia.length === 0 && tpPlMesmaUC.length === 0
    && excessosPLPorBloco.length === 0 && violacoesTSimultaneas.length === 0
    && violacoesTConjuntas.length === 0;

  return {
    ok,
    totalBlocos: sessoes.length,
    completude: { pct: pctGlobal, colocados: colocTot, alvo: alvoTot, incompletas, sobreColocadas },
    sobreposicoes,
    maxBlocosDia,
    excedeu8h: maxBlocosDia > 4,
    excessosDias8h,
    violacoesAlmoco,
    violacoesCronologia,
    tpPlMesmaUC,
    excessosPLPorBloco,
    violacoesTSimultaneas,
    violacoesTConjuntas,
  };
}
