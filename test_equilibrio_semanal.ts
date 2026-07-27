// Medição do EQUILÍBRIO DA CARGA SEMANAL por turma teórica (família A/B).
//   npx tsx test_equilibrio_semanal.ts
//
// Reproduz o pipeline real do App (handleTriggerSolver): gerarSessoesConjunto por
// semestre → completarCargaParaBlocos100 → organizarBlocos100. Como cada bloco a
// 100% ocupa a turma teórica inteira, a carga de um estudante numa semana é
// 2h × nº de manchas (semana|dia|hora) distintas da sua família.
//
// Objetivo do coordenador: carga semanal o mais uniforme possível, sobretudo nas
// semanas 8-15 (UCs "-I") e 16-23 (UCs "-II") do 2.º ano.

import type { UC, SessaoHorario } from "./src/types";
import { ucsIniciais, anosSemestresIniciais, feriadosIniciais } from "./src/mockData";
import { gerarSessoesConjunto, calcularSemanas, mapearSemanasPedagogicasParaFisicas, type EntradaUC } from "./src/utils/distribuicao";
import { completarCargaParaBlocos100, organizarBlocos100, CONFIGURACAO_BLOCOS_100_DEFAULT, type ConfiguracaoBlocos100 } from "./src/utils/blocos100";

const ANO_LETIVO = anosSemestresIniciais[0]?.anoLetivo ?? "2026/2027";

function familiaDe(turma: string): "A" | "B" | null {
  if (turma === "Turma A") return "A";
  if (turma === "Turma B") return "B";
  const tp = turma.match(/^TP(\d+)$/); if (tp) return +tp[1] <= 4 ? "A" : "B";
  const pl = turma.match(/^PL(\d+)$/); if (pl) return +pl[1] <= 12 ? "A" : "B";
  return null;
}

/** Constrói as entradas por semestre, como o App faz. */
function construirEntradas(ucs: UC[]) {
  const entradasS1: EntradaUC[] = [];
  const entradasS2: EntradaUC[] = [];
  for (const uc of ucs) {
    if (!uc.turmasConfig?.length) continue;
    if (Number(uc.anoCurricular) === 3) continue;
    const anoSem = anosSemestresIniciais.find(s => s.anoLetivo === ANO_LETIVO && s.semestre === uc.semestre);
    if (!anoSem?.dataInicioSemestre) continue;
    const prop = `dataInicioAno${uc.anoCurricular}` as keyof typeof anoSem;
    const anoDataInicio = uc.semestre === 2 ? anoSem.dataInicioSemestre : (anoSem as any)?.[prop];
    const dataInicio = uc.dataInicio || anoDataInicio || anoSem.dataInicioSemestre;
    const semanaGlobalOffset = uc.semestre === 2 ? 15 : 0;
    const semStartPed = uc.semanaInicio || 1;
    const semEndPed = uc.semanaFim ?? (semStartPed + (uc.numSemanas || 15) - 1);
    const m = mapearSemanasPedagogicasParaFisicas(semStartPed, semEndPed, anoSem.semanasPersonalizadas);
    const semanas = calcularSemanas(dataInicio, m.start, m.end, feriadosIniciais, anoSem.semanasPersonalizadas);
    (uc.semestre === 2 ? entradasS2 : entradasS1).push({ uc, semanas, semanaGlobalOffset });
  }
  return { entradasS1, entradasS2 };
}

export function gerarHorario(ucs: UC[], overrides: Partial<ConfiguracaoBlocos100> = {}) {
  const { entradasS1, entradasS2 } = construirEntradas(ucs);
  const prefTurmaAManha: Record<string, boolean> = {};
  for (let ano = 1; ano <= 4; ano++) for (const sem of [1, 2]) prefTurmaAManha[`${ano}|${sem}`] = sem === 1;
  Object.assign(prefTurmaAManha, overrides.prefTurmaAManha ?? {});

  const ocupacaoGlobal = new Set<string>();
  const plCount = new Map<string, number>();
  // As mesmas opções que o App passa ao motor: os turnos e as semanas de turma única valem
  // também na distribuição inicial (é ela que coloca as T, que blocos100 nunca desloca).
  const opcoes = {
    maxPLporMancha: 6, prefTurmaAManha, sessoesFixas: [] as SessaoHorario[],
    semanasSoTurmaA: overrides.semanasSoTurmaA, semanasSoTurmaB: overrides.semanasSoTurmaB,
  };
  const s1 = gerarSessoesConjunto(entradasS1, 1, 0, ocupacaoGlobal, plCount, opcoes as any);
  const s2 = gerarSessoesConjunto(entradasS2, 2, s1.length, ocupacaoGlobal, plCount, opcoes as any);

  const entradas = [...entradasS1, ...entradasS2];
  let todas = completarCargaParaBlocos100([...s1, ...s2], entradas, []);
  const r = organizarBlocos100(todas, ucs, { ...CONFIGURACAO_BLOCOS_100_DEFAULT, prefTurmaAManha, ...overrides }, entradas, []);
  return { sessoes: r.sessoes, naoAlocadas: r.naoAlocadas, blocosPorPadrao: r.blocosPorPadrao, entradas };
}

