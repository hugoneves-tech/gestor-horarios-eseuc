/**
 * MODELO CP-SAT — a formulação formal do empacotamento, executável.
 *
 * DECISÃO: x[b][m] ∈ {0,1} — o bloco a 100% `b` (vindo do INVENTÁRIO existente,
 * que é agnóstico ao algoritmo) ocupa a mancha `m` = (semana, dia, hora).
 *
 * Modelar ao nível do BLOCO e não da sessão é o que torna o problema tratável:
 * a composição a 100% (a restrição que o motor heurístico não consegue fechar
 * de forma gulosa) fica satisfeita POR CONSTRUÇÃO, e o solver só decide
 * EMPACOTAMENTO — que é exatamente onde a heurística perde os 44 blocos.
 *
 * Nenhuma regra nova é inventada: cada restrição abaixo cita o campo de
 * `ConfiguracaoMotor` de onde sai. Zero siglas de UC escritas no código.
 */

import { CpModel, CpSolver, CpSolverStatus, LinearExpr } from "cpsat-js";
import type { Constraint, IntVar } from "cpsat-js";

import type { BlocoInventariado, Inventario } from "../inventario";
import type { MapaTurmas, SemanaAlocacao } from "../planeador";
import { horaParaMinutos } from "../../regras/esquema";
import type { ConfiguracaoMotor } from "../../regras/esquema";
import type { SessaoHorario } from "../../types";

/**
 * Tudo o que o modelo precisa de saber, e nada mais. Deliberadamente NÃO é o
 * contexto do protótipo (que lia ficheiros do disco): assim o mesmo modelo
 * corre no browser, num Web Worker, sem tocar no sistema de ficheiros.
 */
export interface ContextoSolver {
  regras: ConfiguracaoMotor;
  inventario: Inventario;
  /** Calendário por ano curricular, tal como `construirCalendario` o devolve. */
  calendario: Map<number, SemanaAlocacao[]>;
  mapa: MapaTurmas;
}

/**
 * Blocos cuja janela de semanas viáveis cai INTEIRAMENTE dentro de [de, ate].
 * Um bloco que atravesse a fronteira não pertence a nenhuma das janelas — é por
 * isso que os cortes têm de ser escolhidos com `cortesLimpos` (ver `janelas.ts`).
 */
export function blocosDaJanela(inv: Inventario, de: number, ate: number): BlocoInventariado[] {
  return inv.blocos.filter(
    (b) => b.semanasViaveis.length > 0 && b.semanasViaveis.every((s) => s >= de && s <= ate),
  );
}

// ---------------------------------------------------------------------------
// Utilitários de expressão linear (somar milhares de booleanos sem O(n²))
// ---------------------------------------------------------------------------

function soma(vars: IntVar[], coef = 1): LinearExpr {
  const m = new Map<number, bigint>();
  const c = BigInt(coef);
  for (const v of vars) m.set(v.index, (m.get(v.index) ?? 0n) + c);
  return new LinearExpr(m, 0n);
}

function somaPesada(pares: [IntVar, number][]): LinearExpr {
  const m = new Map<number, bigint>();
  for (const [v, c] of pares) {
    if (c === 0) continue;
    m.set(v.index, (m.get(v.index) ?? 0n) + BigInt(c));
  }
  return new LinearExpr(m, 0n);
}

function somaExprs(exprs: LinearExpr[]): LinearExpr {
  const m = new Map<number, bigint>();
  let off = 0n;
  for (const e of exprs) {
    off += e.offset;
    for (const [k, v] of e.terms) m.set(k, (m.get(k) ?? 0n) + v);
  }
  return new LinearExpr(m, off);
}

// ---------------------------------------------------------------------------
// Manchas
// ---------------------------------------------------------------------------

export interface Mancha {
  idx: number;
  semana: number;
  dia: string;
  hora: string;
  /** Ordem cronológica total dentro da janela. */
  ord: number;
  periodo: "manha" | "tarde";
}

export interface OpcoesModelo {
  de: number;
  ate: number;
  /** Segundos de tempo de parede dados ao solver. */
  tempo: number;
  workers: number;
  /** Ligar as restrições de precedência (T→TP, TP→PL). */
  precedencias: boolean;
  /** Ligar a restrição de ritmo das TP. */
  ritmo: boolean;
  /** Ordenar cronologicamente os blocos idênticos (quebra de simetria). */
  simetria: boolean;
  /** Pesos da função objetivo. */
  pesoSexta: number;
  pesoDiaAberto: number;
  pesoTurno: number;
  pesoEquilibrio: number;
  verboso: boolean;
  /**
   * Para onde vai o registo de progresso. No protótipo de linha de comandos é o
   * `console`; dentro de um Web Worker é a ponte que devolve o texto à interface.
   */
  onLog?: (linha: string) => void;
  /**
   * ARRANQUE A QUENTE: sessões já produzidas (tipicamente pela heurística
   * atual) usadas como PISTA. Uma pista não restringe nada — só diz ao solver
   * por onde começar. É a arquitetura híbrida: a heurística dá um ponto de
   * partida em ~20 s, o solver melhora-o a partir daí.
   */
  pista?: SessaoHorario[];
  /**
   * Sessões JÁ COLOCADAS antes da janela (o layout fixo que o coordenador impõe
   * na primeira semana). Não são decisões — mas CONTAM como pré-requisitos
   * cumpridos, porque estão cronologicamente antes de tudo o que o solver
   * coloca. Ignorá-las fazia o modelo julgar-se com menos aulas T disponíveis
   * do que o validador vê, e as precedências escalonadas ficavam impossíveis.
   */
  sessoesFixas?: SessaoHorario[];
}

