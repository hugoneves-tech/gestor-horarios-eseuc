import type { UC, FeriadoInterrupcao, SessaoHorario, SemanaPersonalizada } from "../types";

export interface SemanaInfo {
  numero: number;
  dataSegunda: string; // YYYY-MM-DD (Monday of this week)
  dataSexta: string;   // YYYY-MM-DD
  diasUteis: number;   // 0-5
  fator: number;       // diasUteis / 5
  feriadosNesta: string[];
  diasBloqueados: string[]; // e.g. ["Segunda","Quinta"] — days with no classes this week
  isPausa?: boolean;
  motivoPausa?: string;
  numeroPedagogico?: number;
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
  feriados: FeriadoInterrupcao[],
  semanasPersonalizadas?: SemanaPersonalizada[]
): SemanaInfo[] {
  const actualStart = toDate(dataInicioSemestre);

  // Monday of the week containing actualStart
  const dow = actualStart.getDay(); // 0=Sun,1=Mon,...
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const base = new Date(actualStart);
  base.setDate(actualStart.getDate() - daysFromMonday);

  const result: SemanaInfo[] = [];

  for (let w = semanaInicio; w <= semanaFim; w++) {
    // Check if there is a customized config for this week number
    const custom = semanasPersonalizadas?.find(cp => cp.numero === w);

    let seg: Date;
    let sex: Date;
    let isPausa = false;
    let motivoPausa = "";

    if (custom) {
      seg = toDate(custom.dataSegunda);
      sex = toDate(custom.dataSexta);
      isPausa = !!custom.isPausa;
      motivoPausa = custom.motivoPausa || "";
    } else {
      seg = new Date(base);
      seg.setDate(base.getDate() + (w - 1) * 7);
      sex = new Date(seg);
      sex.setDate(seg.getDate() + 6);
    }

    const diasBloqueados: string[] = [];
    const nomesF: string[] = [];

    if (isPausa) {
      diasBloqueados.push(...DIAS_SEMANA);
      nomesF.push(motivoPausa || "Pausa letiva");
    } else {
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
    }

    const diasUteis = 5 - diasBloqueados.length;

    let numeroPedagogico: number | undefined = undefined;
    if (!isPausa) {
      let activeCount = 0;
      for (let i = 1; i <= w; i++) {
        const c = semanasPersonalizadas?.find(cp => cp.numero === i);
        if (!c?.isPausa) {
          activeCount++;
        }
      }
      numeroPedagogico = activeCount;
    }

    result.push({
      numero: w,
      dataSegunda: toISODate(seg),
      dataSexta: toISODate(sex),
      diasUteis: Math.max(0, diasUteis),
      fator: Math.max(0, diasUteis) / 5,
      feriadosNesta: nomesF,
      diasBloqueados,
      isPausa,
      motivoPausa,
      numeroPedagogico,
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
    // 6ª é prioritariamente das Teóricas → a MI usa-a só em ÚLTIMO recurso (fim do pool),
    // para tapar buracos das sextas que sobram livres depois de esgotadas as T.
    const ordem = avail.filter(d => d !== "Sexta").concat(avail.includes("Sexta") ? ["Sexta"] : []);
    for (const dia of ordem) for (const hora of periodosPrefDia(dia)) slotsF.push({ dia, hora });
    return slotsF.filter(s => !(s.dia === "Sexta" && s.hora === "18:00"));
  }

  // Períodos da T: na 6ª-feira é SEMPRE de manhã, em ORDEM FIXA [08,10,12] (sem rotação)
  // para que o modelo de conflitos (Turma A não repete) empurre cada UC para o período
  // seguinte e a 6ª encha sequencialmente (08→10→12), ambas as turmas no mesmo período.
  // Nos outros dias de T (2ª/4ª) usa a metade da família (com rotação).
  const periodosTDia = (dia: string) =>
    dia === "Sexta" ? PERIODOS_MANHA : periodosPrefDia(dia);

  // SEMANA PARCIAL (ex.: 2.º ano começa quinta) → 6ª de manhã T (ambas as turmas) e TODAS
  // as TP no bloco 16-18 (admitindo 2 UCs diferentes nesse bloco). Sem quinta, sem PL.
  if (!avail.includes("Segunda") && !avail.includes("Terça")) {
    if (!avail.includes("Quarta")) {
      if (!avail.includes("Sexta")) return [];
      if (tipo === "T") {
        const slotsP: Slot[] = [];
        for (const hora of periodosTDia("Sexta")) slotsP.push({ dia: "Sexta", hora });
        return slotsP;
      }
      if (tipo === "TP") return [{ dia: "Sexta", hora: "16:00" }];
      return [];
    }
  }

  // Dias permitidos por tipo (regra ESEUC):
  //   T       → só 2ª e 4ª (todo o dia) e 6ª (só de manhã). T enche a 6ª primeiro.
  //   TP/PL/S → 2ª–5ª; a 6ª entra em ÚLTIMO recurso (só quando as T já esgotaram a 6ª e
  //             os outros dias estão cheios → aproveita as 6ªs livres para TP/PL).
  let ordemDias: string[];
  if (tipo === "T") {
    ordemDias = ["Sexta", "Segunda", "Quarta"].filter(d => avail.includes(d));
  } else if (tipo === "TP") {
    ordemDias = ["Sexta", "Quarta", "Quinta", "Terça", "Segunda"].filter(d => avail.includes(d));
  } else if (tipo === "PL") {
    ordemDias = ["Sexta", "Quinta", "Quarta", "Terça", "Segunda"].filter(d => avail.includes(d));
  } else {
    ordemDias = ["Sexta", "Terça", "Quinta"].filter(d => avail.includes(d));
  }
  if (!ordemDias.length) return [];

  const slots: Slot[] = [];
  const parcialSem = !avail.includes("Segunda") && !avail.includes("Terça");
  for (const dia of ordemDias) {
    let periodos = tipo === "T" ? periodosTDia(dia) : (dia === "Sexta" ? PERIODOS_MANHA : periodosPrefDia(dia));
    if (dia === "Quarta" && parcialSem) {
        // Semana parcial (arranque à 4ª): a 4ª é EXCLUSIVA das Teóricas, de manhã, com
        // AMBAS as turmas no mesmo bloco (como a 6ª): ordem fixa [08,10,12], sem rotação
        // nem metade de família — o anfiteatro leva as duas turmas em simultâneo.
        if (tipo !== "T") continue;
        periodos = PERIODOS_MANHA;
    }
    for (const hora of periodos) slots.push({ dia, hora });
  }
  // Bloco de ajuste (metade oposta) — só para PL e TP, nunca para T.
  if (tipo === "PL" || tipo === "TP") {
    for (const dia of ordemDias) {
       if (dia === "Quarta" && !avail.includes("Segunda") && !avail.includes("Terça")) continue;
       for (const hora of periodosOver) slots.push({ dia, hora });
    }
  }
  return slots.filter(s => !(s.dia === "Sexta" && s.hora === "18:00"));
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
  // Pares de SIGLAS de UC que NÃO podem estar na mesma mancha (ex.: docentes partilhados):
  // [["ESDAC","EIG"]]. Bidirecional.
  ucConflitos?: string[][];
  // Semanas (globais) em que SÓ uma turma tem aulas (a outra está em estágio) → tudo de
  // manhã. Pode ser global (Array) ou específico por ano (Record).
  semanasSoTurmaA?: number[] | Record<number, number[]>;
  semanasSoTurmaB?: number[] | Record<number, number[]>;
  // Modo "sem regras": ignora TODAS as regras pedagógicas (ordem T→TP→PL, agrupamentos,
  // conflitos de UC, T só em certos dias, etc.). Mantém APENAS a distribuição pelos turnos
  // da tarde e o espaço para almoço (mais o teto de 8h e não duplicar a mesma turma).
  semRegras?: boolean;
  // Sessões FIXAS (importadas de fora ou fixadas manualmente): o motor semeia-as como
  // ocupação/conflitos e desconta a carga já satisfeita, gerando só o que falta À VOLTA
  // delas. NÃO são devolvidas no output (quem chama preserva-as). Filtradas por semestre.
  sessoesFixas?: SessaoHorario[];
  // Restrições GENÉRICAS por UC: bloqueiam slots para as siglas indicadas. Cobrem regras
  // naturais como "ESDAC só de manhã" (diasProibidos/periodosProibidos). Cada entrada:
  //   { siglas:["ESDAC"], periodosProibidos:["tarde"] }  → ESDAC nunca à tarde
  //   { siglas:["EIG"], diasProibidos:["Sexta"] }         → EIG nunca à sexta
  //   { siglas:["MI"], tipos:["PL"], diasProibidos:["Segunda"] } → só as PL de MI, não 2.ª
  restricoesUC?: {
    siglas: string[];
    diasProibidos?: string[];                 // ex.: ["Sexta"]
    periodosProibidos?: ("manha" | "tarde")[]; // manha = 08/10/12, tarde = 14/16/18
    tipos?: ("T" | "TP" | "PL" | "S")[];       // restringe a estes tipos de aula (vazio = todos)
    semanasRestritas?: number[];               // semanas globais em que esta regra se aplica (vazio = todas)
  }[];
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
  // Semanas em que só uma turma tem aulas (a outra em estágio) → tudo de manhã.
  const soTurmaA = (ano: number, week: number) => {
    if (Array.isArray(opts.semanasSoTurmaA)) return opts.semanasSoTurmaA.includes(week);
    if (opts.semanasSoTurmaA?.[ano]) return opts.semanasSoTurmaA[ano].includes(week);
    return false;
  };
  const soTurmaB = (ano: number, week: number) => {
    if (Array.isArray(opts.semanasSoTurmaB)) return opts.semanasSoTurmaB.includes(week);
    if (opts.semanasSoTurmaB?.[ano]) return opts.semanasSoTurmaB[ano].includes(week);
    return false;
  };
  const soUmaTurma = (ano: number, week: number) => soTurmaA(ano, week) || soTurmaB(ano, week);

  interface WeekRef { semanaGlobal: number; diasBloqueados: string[]; }
  interface Task {
    ano: number; ucNome: string; ucSigla: string; ucKey: string; family: "A" | "B";
    turmaNome: string; tipo: "T" | "TP" | "PL" | "S"; salaTipo: string; manha: boolean;
    salaPool: SalaPool;   // "comp" (salas de computadores, ex. MI) ou "lab"
    flexivel: boolean;    // PL de MI: qualquer dia/período (tapa-buracos)
    exemptaGate: boolean; // MI: não está sujeita ao gate rígido T→TP→PL
    rotaBase: number;     // deslocamento de período por UC (rotação semanal ESDAC@08/MI@10/FT@12)
    weeks: WeekRef[]; total: number; placed: number;
    maxSimultaneoT?: number;
    maxSimultaneoTP?: number;
    maxSimultaneoPL?: number;
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
      let wks = tipo === "PL" ? weeksPL : weeks;
      // Família A não tem aulas nas semanas "só Turma B" (está em estágio), e vice-versa.
      wks = wks.filter(w => family === "A" ? !soTurmaB(ano, w.semanaGlobal) : !soTurmaA(ano, w.semanaGlobal));
      tasks.push({
        ano, ucNome: uc.nome, ucSigla: uc.sigla, ucKey: uc.id, family, turmaNome, tipo, salaTipo, manha, salaPool, flexivel, exemptaGate: ehFlexivel, rotaBase, weeks: wks, total, placed: 0,
        maxSimultaneoT: uc.maxSimultaneoT,
        maxSimultaneoTP: uc.maxSimultaneoTP,
        maxSimultaneoPL: uc.maxSimultaneoPL,
      });
      const s = getStat(`${uc.id}|${family}`);
      if (tipo === "T") s.totalT += total; else if (tipo === "TP") s.totalTP += total; else if (tipo === "PL") s.totalPL += total;
    };
    uc.turmasConfig.filter(t => t.tipo === "Teórica").forEach((t, i) => {
      const isA = t.nome === "Turma A" || (t.nome !== "Turma B" && i % 2 === 0);
      add(t.nome, "T", "Anfiteatro (Teórica T)", (isA && turmaAManha) || (!isA && !turmaAManha), isA ? "A" : "B", Math.floor(uc.cargaHorariaTeorica / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "TeoricoPratica").forEach((t, i) => {
      const inA = t.nome.match(/TP[1234]$/) ? true : t.nome.match(/TP[5678]$/) ? false : i < 4;
      add(t.nome, "TP", "Sala Comum TP", (inA && turmaAManha) || (!inA && !turmaAManha), inA ? "A" : "B", Math.floor(uc.cargaHorariaTP / 2));
    });
    uc.turmasConfig.filter(t => t.tipo === "Prática").forEach((t, i) => {
      const pMatch = t.nome.match(/PL(\d+)/);
      const inA = pMatch ? parseInt(pMatch[1]) <= 12 : i < 12;
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
  // mancha → {ucKey...} com PL de QUALQUER pool (inclui salas de computador/MI). Serve só o
  // conflito de docente partilhado TP↔PL da MESMA UC, que vale para todas as UCs (até MI).
  const plUCsAll = new Map<string, Set<string>>();
  // Conflito entre UCs (docentes partilhados): não podem estar na mesma mancha.
  const conflitoUC = new Map<string, Set<string>>(); // sigla → {siglas em conflito}
  for (const [a, b] of (opts.ucConflitos || [])) {
    if (!conflitoUC.has(a)) conflitoUC.set(a, new Set()); conflitoUC.get(a)!.add(b);
    if (!conflitoUC.has(b)) conflitoUC.set(b, new Set()); conflitoUC.get(b)!.add(a);
  }
  // Restrições genéricas por UC (sigla → lista de bloqueios dia/período/tipo). Aplicam-se
  // no caminho principal e na recuperação. Cobrem "X só de manhã", "Y não à sexta", etc.
  const restricaoSigla = new Map<string, { dias: Set<string>; manha: boolean; tarde: boolean; tipos: Set<string>; semanasRestritas: Set<number> }[]>();
  for (const r of (opts.restricoesUC || [])) {
    const dias = new Set(r.diasProibidos || []);
    const periodos = new Set(r.periodosProibidos || []);
    const tipos = new Set(r.tipos || []);
    const semanasRestritas = new Set(r.semanasRestritas || []);
    for (const sig of (r.siglas || [])) {
      if (!restricaoSigla.has(sig)) restricaoSigla.set(sig, []);
      restricaoSigla.get(sig)!.push({ dias, manha: periodos.has("manha"), tarde: periodos.has("tarde"), tipos, semanasRestritas });
    }
  }
  // True se um slot está PROIBIDO para esta (UC, tipo) por uma restrição genérica.
  const slotProibido = (ucSigla: string, tipo: string, dia: string, hora: string, semanaGlobal: number): boolean => {
    const rs = restricaoSigla.get(ucSigla); if (!rs) return false;
    const ehManha = PERIODOS_MANHA.includes(hora);
    for (const r of rs) {
      if (r.tipos.size && !r.tipos.has(tipo)) continue;
      if (r.semanasRestritas.size && !r.semanasRestritas.has(semanaGlobal)) continue;
      if (r.dias.has(dia)) return true;
      if (r.manha && ehManha) return true;
      if (r.tarde && !ehManha) return true;
    }
    return false;
  };
  const siglaMancha = new Map<string, Set<string>>(); // mancha → {siglas de UC} (qualquer tipo)
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
  const ucSimultaneoCount = new Map<string, number>(); // `${ucKey}|${week}|${dia}|${hora}|${tipo}` → count
  const ucSimKey = (ucKey: string, week: number, dia: string, hora: string, tipo: string) => `${ucKey}|${week}|${dia}|${hora}|${tipo}`;
  // Carga diária por aluno (grupo-folha PL): base de 6h (3 blocos) numa só metade do dia
  // e, no MÁXIMO, UM dia por semana a 8h (4 blocos). Nunca mais de 8h.
  const MAX_BLOCOS_DIA = 4;     // teto absoluto = 8h/dia
  const diaCount = new Map<string, number>(); // `${ano}|${week}|${dia}|${plGroup}` → nº de blocos
  const diaKey = (ano: number, week: number, dia: string, g: string) => `${ano}|${week}|${dia}|${g}`;
  // Evitar 2 blocos CONSECUTIVOS da mesma (UC,turma,tipo) no mesmo dia (sem 4h seguidas
  // da mesma UC). Não é cap por dia (que partia a completude) — só proíbe a adjacência.
  const TODOS_PERIODOS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
  const turmaPeriodos = new Map<string, Set<string>>(); // `${ano}|${week}|${dia}|${ucKey}|${turma}|${tipo}` → horas
  // Momento (semana+dia+hora) da 1.ª T e da 1.ª TP de cada (UC, família) — cronologia
  // GLOBAL: a 1.ª TP nunca antes da 1.ª T; a 1.ª PL nunca antes da 1.ª TP.
  const ordSlot = (week: number, dia: string, hora: string) => week * 1000 + DIAS_SEMANA.indexOf(dia) * 10 + TODOS_PERIODOS.indexOf(hora);
  const tMinOrd = new Map<string, number>();  // `${ano}|${ucKey}|${family}` → ord da 1.ª T
  const tpMinOrd = new Map<string, number>(); // idem, 1.ª TP
  // ESPELHO Turma A ↔ Turma B: slots já colocados por (UC, tipo, família) em cada semana,
  // para a outra família preferir o slot espelhado (08↔14, 10↔16, 12↔18, mesmo dia).
  const espelho = new Map<string, Set<string>>(); // `${ano}|${week}|${ucKey}|${tipo}|${family}` → {"dia|hora"}
  const HORA_ESPELHO: Record<string, string> = { "08:00": "14:00", "10:00": "16:00", "12:00": "18:00", "14:00": "08:00", "16:00": "10:00", "18:00": "12:00" };
  const ttKey = (ano: number, week: number, dia: string, ucKey: string, turma: string, tipo: string) => `${ano}|${week}|${dia}|${ucKey}|${turma}|${tipo}`;
  const adjacenteOcupado = (ano: number, week: number, dia: string, ucKey: string, turma: string, tipo: string, hora: string) => {
    const set = turmaPeriodos.get(ttKey(ano, week, dia, ucKey, turma, tipo));
    if (!set) return false;
    const i = TODOS_PERIODOS.indexOf(hora);
    return (i > 0 && set.has(TODOS_PERIODOS[i - 1])) || (i < 5 && set.has(TODOS_PERIODOS[i + 1]));
  };

  // Atualiza TODA a contabilidade do motor para uma sessão neste slot (ocupação, conflitos,
  // cronologia, carga diária, espelho). Partilhado por commit (geração) e seedFixa (fixas).
  const registar = (t: Task, wk: WeekRef, slot: Slot) => {
    registarSlot(ocupacao, t.ano, wk.semanaGlobal, t.turmaNome, slot.dia, slot.hora);
    const ucsK = ucSimKey(t.ucKey, wk.semanaGlobal, slot.dia, slot.hora, t.tipo);
    ucSimultaneoCount.set(ucsK, (ucSimultaneoCount.get(ucsK) || 0) + 1);

    const smk = tpManchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora);
    let sset = siglaMancha.get(smk); if (!sset) { sset = new Set(); siglaMancha.set(smk, sset); }
    sset.add(t.ucSigla);
    if (t.tipo === "T") {
      const tk = ttKey(t.ano, wk.semanaGlobal, slot.dia, t.ucKey, t.turmaNome, t.tipo);
      let set = turmaPeriodos.get(tk); if (!set) { set = new Set(); turmaPeriodos.set(tk, set); }
      set.add(slot.hora);
      const mk = `${t.ano}|${t.ucKey}|${t.family}`;
      const o = ordSlot(wk.semanaGlobal, slot.dia, slot.hora);
      const cur = tMinOrd.get(mk);
      if (cur === undefined || o < cur) tMinOrd.set(mk, o);
    }
    for (const g of gruposAlunoFolha(t.turmaNome)) {
      const dk = diaKey(t.ano, wk.semanaGlobal, slot.dia, g);
      diaCount.set(dk, (diaCount.get(dk) || 0) + 1);
    }
    if (t.tipo === "PL") {
      const k = manchaKey(t.ano, wk.semanaGlobal, slot.dia, slot.hora, t.salaPool);
      plCount.set(k, (plCount.get(k) || 0) + 1);
      { let set = plUCsAll.get(smk); if (!set) { set = new Set(); plUCsAll.set(smk, set); } set.add(t.ucKey); }
      if (t.salaPool !== "comp") {
        let set = plUCs.get(smk); if (!set) { set = new Set(); plUCs.set(smk, set); }
        set.add(t.ucKey);
      }
    }
    if (t.tipo === "TP") {
      tpCount.set(smk + "|" + t.ucKey, (tpCount.get(smk + "|" + t.ucKey) || 0) + 1);
      const mkTP = `${t.ano}|${t.ucKey}|${t.family}`;
      const oTP = ordSlot(wk.semanaGlobal, slot.dia, slot.hora);
      const curTP = tpMinOrd.get(mkTP);
      if (curTP === undefined || oTP < curTP) tpMinOrd.set(mkTP, oTP);
      const sc = meioCohort(t.turmaNome);
      if (sc) {
        let set = tpCohortMancha.get(smk); if (!set) { set = new Set(); tpCohortMancha.set(smk, set); }
        set.add(sc);
        let uccoh = tpUCCohort.get(smk); if (!uccoh) { uccoh = new Set(); tpUCCohort.set(smk, uccoh); }
        uccoh.add(`${t.ucKey}|${sc}`);
      }
      let ucsS = tpUCs.get(smk); if (!ucsS) { ucsS = new Set(); tpUCs.set(smk, ucsS); }
      ucsS.add(t.ucKey);
    }
    {
      const ek = `${t.ano}|${wk.semanaGlobal}|${t.ucKey}|${t.tipo}|${t.family}`;
      let es = espelho.get(ek); if (!es) { es = new Set(); espelho.set(ek, es); }
      es.add(`${slot.dia}|${slot.hora}`);
    }
  };

  // Coloca e CONTABILIZA uma sessão gerada (adiciona-a ao output).
  const commit = (t: Task, wk: WeekRef, slot: Slot) => {
    registar(t, wk, slot);
    t.placed++;
    const s = getStat(statKeyOf(t));
    if (t.tipo === "T") s.placedT++; else if (t.tipo === "TP") s.placedTP++; else if (t.tipo === "PL") s.placedPL++;
    sessoes.push({
      id: ++id, ucNome: t.ucNome, ucSigla: t.ucSigla, tipoAula: t.tipo,
      docente: "", sala: "", salaTipo: t.salaTipo,
      turma: t.turmaNome, diaSemana: slot.dia, horaInicio: slot.hora,
      horaFim: addHours(slot.hora, 2), bloqueado: false, semana: wk.semanaGlobal,
    });
  };

  // Semeia uma sessão FIXA (importada/fixada): regista a sua ocupação/conflitos e desconta
  // 1 bloco da carga a gerar dessa (UC, turma, tipo). NÃO entra no output (quem chama
  // preserva as fixas). Assim o motor gera só o que falta, à volta das fixas.
  const seedFixa = (t: Task, wk: WeekRef, slot: Slot) => {
    registar(t, wk, slot);
    if (t.total > 0) t.total--;
    const s = getStat(statKeyOf(t));
    if (t.tipo === "T") { if (s.totalT > 0) s.totalT--; }
    else if (t.tipo === "TP") { if (s.totalTP > 0) s.totalTP--; }
    else if (t.tipo === "PL") { if (s.totalPL > 0) s.totalPL--; }
  };

  // Colocação FORÇADA num slot específico (para a passagem de "encher blocos extra"),
  // verificando ocupação, conflito de UC, teto de 8h e cap de PL/TP.
  const tryPlaceAt = (t: Task, wk: WeekRef, dia: string, hora: string, relaxPLuc = false): boolean => {
    if (dia === "Sexta" && hora === "18:00") return false;
    // Cronologia GLOBAL T→TP→PL também nas passagens de recuperação.
    if (t.tipo === "TP" || t.tipo === "PL") {
      const st0 = getStat(statKeyOf(t));
      const ref = t.tipo === "TP"
        ? tMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`)
        : (st0.totalTP > 0 ? tpMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`) : tMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`));
      if (ref === undefined || ordSlot(wk.semanaGlobal, dia, hora) <= ref) return false;
    }
    if (t.placed >= t.total) return false;
    if (!opts.semRegras && slotProibido(t.ucSigla, t.tipo, dia, hora, wk.semanaGlobal)) return false; // restrição genérica por UC
    if (ocupacao.has(slotKey(t.ano, wk.semanaGlobal, t.turmaNome, dia, hora))) return false;
    const smk = tpManchaKey(t.ano, wk.semanaGlobal, dia, hora);
    const emConflito = conflitoUC.get(t.ucSigla);
    if (emConflito) { const set = siglaMancha.get(smk); if (set) for (const sig of set) if (emConflito.has(sig)) return false; }
    if (gruposAlunoFolha(t.turmaNome).some(g => (diaCount.get(diaKey(t.ano, wk.semanaGlobal, dia, g)) || 0) >= MAX_BLOCOS_DIA)) return false;
    if (t.tipo === "TP") {
      const set = tpUCs.get(smk);
      if (!relaxPLuc && set && !(set.size === 1 && set.has(t.ucKey))) return false; // só a mesma UC nas TP
      if ((tpCount.get(smk + "|" + t.ucKey) || 0) >= MAX_TP_POR_UC_MANCHA) return false;
      if (plUCsAll.get(smk)?.has(t.ucKey)) return false; // docente partilhado: não com PL da mesma UC (inclui MI)
    }
    if (t.tipo === "PL") {
      if ((plCount.get(manchaKey(t.ano, wk.semanaGlobal, dia, hora, t.salaPool)) || 0) >= MAX_PL_POR_POOL[t.salaPool]) return false;
      // relaxPLuc: bloco de recuperação da 6ª admite PL de UCs diferentes (3 ESDAC + 3 FT).
      if (!relaxPLuc && t.salaPool !== "comp") {
        const set = plUCs.get(smk);
        if (set && set.size > 0 && !set.has(t.ucKey)) {
          if (t.maxSimultaneoPL === 3) {
            let ok = true;
            for (const otherUc of set) {
              const otherTask = tasks.find(x => x.ucKey === otherUc && x.tipo === "PL");
              if (!otherTask || otherTask.maxSimultaneoPL !== 3) { ok = false; break; }
            }
            if (!ok) return false;
          } else {
            return false;
          }
        }
      }
      if (tpUCs.get(smk)?.has(t.ucKey)) return false; // docente partilhado: não com TP da mesma UC
    }
    commit(t, wk, { dia, hora });
    return true;
  };

  const tryPlace = (t: Task, wk: WeekRef): boolean => {
    // Rotação por UC: base distinta por UC (período de arranque) + variação por semana.
    // Em poolDoTipo soma-se ainda o índice do dia → rotação dia-a-dia (FT qui@08→sex@10).
    const rotacao = t.rotaBase + wk.semanaGlobal - 1;
    // Semanas de uma só turma → essa turma arranca de manhã (não há a outra na tarde),
    // com a tarde disponível em ajuste para a carga alta destas semanas (bloco 2/4).
    // Semana PARCIAL (1.ª semana do 2.º ano): permite 2 UCs no bloco de TP (16-18 da 6ª).
    const ehParcial = !!(wk.diasBloqueados?.includes("Segunda") && wk.diasBloqueados?.includes("Terça"));
    const manhaEf = soUmaTurma(t.ano, wk.semanaGlobal) ? true : t.manha;
    let pool = poolDoTipo(t.tipo, wk.diasBloqueados, manhaEf, rotacao, t.flexivel);
    // MODO SEM REGRAS: SEM nenhuma regra — todos os dias úteis e TODOS os períodos (08-18),
    // sem turnos, sem almoço, sem teto de 8h. Só não duplica a mesma turma. Para comparar.
    if (opts.semRegras) {
      const bloq = new Set(wk.diasBloqueados || []);
      pool = DIAS_SEMANA.filter(d => !bloq.has(d)).flatMap(d => TODOS_PERIODOS.map(hora => ({ dia: d, hora })));
    }
    // Semanas de turma única (ex.: 8-15 só B, 16-23 só A no 2.º ano): SÓ período da manhã.
    if (!opts.semRegras && soUmaTurma(t.ano, wk.semanaGlobal)) {
      pool = pool.filter(s => PERIODOS_MANHA.includes(s.hora));
    }
    // Conflito de UCs (docentes partilhados): nunca na mesma mancha (ex.: ESDAC ∦ EIG).
    const emConflito = conflitoUC.get(t.ucSigla);
    if (!opts.semRegras && emConflito && emConflito.size) {
      pool = pool.filter(s => {
        const set = siglaMancha.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora));
        if (!set) return true;
        for (const sig of set) if (emConflito.has(sig)) return false;
        return true;
      });
    }
    // Sem 2 blocos CONSECUTIVOS da mesma Teórica no dia (sem 4h seguidas de T da mesma UC,
    // ex.: MI-T 10h+12h). Só T (esparsa); TP/PL ficam livres para completar a carga.
    if (t.tipo === "T" && !opts.semRegras) {
      pool = pool.filter(s => !adjacenteOcupado(t.ano, wk.semanaGlobal, s.dia, t.ucKey, t.turmaNome, t.tipo, s.hora));
    }
    // Regra opcional: PL apenas em certos dias da semana (ex.: 4.ª a 6.ª feira).
    if (t.tipo === "PL" && opts.plDiasPermitidos && opts.plDiasPermitidos.length) {
      const permitidos = new Set(opts.plDiasPermitidos);
      pool = pool.filter(s => permitidos.has(s.dia));
    }
    // Restrições GENÉRICAS por UC ("X só de manhã", "Y não à sexta", …) — bloqueiam slots.
    if (!opts.semRegras && restricaoSigla.has(t.ucSigla)) {
      pool = pool.filter(s => !slotProibido(t.ucSigla, t.tipo, s.dia, s.hora, wk.semanaGlobal));
    }
    // Limite de 2 TP por mancha (salas de TP): não juntar as 4 TP no mesmo slot.
    if (t.tipo === "TP" && !opts.semRegras) {
      // CRONOLOGIA GLOBAL: nenhuma TP antes do momento da 1.ª T da sua (UC, família).
      {
        const tMin = tMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`);
        pool = pool.filter(s => tMin !== undefined && ordSlot(wk.semanaGlobal, s.dia, s.hora) > tMin);
      }
      pool = pool.filter(s => (tpCount.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora) + "|" + t.ucKey) || 0) < MAX_TP_POR_UC_MANCHA);
      // ALLOW DIFFERENT UCs IN TP BLOCK
      // Docente partilhado TP↔PL: a TP NÃO pode estar na mancha que já tem PL da MESMA UC
      // (qualquer turma; inclui MI/salas de computador via plUCsAll).
      pool = pool.filter(s => !plUCsAll.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora))?.has(t.ucKey));
      // Agrupar TP da MESMA UC, dentro da metade do dia (manhã/tarde). Em semanas com PL
      // desta UC, PARTE-SE em 2+2 (TP1,2 numa mancha; TP3,4 noutra) para caber o par
      // 2TP+6PL (bloco cheio 180); fora dessas semanas, agrupam-se as 4. Nunca outra UC
      // na mesma mancha; o overflow (metade oposta) fica no fim.
      const prefHoras = new Set<string>(manhaEf ? PERIODOS_MANHA : PERIODOS_TARDE);
      const split = plSemanas.has(`${t.ucKey}|${t.family}|${wk.semanaGlobal}`);
      const sc = meioCohort(t.turmaNome);
      const compSc = sc ? COMPLEMENTO_COHORT[sc] : null;
      const bucket = (s: Slot) => { if (!prefHoras.has(s.hora)) return -1; const set = tpUCCohort.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora)); if (!set || set.size === 0) return 1; if (split && compSc && set.has(`${t.ucKey}|${compSc}`)) return 0; return 2; };
      const b2 = pool.filter(s => bucket(s) === 2);
      const b1 = pool.filter(s => bucket(s) === 1);
      const b0 = pool.filter(s => bucket(s) === 0);
      const bover = pool.filter(s => bucket(s) === -1);
      pool = [...b2, ...b1, ...b0, ...bover];
    }
    // Emparelhamento TP∥PL: a PL prefere QUALQUER mancha que já tenha a TP do
    // meio-cohort COMPLEMENTAR (ex.: PL7-12 ∥ TP1+TP2), formando o bloco cheio de 180
    // com alunos disjuntos. Maximiza a colocação das PL (para completarem).
    if (t.tipo === "PL" && !opts.semRegras) {
      // CRONOLOGIA GLOBAL: nenhuma PL antes do momento da 1.ª TP da sua (UC, família)
      // (se a UC não tiver TP de todo, vale a 1.ª T).
      {
        const st0 = getStat(statKeyOf(t));
        const ref = st0.totalTP > 0 ? tpMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`) : tMinOrd.get(`${t.ano}|${t.ucKey}|${t.family}`);
        pool = pool.filter(s => ref !== undefined && ordSlot(wk.semanaGlobal, s.dia, s.hora) > ref);
      }
      // RÍGIDO: nunca PLs de UCs DIFERENTES no mesmo bloco (proibido 1 PL de uma + 5 de
      // outra). Só mancha sem PL ou já com PL da MESMA UC. (MI usa salas de computadores
      // — pool próprio — e está isenta desta regra.)
      // EXCEÇÃO: se a UC só possibilita 3 PLs em simultâneo, pode conjugar com outras UCs que também só possibilitem 3 PLs, para perfazer os 6 PLs.
      if (t.salaPool !== "comp") {
        pool = pool.filter(s => {
          const set = plUCs.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora));
          if (!set || set.size === 0) return true;
          if (set.has(t.ucKey)) return true;
          if (t.maxSimultaneoPL === 3) {
            for (const otherUc of set) {
              const otherTask = tasks.find(x => x.ucKey === otherUc && x.tipo === "PL");
              if (!otherTask || otherTask.maxSimultaneoPL !== 3) return false;
            }
            return true;
          }
          return false;
        });
      }
      // Docente partilhado TP↔PL: a PL NÃO pode estar na mancha que já tem TP da MESMA UC.
      pool = pool.filter(s => !tpUCs.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora))?.has(t.ucKey));
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
    // Carga diária: teto absoluto de 8h/dia (4 blocos). No modo SEM REGRAS não se aplica.
    const folhas = gruposAlunoFolha(t.turmaNome);
    if (!opts.semRegras) {
      pool = pool.filter(s => folhas.every(g =>
        (diaCount.get(diaKey(t.ano, wk.semanaGlobal, s.dia, g)) || 0) < MAX_BLOCOS_DIA));
      // ALVO 6h/dia: preferir dias em que os alunos ainda têm <3 blocos; o 4.º bloco
      // (8h) só em último recurso. Partição ESTÁVEL — preserva a ordem dos
      // emparelhamentos (TP agrupada, PL∥TP) dentro de cada nível de carga.
      const cargaDia = (s: Slot) => Math.max(0, ...folhas.map(g => diaCount.get(diaKey(t.ano, wk.semanaGlobal, s.dia, g)) || 0));
      const compoe = pool.filter(s => { const c = cargaDia(s); return c >= 1 && c <= 2; }); // compõe os 6h
      const vazios = pool.filter(s => cargaDia(s) === 0);                                   // novo dia
      const cheios = pool.filter(s => cargaDia(s) >= 3);                                    // 4.º bloco: último recurso
      const completa6 = compoe.filter(s => cargaDia(s) === 2);  // 3.º bloco → fecha os 6h
      const constroi = compoe.filter(s => cargaDia(s) === 1);   // 2.º bloco
      pool = [...completa6, ...vazios, ...constroi, ...cheios];
      // ÚLTIMA semana da UC: 6ª em último recurso (antecipa para 2ª-5ª; se possível a
      // 6ª fica livre e os estudantes vão mais cedo para casa). Partição estável.
      const ultima = t.weeks.length > 0 && wk.semanaGlobal === t.weeks[t.weeks.length - 1].semanaGlobal;
      if (ultima) pool = [...pool.filter(s => s.dia !== "Sexta"), ...pool.filter(s => s.dia === "Sexta")];
      // ESPELHO A↔B (preferência principal): se a OUTRA família já tem esta (UC, tipo)
      // nesta semana, preferir o slot espelhado (mesmo dia, manhã↔tarde). Nas Teóricas
      // o MESMO slot também conta (momento em comum: ambas as turmas no anfiteatro).
      if (!soUmaTurma(t.ano, wk.semanaGlobal)) {
        const outro = espelho.get(`${t.ano}|${wk.semanaGlobal}|${t.ucKey}|${t.tipo}|${t.family === "A" ? "B" : "A"}`);
        if (outro && outro.size) {
          const alvos = new Set<string>();
          for (const dh of outro) {
            const [dia, hora] = dh.split("|");
            const he = HORA_ESPELHO[hora]; if (he) alvos.add(`${dia}|${he}`);
            if (t.tipo === "T") alvos.add(dh); // T: mesmo bloco = momento em comum
          }
          pool = [...pool.filter(s => alvos.has(`${s.dia}|${s.hora}`)), ...pool.filter(s => !alvos.has(`${s.dia}|${s.hora}`))];
        }
      }
    }
        let sibling = null;
    if (t.tipo === "TP") {
      const TP_SIBLING = { TP1: "TP2", TP2: "TP1", TP3: "TP4", TP4: "TP3", TP5: "TP6", TP6: "TP5", TP7: "TP8", TP8: "TP7" };
      const sibName = TP_SIBLING[t.turmaNome];
      sibling = tasks.find(x => x.tipo === "TP" && x.ucKey === t.ucKey && x.ano === t.ano && x.turmaNome === sibName && x.placed < x.total) || null;
      if (sibling) {
         pool = pool.filter(s => {
            if (ocupacao.has(slotKey(sibling.ano, wk.semanaGlobal, sibling.turmaNome, s.dia, s.hora))) return false;
            if ((tpCount.get(tpManchaKey(t.ano, wk.semanaGlobal, s.dia, s.hora) + "|" + t.ucKey) || 0) + 2 > MAX_TP_POR_UC_MANCHA) return false;
            const sf = gruposAlunoFolha(sibling.turmaNome);
            if (!opts.semRegras && sf.some(g => (diaCount.get(diaKey(sibling.ano, wk.semanaGlobal, s.dia, g)) || 0) >= MAX_BLOCOS_DIA)) return false;
            return true;
         });
      }
    }
    // Enforce UC-specific maximum simultaneous limits for T, TP, and PL
    if (t.tipo === "T" && t.maxSimultaneoT != null && t.maxSimultaneoT > 0) {
      pool = pool.filter(s => {
        const current = ucSimultaneoCount.get(ucSimKey(t.ucKey, wk.semanaGlobal, s.dia, s.hora, "T")) || 0;
        return current + 1 <= t.maxSimultaneoT!;
      });
    } else if (t.tipo === "TP" && t.maxSimultaneoTP != null && t.maxSimultaneoTP > 0) {
      pool = pool.filter(s => {
        const added = sibling ? 2 : 1;
        const current = ucSimultaneoCount.get(ucSimKey(t.ucKey, wk.semanaGlobal, s.dia, s.hora, "TP")) || 0;
        return current + added <= t.maxSimultaneoTP!;
      });
    } else if (t.tipo === "PL" && t.maxSimultaneoPL != null && t.maxSimultaneoPL > 0) {
      pool = pool.filter(s => {
        const current = ucSimultaneoCount.get(ucSimKey(t.ucKey, wk.semanaGlobal, s.dia, s.hora, "PL")) || 0;
        return current + 1 <= t.maxSimultaneoPL!;
      });
    }

    const slot = encontrarSlotLivre(pool, t.ano, wk.semanaGlobal, t.turmaNome, t.tipo, ocupacao, plCount, 0, t.salaPool);
    if (!slot) return false;
    commit(t, wk, slot);
    if (sibling) commit(sibling, wk, slot);
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
  const plTasks = tasks.filter(t => t.tipo === "PL"); const ucsComPL = new Set<string>(); plTasks.forEach(t => ucsComPL.add(t.ucSigla));
  const sTasks  = tasks.filter(t => t.tipo === "S");

  // Place one phase within one week: max-min fair (least-complete task first), with a
  // soft per-week cap so blocks spread across weeks instead of front-loading, and an
  // optional T→TP→PL gate.
  interface Active { t: Task; wk: WeekRef; cap: number; }
  const placeWeek = (phaseTasks: Task[], W: number, gate: ((t: Task) => boolean) | null) => {
    const active: Active[] = phaseTasks
      .map(t => ({ t, wk: t.weeks.find(w => w.semanaGlobal === W) }))
      .filter(a => a.wk && a.t.placed < a.t.total)
      .map(a => {
        const maxCap = Math.max(1, Math.ceil(a.t.total / Math.max(1, a.t.weeks.length)));
        // PL com cap exato (espalha uniformemente até à ÚLTIMA semana, sem acabar cedo);
        // restantes tipos com +1 de folga.
        let cap = a.t.tipo === 'PL' ? maxCap : maxCap + 1;

        // TP de UC SEM PL (ex.: EIG): intercalada — cap normal nas semanas iniciais e
        // ligeira folga nas 2 finais (emparelha com as PL sem as expulsar).
        if (a.t.tipo === 'TP' && !ucsComPL.has(a.t.ucSigla)) {
          const idx = a.t.weeks.findIndex(w => w.semanaGlobal === W);
          const ultimas2 = idx >= a.t.weeks.length - 2;
          cap = ultimas2 ? maxCap + 1 : maxCap;
        }
        // TP de UC com PL PESADA (ex.: ESDAC 24h PL vs 6h TP): adiantar as TPs nas 2
        // primeiras semanas para o gate T→TP→PL libertar as muitas PL cedo.
        if (a.t.tipo === 'TP') {
          const st = getStat(statKeyOf(a.t));
          if (st.totalPL > 2 * st.totalTP && st.totalTP > 0) {
            const idx = a.t.weeks.findIndex(w => w.semanaGlobal === W);
            if (idx <= 2) cap = maxCap + 4;
          }
        }
        return { t: a.t, wk: a.wk!, cap };
      });
    const done = new Map<Task, number>();
    const stuck = new Set<Task>();
    while (true) {
      let best: Active | null = null;
      let bestRatio = Infinity;
      for (const a of active) {
        if (stuck.has(a.t) || (done.get(a.t) || 0) >= a.cap || a.t.placed >= a.t.total) continue;
        if (gate && !a.t.exemptaGate && !gate(a.t)) continue; // MI isenta do gate rígido
        let ratio = a.t.placed / a.t.total; if (a.t.tipo === "TP" && !ucsComPL.has(a.t.ucSigla)) ratio += 0.3; if (W === primeiraSemana && ucsComPL.has(a.t.ucSigla)) ratio -= 2;
        if (a.t.tipo === "TP") { const stR = getStat(statKeyOf(a.t)); if (stR.totalPL > 2 * stR.totalTP && stR.totalTP > 0) ratio -= 1.0; } // PL pesada: TP cedo
        // 1.ª semana: a T das UCs com PL pesada vai PRIMEIRO (4ª de manhã) — destranca
        // a cadeia T→TP→PL logo no arranque (ESDAC: T 4ª → TP 5ª → PL 6ª).
        if (a.t.tipo === "T" && W === primeiraSemana) { const stT = getStat(statKeyOf(a.t)); if (stT.totalPL > 2 * stT.totalTP && stT.totalTP > 0) ratio -= 3; }
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
        let ratio = t.placed / t.total; if (t.tipo === "TP" && !ucsComPL.has(t.ucSigla)) ratio += 0.3;
        if (ratio < bestRatio) { bestRatio = ratio; best = t; }
      }
      if (!best) break;
      let placedOne = false;
      for (const w of best.weeks) { if (tryPlace(best, w)) { placedOne = true; break; } }
      if (!placedOne) exhausted.add(best);
    }
  };

  // SEMEADURA de sessões FIXAS (importadas/fixadas): regista a sua ocupação/conflitos e
  // desconta a carga ANTES de gerar, para o motor preencher só o que falta À VOLTA delas.
  // Passa-se a lista completa; cada chamada (semestre) só semeia as fixas das suas semanas.
  if (opts.sessoesFixas?.length) {
    const semanasDesteSem = new Set(tasks.flatMap(t => t.weeks.map(w => w.semanaGlobal)));
    for (const f of opts.sessoesFixas) {
      if (f.semana == null || !semanasDesteSem.has(f.semana)) continue; // outra metade do ano
      const t = tasks.find(x => x.ucSigla === f.ucSigla && x.tipo === f.tipoAula && x.turmaNome === f.turma);
      if (!t) continue; // UC/turma/tipo sem tarefa correspondente → ignorada (reportado fora)
      seedFixa(t, { semanaGlobal: f.semana, diasBloqueados: [] }, { dia: f.diaSemana, hora: f.horaInicio });
    }
  }

  const allWeeks = [...new Set(tasks.flatMap(t => t.weeks.map(w => w.semanaGlobal)))].sort((a, b) => a - b);
  // Chronological: each week lays T, then the gated TP, then the gated PL.
  const gTP = opts.semRegras ? null : canTP;   // sem regras: ignora a ordem T→TP→PL
  const gPL = opts.semRegras ? null : canPL;
  const primeiraSemana = allWeeks[0];
  for (const W of allWeeks) {
    placeWeek(tTasks,  W, null);
    // PL ANTES da TP dentro da semana: as PL (FT/ESDAC, blocos exclusivos por UC) têm
    // 1.ª escolha das manchas; a ordem pedagógica T→TP→PL mantém-se pelos gates por
    // conteúdo (uma PL só entra quando a T/TP correspondente está à frente).
    placeWeek(plTasks, W, gPL);
    placeWeek(tpTasks, W, gTP); // gate T→TP→PL ativo em TODAS as semanas (incl. a 1.ª)
    placeWeek(sTasks,  W, null);
  }
  // Finish anything left, respecting the same gates.
  cram(tTasks, null);
  cram(plTasks, gPL);

  // Passagem (a): blocos com 6 PL de um meio-cohort C1 → juntar as 2 TP do meio-cohort
  // COMPLEMENTAR C2 (alunos disjuntos), formando 2TP+6PL = 180 e ocupando o cohort idle.
  // Coloca TP de C2 que ainda tenham blocos por dar (sobe também a completude das TP).
  const TP_DO_COHORT: Record<string, string[]> = {
    A1: ["TP1", "TP2"], A2: ["TP3", "TP4"], B1: ["TP5", "TP6"], B2: ["TP7", "TP8"],
  };
  const anoDeSigla = new Map<string, number>();
  for (const t of tasks) anoDeSigla.set(t.ucSigla, t.ano);
  const wkByGlobal = new Map<number, WeekRef>();
  for (const t of tasks) for (const w of t.weeks) if (!wkByGlobal.has(w.semanaGlobal)) wkByGlobal.set(w.semanaGlobal, w);
  const plDaMancha = new Map<string, { ano: number; week: number; dia: string; hora: string; cohorts: Set<string>; n: number; plUCs: Set<string> }>();
  for (const s of sessoes) {
    if (s.tipoAula !== "PL") continue;
    const sc = meioCohort(s.turma); if (!sc) continue;
    const ano = anoDeSigla.get(s.ucSigla) ?? 0;
    const k = `${ano}|${s.semana}|${s.diaSemana}|${s.horaInicio}`;
    let e = plDaMancha.get(k);
    if (!e) { e = { ano, week: s.semana ?? 0, dia: s.diaSemana, hora: s.horaInicio, cohorts: new Set(), n: 0, plUCs: new Set() }; plDaMancha.set(k, e); }
    e.cohorts.add(sc); e.n++; e.plUCs.add(s.ucSigla);
  }
  const tpTasksAll = tasks.filter(t => t.tipo === "TP");
  const siglaDeUC = new Map<string, string>(); for (const t of tasks) siglaDeUC.set(t.ucKey, t.ucSigla);
  for (const e of plDaMancha.values()) {
    if (e.dia === "Sexta") continue;                   // a 6ª de tarde é só PL (sem TP)
    if (e.cohorts.size !== 1) continue;     // só blocos cheios (6 PL) de um só meio-cohort
    const c2 = COMPLEMENTO_COHORT[[...e.cohorts][0]];
    const alvo = new Set(TP_DO_COHORT[c2] || []);
    const wk = wkByGlobal.get(e.week); if (!wk) continue;
    // escolher UMA UC, DIFERENTE da UC da PL (docente partilhado TP↔PL), cujas duas TP de C2 ainda tenham blocos.
    // Damos prioridade a UCs que NÃO TÊM PL (ex: EIG) para que usem os seus blocos aqui.
    // SÓ tarefas cuja UC decorre NESTA semana (sem antecipar UCs do bloco 8-15 para 1-7;
    // a ordenação abaixo já prefere UCs sem PL, ex. EIG, para preencher estes blocos).
    const naSemana = (t: Task) => t.weeks.some(w => w.semanaGlobal === e.week);
    const tpsDispon = tpTasksAll.filter(t => t.ano === e.ano && alvo.has(t.turmaNome) && t.placed < t.total && naSemana(t) && !e.plUCs.has(siglaDeUC.get(t.ucKey) || ""));
    const ucsDisp = [...new Set(tpsDispon.map(t => t.ucKey))].filter(uc => [...alvo].every(tp => tpTasksAll.find(t => t.ucKey === uc && t.turmaNome === tp && t.placed < t.total && naSemana(t)))).sort((a, b) => {
        const hA = ucsComPL.has(siglaDeUC.get(a) || "") ? 1 : 0;
        const hB = ucsComPL.has(siglaDeUC.get(b) || "") ? 1 : 0;
        return hA - hB;
    });
    // Tentar os candidatos POR ORDEM (EIG primeiro por não ter PL), saltando UCs em
    // conflito com as PL do bloco (ex.: EIG não entra num bloco de PL de ESDAC — usa-se
    // então ES/MI/FT). Antes só se tentava o 1.º e falhava em silêncio.
    const conflitaComBloco = (ucKey: string) => {
      const sig = siglaDeUC.get(ucKey) || "";
      const conj = conflitoUC.get(sig);
      return !!conj && [...e.plUCs].some(p => conj.has(p));
    };
    for (const ucCand of ucsDisp) {
      if (conflitaComBloco(ucCand)) continue;
      const candsA = TP_DO_COHORT[c2].map(tp => tpTasksAll.find(t => t.ucKey === ucCand && t.turmaNome === tp && t.placed < t.total && naSemana(t)));
      const allFitA = candsA.every(c => c && !ocupacao.has(slotKey(c.ano, wk.semanaGlobal, c.turmaNome, e.dia, e.hora)) && !gruposAlunoFolha(c.turmaNome).some(g => (diaCount.get(diaKey(c.ano, wk.semanaGlobal, e.dia, g)) || 0) >= MAX_BLOCOS_DIA));
      if (allFitA) {
        candsA.forEach(c => tryPlaceAt(c!, wk, e.dia, e.hora, true));
        break;
      }
    }
    
    // Also try to place 4 TPs of the OTHER Turma to reach the 180 (6PL+2TP) + 90 (4TP) = 270 block
    const fam = [...e.cohorts][0].startsWith("A") ? "B" : "A";
    const tpOutros = [...(TP_DO_COHORT[fam + "1"] || []), ...(TP_DO_COHORT[fam + "2"] || [])];
    const ucsDispOutra = [...new Set(tpTasksAll.filter(t => t.ano === e.ano && tpOutros.includes(t.turmaNome) && t.placed < t.total && naSemana(t)).map(t => t.ucKey))].filter(uc => tpOutros.every(tp => tpTasksAll.find(t => t.ucKey === uc && t.turmaNome === tp && t.placed < t.total && naSemana(t)))).sort((a, b) => {
        const hA = ucsComPL.has(siglaDeUC.get(a) || "") ? 1 : 0;
        const hB = ucsComPL.has(siglaDeUC.get(b) || "") ? 1 : 0;
        return hA - hB;
    });
    for (const ucCandO of ucsDispOutra) {
      if (conflitaComBloco(ucCandO)) continue;
      const candsB = tpOutros.map(tp => tpTasksAll.find(t => t.ucKey === ucCandO && t.turmaNome === tp && t.placed < t.total && naSemana(t)));
      const allFitB = candsB.every(c => c && !ocupacao.has(slotKey(c.ano, wk.semanaGlobal, c.turmaNome, e.dia, e.hora)) && !gruposAlunoFolha(c.turmaNome).some(g => (diaCount.get(diaKey(c.ano, wk.semanaGlobal, e.dia, g)) || 0) >= MAX_BLOCOS_DIA));
      if (allFitB) {
        candsB.forEach(c => tryPlaceAt(c!, wk, e.dia, e.hora, true));
        break;
      }
    }
  }

  cram(tpTasks, gTP);
  cram(sTasks, null);

  // Passagem (b): recuperação das PL em atraso. Nas 6ªs das semanas de AMBAS as turmas,
  // UM bloco após o almoço (16:00) para CADA turma (A e B, todas as 6ªs), só com as PL em
  // falta. Admite mistura de UCs no bloco (ex.: 3 ESDAC + 3 FT) — exceção pedida para
  // recuperar a carga de PL atrasada (FT/ESDAC). O cap do pool (6) limita cada bloco.
  const plTasksRec = tasks.filter(t => (t.tipo === "PL" || t.tipo === "TP") && t.salaPool !== "comp");
  for (const [wg, wk] of wkByGlobal) {
    if (soUmaTurma(2, wg)) continue; // TODO: Pl recovery might need ano check. Assuming ano 2 for legacy behaviour for now
    if (wk.diasBloqueados?.includes("Sexta")) continue;        // 6ª feriado
    for (const fam of ["A", "B"] as const) {                   // ambas as turmas, todas as 6ªs
      const cand = plTasksRec
        .filter(t => t.family === fam && t.placed < t.total && t.weeks.some(w => w.semanaGlobal === wg))
        .sort((a, b) => (b.total - b.placed) - (a.total - a.placed)); // maior atraso primeiro
      for (const t of cand) tryPlaceAt(t, wk, "Sexta", "16:00", true);
    }
  }

  return sessoes;
}
