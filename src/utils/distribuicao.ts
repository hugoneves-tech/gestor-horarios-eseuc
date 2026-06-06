import type { UC, FeriadoInterrupcao, SessaoHorario } from "../types";

export interface SemanaInfo {
  numero: number;
  dataSegunda: string; // YYYY-MM-DD (Monday of this week)
  dataSexta: string;   // YYYY-MM-DD
  diasUteis: number;   // 0-5
  fator: number;       // diasUteis / 5
  feriadosNesta: string[];
  diasBloqueados: string[]; // e.g. ["Segunda","Quinta"] — days with no classes this week
}

export interface PlanoSemanal {
  semana: SemanaInfo;
  blocoT: number;  // blocks of 2h of T this week (per T turma)
  blocoTP: number;
  blocoPL: number;
  blocoS: number;
}

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addHours(timeStr: string, h: number): string {
  const [hh, mm] = timeStr.split(":").map(Number);
  return `${String(hh + h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

/**
 * Calcula informação sobre cada semana letiva.
 * dataInicioSemestre pode ser qualquer dia (não necessariamente segunda-feira).
 * Dias antes de dataInicioSemestre e dias com feriados são marcados como bloqueados.
 */
export function calcularSemanas(
  dataInicioSemestre: string,
  semanaInicio: number,
  semanaFim: number,
  feriados: FeriadoInterrupcao[]
): SemanaInfo[] {
  const actualStart = toDate(dataInicioSemestre);

  // Monday of the week containing actualStart
  const dow = actualStart.getDay(); // 0=Sun,1=Mon,...
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const base = new Date(actualStart);
  base.setDate(actualStart.getDate() - daysFromMonday);

  const result: SemanaInfo[] = [];

  for (let w = semanaInicio; w <= semanaFim; w++) {
    const seg = new Date(base);
    seg.setDate(base.getDate() + (w - 1) * 7);

    const diasBloqueados: string[] = [];
    const nomesF: string[] = [];

    for (let d = 0; d < 5; d++) {
      const dia = new Date(seg);
      dia.setDate(seg.getDate() + d);
      const nomeDia = DIAS_SEMANA[d];

      // Days before semester start
      if (dia < actualStart) {
        diasBloqueados.push(nomeDia);
        continue;
      }

      // Holidays / interruptions
      for (const f of feriados) {
        const fS = toDate(f.dataInicio);
        const fE = toDate(f.dataFim);
        if (dia >= fS && dia <= fE) {
          diasBloqueados.push(nomeDia);
          if (!nomesF.includes(f.nome)) nomesF.push(f.nome);
          break;
        }
      }
    }

    const diasUteis = 5 - diasBloqueados.length;
    const sex = new Date(seg);
    sex.setDate(seg.getDate() + 4);

    result.push({
      numero: w,
      dataSegunda: toISODate(seg),
      dataSexta: toISODate(sex),
      diasUteis: Math.max(0, diasUteis),
      fator: Math.max(0, diasUteis) / 5,
      feriadosNesta: nomesF,
      diasBloqueados,
    });
  }

  return result;
}

/**
 * Distribui N blocos pelas semanas proporcionalmente ao fator de disponibilidade.
 * Semanas com fator=0 (semana inteira bloqueada) recebem 0 blocos.
 */
function distribuirBlocos(totalBlocos: number, semanas: SemanaInfo[]): number[] {
  const totalFator = semanas.reduce((s, w) => s + w.fator, 0);
  if (!totalFator || !totalBlocos) return semanas.map(() => 0);

  const floats = semanas.map(s => (totalBlocos * s.fator) / totalFator);
  const result = floats.map(f => Math.floor(f));
  let rest = totalBlocos - result.reduce((a, b) => a + b, 0);

  const order = semanas
    .map((s, i) => ({ i, fator: s.fator, rem: floats[i] - result[i] }))
    .filter(x => x.fator > 0) // only distribute to weeks with available days
    .sort((a, b) => b.rem - a.rem || b.fator - a.fator);

  for (let k = 0; k < rest && k < order.length; k++) result[order[k].i]++;
  return result;
}

export function calcularPlano(uc: UC, semanas: SemanaInfo[]): PlanoSemanal[] {
  const blocosTotaisT  = Math.floor(uc.cargaHorariaTeorica / 2);
  const blocosTotaisTP = Math.floor(uc.cargaHorariaTP / 2);
  const blocosTotaisPL = Math.floor(uc.cargaHorariaPratica / 2);
  const blocosTotaisS  = Math.floor((uc.cargaHorariaS ?? 0) / 2);

  const distT  = distribuirBlocos(blocosTotaisT, semanas);
  const distTP = distribuirBlocos(blocosTotaisTP, semanas);
  const distPL = distribuirBlocos(blocosTotaisPL, semanas);
  const distS  = distribuirBlocos(blocosTotaisS, semanas);

  return semanas.map((semana, i) => ({
    semana,
    blocoT:  distT[i],
    blocoTP: distTP[i],
    blocoPL: distPL[i],
    blocoS:  distS[i],
  }));
}

// ---------------------------------------------------------------------------
// Day mapping — T on Mon/Tue, TP on Wed/Thu, PL on Thu/Fri (Thu first → lighter Fri).
// This day ordering implements the T→TP→PL interleaving within each week.
// Periods: morning 08/10/12, afternoon 14/16/18 (3 two-hour blocks each).
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const PERIODOS_MANHA = ["08:00", "10:00", "12:00"];
const PERIODOS_TARDE = ["14:00", "16:00", "18:00"];

const T_DIAS_PREF  = ["Segunda", "Terça"];
const TP_DIAS_PREF = ["Quarta", "Quinta"];
// PL primarily Thu/Fri; Wednesday is an overflow day (last priority) used when
// Thu/Fri capacity (6 PL per mancha) is exhausted, so all PL hours still fit.
const PL_DIAS_PREF = ["Quinta", "Sexta", "Quarta"];

const MAX_PL_POR_MANCHA = 6; // physical simulation labs per year

type Slot = { dia: string; hora: string };

/**
 * Builds the ordered slot pool for a given block type in a given week.
 *  - T always gets a pool: its preferred days (Mon/Tue), or — if those are
 *    blocked (e.g. a Thursday semester start) — the earliest available days,
 *    so every UC still begins with a Teórica.
 *  - TP/PL stay strictly on their preferred days; if those are blocked (e.g.
 *    a mid-week interruption) they get NO pool and carry forward to later weeks,
 *    never polluting the T days.
 */
function poolDoTipo(
  tipo: "T" | "TP" | "PL" | "S",
  diasBloqueados: string[],
  manha: boolean
): Slot[] {
  // Preferred half of the day first; the other half is appended as a LAST RESORT,
  // so e.g. the família-A morning fills completely before any of its blocks spill
  // into the afternoon (and vice-versa for família B). Different rooms host T/TP/PL,
  // so the binding limits are the student (one place at a time) and the 6 labs.
  const periodosPref = manha ? PERIODOS_MANHA : PERIODOS_TARDE;
  const periodosOver = manha ? PERIODOS_TARDE : PERIODOS_MANHA;
  const avail = WEEKDAYS.filter(d => !diasBloqueados.includes(d));
  if (!avail.length) return [];

  // Partial start week — when the Mon/Tue theory days are unavailable (e.g. a
  // Thursday semester start, leaving only Thu/Fri). The week must follow T → TP
  // on SEPARATE days, with NO PL at all (practicals only begin in a full week):
  //   1.ª 5ª-feira = Teórica,  6ª-feira = TP (opcional).
  if (!avail.includes("Segunda") && !avail.includes("Terça")) {
    if (tipo === "PL") return [];               // never any PL in this week
    const diasPartial = tipo === "T"
      ? avail.slice(0, 1)                        // T on the first available day (Thu)
      : avail.slice(1);                          // TP/S on the following day(s) (Fri)
    const slotsP: Slot[] = [];
    for (const dia of diasPartial) for (const hora of periodosPref) slotsP.push({ dia, hora });
    return slotsP;
  }

  // Preferred days first, then overflow days appended (used only when the
  // preferred days are full). Overflow preserves the T→TP→PL tendency:
  //   T  → Seg/Ter, overflow to later days
  //   TP → Qua/Qui, overflow to Ter then Sex (adjacent, still after T)
  //   PL → Qui/Sex/Qua, overflow to Ter then Seg (latest first)
  // This lets the week fill densely when the volume is high, instead of
  // starving later UCs, while normal (low-pressure) weeks keep the clean mapping.
  let ordemDias: string[];
  if (tipo === "T") {
    // Teóricas own Seg/Ter. If both are blocked (e.g. Thursday semester start),
    // fall back to the earliest available days so the UC still begins with a T.
    const pref = ["Segunda", "Terça"].filter(d => avail.includes(d));
    ordemDias = pref.length ? pref : avail.slice(0, 2);
  } else if (tipo === "TP") {
    // TP spreads across Qua/Qui, then overflows to Terça e Sexta (still after the
    // Monday/Tuesday theory), keeping the T→TP→PL progression.
    ordemDias = ["Quarta", "Quinta", "Terça", "Sexta"];
  } else if (tipo === "PL") {
    // PL prefers Qui/Sex/Qua. Only as a LAST RESORT (when those manchas are full
    // for the whole UC) does it spill onto Ter/Seg, so the week can still be filled
    // instead of dropping practical hours.
    ordemDias = ["Quinta", "Sexta", "Quarta", "Terça", "Segunda"];
  } else {
    ordemDias = ["Terça", "Sexta"];
  }
  const dias = ordemDias.filter(d => avail.includes(d));
  if (!dias.length) return [];

  const slots: Slot[] = [];
  // Preferred half (own period) across the preferred days …
  for (const dia of dias) for (const hora of periodosPref) slots.push({ dia, hora });
  // … then the other half as LAST RESORT — only for PL, the over-subscribed type.
  // T and TP fit in their own half, so they never cross over (keeps família A in the
  // morning / família B in the afternoon, except for the genuine PL excess).
  if (tipo === "PL") {
    for (const dia of dias) for (const hora of periodosOver) slots.push({ dia, hora });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Conflict model — keys are namespaced by ANO so that e.g. PL1 of year 1 and
// PL1 of year 2 are independent student groups (no false conflict).
// ---------------------------------------------------------------------------

export type OcupacaoGlobal = Set<string>;
export type ContagemPL = Map<string, number>; // `${ano}|${semana}|${dia}|${hora}` → nº de PL nessa mancha

function slotKey(ano: number, semanaGlobal: number, turma: string, dia: string, hora: string): string {
  return `${ano}|${semanaGlobal}|${turma}|${dia}|${hora}`;
}

function manchaKey(ano: number, semanaGlobal: number, dia: string, hora: string): string {
  return `${ano}|${semanaGlobal}|${dia}|${hora}`;
}

/**
 * Only turmas that literally share the same students create conflicts:
 * - Turma A T-session requires ALL Turma A students → blocks TP1-4 and PL1-12
 * - TP1 uses its 45 students → blocks its own PLs (PL1-3) and Turma A T
 *   but NOT sibling TPs (TP2-4 are different students)
 * - PL1 uses its 15 students → blocks TP1 and Turma A T only
 */
function gruposConflitantes(turma: string): string[] {
  const all = new Set<string>([turma]);

  if (turma === "Turma A") {
    ["TP1","TP2","TP3","TP4"].forEach(t => all.add(t));
    for (let i = 1; i <= 12; i++) all.add(`PL${i}`);
  } else if (turma === "Turma B") {
    ["TP5","TP6","TP7","TP8"].forEach(t => all.add(t));
    for (let i = 13; i <= 24; i++) all.add(`PL${i}`);
  } else if (/^TP\d+$/.test(turma)) {
    const n = parseInt(turma.slice(2));
    all.add(n <= 4 ? "Turma A" : "Turma B");
    const plStart = (n - 1) * 3 + 1;
    for (let i = plStart; i <= plStart + 2; i++) all.add(`PL${i}`);
  } else if (/^PL\d+$/.test(turma)) {
    const n = parseInt(turma.slice(2));
    const tpIdx = Math.ceil(n / 3);
    all.add(`TP${tpIdx}`);
    all.add(tpIdx <= 4 ? "Turma A" : "Turma B");
  }

  return Array.from(all);
}

function registarSlot(
  ocupacao: OcupacaoGlobal,
  ano: number,
  semanaGlobal: number,
  turma: string,
  dia: string,
  hora: string
): void {
  // Lunch protection: a group that has the 12:00–14:00 block cannot also take
  // 14:00–16:00 (and vice-versa), so there is always a free midday block for lunch.
  // This matters mainly when a turma spills across the midday (morning + afternoon).
  const horaAlmoco = hora === "12:00" ? "14:00" : hora === "14:00" ? "12:00" : null;
  for (const g of gruposConflitantes(turma)) {
    ocupacao.add(slotKey(ano, semanaGlobal, g, dia, hora));
    if (horaAlmoco) ocupacao.add(slotKey(ano, semanaGlobal, g, dia, horaAlmoco));
  }
}

/**
 * Finds the first available slot in the pool for this turma+week, skipping
 * already-occupied slots and (for PL) slots that already hold the max of 6
 * simultaneous PL of that year.
 */
function encontrarSlotLivre(
  pool: Slot[],
  ano: number,
  semanaGlobal: number,
  turma: string,
  tipo: "T" | "TP" | "PL" | "S",
  ocupacao: OcupacaoGlobal,
  plCount: ContagemPL,
  startIdx: number
): Slot | null {
  if (!pool.length) return null;
  for (let i = 0; i < pool.length; i++) {
    const slot = pool[(startIdx + i) % pool.length];
    if (ocupacao.has(slotKey(ano, semanaGlobal, turma, slot.dia, slot.hora))) continue;
    if (tipo === "PL") {
      const c = plCount.get(manchaKey(ano, semanaGlobal, slot.dia, slot.hora)) || 0;
      if (c >= MAX_PL_POR_MANCHA) continue; // max 6 PL per mancha per year
    }
    return slot;
  }
  return null;
}

/**
 * Generates sessions for a UC across all its weeks.
 *
 * Volume model (per the coordinator's rule):
 *   carga is per-turma TOTAL hours. Each T/TP/PL turma must fulfil its own hours.
 *   e.g. 10h T → every T turma gets 5 blocks of 2h. With 2 T turmas that's 10 T blocks;
 *   10h TP → 5 blocks × 8 TP turmas = 40 TP blocks; 10h PL → 5 × 24 = 120 PL blocks.
 *
 * Placement rules:
 *  - T on Mon/Tue, TP on Wed/Thu, PL on Thu/Fri (Fri last → lighter Fridays).
 *    The day pools structurally enforce the T→TP→PL ordering within each week.
 *  - No sessions on blocked days (holidays, interruptions, pre-semester days).
 *  - Non-conflicting turmas may share a time slot (e.g. several PL of different
 *    parents + several TP of different families in the same mancha horária).
 *  - Each turma's full block total is guaranteed: blocks that cannot be placed in
 *    their proportional week carry forward to later weeks so nothing is lost.
 */
export function gerarSessoes(
  uc: UC,
  semanas: SemanaInfo[],
  semestre: 1 | 2,
  idOffset: number = 0,
  ocupacao: OcupacaoGlobal = new Set(),
  semanaGlobalOffset: number = 0,
  plCount: ContagemPL = new Map()
): SessaoHorario[] {
  if (!uc.turmasConfig?.length) return [];

  const ano = Number(uc.anoCurricular) || 1;
  const sessoes: SessaoHorario[] = [];
  let id = idOffset;

  const tTurmas  = uc.turmasConfig.filter(t => t.tipo === "Teórica");
  const tpTurmas = uc.turmasConfig.filter(t => t.tipo === "TeoricoPratica");
  const plTurmas = uc.turmasConfig.filter(t => t.tipo === "Prática");
  const sTurmas  = uc.turmasConfig.filter(t => t.tipo === "Seminário");

  // S1: Turma A family in morning; S2: Turma A family in afternoon
  const turmaAManha = semestre === 1;

  // Weeks that have at least one usable day (skip fully-blocked weeks entirely)
  const semanasValidas = semanas.filter(s => s.fator > 0);
  const totalFator = semanasValidas.reduce((a, s) => a + s.fator, 0) || 1;

  /**
   * Distributes `totalBlocks` of one turma across the valid weeks, guaranteeing
   * the total when physical space exists. Proportional per-week target by fator,
   * with carry-forward of any blocks that don't fit a given week. The slot pool
   * is rebuilt per week (so blocked days and the T-fallback are respected).
   */
  const distribuirTurma = (
    turmaNome: string,
    totalBlocks: number,
    tipoAula: "T" | "TP" | "PL" | "S",
    salaTipo: string,
    manha: boolean
  ) => {
    if (totalBlocks <= 0) return;

    // Proportional target per valid week (largest remainder method)
    const floats = semanasValidas.map(s => (totalBlocks * s.fator) / totalFator);
    const targets = floats.map(f => Math.floor(f));
    const rest = totalBlocks - targets.reduce((a, b) => a + b, 0);
    semanasValidas
      .map((_, i) => ({ i, rem: floats[i] - targets[i] }))
      .sort((a, b) => b.rem - a.rem)
      .slice(0, rest)
      .forEach(o => { targets[o.i]++; });

    const tryPlace = (semana: SemanaInfo): boolean => {
      const semanaGlobal = semana.numero + semanaGlobalOffset;
      const pool = poolDoTipo(tipoAula, semana.diasBloqueados, manha);
      const slot = encontrarSlotLivre(pool, ano, semanaGlobal, turmaNome, tipoAula, ocupacao, plCount, 0);
      if (!slot) return false;
      registarSlot(ocupacao, ano, semanaGlobal, turmaNome, slot.dia, slot.hora);
      if (tipoAula === "PL") {
        const mk = manchaKey(ano, semanaGlobal, slot.dia, slot.hora);
        plCount.set(mk, (plCount.get(mk) || 0) + 1);
      }
      sessoes.push({
        id: ++id, ucNome: uc.nome, ucSigla: uc.sigla, tipoAula,
        docente: "", sala: "", salaTipo,
        turma: turmaNome, diaSemana: slot.dia, horaInicio: slot.hora,
        horaFim: addHours(slot.hora, 2), bloqueado: false, semana: semanaGlobal,
      });
      return true;
    };

    let placed = 0;
    let carry = 0;

    // Pass 1: proportional per-week target with carry-forward
    for (let i = 0; i < semanasValidas.length; i++) {
      const quota = Math.min(targets[i] + carry, totalBlocks - placed);
      let placedThisWeek = 0;
      for (let k = 0; k < quota; k++) {
        if (tryPlace(semanasValidas[i])) { placed++; placedThisWeek++; }
        else break; // week saturated for this turma — carry the rest
      }
      carry = quota - placedThisWeek;
    }

    // Pass 2: if blocks remain (early weeks were short), cram into any week with free slots
    let progress = true;
    while (placed < totalBlocks && progress) {
      progress = false;
      for (let i = 0; i < semanasValidas.length && placed < totalBlocks; i++) {
        if (tryPlace(semanasValidas[i])) { placed++; progress = true; }
      }
    }
  };

  // Process T first, then TP, then PL: within a week T occupies its (earlier)
  // slots before TP/PL try theirs, so the student always starts with Teórica.

  // --- T ---
  tTurmas.forEach((turma, ti) => {
    const isA = turma.nome === "Turma A" || ti % 2 === 0;
    const manha = (isA && turmaAManha) || (!isA && !turmaAManha);
    distribuirTurma(turma.nome, Math.floor(uc.cargaHorariaTeorica / 2), "T",
      "Anfiteatro (Teórica T)", manha);
  });

  // --- TP — TP1-4 → family A, TP5-8 → family B ---
  tpTurmas.forEach((turma, ti) => {
    const inA = ti < 4;
    const manha = (inA && turmaAManha) || (!inA && !turmaAManha);
    distribuirTurma(turma.nome, Math.floor(uc.cargaHorariaTP / 2), "TP",
      "Sala Comum TP", manha);
  });

  // --- PL — PL1-12 → family A, PL13-24 → family B ---
  plTurmas.forEach((turma, ti) => {
    const inA = ti < 12;
    const manha = (inA && turmaAManha) || (!inA && !turmaAManha);
    distribuirTurma(turma.nome, Math.floor(uc.cargaHorariaPratica / 2), "PL",
      "Laboratório de Simulação PL", manha);
  });

  // --- S ---
  sTurmas.forEach((turma) => {
    distribuirTurma(turma.nome, Math.floor((uc.cargaHorariaS ?? 0) / 2), "S",
      "Sala Comum TP", turmaAManha);
  });

  return sessoes;
}

// ===========================================================================
// Fair multi-UC scheduler
// ---------------------------------------------------------------------------
// Distributes ALL UCs of a semester together, week by week, round-robin across
// UCs, so that no UC monopolises the limited PL manchas and starves the others.
// Processing happens in 3 phases (T → TP → PL → S) so that, globally, every
// Teórica is laid down before TP, and every TP before PL.
// ===========================================================================

export interface EntradaUC {
  uc: UC;
  semanas: SemanaInfo[];
  semanaGlobalOffset: number;
}

export function gerarSessoesConjunto(
  entradas: EntradaUC[],
  semestre: 1 | 2,
  idStart: number = 0,
  ocupacao: OcupacaoGlobal = new Set(),
  plCount: ContagemPL = new Map()
): SessaoHorario[] {
  const sessoes: SessaoHorario[] = [];
  let id = idStart;
  const turmaAManha = semestre === 1;

  interface WeekRef { semanaGlobal: number; diasBloqueados: string[]; }
  interface Task {
    ano: number; ucNome: string; ucSigla: string; ucKey: string; family: "A" | "B";
    turmaNome: string; tipo: "T" | "TP" | "PL" | "S"; salaTipo: string; manha: boolean;
    weeks: WeekRef[]; total: number; placed: number;
  }

  const buildWeeks = (semanas: SemanaInfo[], offset: number): WeekRef[] =>
    semanas.filter(s => s.fator > 0).map(s => ({
      semanaGlobal: s.numero + offset,
      diasBloqueados: s.diasBloqueados,
    }));

  // Cumulative T/TP/PL counts per (UC, família) — drives the T→TP→PL gating so that,
  // for every UC, a TP only appears once its T is proportionally ahead, and a PL only
  // once its TP is ahead.
  interface Stat { placedT: number; totalT: number; placedTP: number; totalTP: number; placedPL: number; totalPL: number; }
  const stats = new Map<string, Stat>();
  const statKeyOf = (t: Task) => `${t.ucKey}|${t.family}`;
  const getStat = (k: string): Stat => {
    let s = stats.get(k);
    if (!s) { s = { placedT: 0, totalT: 0, placedTP: 0, totalTP: 0, placedPL: 0, totalPL: 0 }; stats.set(k, s); }
    return s;
  };

  // Build the flat task list (one per UC × turma) and accumulate per-família totals.
  const tasks: Task[] = [];
  for (const { uc, semanas, semanaGlobalOffset } of entradas) {
    if (!uc.turmasConfig?.length) continue;
    const ano = Number(uc.anoCurricular) || 1;
    const weeks = buildWeeks(semanas, semanaGlobalOffset);
    const add = (turmaNome: string, tipo: Task["tipo"], salaTipo: string, manha: boolean, family: "A" | "B", total: number) => {
      if (total <= 0) return;
      tasks.push({ ano, ucNome: uc.nome, ucSigla: uc.sigla, ucKey: uc.id, family, turmaNome, tipo, salaTipo, manha, weeks, total, placed: 0 });
      const s = getStat(`${uc.id}|${family}`);
      if (tipo === "T") s.totalT += total; else if (tipo === "TP") s.totalTP += total; else if (tipo === "PL") s.totalPL += total;
    };
    uc.turmasConfig.filter(t => t.tipo === "Teórica").forEach((t, i) => {
      const isA = t.nome === "Turma A" || i % 2 === 0;
      add(t.nome, "T", "Anfiteatro (Teórica T)", (isA && turmaAManha) || (!isA && !turmaAManha), isA ? "A" : "B", Math.floor(uc.cargaHorariaTeorica / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "TeoricoPratica").forEach((t, i) => {
      const inA = i < 4;
      add(t.nome, "TP", "Sala Comum TP", (inA && turmaAManha) || (!inA && !turmaAManha), inA ? "A" : "B", Math.floor(uc.cargaHorariaTP / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "Prática").forEach((t, i) => {
      const inA = i < 12;
      add(t.nome, "PL", "Laboratório de Simulação PL", (inA && turmaAManha) || (!inA && !turmaAManha), inA ? "A" : "B", Math.floor(uc.cargaHorariaPratica / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "Seminário").forEach((t) => {
      add(t.nome, "S", "Sala Comum TP", turmaAManha, "A", Math.floor((uc.cargaHorariaS ?? 0) / 2));
    });
  }

  const tryPlace = (t: Task, wk: WeekRef): boolean => {
    const pool = poolDoTipo(t.tipo, wk.diasBloqueados, t.manha);
    const slot = encontrarSlotLivre(pool, t.ano, wk.semanaGlobal, t.turmaNome, t.tipo, ocupacao, plCount, 0);
    if (!slot) return false;
    registarSlot(ocupacao, t.ano, wk.semanaGlobal, t.turmaNome, slot.dia, slot.hora);
    if (t.tipo === "PL") {
      const k = manchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora);
      plCount.set(k, (plCount.get(k) || 0) + 1);
    }
    t.placed++;
    const s = getStat(statKeyOf(t));
    if (t.tipo === "T") s.placedT++; else if (t.tipo === "TP") s.placedTP++; else if (t.tipo === "PL") s.placedPL++;
    sessoes.push({
      id: ++id, ucNome: t.ucNome, ucSigla: t.ucSigla, tipoAula: t.tipo,
      docente: "", sala: "", salaTipo: t.salaTipo,
      turma: t.turmaNome, diaSemana: slot.dia, horaInicio: slot.hora,
      horaFim: addHours(slot.hora, 2), bloqueado: false, semana: wk.semanaGlobal,
    });
    return true;
  };

  // Gates: a TP may be placed only when its UC/família's T is proportionally ahead;
  // a PL only when the TP (or T, if there is no TP) is ahead. This guarantees that,
  // within each UC, no TP happens before a T and no PL before a TP.
  const canTP = (t: Task): boolean => {
    const s = getStat(statKeyOf(t));
    return s.totalT === 0 || (s.placedT / s.totalT) > (s.placedTP / s.totalTP);
  };
  const canPL = (t: Task): boolean => {
    const s = getStat(statKeyOf(t));
    if (s.totalTP > 0) return (s.placedTP / s.totalTP) > (s.placedPL / s.totalPL);
    return s.totalT === 0 || (s.placedT / s.totalT) > (s.placedPL / s.totalPL);
  };

  const tTasks  = tasks.filter(t => t.tipo === "T");
  const tpTasks = tasks.filter(t => t.tipo === "TP");
  const plTasks = tasks.filter(t => t.tipo === "PL");
  const sTasks  = tasks.filter(t => t.tipo === "S");

  // Place one phase within one week: max-min fair (least-complete task first), with a
  // soft per-week cap so blocks spread across weeks instead of front-loading, and an
  // optional T→TP→PL gate.
  interface Active { t: Task; wk: WeekRef; cap: number; }
  const placeWeek = (phaseTasks: Task[], W: number, gate: ((t: Task) => boolean) | null) => {
    const active: Active[] = phaseTasks
      .map(t => ({ t, wk: t.weeks.find(w => w.semanaGlobal === W) }))
      .filter(a => a.wk && a.t.placed < a.t.total)
      .map(a => ({ t: a.t, wk: a.wk!, cap: Math.max(1, Math.ceil(a.t.total / Math.max(1, a.t.weeks.length))) + 1 }));
    const done = new Map<Task, number>();
    const stuck = new Set<Task>();
    while (true) {
      let best: Active | null = null;
      let bestRatio = Infinity;
      for (const a of active) {
        if (stuck.has(a.t) || (done.get(a.t) || 0) >= a.cap || a.t.placed >= a.t.total) continue;
        if (gate && !gate(a.t)) continue;
        const ratio = a.t.placed / a.t.total;
        if (ratio < bestRatio) { bestRatio = ratio; best = a; }
      }
      if (!best) break;
      if (tryPlace(best.t, best.wk)) done.set(best.t, (done.get(best.t) || 0) + 1);
      else stuck.add(best.t);
    }
  };

  // Cram leftover (gated, fair): place any remaining blocks in any of their weeks.
  const cram = (phaseTasks: Task[], gate: ((t: Task) => boolean) | null) => {
    const exhausted = new Set<Task>();
    while (true) {
      let best: Task | null = null;
      let bestRatio = Infinity;
      for (const t of phaseTasks) {
        if (t.placed >= t.total || exhausted.has(t)) continue;
        if (gate && !gate(t)) continue;
        const ratio = t.placed / t.total;
        if (ratio < bestRatio) { bestRatio = ratio; best = t; }
      }
      if (!best) break;
      let placedOne = false;
      for (const w of best.weeks) { if (tryPlace(best, w)) { placedOne = true; break; } }
      if (!placedOne) exhausted.add(best);
    }
  };

  const allWeeks = [...new Set(tasks.flatMap(t => t.weeks.map(w => w.semanaGlobal)))].sort((a, b) => a - b);
  // Chronological: each week lays T, then the gated TP, then the gated PL.
  for (const W of allWeeks) {
    placeWeek(tTasks,  W, null);
    placeWeek(tpTasks, W, canTP);
    placeWeek(plTasks, W, canPL);
    placeWeek(sTasks,  W, null);
  }
  // Finish anything left, respecting the same gates.
  cram(tTasks, null);
  cram(tpTasks, canTP);
  cram(plTasks, canPL);
  cram(sTasks, null);

  return sessoes;
}