export const OPCOES_PADRAO: OpcoesModelo = {
  de: 1,
  ate: 7,
  tempo: 60,
  workers: 8,
  precedencias: true,
  ritmo: true,
  simetria: true,
  pesoSexta: 30,
  pesoDiaAberto: 120,
  pesoTurno: 3,
  pesoEquilibrio: 25,
  verboso: true,
};

export interface Resultado {
  status: string;
  wallTime: number;
  msConstrucao: number;
  msSolve: number;
  nVars: number;
  nRestricoes: number;
  blocosTotais: number;
  blocosColocados: number;
  objetivo: number;
  sessoes: SessaoHorario[];
  manchasPorFamilia: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Construção e resolução
// ---------------------------------------------------------------------------

export async function resolver(ctx: ContextoSolver, op: OpcoesModelo): Promise<Resultado> {
  const t0 = Date.now();
  const r = ctx.regras;
  const log = (s: string) => { if (op.verboso) (op.onLog ?? ((l: string) => console.log(l)))(s); };

  const horas = r.grelha.horasInicio;
  const blocoH = r.grelha.duracaoBlocoHoras;
  const limiarTarde = r.grelha.limiarTardeHora * 60;
  const periodoDe = (h: string): "manha" | "tarde" =>
    horaParaMinutos(h) >= limiarTarde ? "tarde" : "manha";

  /**
   * `TP_n` cobre as `PL_k` do seu desdobramento — relação ESTRUTURAL, derivada
   * do mapa de turmas do próprio motor, nunca de nomes escritos aqui.
   */
  const folhasDaTP = new Map<string, Set<string>>();
  for (let f = 0; f < ctx.mapa.familias.length; f++) {
    for (let q = 0; q < ctx.mapa.quartosPorFamilia; q++) {
      folhasDaTP.set(ctx.mapa.tp(f, q), new Set(ctx.mapa.pl(f, q)));
    }
  }
  const cobre = (turmaTP: string, turmaDepois: string): boolean =>
    turmaTP === turmaDepois || (folhasDaTP.get(turmaTP)?.has(turmaDepois) ?? false);

  /** Família ("A"/"B") de uma turma, pelo mapa de turmas do motor. */
  const famDaTurma = (nome: string): string | undefined => {
    const i = ctx.mapa.familiaDe(nome) ?? ctx.mapa.familiaDe(ctx.mapa.canonico(nome));
    return i === undefined ? undefined : ctx.mapa.familias[i];
  };

  // --- manchas da janela -----------------------------------------------------
  const semanas = new Map<number, string[]>();
  for (const [, ss] of ctx.calendario) {
    for (const s of ss) if (s.global >= op.de && s.global <= op.ate) semanas.set(s.global, s.dias);
  }
  const manchas: Mancha[] = [];
  let ord = 0;
  for (const w of [...semanas.keys()].sort((a, b) => a - b)) {
    for (const d of semanas.get(w)!) {
      for (const h of horas) {
        manchas.push({ idx: manchas.length, semana: w, dia: d, hora: h, ord: ord++, periodo: periodoDe(h) });
      }
    }
  }

  // --- blocos ---------------------------------------------------------------
  const blocos = blocosDaJanela(ctx.inventario, op.de, op.ate);
  const familias = [...new Set(blocos.map((b) => b.familia))].sort();

  log(`  manchas na janela: ${manchas.length} (${semanas.size} semanas, ${[...semanas.values()].reduce((a, d) => a + d.length, 0)} dias)`);
  log(`  blocos a colocar : ${blocos.length} (${familias.map((f) => `${f}=${blocos.filter((b) => b.familia === f).length}`).join(", ")})`);

  // --- janela de tipo com modo VETO (regras.janelasPorTipo) -----------------
  const vetos = new Map<string, (m: Mancha) => boolean>();
  for (const j of r.janelasPorTipo) {
    if (j.modo !== "veto") continue;
    const permitido = new Map<string, { periodos: Set<string>; horas: Set<string> }>();
    for (const d of j.janelas) {
      permitido.set(d.dia, { periodos: new Set(d.periodos), horas: new Set(d.horas) });
    }
    vetos.set(j.tipo, (m: Mancha) => {
      const p = permitido.get(m.dia);
      if (!p) return false;
      if (p.horas.size > 0 && !p.horas.has(m.hora)) return false;
      if (p.periodos.size > 0 && !p.periodos.has(m.periodo)) return false;
      return true;
    });
  }

  // --- restrições por UC com dias/períodos proibidos (regras.restricoesUC) ---
  const fronteira = r.calendario.fronteiraSemestre;
  const semestreDe = (w: number) => (w <= fronteira ? 1 : 2);
  const relativaDe = (w: number) => (w <= fronteira ? w : w - fronteira);
  function proibidoPorRestricao(sigla: string, tipo: string, m: Mancha): boolean {
    for (const x of r.restricoesUC) {
      if (x.siglas.length > 0 && !x.siglas.includes(sigla)) continue;
      if (x.tipos.length > 0 && !x.tipos.includes(tipo as never)) continue;
      if (x.semestre !== null && x.semestre !== semestreDe(m.semana)) continue;
      if (x.semanasRestritas.length > 0 && !x.semanasRestritas.includes(relativaDe(m.semana))) continue;
      const temDia = x.diasProibidos.length > 0;
      const temPer = x.periodosProibidos.length > 0;
      if (temDia && temPer) {
        if (x.diasProibidos.includes(m.dia) && x.periodosProibidos.includes(m.periodo)) return true;
      } else if (temDia) {
        if (x.diasProibidos.includes(m.dia)) return true;
      } else if (temPer) {
        if (x.periodosProibidos.includes(m.periodo)) return true;
      }
    }
    return false;
  }

  /** Uma mancha serve um bloco se serve TODAS as suas sessões. */
  function manchaServe(b: BlocoInventariado, m: Mancha): boolean {
    if (!b.semanasViaveis.includes(m.semana)) return false;
    for (const s of b.sessoes) {
      const veto = vetos.get(s.tipo);
      if (veto && !veto(m)) return false;
      if (proibidoPorRestricao(s.ucSigla, s.tipo, m)) return false;
    }
    return true;
  }

  // --- variáveis ------------------------------------------------------------
  const model = new CpModel();
  /** x[bi] = mapa mancha.idx -> BoolVar */
  const x: Map<number, IntVar>[] = [];
  const falta: IntVar[] = [];
  let nVars = 0;
  let nRestricoes = 0;

  for (let bi = 0; bi < blocos.length; bi++) {
    const b = blocos[bi];
    const mp = new Map<number, IntVar>();
    for (const m of manchas) {
      if (!manchaServe(b, m)) continue;
      mp.set(m.idx, model.newBoolVar(`x_${bi}_${m.idx}`));
      nVars++;
    }
    x.push(mp);
    const f = model.newBoolVar(`falta_${bi}`);
    falta.push(f);
    nVars++;
    // C1: cada bloco é colocado exatamente uma vez (ou fica por colocar).
    model.add(somaExprs([soma([...mp.values()]), soma([f])]).equals(1));
    nRestricoes++;
  }

  log(`  variáveis x[b][m] criadas: ${nVars - blocos.length} (+${blocos.length} folgas)`);

  // --- índices auxiliares ---------------------------------------------------
  const porFamilia = new Map<string, number[]>();
  for (let bi = 0; bi < blocos.length; bi++) {
    const f = blocos[bi].familia;
    if (!porFamilia.has(f)) porFamilia.set(f, []);
    porFamilia.get(f)!.push(bi);
  }
  const manchaPorChave = new Map<string, Mancha>();
  for (const m of manchas) manchaPorChave.set(`${m.semana}|${m.dia}|${m.hora}`, m);
  const diasDaJanela: { semana: number; dia: string; manchas: Mancha[] }[] = [];
  {
    const acc = new Map<string, Mancha[]>();
    for (const m of manchas) {
      const k = `${m.semana}|${m.dia}`;
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k)!.push(m);
    }
    for (const [k, ms] of acc) {
      const [w, d] = k.split("|");
      diasDaJanela.push({ semana: Number(w), dia: d, manchas: ms });
    }
  }