/** Manchas distintas por (família, semana) → horas de aula do estudante nessa semana. */
export function cargaPorSemana(sessoes: SessaoHorario[]) {
  const manchas = new Map<string, Set<string>>();   // `${fam}|${semana}` → {dia|hora}
  const tarde = new Map<string, number>();          // `${fam}|${semana}` → manchas de tarde
  const sextas = new Map<string, Set<string>>();    // `${fam}|${semana}` → manchas à sexta
  for (const s of sessoes) {
    const fam = familiaDe(s.turma); if (!fam || s.semana == null) continue;
    const k = `${fam}|${s.semana}`; const dh = `${s.diaSemana}|${s.horaInicio}`;
    let set = manchas.get(k); if (!set) { set = new Set(); manchas.set(k, set); }
    if (!set.has(dh)) {
      set.add(dh);
      if (["14:00", "16:00", "18:00"].includes(s.horaInicio)) tarde.set(k, (tarde.get(k) || 0) + 1);
      if (s.diaSemana === "Sexta") {
        let f = sextas.get(k); if (!f) { f = new Set(); sextas.set(k, f); } f.add(dh);
      }
    }
  }
  return { manchas, tarde, sextas };
}

function estatisticas(nums: number[]) {
  const ativos = nums.filter(n => n > 0);
  if (!ativos.length) return { min: 0, max: 0, media: 0, amplitude: 0 };
  const media = ativos.reduce((a, b) => a + b, 0) / ativos.length;
  const min = Math.min(...ativos), max = Math.max(...ativos);
  return { min, max, media, amplitude: max - min };
}

const DIAS_UTEIS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const BLOCOS_SEMANAS: [string, number, number][] = [["1-7", 1, 7], ["8-15", 8, 15], ["16-23", 16, 23], ["24-30", 24, 30]];

/**
 * Teto FÍSICO de horas de uma semana para uma família: os dias úteis dessa semana (as
 * semanas com feriados têm menos), com no máximo 3 dias de 8h (4 manchas) e os restantes
 * a 6h (3 manchas), tal como manda a regra de carga diária do estudante. As semanas 1, 4
 * e 5 do mockData são curtas por feriados e ficam estruturalmente abaixo das outras.
 */
function tetoPorSemana(entradas: EntradaUC[], fam: "A" | "B") {
  const carga = CONFIGURACAO_BLOCOS_100_DEFAULT.cargaDiariaEstudante;
  const alvo = Math.max(1, Math.floor(carga.alvoHoras / 2));
  const maxBlocos = Math.max(alvo, Math.floor(carga.maxHoras / 2));
  const dias = new Map<number, Set<string>>();
  for (const entrada of entradas) {
    if (!(entrada.uc.turmasConfig ?? []).some(t => familiaDe(t.nome) === fam)) continue;
    for (const semana of entrada.semanas) {
      if (!(semana.fator > 0)) continue;
      const w = semana.numero + entrada.semanaGlobalOffset;
      let set = dias.get(w); if (!set) { set = new Set(); dias.set(w, set); }
      for (const d of DIAS_UTEIS) if (!semana.diasBloqueados?.includes(d)) set.add(d);
    }
  }
  const teto = new Map<number, number>();
  for (const [w, set] of dias) {
    const d = set.size;
    teto.set(w, 2 * (Math.min(d, carga.maxDiasNoMaximoPorSemana) * maxBlocos + Math.max(0, d - carga.maxDiasNoMaximoPorSemana) * alvo));
  }
  return teto;
}

/**
 * Critério de aceitação do coordenador: amplitude (máx-mín) ≤ 4h em cada bloco de semanas
 * e por família, contando SÓ as semanas em que a família tem aulas. Uma semana só pode
 * ficar mais de 4h abaixo da mais carregada se já estiver no seu próprio teto físico
 * (tolerância de 1 mancha para a granularidade da arrumação por dias).
 */
