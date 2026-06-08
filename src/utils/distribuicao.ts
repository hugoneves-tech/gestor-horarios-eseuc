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
  manha: boolean,
  rotacao: number = 0,   // roda a ordem dos períodos por semana (Regra B: não estar sempre cedo/tarde)
  flexivel: boolean = false // PL de MI: qualquer dia, no período da família (tapa-buracos)
): Slot[] {
  const rotN = (a: string[], off: number) => { const n = ((off % a.length) + a.length) % a.length; return a.slice(n).concat(a.slice(0, n)); };
  const baseMetade = manha ? PERIODOS_MANHA : PERIODOS_TARDE;
  // Período preferido DEPENDE DO DIA (rotação dia-a-dia): cada UC avança um período de
  // um dia para o outro. Ex.: FT quinta@08 → sexta@10. (rotacao = base da UC + semana.)
  const periodosPrefDia = (dia: string) => rotN(baseMetade, rotacao + WEEKDAYS.indexOf(dia));
  // Bloco de AJUSTE na metade oposta — SEMPRE um único bloco adjacente ao almoço,
  // igual para T/TP e PL (manhã→16h, depois do almoço 14-16; tarde→10h, antes do
  // almoço 12-14). Aí cabem 2 TP + 6 PL (emparelhamento) = 180 alunos no bloco extra.
  const periodosOver = manha ? ["16:00"] : ["10:00"];
  const avail = WEEKDAYS.filter(d => !diasBloqueados.includes(d));
  if (!avail.length) return [];

  // PL flexível (MI, salas de computadores): qualquer dia disponível, no período
  // da família. Serve de "cola" para compactar o dia (tapar buracos).
  if (flexivel) {
    const slotsF: Slot[] = [];
    for (const dia of avail) for (const hora of periodosPrefDia(dia)) slotsF.push({ dia, hora });
    return slotsF;
  }

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
    for (const dia of diasPartial) for (const hora of periodosPrefDia(dia)) slotsP.push({ dia, hora });
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
    // Teóricas no INÍCIO da semana (Seg/Ter) — a teoria (conteúdo) vem primeiro.
    const pref = ["Segunda", "Terça"].filter(d => avail.includes(d));
    ordemDias = pref.length ? pref : avail.slice(0, 2);
  } else if (tipo === "TP") {
    // TP a meio da semana (Qua/Qui), transborda para Ter/Sex (depois da teoria).
    ordemDias = ["Quarta", "Quinta", "Terça", "Sexta"];
  } else if (tipo === "PL") {
    // PL no fim da semana (Qui/Sex/Qua); só em último recurso Ter/Seg, para encher.
    ordemDias = ["Quinta", "Sexta", "Quarta", "Terça", "Segunda"];
  } else {
    ordemDias = ["Terça", "Sexta"];
  }
  const dias = ordemDias.filter(d => avail.includes(d));
  if (!dias.length) return [];

  const slots: Slot[] = [];
  // Preferred half (own period) across the preferred days, rotação por dia …
  for (const dia of dias) for (const hora of periodosPrefDia(dia)) slots.push({ dia, hora });
  // … then the other half como ÚLTIMO RECURSO — para PL e TP (ex.: TP da Turma B
  // no bloco 10h-12h). Só a Teórica (T, 180 alunos no anfiteatro) fica na sua metade.
  if (tipo === "PL" || tipo === "TP") {
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

// Conjuntos de salas práticas independentes. As PL de laboratório de simulação
// e as PL de sala de computadores ocupam espaços diferentes → contadores separados,
// podendo decorrer em simultâneo. (ex.: MI usa salas de computadores.)
export type SalaPool = "lab" | "comp";
const UCS_PL_COMPUTADOR = new Set(["MI"]); // UCs cujas PL decorrem em salas de computadores
const MAX_PL_POR_POOL: Record<SalaPool, number> = { lab: 6, comp: 6 };

function manchaKey(ano: number, semanaGlobal: number, dia: string, hora: string, pool: SalaPool = "lab"): string {
  return `${ano}|${semanaGlobal}|${dia}|${hora}|${pool}`;
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

/**
 * Grupos-folha de ALUNOS (PL) abrangidos por uma turma. Como cada aluno pertence
 * a exatamente um grupo de PL, contar blocos/dia por estes grupos = nº de horas
 * que cada aluno tem nesse dia. Serve para o limite de 8h/dia (4 blocos).
 *   Turma A → PL1..PL12 ; Turma B → PL13..PL24
 *   TP_i    → as suas 3 PL ; PL_j → a própria
 */
function gruposAlunoFolha(turma: string): string[] {
  if (turma === "Turma A") return Array.from({ length: 12 }, (_, i) => `PL${i + 1}`);
  if (turma === "Turma B") return Array.from({ length: 12 }, (_, i) => `PL${i + 13}`);
  if (/^TP\d+$/.test(turma)) {
    const n = parseInt(turma.slice(2));
    const plStart = (n - 1) * 3 + 1;
    return [plStart, plStart + 1, plStart + 2].map(i => `PL${i}`);
  }
  if (/^PL\d+$/.test(turma)) return [turma];
  return [turma]; // T/Seminário sem desdobramento conhecido: conta como o próprio
}

/**
 * Meio-cohort de uma turma TP/PL, para o emparelhamento cruzado TP∥PL entre UCs:
 *   A1 = TP1,TP2 = PL1-6 ; A2 = TP3,TP4 = PL7-12 (família A)
 *   B1 = TP5,TP6 = PL13-18 ; B2 = TP7,TP8 = PL19-24 (família B)
 * A TP de uma UC (meio-cohort X) pode partilhar mancha com a PL de OUTRA UC do
 * meio-cohort COMPLEMENTAR (alunos disjuntos) — ex.: TP1+TP2 ∥ PL7-12.
 */
function meioCohort(turma: string): "A1" | "A2" | "B1" | "B2" | null {
  if (/^TP\d+$/.test(turma)) {
    const n = parseInt(turma.slice(2));
    if (n === 1 || n === 2) return "A1"; if (n === 3 || n === 4) return "A2";
    if (n === 5 || n === 6) return "B1"; if (n === 7 || n === 8) return "B2";
  }
  if (/^PL\d+$/.test(turma)) {
    const n = parseInt(turma.slice(2));
    if (n >= 1 && n <= 6) return "A1"; if (n >= 7 && n <= 12) return "A2";
    if (n >= 13 && n <= 18) return "B1"; if (n >= 19 && n <= 24) return "B2";
  }
  return null;
}
const COMPLEMENTO_COHORT: Record<string, string> = { A1: "A2", A2: "A1", B1: "B2", B2: "B1" };

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
  startIdx: number,
  salaPool: SalaPool = "lab"
): Slot | null {
  if (!pool.length) return null;
  for (let i = 0; i < pool.length; i++) {
    const slot = pool[(startIdx + i) % pool.length];
    if (ocupacao.has(slotKey(ano, semanaGlobal, turma, slot.dia, slot.hora))) continue;
    if (tipo === "PL") {
      // Cap por conjunto de salas: lab e comp são contados em separado.
      const c = plCount.get(manchaKey(ano, semanaGlobal, slot.dia, slot.hora, salaPool)) || 0;
      if (c >= MAX_PL_POR_POOL[salaPool]) continue;
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

export interface OpcoesDistribuicao {
  // Se definido, as PL só podem ser colocadas nestes dias da semana (ex.: ["Quarta","Quinta","Sexta"]).
  plDiasPermitidos?: string[] | null;
  // Nº de salas de TP disponíveis = máximo de TP em simultâneo por mancha.
  // Não definido = sem limite (4 TP podem coexistir). Com 2 salas → emerge o padrão 2 TP + 6 PL.
  maxTPporMancha?: number | null;
  // Preferência manhã/tarde da turma teórica (Turma A) por ano+semestre.
  // Chave `${ano}|${semestre}` → true = manhã, false = tarde. Sem entrada = manhã no S1.
  prefTurmaAManha?: Record<string, boolean>;
}

export function gerarSessoesConjunto(
  entradas: EntradaUC[],
  semestre: 1 | 2,
  idStart: number = 0,
  ocupacao: OcupacaoGlobal = new Set(),
  plCount: ContagemPL = new Map(),
  opts: OpcoesDistribuicao = {}
): SessaoHorario[] {
  const sessoes: SessaoHorario[] = [];
  let id = idStart;
  // Preferência manhã/tarde da Turma A por ano (e semestre desta chamada).
  const turmaAManhaDe = (ano: number): boolean =>
    opts.prefTurmaAManha?.[`${ano}|${semestre}`] ?? (semestre === 1);

  interface WeekRef { semanaGlobal: number; diasBloqueados: string[]; }
  interface Task {
    ano: number; ucNome: string; ucSigla: string; ucKey: string; family: "A" | "B";
    turmaNome: string; tipo: "T" | "TP" | "PL" | "S"; salaTipo: string; manha: boolean;
    salaPool: SalaPool;   // "comp" (salas de computadores, ex. MI) ou "lab"
    flexivel: boolean;    // PL de MI: qualquer dia/período (tapa-buracos)
    exemptaGate: boolean; // MI: não está sujeita ao gate rígido T→TP→PL
    rotaBase: number;     // deslocamento de período por UC (rotação semanal ESDAC@08/MI@10/FT@12)
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
  // rotaBase por UC (índice por ano) → cada UC arranca num período diferente da sua
  // metade e roda por semana: ex. sem.1 ESDAC@08, MI@10, FT@12; sem.2 roda.
  const tasks: Task[] = [];
  const rotaBasePorAno = new Map<number, number>();
  for (const { uc, semanas, semanaGlobalOffset } of entradas) {
    if (!uc.turmasConfig?.length) continue;
    const ano = Number(uc.anoCurricular) || 1;
    const rotaBase = rotaBasePorAno.get(ano) ?? 0;
    rotaBasePorAno.set(ano, rotaBase + 1);
    const turmaAManha = turmaAManhaDe(ano);
    const weeks = buildWeeks(semanas, semanaGlobalOffset);
    const usaComputador = UCS_PL_COMPUTADOR.has(uc.sigla);
    const ehFlexivel = usaComputador; // MI: UC flexível (tapa-buracos)
    // Semanas escolhidas para PL (relativas ao semestre), se definidas na UC.
    const semanasPLPref = Array.isArray(uc.semanasPL) && uc.semanasPL.length
      ? new Set(uc.semanasPL) : null;
    // PL de MI só a partir da 3.ª semana (relativa) — e espalham-se até ao fim.
    const weeksPL_MI = weeks.filter(w => (w.semanaGlobal - semanaGlobalOffset) >= 3);
    // Semanas onde as PL desta UC podem decorrer (interseção da preferência com as válidas).
    const weeksPL_base = ehFlexivel ? weeksPL_MI : weeks;
    const weeksPL = semanasPLPref
      ? weeksPL_base.filter(w => semanasPLPref.has(w.semanaGlobal - semanaGlobalOffset))
      : weeksPL_base;
    const add = (turmaNome: string, tipo: Task["tipo"], salaTipo: string, manha: boolean, family: "A" | "B", total: number) => {
      if (total <= 0) return;
      const salaPool: SalaPool = tipo === "PL" && usaComputador ? "comp" : "lab";
      const flexivel = ehFlexivel && tipo === "PL";
      const wks = tipo === "PL" ? weeksPL : weeks;
      tasks.push({ ano, ucNome: uc.nome, ucSigla: uc.sigla, ucKey: uc.id, family, turmaNome, tipo, salaTipo, manha, salaPool, flexivel, exemptaGate: ehFlexivel, rotaBase, weeks: wks, total, placed: 0 });
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
      const salaTipoPL = usaComputador ? "Sala de Computadores PL" : "Laboratório de Simulação PL";
      add(t.nome, "PL", salaTipoPL, (inA && turmaAManha) || (!inA && !turmaAManha), inA ? "A" : "B", Math.floor(uc.cargaHorariaPratica / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "Seminário").forEach((t) => {
      add(t.nome, "S", "Sala Comum TP", turmaAManha, "A", Math.floor((uc.cargaHorariaS ?? 0) / 2));
    });
  }

  // Meios-cohorts de TP presentes em cada mancha (de QUALQUER UC). Serve o
  // emparelhamento cruzado TP∥PL: a PL de um meio-cohort encosta-se a uma mancha que
  // já tenha a TP do meio-cohort COMPLEMENTAR (alunos disjuntos). Ex.: PL7-12 (A2)
  // prefere mancha com TP1+TP2 (A1), seja da mesma UC ou de outra.
  const tpCohortMancha = new Map<string, Set<string>>(); // `${ano}|${week}|${dia}|${hora}` → {A1,A2,B1,B2}
  const tpUCs = new Map<string, Set<string>>(); // `${ano}|${week}|${dia}|${hora}` → {ucKey...} (agrupar TP por UC)
  const tpUCCohort = new Map<string, Set<string>>(); // mancha → {`${ucKey}|${meioCohort}`...}
  const plUCs = new Map<string, Set<string>>(); // mancha → {ucKey...} com PL (não misturar PL de UCs diferentes)
  // Semanas em que cada (UC, família) tem PL → nessas semanas parte-se a TP em 2+2 para
  // emparelhar com as 6 PL (bloco cheio 2TP+6PL). Fora delas, agrupam-se as 4 TP.
  const plSemanas = new Set<string>(); // `${ucKey}|${family}|${week}`
  for (const t of tasks) if (t.tipo === "PL") for (const w of t.weeks) plSemanas.add(`${t.ucKey}|${t.family}|${w.semanaGlobal}`);
  // Limite de TP em simultâneo por mancha = nº de salas de TP. Com 2 salas, as 4 TP
  // de uma família partem-se por 2 manchas e sobram slots para as 6 PL desdobradas
  // das outras 2 TP. Sem limite definido, 4 TP podem coexistir (não se descarta).
  // Máx. TP da MESMA UC por mancha (uma família: TP1-4 ou TP5-8). Por defeito 4 — uma
  // UC nunca tem 8 TPs no mesmo bloco (docentes a mais). Mas DUAS UCs diferentes podem
  // partilhar o bloco (ex.: Turma B de uma UC + Turma A em overflow de OUTRA UC = 4+4).
  const MAX_TP_POR_UC_MANCHA = (opts.maxTPporMancha && opts.maxTPporMancha > 0) ? opts.maxTPporMancha : 4;
  const tpCount = new Map<string, number>(); // `${ano}|${week}|${dia}|${hora}` → nº de TP
  const tpManchaKey = (ano: number, week: number, dia: string, hora: string) => `${ano}|${week}|${dia}|${hora}`;
  // Carga diária por aluno (grupo-folha PL): base de 6h (3 blocos) numa só metade do dia
  // e, no MÁXIMO, UM dia por semana a 8h (4 blocos). Nunca mais de 8h.
  const MAX_BLOCOS_DIA = 4;     // teto absoluto = 8h/dia
  const diaCount = new Map<string, number>(); // `${ano}|${week}|${dia}|${plGroup}` → nº de blocos
  const diaKey = (ano: number, week: number, dia: string, g: string) => `${ano}|${week}|${dia}|${g}`;
  // Evitar 2 blocos CONSECUTIVOS da mesma (UC,turma,tipo) no mesmo dia (sem 4h seguidas
  // da mesma UC). Não é cap por dia (que partia a completude) — só proíbe a adjacência.
  const TODOS_PERIODOS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
  const turmaPeriodos = new Map<string, Set<string>>(); // `${ano}|${week}|${dia}|${turma}|${tipo}` → horas
  const ttKey = (ano: number, week: number, dia: string, turma: string, tipo: string) => `${ano}|${week}|${dia}|${turma}|${tipo}`;
  const adjacenteOcupado = (ano: number, week: number, dia: string, turma: string, tipo: string, hora: string) => {
    const set = turmaPeriodos.get(ttKey(ano, week, dia, turma, tipo));
    if (!set) return false;
    const i = TODOS_PERIODOS.indexOf(hora);
    return (i > 0 && set.has(TODOS_PERIODOS[i - 1])) || (i < 5 && set.has(TODOS_PERIODOS[i + 1]));
  };

  const tryPlace = (t: Task, wk: WeekRef): boolean => {
    // Rotação por UC: base distinta por UC (período de arranque) + variação por semana.
    // Em poolDoTipo soma-se ainda o índice do dia → rotação dia-a-dia (FT qui@08→sex@10).
    const rotacao = t.rotaBase + wk.semanaGlobal - 1;
    let pool = poolDoTipo(t.tipo, wk.diasBloqueados, t.manha, rotacao, t.flexivel);
    // Sem 2 blocos CONSECUTIVOS da mesma Teórica no dia (sem 4h seguidas de T da mesma UC,
    // ex.: MI-T 10h+12h). Só T (esparsa); TP/PL ficam livres para completar a carga.
    if (t.tipo === "T") {
      pool = pool.filter(s => !adjacenteOcupado(t.ano, wk.semanaGlobal, s.dia, t.turmaNome, t.tipo, s.hora));
    }
    // Regra opcional: PL apenas em certos dias da semana (ex.: 4.ª a 6.ª feira).
    if (t.tipo === "PL" && opts.plDiasPermitidos && opts.plDiasPermitidos.length) {
      const permitidos = new Set(opts.plDiasPermitidos);
      pool = pool.filter(s => permitidos.has(s.dia));
    }
    // Limite de 2 TP por mancha (salas de TP): não juntar as 4 TP no mesmo slot.
    if (t.tipo === "TP") {
      pool = pool.filter(s => (tpCount.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora) + "|" + t.ucKey) || 0) < MAX_TP_POR_UC_MANCHA);
      // RÍGIDO: nunca TPs de UCs DIFERENTES no mesmo bloco (proibido 1 TP de uma + 1 de
      // outra). Só se permite a mancha vazia de TP ou já com TP da MESMA UC.
      pool = pool.filter(s => {
        const set = tpUCs.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora));
        return !set || set.size === 0 || (set.size === 1 && set.has(t.ucKey));
      });
      // Agrupar TP da MESMA UC, dentro da metade do dia (manhã/tarde). Em semanas com PL
      // desta UC, PARTE-SE em 2+2 (TP1,2 numa mancha; TP3,4 noutra) para caber o par
      // 2TP+6PL (bloco cheio 180); fora dessas semanas, agrupam-se as 4. Nunca outra UC
      // na mesma mancha; o overflow (metade oposta) fica no fim.
      const prefHoras = new Set<string>(t.manha ? PERIODOS_MANHA : PERIODOS_TARDE);
      const split = plSemanas.has(`${t.ucKey}|${t.family}|${wk.semanaGlobal}`);
      const sc = meioCohort(t.turmaNome);
      const compSc = sc ? COMPLEMENTO_COHORT[sc] : null;
      const bucket = (s: Slot) => {
        if (!prefHoras.has(s.hora)) return -1;                // metade oposta: último
        const set = tpUCCohort.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora));
        if (!set || set.size === 0) return 1;                 // vazia: ok
        const soEstaUC = [...set].every(k => k.startsWith(t.ucKey + "|"));
        if (!soEstaUC) return 0;                              // tem outra UC: evitar
        if (split && compSc && set.has(`${t.ucKey}|${compSc}`)) return 0; // não juntar os 2 meios-cohorts (deixa lugar à PL)
        return 2;                                             // mesma UC (e meio-cohort compatível): agrupar
      };
      const b2 = pool.filter(s => bucket(s) === 2);
      const b1 = pool.filter(s => bucket(s) === 1);
      const b0 = pool.filter(s => bucket(s) === 0);
      const bover = pool.filter(s => bucket(s) === -1);
      pool = [...b2, ...b1, ...b0, ...bover];
    }
    // Emparelhamento TP∥PL: a PL prefere QUALQUER mancha que já tenha a TP do
    // meio-cohort COMPLEMENTAR (ex.: PL7-12 ∥ TP1+TP2), formando o bloco cheio de 180
    // com alunos disjuntos. Maximiza a colocação das PL (para completarem).
    if (t.tipo === "PL") {
      // RÍGIDO: nunca PLs de UCs DIFERENTES no mesmo bloco (proibido 1 PL de uma + 5 de
      // outra). Só mancha sem PL ou já com PL da MESMA UC. (MI usa salas de computadores
      // — pool próprio — e está isenta desta regra.)
      if (t.salaPool !== "comp") {
        pool = pool.filter(s => {
          const set = plUCs.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora));
          return !set || set.size === 0 || (set.size === 1 && set.has(t.ucKey));
        });
      }
      const sc = meioCohort(t.turmaNome);
      const comp = sc ? COMPLEMENTO_COHORT[sc] : null;
      if (comp && pool.length) {
        const mk = (s: Slot) => tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora);
        const mesmoUC = (s: Slot) => tpUCCohort.get(mk(s))?.has(`${t.ucKey}|${comp}`);   // TP complementar DESTA UC
        const qualquer = (s: Slot) => tpCohortMancha.get(mk(s))?.has(comp);              // TP complementar de qualquer UC
        const b2 = pool.filter(mesmoUC);
        const b1 = pool.filter(s => !mesmoUC(s) && qualquer(s));
        const b0 = pool.filter(s => !mesmoUC(s) && !qualquer(s));
        pool = [...b2, ...b1, ...b0];
      }
    }
    // Carga diária: teto absoluto de 8h/dia (4 blocos). Vários dias podem chegar às 8h
    // (o bloco de ajuste extra), para caberem todas as PLs — só não se passa das 8h.
    const folhas = gruposAlunoFolha(t.turmaNome);
    pool = pool.filter(s => folhas.every(g =>
      (diaCount.get(diaKey(t.ano, wk.semanaGlobal, s.dia, g)) || 0) < MAX_BLOCOS_DIA));
    const slot = encontrarSlotLivre(pool, t.ano, wk.semanaGlobal, t.turmaNome, t.tipo, ocupacao, plCount, 0, t.salaPool);
    if (!slot) return false;
    registarSlot(ocupacao, t.ano, wk.semanaGlobal, t.turmaNome, slot.dia, slot.hora);
    if (t.tipo === "T") {
      const tk = ttKey(t.ano, wk.semanaGlobal, slot.dia, t.turmaNome, t.tipo);
      let set = turmaPeriodos.get(tk); if (!set) { set = new Set(); turmaPeriodos.set(tk, set); }
      set.add(slot.hora);
    }
    for (const g of folhas) {
      const dk = diaKey(t.ano, wk.semanaGlobal, slot.dia, g);
      diaCount.set(dk, (diaCount.get(dk) || 0) + 1);
    }
    if (t.tipo === "PL") {
      const k = manchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora, t.salaPool);
      plCount.set(k, (plCount.get(k) || 0) + 1);
      // MI (salas de computadores) é exceção e não conta para a regra de "uma só UC de PL".
      if (t.salaPool !== "comp") {
        const mk = tpManchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora);
        let set = plUCs.get(mk);
        if (!set) { set = new Set(); plUCs.set(mk, set); }
        set.add(t.ucKey);
      }
    }
    if (t.tipo === "TP") {
      const mk = tpManchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora);
      const ck = mk + "|" + t.ucKey;
      tpCount.set(ck, (tpCount.get(ck) || 0) + 1);
      const sc = meioCohort(t.turmaNome);
      if (sc) {
        let set = tpCohortMancha.get(mk);
        if (!set) { set = new Set(); tpCohortMancha.set(mk, set); }
        set.add(sc);
        let uccoh = tpUCCohort.get(mk);
        if (!uccoh) { uccoh = new Set(); tpUCCohort.set(mk, uccoh); }
        uccoh.add(`${t.ucKey}|${sc}`);
      }
      let ucs = tpUCs.get(mk);
      if (!ucs) { ucs = new Set(); tpUCs.set(mk, ucs); }
      ucs.add(t.ucKey);
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
        if (gate && !a.t.exemptaGate && !gate(a.t)) continue; // MI isenta do gate rígido
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
        if (gate && !t.exemptaGate && !gate(t)) continue; // MI isenta do gate rígido
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