  /** Todas as variáveis de blocos da família f na mancha m. */
  function varsEm(fam: string, m: Mancha): IntVar[] {
    const out: IntVar[] = [];
    for (const bi of porFamilia.get(fam) ?? []) {
      const v = x[bi].get(m.idx);
      if (v) out.push(v);
    }
    return out;
  }

  // --- C2: no máximo um bloco por família e por mancha ----------------------
  for (const fam of familias) {
    for (const m of manchas) {
      const vs = varsEm(fam, m);
      if (vs.length > 1) { model.add(soma(vs).le(1)); nRestricoes++; }
    }
  }

  // --- C3: carga diária (regras.cargaDiaria) --------------------------------
  const tetoBlocosDia = Math.floor(r.cargaDiaria.transversal.maxHoras / blocoH);
  const alvoBlocosDia = Math.floor(r.cargaDiaria.transversal.alvoHoras / blocoH);
  for (const fam of familias) {
    for (const d of diasDaJanela) {
      const vs = d.manchas.flatMap((m) => varsEm(fam, m));
      if (vs.length > tetoBlocosDia) { model.add(soma(vs).le(tetoBlocosDia)); nRestricoes++; }
    }
  }

  // --- C4: pausa de almoço (regras.grelha.pausaAlmoco) ----------------------
  const pa = r.grelha.pausaAlmoco;
  if (pa) {
    for (const fam of familias) {
      for (const d of diasDaJanela) {
        const antes = manchaPorChave.get(`${d.semana}|${d.dia}|${pa.horaAntes}`);
        const depois = manchaPorChave.get(`${d.semana}|${d.dia}|${pa.horaDepois}`);
        if (!antes || !depois) continue;
        const vs = [...varsEm(fam, antes), ...varsEm(fam, depois)];
        if (vs.length > 1) { model.add(soma(vs).le(1)); nRestricoes++; }
      }
    }
  }

  // --- C5: capacidade global de PL (regras.capacidade.maxPLporMancha) -------
  const maxPL = r.capacidade.maxPLporMancha;
  const nPL = blocos.map((b) => b.sessoes.filter((s) => s.tipo === "PL").length);
  for (const m of manchas) {
    const pares: [IntVar, number][] = [];
    for (let bi = 0; bi < blocos.length; bi++) {
      if (nPL[bi] === 0) continue;
      const v = x[bi].get(m.idx);
      if (v) pares.push([v, nPL[bi]]);
    }
    if (pares.length > 0) {
      const maxPossivel = pares.reduce((a, [, c]) => a + c, 0);
      if (maxPossivel > maxPL) { model.add(somaPesada(pares).le(maxPL)); nRestricoes++; }
    }
  }