function falhasDeEquilibrio(manchas: Map<string, Set<string>>, entradas: EntradaUC[]): string[] {
  const falhas: string[] = [];
  for (const fam of ["A", "B"] as const) {
    const teto = tetoPorSemana(entradas, fam);
    for (const [nome, ini, fim] of BLOCOS_SEMANAS) {
      const ativas: { w: number; h: number }[] = [];
      for (let w = ini; w <= fim; w++) {
        const h = (manchas.get(`${fam}|${w}`)?.size ?? 0) * 2;
        if (h > 0) ativas.push({ w, h });
      }
      if (!ativas.length) continue;
      const maxH = Math.max(...ativas.map(a => a.h));
      for (const a of ativas) {
        const tetoH = teto.get(a.w) ?? 36;
        if (maxH - a.h > 4 && a.h < tetoH - 2) {
          falhas.push(`${nome}/${fam}: semana ${a.w} com ${a.h}h — ${maxH - a.h}h abaixo da mais carregada (${maxH}h) e ainda ${tetoH - a.h}h abaixo do teto físico (${tetoH}h)`);
        }
      }
    }
  }
  return falhas;
}

function relatorio(titulo: string, ucs: UC[], overrides: Partial<ConfiguracaoBlocos100> = {}, detalhado = false) {
  const { sessoes, naoAlocadas, blocosPorPadrao, entradas } = gerarHorario(ucs, overrides);
  const { manchas, tarde, sextas } = cargaPorSemana(sessoes);

  console.log("==================================================================");
  console.log(` ${titulo}`);
  console.log("==================================================================");
  console.log(`Sessões: ${sessoes.length}   não alocadas: ${naoAlocadas.length}`);
  console.log(`Blocos por padrão: ${JSON.stringify(blocosPorPadrao)}`);
  console.log("");
  if (detalhado) {
    console.log("Sem | Turma A (h)  tarde sexta | Turma B (h)  tarde sexta");
    console.log("----+---------------------------+--------------------------");
    for (let w = 1; w <= 30; w++) {
      const cel = (fam: "A" | "B") => {
        const k = `${fam}|${w}`;
        const h = (manchas.get(k)?.size ?? 0) * 2;
        const t = tarde.get(k) ?? 0;
        const f = sextas.get(k)?.size ?? 0;
        return `${String(h).padStart(3)}h${" ".repeat(8)}${String(t).padStart(2)}    ${String(f).padStart(2)}`;
      };
      const marca = (w >= 8 && w <= 15) || (w >= 16 && w <= 23) ? " *" : "  ";
      console.log(`${String(w).padStart(3)}${marca}| ${cel("A")} | ${cel("B")}`);
    }
    console.log("  (* = semanas apontadas pelo coordenador)");
    console.log("");
  }

  console.log("Bloco  | Fam | min  max  média  amplitude  (teto físico mín. das semanas ativas)");
  console.log("-------+-----+-------------------------------------------------------------");
  for (const [nome, ini, fim] of BLOCOS_SEMANAS) {
    for (const fam of ["A", "B"] as const) {
      const teto = tetoPorSemana(entradas, fam);
      const horas: number[] = [];
      const tetos: number[] = [];
      for (let w = ini; w <= fim; w++) {
        const h = (manchas.get(`${fam}|${w}`)?.size ?? 0) * 2;
        horas.push(h);
        if (h > 0) tetos.push(teto.get(w) ?? 36);
      }
      const e = estatisticas(horas);
      if (e.max === 0) continue;
      console.log(`${nome.padEnd(6)} |  ${fam}  | ${String(e.min).padStart(3)}h ${String(e.max).padStart(3)}h ${e.media.toFixed(1).padStart(6)}h ${String(e.amplitude).padStart(8)}h        ${String(Math.min(...tetos)).padStart(3)}h`);
    }
  }
  const totalManchas = [...manchas.values()].reduce((a, s) => a + s.size, 0);
  const totalTarde = [...tarde.values()].reduce((a, n) => a + n, 0);
  const totalSextas = [...sextas.values()].reduce((a, s) => a + s.size, 0);
  const pctTarde = 100 * totalTarde / totalManchas;
  console.log("");
  console.log(`Total de manchas: ${totalManchas}  |  de tarde: ${totalTarde} (${pctTarde.toFixed(1)}%)  |  à sexta: ${totalSextas} (${(100 * totalSextas / totalManchas).toFixed(1)}%)`);
  const falhas = falhasDeEquilibrio(manchas, entradas);
  console.log(falhas.length ? `EQUILÍBRIO: ${falhas.length} falha(s)` : "EQUILÍBRIO: OK (amplitude ≤ 4h fora das semanas no teto físico)");
  for (const f of falhas) console.log(`  ✗ ${f}`);
  console.log("==================================================================");
  console.log("");
  return { naoAlocadas: naoAlocadas.length, pctTarde, falhas };
}