  // --- C6: máximos por UC na mancha (maxTP/maxPL por UC, âmbito bloco) ------
  // A composição já garante o limite DENTRO de um bloco; falta o limite quando
  // duas famílias (ou anos) partilham a mesma mancha.
  const siglas = [...new Set(blocos.flatMap((b) => b.sessoes.map((s) => s.ucSigla)))];
  const limUC = new Map<string, { tp: number; pl: number }>();
  for (const s of siglas) {
    const decl = r.limitesPorUC.find((l) => l.sigla === s);
    limUC.set(s, {
      tp: Math.min(r.capacidade.maxTPporUCporMancha ?? 99, decl?.maxSimultaneoTP ?? 99),
      pl: Math.min(r.capacidade.maxPLporUCporMancha ?? 99, decl?.maxSimultaneoPL ?? 99),
    });
  }
  const contaUC = blocos.map((b) => {
    const c = new Map<string, { tp: number; pl: number }>();
    for (const s of b.sessoes) {
      if (!c.has(s.ucSigla)) c.set(s.ucSigla, { tp: 0, pl: 0 });
      if (s.tipo === "TP") c.get(s.ucSigla)!.tp++;
      else if (s.tipo === "PL") c.get(s.ucSigla)!.pl++;
    }
    return c;
  });
  for (const m of manchas) {
    for (const sig of siglas) {
      const lim = limUC.get(sig)!;
      for (const tipo of ["tp", "pl"] as const) {
        const pares: [IntVar, number][] = [];
        for (let bi = 0; bi < blocos.length; bi++) {
          const n = contaUC[bi].get(sig)?.[tipo] ?? 0;
          if (n === 0) continue;
          const v = x[bi].get(m.idx);
          if (v) pares.push([v, n]);
        }
        const maxPossivel = pares.reduce((a, [, c]) => a + c, 0);
        if (maxPossivel > lim[tipo]) { model.add(somaPesada(pares).le(lim[tipo])); nRestricoes++; }
      }
    }
  }

  // --- C7: maratonas (regras.maratonaUC.maxBlocosMesmaUCporDia) -------------
  // O teto de blocos SEGUIDOS é implicado pelo teto diário quando são iguais.
  if (r.maratonaUC.ativo) {
    const maxDia = r.maratonaUC.maxBlocosMesmaUCporDia;
    for (const fam of familias) {
      for (const d of diasDaJanela) {
        for (const sig of siglas) {
          const vs: IntVar[] = [];
          for (const bi of porFamilia.get(fam) ?? []) {
            if (!blocos[bi].sessoes.some((s) => s.ucSigla === sig)) continue;
            for (const m of d.manchas) { const v = x[bi].get(m.idx); if (v) vs.push(v); }
          }
          if (vs.length > maxDia) { model.add(soma(vs).le(maxDia)); nRestricoes++; }
        }
      }
    }
  }

  // --- Variáveis de POSIÇÃO e de SEMANA -------------------------------------
  // Formulação compacta: em vez de somar prefixos cronológicos (que gera
  // milhões de termos e faz rebentar o WASM), cada bloco ganha UMA posição
  // cronológica e UMA semana. Um bloco por colocar é empurrado para depois do
  // fim do horizonte, para que nunca possa servir de pré-requisito a ninguém.
  const semanasOrd = [...semanas.keys()].sort((a, b) => a - b);
  const semanaMax = semanasOrd[semanasOrd.length - 1];
  const FORA_POS = manchas.length + 1;
  const FORA_SEM = semanaMax + 1;
  const precisaPos = op.precedencias || op.simetria;
  const precisaSem = op.ritmo && r.ritmoTP.ativo && r.ritmoTP.unidade === "semanas";

  const pos: IntVar[] = [];
  const wk: IntVar[] = [];
  if (precisaPos || precisaSem) {
    for (let bi = 0; bi < blocos.length; bi++) {
      const entradas = [...x[bi].entries()];
      if (precisaPos) {
        const p = model.newIntVar(0, FORA_POS, `pos_${bi}`);
        nVars++;
        model.add(
          somaExprs([
            somaPesada(entradas.map(([midx, v]) => [v, manchas[midx].ord] as [IntVar, number])),
            soma([falta[bi]], FORA_POS),
            soma([p], -1),
          ]).equals(0),
        );
        nRestricoes++;
        pos.push(p);
      }
      if (precisaSem) {
        const w = model.newIntVar(0, FORA_SEM, `wk_${bi}`);
        nVars++;
        model.add(
          somaExprs([
            somaPesada(entradas.map(([midx, v]) => [v, manchas[midx].semana] as [IntVar, number])),
            soma([falta[bi]], FORA_SEM),
            soma([w], -1),
          ]).equals(0),
        );
        nRestricoes++;
        wk.push(w);
      }
    }
  }

  // --- Quebra de simetria entre blocos IDÊNTICOS ----------------------------
  // O inventário produz dezenas de blocos exatamente iguais (mesma família,
  // mesma composição). Trocá-los entre si dá a MESMA solução, e o solver
  // gastaria o tempo todo a explorar essas permutações. Forçá-los a aparecer
  // por ordem cronológica não perde nenhuma solução distinta.
  const assinatura = (bi: number): string =>
    `${blocos[bi].familia}|${blocos[bi].semanasViaveis.join(",")}|` +
    blocos[bi].sessoes.map((s) => `${s.ucSigla}/${s.tipo}/${s.turma}`).sort().join("+");
  const gruposIdenticos = new Map<string, number[]>();
  for (let bi = 0; bi < blocos.length; bi++) {
    const a = assinatura(bi);
    if (!gruposIdenticos.has(a)) gruposIdenticos.set(a, []);
    gruposIdenticos.get(a)!.push(bi);
  }
  if (op.simetria) {
    let cadeias = 0;
    for (const [, grupo] of gruposIdenticos) {
      if (grupo.length < 2) continue;
      for (let i = 0; i + 1 < grupo.length; i++) {
        model.add(pos[grupo[i]].lt(pos[grupo[i + 1]]));
        nRestricoes++;
      }
      cadeias++;
    }
    log(`  quebra de simetria: ${gruposIdenticos.size} classes de blocos, ${cadeias} cadeias ordenadas`);
  }