/**
 * Estrutura ESEUC real: nas semanas 8-15 só a Turma A tem aulas (UCs "-I") e nas 16-23 só
 * a Turma B (UCs "-II") — a outra turma está em estágio. Devolve o catálogo com as turmas
 * dessas UCs restringidas à família que está presente.
 */
function comEstruturaDeTurmaUnica(ucs: UC[]): UC[] {
  return ucs.map(uc => {
    if (Number(uc.anoCurricular) !== 2 || !uc.turmasConfig?.length) return uc;
    const inicioGlobal = (uc.semanaInicio || 1) + (uc.semestre === 2 ? 15 : 0);
    const fam = uc.semestre === 1 && inicioGlobal >= 8 ? "A" : uc.semestre === 2 && inicioGlobal <= 16 ? "B" : null;
    if (!fam) return uc;
    return { ...uc, turmasConfig: uc.turmasConfig.filter(t => familiaDe(t.nome) === fam) };
  });
}

if (process.argv[1]?.includes("test_equilibrio_semanal")) {
  const SO_A = { 2: Array.from({ length: 8 }, (_, i) => 8 + i) };   // semanas globais 8-15
  const SO_B = { 2: Array.from({ length: 8 }, (_, i) => 16 + i) };  // semanas globais 16-23

  // 1) Cenário base: mockData tal como está, sem semanas de turma única configuradas.
  const base = relatorio("CENÁRIO 1 — base (mockData, sem semanas de turma única)", ucsIniciais, {}, true);

  // 2) Mesmo cenário com as semanas de turma única do 2.º ano declaradas.
  const comFlags = relatorio(
    "CENÁRIO 2 — mockData + semanasSoTurmaA 8-15 / semanasSoTurmaB 16-23 (2.º ano)",
    ucsIniciais, { semanasSoTurmaA: SO_A, semanasSoTurmaB: SO_B }, true,
  );

  // 3) Estrutura ESEUC verdadeira (só uma turma nas semanas 8-15 e 16-23) com a Turma A de
  //    manhã nos DOIS semestres — a configuração em que a Turma B ficaria sempre à tarde.
  //    É aqui que as semanas de turma única mostram o seu efeito: sem elas a Turma B fica à
  //    tarde nas semanas 16-23 apesar de ser a única turma na escola.
  const prefAManhaSempre = { "2|1": true, "2|2": true };
  const ucsEstrutura = comEstruturaDeTurmaUnica(ucsIniciais);
  const estruturaSemFlags = relatorio(
    "CENÁRIO 3a — estrutura de turma única, SEM semanasSoTurma (Turma A de manhã nos 2 semestres)",
    ucsEstrutura, { prefTurmaAManha: prefAManhaSempre },
  );
  const estruturaComFlags = relatorio(
    "CENÁRIO 3b — estrutura de turma única, COM semanasSoTurma (Turma A de manhã nos 2 semestres)",
    ucsEstrutura, { prefTurmaAManha: prefAManhaSempre, semanasSoTurmaA: SO_A, semanasSoTurmaB: SO_B },
  );

  const erros: string[] = [];
  for (const [nome, r] of [["1", base], ["2", comFlags], ["3a", estruturaSemFlags], ["3b", estruturaComFlags]] as const) {
    if (r.naoAlocadas > 0) erros.push(`Cenário ${nome}: ${r.naoAlocadas} sessões não alocadas (não pode regredir de 0).`);
    if (r.falhas.length) erros.push(`Cenário ${nome}: ${r.falhas.length} semana(s) desequilibrada(s) — ${r.falhas[0]}`);
  }
  if (!(estruturaComFlags.pctTarde < estruturaSemFlags.pctTarde)) {
    erros.push(`As semanas de turma única não reduziram a tarde: ${estruturaComFlags.pctTarde.toFixed(1)}% vs ${estruturaSemFlags.pctTarde.toFixed(1)}%.`);
  }

  console.log("RESUMO % de manchas à tarde");
  console.log(`  cenário 1 (base) .................... ${base.pctTarde.toFixed(1)}%`);
  console.log(`  cenário 2 (mock + turma única) ...... ${comFlags.pctTarde.toFixed(1)}%`);
  console.log(`  cenário 3a (estrutura, sem flags) ... ${estruturaSemFlags.pctTarde.toFixed(1)}%`);
  console.log(`  cenário 3b (estrutura, com flags) ... ${estruturaComFlags.pctTarde.toFixed(1)}%`);
  console.log("");
  if (erros.length) {
    for (const e of erros) console.error(`FALHA: ${e}`);
    process.exit(1);
  }
  console.log("Equilíbrio semanal, cobertura a 100% e redução da tarde validados.");
}