  // --- Pré-requisitos já cumpridos pelas sessões fixas ----------------------
  // Estão todas em semanas ANTERIORES às da janela do solver, logo contam como
  // "dadas antes" de qualquer bloco que o solver venha a colocar.
  const fixasT = new Map<string, number>();  // fam|sigla -> nº de aulas T
  const fixasTP = new Map<string, number>(); // fam|sigla|turmaTP -> nº de aulas TP
  // Semanas que o solver DECIDE (alguma vez viáveis para algum bloco). Uma
  // sessão fixa só conta como pré-requisito se estiver numa semana anterior a
  // todas essas — aí é garantidamente anterior a tudo o que o solver coloca.
  const semanasDecididas = new Set<number>();
  for (const b of blocos) for (const w of b.semanasViaveis) semanasDecididas.add(w);
  const primeiraDecidida = Math.min(...semanasDecididas);
  for (const s of op.sessoesFixas ?? []) {
    const w = s.semana ?? 0;
    if (semanasDecididas.has(w) || w >= primeiraDecidida) continue;
    const fam = famDaTurma(s.turma);
    if (!fam) continue;
    if (s.tipoAula === "T") {
      const k = `${fam}|${s.ucSigla}`;
      fixasT.set(k, (fixasT.get(k) ?? 0) + 1);
    } else if (s.tipoAula === "TP") {
      const k = `${fam}|${s.ucSigla}|${s.turma}`;
      fixasTP.set(k, (fixasTP.get(k) ?? 0) + 1);
    }
  }
  const nFixT = (fam: string, sig: string) => fixasT.get(`${fam}|${sig}`) ?? 0;
  const nFixTP = (fam: string, sig: string, turmaDepois: string) => {
    let n = 0;
    for (const [k, v] of fixasTP) {
      const [f, s, t] = k.split("|");
      if (f === fam && s === sig && cobre(t, turmaDepois)) n += v;
    }
    return n;
  };
  if ((op.sessoesFixas ?? []).length > 0) {
    log(`  sessões fixas antes da janela: ${(op.sessoesFixas ?? []).length} · pré-requisitos T já dados: ${[...fixasT].map(([k, v]) => `${k}=${v}`).join(" ") || "(nenhum)"}`);
  }

  /** Blocos da família `fam` que trazem uma sessão de `sig`/`tipo` na turma dada. */
  function blocosCom(fam: string, sig: string, tipo: string, turma?: string): number[] {
    return (porFamilia.get(fam) ?? []).filter((bi) =>
      blocos[bi].sessoes.some(
        (s) => s.ucSigla === sig && s.tipo === tipo && (turma === undefined || s.turma === turma),
      ),
    );
  }

  // --- C8: precedências (regras.precedencias) -------------------------------
  if (precisaPos) {
    for (const fam of familias) {
      for (const prec of r.precedencias) {
        const alvo = prec.siglas.length > 0 ? new Set(prec.siglas) : new Set(siglas);
        const kBruto = prec.unidade === "horas" ? Math.ceil(prec.minimoAntes / blocoH) : prec.minimoAntes;
        for (const sig of siglas) {
          if (!alvo.has(sig)) continue;
          const turmasDepois = new Set<string>();
          for (const bi of porFamilia.get(fam) ?? []) {
            for (const s of blocos[bi].sessoes) {
              if (s.ucSigla === sig && s.tipo === prec.tipoDepois) turmasDepois.add(s.turma);
            }
          }
          for (const turma of turmasDepois) {
            const depois = blocosCom(fam, sig, prec.tipoDepois, turma);
            const antes = (porFamilia.get(fam) ?? []).filter((bi) =>
              blocos[bi].sessoes.some(
                (s) =>
                  s.ucSigla === sig &&
                  s.tipo === prec.tipoAntes &&
                  (prec.tipoAntes === "T" ? true : cobre(s.turma, turma)),
              ),
            );
            // Desconta o que o layout fixo já entregou antes da janela.
            const k =
              kBruto -
              (prec.tipoAntes === "T" ? nFixT(fam, sig) : nFixTP(fam, sig, turma));
            if (k <= 0) continue;
            if (antes.length === 0 || depois.length === 0) continue;

            if (prec.tipoAntes === "T") {
              // Os blocos T da mesma UC e família são IDÊNTICOS: ordená-los no
              // tempo não perde soluções (quebra de simetria) e dá-nos o "k-ésimo".
              // (redundante com a quebra de simetria quando os blocos T caem
              // todos na mesma classe; mantém-se para garantir a ordem TOTAL
              // mesmo quando têm janelas de semanas diferentes)
              for (let i = 0; i + 1 < antes.length; i++) {
                model.add(pos[antes[i]].lt(pos[antes[i + 1]]));
                nRestricoes++;
              }
              if (antes.length < k) continue;
              const kEsimo = antes[k - 1];
              for (const d of depois) {
                if (d === kEsimo) continue;
                model.add(pos[kEsimo].lt(pos[d]));
                nRestricoes++;
              }
            } else {
              // Blocos "antes" heterogéneos: emparelhamento explícito.
              // Para cada bloco DEPOIS, pelo menos k blocos ANTES antes dele.
              for (const d of depois) {
                const ys: IntVar[] = [];
                for (const a of antes) {
                  if (a === d) continue;
                  const y = model.newBoolVar(`y_${a}_${d}`);
                  nVars++;
                  model.add(pos[a].lt(pos[d])).onlyEnforceIf(y);
                  nRestricoes++;
                  ys.push(y);
                }
                if (ys.length === 0) continue;
                model.add(soma(ys).ge(Math.min(k, ys.length)));
                nRestricoes++;
              }
            }
          }
        }
      }
    }
  }

  // --- C10: precedência ESCALONADA das PL (regras.precedenciasEscalonadas) --
  // A tabela do coordenador: "antes da n-ésima PL, tantas T e tantas TP".
  // Encoding exato: `ordem[i][j]` reifica pos[i] < pos[j]; daí saem a ORDEM da
  // PL dentro da sua turma e as CONTAGENS de T e TP já dadas antes dela.
  // Como `minimoT`/`minimoTP` são não-decrescentes ao longo da tabela, basta
  // dizer: "se a PL não está nos escalões anteriores, cumpre este escalão".
  if (precisaPos && r.precedenciasEscalonadas.length > 0) {
    const reificar = (i: number, j: number, nome: string): IntVar => {
      const b = model.newBoolVar(nome);
      nVars++;
      model.add(pos[i].le(pos[j].minus(1))).onlyEnforceIf(b);
      model.add(pos[i].ge(pos[j])).onlyEnforceIf(b.not());
      nRestricoes += 2;
      return b;
    };
    for (const fam of familias) {
      for (const esc of r.precedenciasEscalonadas) {
        if (esc.escaloes.length === 0) continue;
        const alvo = esc.siglas.length > 0 ? new Set(esc.siglas) : new Set(siglas);
        const escaloes = [...esc.escaloes].sort((a, b) => a.ateNesimaPL - b.ateNesimaPL);
        for (const sig of siglas) {
          if (!alvo.has(sig)) continue;
          // turmas PL desta UC nesta família
          const turmasPL = new Set<string>();
          for (const bi of porFamilia.get(fam) ?? []) {
            for (const s of blocos[bi].sessoes) if (s.ucSigla === sig && s.tipo === "PL") turmasPL.add(s.turma);
          }
          if (turmasPL.size === 0) continue;
          const blocosT = (porFamilia.get(fam) ?? []).filter((bi) =>
            blocos[bi].sessoes.some((s) => s.ucSigla === sig && s.tipo === "T"),
          );
          for (const p of turmasPL) {
            const blocosPL = blocosCom(fam, sig, "PL", p);
            if (blocosPL.length === 0) continue;
            // TP que cobre esta turma PL
            const blocosTP = (porFamilia.get(fam) ?? []).filter((bi) =>
              blocos[bi].sessoes.some((s) => s.ucSigla === sig && s.tipo === "TP" && cobre(s.turma, p)),
            );
            // ordem[i][j] para i<j dentro das PL (a simétrica é a negação)
            const ordemPL = new Map<string, IntVar>();
            for (let i = 0; i < blocosPL.length; i++) {
              for (let j = i + 1; j < blocosPL.length; j++) {
                ordemPL.set(`${i}|${j}`, reificar(blocosPL[i], blocosPL[j], `oPL_${fam}_${sig}_${p}_${i}_${j}`));
              }
            }
            for (let k = 0; k < blocosPL.length; k++) {
              const d = blocosPL[k];
              // posição (1-based) da PL k dentro da sua turma
              const antesDeK: [IntVar, number][] = [];
              for (let i = 0; i < blocosPL.length; i++) {
                if (i === k) continue;
                const chave = i < k ? `${i}|${k}` : `${k}|${i}`;
                const b = ordemPL.get(chave)!;
                // i<k: b = (i antes de k) -> conta 1;  i>k: b = (k antes de i) -> conta (1-b)
                antesDeK.push([b, i < k ? 1 : -1]);
              }
              const nMaioresQueK = blocosPL.length - 1 - blocosPL.slice(0, k).length;
              // ordem = 1 + Σ_{i<k} b_ik + Σ_{i>k} (1 − b_ki)
              const ordemExpr = somaExprs([
                somaPesada(antesDeK),
                LinearExpr.fromConstant(1 + nMaioresQueK),
              ]);
              const contT = blocosT.map((a) => reificar(a, d, `tT_${fam}_${sig}_${p}_${a}_${d}`));
              const contTP = blocosTP.map((a) => reificar(a, d, `tTP_${fam}_${sig}_${p}_${a}_${d}`));

              // Indicador "ordem <= N" por escalão. A BANDA do escalão e é
              // (prev, N], logo o seu indicador é `ate[e] ∧ ¬ate[e−1]`.
              // A tabela NÃO é monótona (o último escalão baixa `minimoT` de 4
              // para 0), por isso a banda tem mesmo de ser exclusiva — exigir o
              // máximo a todas as PL acima do escalão anterior seria mais
              // apertado do que a regra do coordenador.
              const ate: (IntVar | null)[] = [];
              for (const e of escaloes) {
                if (e.ateNesimaPL >= blocosPL.length) { ate.push(null); continue; } // sempre verdadeiro
                const z = model.newBoolVar(`ate_${fam}_${sig}_${p}_${k}_${e.ateNesimaPL}`);
                nVars++;
                model.add(ordemExpr.le(e.ateNesimaPL)).onlyEnforceIf(z);
                model.add(ordemExpr.ge(e.ateNesimaPL + 1)).onlyEnforceIf(z.not());
                nRestricoes += 2;
                ate.push(z);
              }
              for (let ei = 0; ei < escaloes.length; ei++) {
                const e = escaloes[ei];
                // O layout fixo já entregou `jaT`/`jaTP` aulas antes da janela.
                const jaT = nFixT(fam, sig);
                const jaTP = nFixTP(fam, sig, p);
                const precisaT = Math.min(e.minimoT, contT.length + jaT) - jaT;
                const precisaTP = Math.min(e.minimoTP, contTP.length + jaTP) - jaTP;
                if (precisaT <= 0 && precisaTP <= 0) continue;
                const guardas: (IntVar | number)[] = [];
                if (ate[ei]) guardas.push(ate[ei]!);                  // ordem <= N
                if (ei > 0 && ate[ei - 1]) guardas.push(ate[ei - 1]!.not()); // ordem > prev
                const aplicar = (c: Constraint) => {
                  if (guardas.length > 0) c.onlyEnforceIf(guardas);
                };
                if (precisaT > 0) { aplicar(model.add(soma(contT).ge(precisaT))); nRestricoes++; }
                if (precisaTP > 0) { aplicar(model.add(soma(contTP).ge(precisaTP))); nRestricoes++; }
              }
            }
          }
        }
      }
    }
  }

  // --- C9: ritmo das TP (regras.ritmoTP, unidade "semanas") -----------------
  // Equivalência exata: |w_n − v_n| <= D para todo o n
  //   <=> para toda a semana W: #{aulas de q até W} <= #{aulas de q' até W+D}
  // Contado com indicadores z[b,W] = [semana(b) <= W], que custam 2 termos cada.
  if (precisaSem) {
    const D = r.ritmoTP.maxDesvioSemanas;
    const zPorBloco = new Map<number, Map<number, IntVar>>();
    const indicador = (bi: number, W: number): IntVar | null => {
      if (W >= FORA_SEM) return null; // sempre verdadeiro se colocado; inútil
      let mp = zPorBloco.get(bi);
      if (!mp) { mp = new Map(); zPorBloco.set(bi, mp); }
      const achado = mp.get(W);
      if (achado) return achado;
      const z = model.newBoolVar(`z_${bi}_${W}`);
      nVars++;
      model.add(wk[bi].le(W)).onlyEnforceIf(z);
      model.add(wk[bi].gt(W)).onlyEnforceIf(z.not());
      nRestricoes += 2;
      mp.set(W, z);
      return z;
    };
    for (const fam of familias) {
      for (const sig of siglas) {
        const turmasTP = new Set<string>();
        for (const bi of porFamilia.get(fam) ?? []) {
          for (const s of blocos[bi].sessoes) if (s.ucSigla === sig && s.tipo === "TP") turmasTP.add(s.turma);
        }
        const lista = [...turmasTP].sort();
        if (lista.length < 2) continue;
        const conjunto = new Map<string, number[]>();
        for (const t of lista) conjunto.set(t, blocosCom(fam, sig, "TP", t));
        for (const a of lista) {
          for (const b of lista) {
            if (a === b) continue;
            for (const W of semanasOrd) {
              const esq = conjunto.get(a)!.map((bi) => indicador(bi, W)).filter(Boolean) as IntVar[];
              const dir = conjunto.get(b)!.map((bi) => indicador(bi, W + D)).filter(Boolean) as IntVar[];
              if (esq.length === 0) continue;
              // Se W+D já cobre todo o horizonte, a direita vale |conjunto| e é trivial.
              const direitaTrivial = W + D >= semanaMax;
              if (direitaTrivial) continue;
              model.add(somaExprs([soma(esq), soma(dir, -1)]).le(0));
              nRestricoes++;
            }
          }
        }
      }
    }
  }

  // --- Objetivo -------------------------------------------------------------
  const termos: LinearExpr[] = [];
  // 1. completude (prioridade absoluta)
  termos.push(soma(falta, 1_000_000));
  // 2. sexta livre (regras.preferencias.preferirSextaLivre)
  if (r.preferencias.preferirSextaLivre) {
    const ultimoDia = r.grelha.dias[r.grelha.dias.length - 1];
    const vs: IntVar[] = [];
    for (const m of manchas) {
      if (m.dia !== ultimoDia) continue;
      for (let bi = 0; bi < blocos.length; bi++) { const v = x[bi].get(m.idx); if (v) vs.push(v); }
    }
    termos.push(soma(vs, op.pesoSexta));
  }
  // 3. evitar dias parciais — exatamente o que o validador mede em
  //    `dia-abaixo-do-alvo`: um dia ABERTO com menos do que a carga-alvo.
  //    Penaliza-se o DÉFICE (alvo − blocos) de cada dia aberto, o que empurra
  //    para dias completos sem forçar todos os dias ao teto.
  if (r.cargaDiaria.transversal.evitarDiasParciais) {
    const defs: IntVar[] = [];
    for (const fam of familias) {
      for (const d of diasDaJanela) {
        const dv = d.manchas.flatMap((m) => varsEm(fam, m));
        if (dv.length === 0) continue;
        const aberto = model.newBoolVar(`aberto_${fam}_${d.semana}_${d.dia}`);
        const def = model.newIntVar(0, alvoBlocosDia, `def_${fam}_${d.semana}_${d.dia}`);
        nVars += 2;
        // aberto = 1 sempre que o dia tem pelo menos um bloco
        model.add(somaExprs([soma(dv), soma([aberto], -tetoBlocosDia)]).le(0));
        // def >= alvo*aberto − blocos   (0 quando o dia está fechado ou cheio)
        model.add(
          somaExprs([soma([aberto], alvoBlocosDia), soma(dv, -1), soma([def], -1)]).le(0),
        );
        nRestricoes += 2;
        defs.push(def);
      }
    }
    termos.push(soma(defs, op.pesoDiaAberto));
  }
  // 4. turnos (regras.turnos): a família da manhã prefere manhã, a outra tarde.
  //    PREFERÊNCIA, não veto — o horário de referência sai do turno 13 vezes.
  if (op.pesoTurno > 0) {
    const pares: [IntVar, number][] = [];
    for (const fam of familias) {
      for (const m of manchas) {
        const sem = semestreDe(m.semana);
        const famManha = r.turnos.familiaDeManhaPorSemestre[sem];
        const querManha = fam === famManha;
        const fora = querManha ? m.periodo === "tarde" : m.periodo === "manha";
        if (!fora) continue;
        for (const v of varsEm(fam, m)) pares.push([v, op.pesoTurno]);
      }
    }
    if (pares.length > 0) termos.push(somaPesada(pares));
  }
  // 5. equilíbrio semanal: minimizar a amplitude (max−min) de blocos por semana
  if (op.pesoEquilibrio > 0) {
    for (const fam of familias) {
      const ws = semanasOrd.filter((w) => manchas.some((m) => m.semana === w && varsEm(fam, m).length > 0));
      if (ws.length < 2) continue;
      // Uma variável de contagem por semana (poucas restrições grandes), e
      // depois a amplitude sobre essas contagens (muitas restrições pequenas).
      const nSem = new Map<number, IntVar>();
      for (const w of ws) {
        const vs = manchas.filter((m) => m.semana === w).flatMap((m) => varsEm(fam, m));
        const c = model.newIntVar(0, 60, `nsem_${fam}_${w}`);
        nVars++;
        model.add(somaExprs([soma(vs), soma([c], -1)]).equals(0));
        nRestricoes++;
        nSem.set(w, c);
      }
      const amp = model.newIntVar(0, 999, `amp_${fam}`);
      nVars++;
      for (const w1 of ws) {
        for (const w2 of ws) {
          if (w1 === w2) continue;
          // densidade: blocos/dia, comparada em escala comum d1*d2
          const d1 = semanas.get(w1)!.length;
          const d2 = semanas.get(w2)!.length;
          model.add(
            somaExprs([
              soma([nSem.get(w1)!], d2),
              soma([nSem.get(w2)!], -d1),
              soma([amp], -1),
            ]).le(0),
          );
          nRestricoes++;
        }
      }
      termos.push(soma([amp], op.pesoEquilibrio));
    }
  }

  model.minimize(somaExprs(termos));

  // --- Arranque a quente ----------------------------------------------------
  if (op.pista && op.pista.length > 0) {
    // Agrupa as sessões da pista por mancha+família e procura, para cada
    // grupo, um bloco do inventário com a MESMA composição ainda por usar.
    const grupos = new Map<string, { m: Mancha; sess: string[] }>();
    for (const s of op.pista) {
      const w = s.semana ?? 0;
      if (w < op.de || w > op.ate) continue;
      const m = manchaPorChave.get(`${w}|${s.diaSemana}|${s.horaInicio}`);
      if (!m) continue;
      const fam = famDaTurma(s.turma);
      if (!fam) continue;
      const k = `${m.idx}|${fam}`;
      if (!grupos.has(k)) grupos.set(k, { m, sess: [] });
      grupos.get(k)!.sess.push(`${s.ucSigla}/${s.tipoAula}/${s.turma}`);
    }
    const porComposicao = new Map<string, number[]>();
    for (let bi = 0; bi < blocos.length; bi++) {
      const k = `${blocos[bi].familia}|${blocos[bi].sessoes.map((s) => `${s.ucSigla}/${s.tipo}/${s.turma}`).sort().join("+")}`;
      if (!porComposicao.has(k)) porComposicao.set(k, []);
      porComposicao.get(k)!.push(bi);
    }
    const usados = new Set<number>();
    let dadas = 0;
    for (const [k, g] of grupos) {
      const fam = k.split("|")[1];
      const chave = `${fam}|${g.sess.sort().join("+")}`;
      const cands = porComposicao.get(chave);
      if (!cands) continue;
      const bi = cands.find((c) => !usados.has(c) && x[c].has(g.m.idx));
      if (bi === undefined) continue;
      usados.add(bi);
      model.addHint(x[bi].get(g.m.idx)!, 1);
      model.addHint(falta[bi], 0);
      dadas++;
    }
    log(`  arranque a quente: ${dadas} de ${blocos.length} blocos com pista da heurística`);
  }

  const msConstrucao = Date.now() - t0;
  log(`  modelo construído em ${msConstrucao} ms: ${nVars} variáveis, ${nRestricoes} restrições`);

  // --- resolver -------------------------------------------------------------
  const solver = await CpSolver.create();
  const t1 = Date.now();
  const res = solver.solve(model, { maxTimeInSeconds: op.tempo, numWorkers: op.workers });
  const msSolve = Date.now() - t1;

  const nomeStatus = CpSolverStatus[res.status] ?? String(res.status);
  log(`  solver: status ${nomeStatus}, objetivo ${res.objectiveValue}, wall ${res.wallTime.toFixed(2)}s (${msSolve} ms de relógio)`);

  // --- extrair --------------------------------------------------------------
  const sessoes: SessaoHorario[] = [];
  const manchasPorFamilia: Record<string, number> = {};
  let colocados = 0;
  let id = 1;
  const viavel = res.status === CpSolverStatus.OPTIMAL || res.status === CpSolverStatus.FEASIBLE;
  if (viavel) {
    for (let bi = 0; bi < blocos.length; bi++) {
      for (const [midx, v] of x[bi]) {
        if (res.value(v) !== 1) continue;
        colocados++;
        const m = manchas[midx];
        manchasPorFamilia[blocos[bi].familia] = (manchasPorFamilia[blocos[bi].familia] ?? 0) + 1;
        for (const s of blocos[bi].sessoes) {
          sessoes.push(criarSessao(id++, s, m, blocoH));
        }
      }
    }
  }

  return {
    status: nomeStatus,
    wallTime: res.wallTime,
    msConstrucao,
    msSolve,
    nVars,
    nRestricoes,
    blocosTotais: blocos.length,
    blocosColocados: colocados,
    objetivo: res.objectiveValue,
    sessoes,
    manchasPorFamilia,
  };
}

function criarSessao(
  id: number,
  s: { ucId: string; ucSigla: string; turma: string; tipo: string },
  m: Mancha,
  blocoH: number,
): SessaoHorario {
  const hh = Number(m.hora.slice(0, 2)) + blocoH;
  return {
    id,
    ucNome: s.ucSigla,
    ucSigla: s.ucSigla,
    tipoAula: s.tipo as SessaoHorario["tipoAula"],
    docente: "",
    sala: "",
    salaTipo: "",
    turma: s.turma,
    diaSemana: m.dia,
    horaInicio: m.hora,
    horaFim: `${String(hh).padStart(2, "0")}:${m.hora.slice(3)}`,
    bloqueado: false,
    semana: m.semana,
  };
}
