import type { SessaoHorario, UC } from "../types";
import solver, { type Model, type SolveResult } from "javascript-lp-solver";
import { gruposFolha } from "./validacao";

export type PadraoBloco100Id =
  | "T1"
  | "TP4_MESMA_UC"
  | "TP2_DUAS_UCS"
  | "TP2_PL6_DUAS_UCS"
  | "TP2_PL3_PL3"
  | "TP3_PL3";

export interface ConfiguracaoBlocos100 {
  exigirCoberturaTotal: boolean;
  preferirSextaLivre: boolean;
  /** Capacidade física global de PL por semana+dia+hora, somando todas as turmas e anos. */
  maxPLporMancha: number;
  /** Turma A: true = manhã, false = tarde, por `${ano}|${semestre}`. A B usa o turno oposto. */
  prefTurmaAManha?: Record<string, boolean>;
  /**
   * Semanas GLOBAIS (1-30) em que só a Turma A tem aulas — a B está em estágio —, por ano
   * curricular. Nessas semanas não há contenção entre as duas famílias, por isso a família
   * ativa pode ocupar o dia inteiro (manhã e tarde), com a manhã preferida no custo.
   */
  semanasSoTurmaA?: Record<number, number[]>;
  /** Idem para as semanas em que só a Turma B tem aulas. */
  semanasSoTurmaB?: Record<number, number[]>;
  /** Precedências específicas, carregadas de config.motor.precedenciasUC no Supabase. */
  precedenciasUC?: {
    siglas: string[];
    tipoAntes: "T" | "TP";
    tipoDepois: "TP" | "PL";
    minimoAntes: number;
  }[];
  /** Restrições genéricas provenientes de config.motor.restricoesUC no Supabase. */
  restricoesUC?: {
    siglas: string[];
    diasProibidos?: string[];
    periodosProibidos?: ("manha" | "tarde")[];
    tipos?: ("T" | "TP" | "PL" | "S")[];
    semanasRestritas?: number[];
  }[];
  /** Datas assinaladas pelas regras do Supabase para não ficarem vazias ou com apenas 2h. */
  diasPrioritarios?: {
    semana: number;
    dia: string;
    minimoBlocos: number;
  }[];
  padroesAtivos: PadraoBloco100Id[];
  padraoAEvitar: PadraoBloco100Id;
  cargaDiariaEstudante: {
    alvoHoras: number;
    maxHoras: number;
    maxDiasNoMaximoPorSemana: number;
    evitarDiasParciais?: boolean;
  };
}

export const CONFIGURACAO_BLOCOS_100_DEFAULT: ConfiguracaoBlocos100 = {
  exigirCoberturaTotal: true,
  preferirSextaLivre: true,
  maxPLporMancha: 6,
  precedenciasUC: [],
  restricoesUC: [],
  diasPrioritarios: [],
  padroesAtivos: ["T1", "TP4_MESMA_UC", "TP2_DUAS_UCS", "TP2_PL6_DUAS_UCS", "TP2_PL3_PL3", "TP3_PL3"],
  padraoAEvitar: "TP3_PL3",
  cargaDiariaEstudante: { alvoHoras: 6, maxHoras: 8, maxDiasNoMaximoPorSemana: 5, evitarDiasParciais: false },
};

export const DESCRICAO_PADROES_BLOCOS_100: Record<PadraoBloco100Id, string> = {
  T1: "1 turma T da mesma UC",
  TP4_MESMA_UC: "4 turmas TP da mesma UC",
  TP2_DUAS_UCS: "2 TP de uma UC + 2 TP de outra UC",
  TP2_PL6_DUAS_UCS: "2 TP de uma UC + 6 PL de outra UC",
  TP2_PL3_PL3: "2 TP da mesma UC + 3 PL de uma UC + 3 PL de outra UC (as três UCs diferentes)",
  TP3_PL3: "3 TP da mesma UC + 3 PL de outra UC (a evitar)",
};

type Familia = "A" | "B";
type Item = { sessao: SessaoHorario; ucId: string; ucSigla: string; quarto: number; tipo: "TP" | "PL" };
type Bloco = { sessoes: SessaoHorario[]; padrao: PadraoBloco100Id; semanaPreferida: number; arranqueTP?: boolean };

export interface ResultadoBlocos100 {
  sessoes: SessaoHorario[];
  naoAlocadas: SessaoHorario[];
  blocosPorPadrao: Partial<Record<PadraoBloco100Id, number>>;
  avisos: string[];
}

export interface ErroBloco100 {
  chave: string;
  cobertura: number;
  motivo: string;
}

export interface UCAtivaBlocos100 {
  uc: UC;
  semanas: { numero: number; diasBloqueados?: string[] }[];
  semanaGlobalOffset: number;
}

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const HORAS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

function familiaEQuarto(turma: string): { familia: Familia; quarto: number } | null {
  const tp = turma.match(/^TP(\d+)$/i);
  if (tp) {
    const n = Number(tp[1]);
    if (n >= 1 && n <= 8) return { familia: n <= 4 ? "A" : "B", quarto: (n - 1) % 4 };
  }
  const pl = turma.match(/^PL(\d+)$/i);
  if (pl) {
    const n = Number(pl[1]);
    if (n >= 1 && n <= 24) return { familia: n <= 12 ? "A" : "B", quarto: Math.floor(((n - 1) % 12) / 3) };
  }
  return null;
}

function familiaTeorica(turma: string): Familia | null {
  if (/Turma A/i.test(turma)) return "A";
  if (/Turma B/i.test(turma)) return "B";
  return familiaEQuarto(turma)?.familia ?? null;
}

function modaSemana(sessoes: SessaoHorario[]): number {
  const contagem = new Map<number, number>();
  for (const s of sessoes) if (s.semana != null) contagem.set(s.semana, (contagem.get(s.semana) ?? 0) + 1);
  return [...contagem].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
}

function take(pool: Item[], tipo: "TP" | "PL", ucId: string, quarto: number, quantidade: number): Item[] | null {
  const encontrados = pool.filter(x => x.tipo === tipo && x.ucId === ucId && x.quarto === quarto).slice(0, quantidade);
  if (encontrados.length !== quantidade) return null;
  for (const item of encontrados) pool.splice(pool.indexOf(item), 1);
  return encontrados;
}

function criarBloco(itens: Item[], padrao: PadraoBloco100Id): Bloco {
  const sessoes = itens.map(x => x.sessao);
  return { sessoes, padrao, semanaPreferida: modaSemana(sessoes) };
}

type Consumo = { tipo: "TP" | "PL"; ucId: string; quarto: number; quantidade: number };
type CandidatoBloco = { padrao: PadraoBloco100Id; consumos: Consumo[] };

function resolverPoolExato(
  poolOriginal: Item[],
  ativos: Set<PadraoBloco100Id>,
  evitar: PadraoBloco100Id,
  slotsPermitidosPorUc: Map<string, Set<string>> | null,
  maxSimultaneoTPPorUc: Map<string, number>,
  maxSimultaneoPLPorUc: Map<string, number>,
  reservarArranqueTP = true,
): { blocos: Bloco[]; sobras: Item[] } {
  const poolTrabalho = [...poolOriginal];
  const blocosArranque: Bloco[] = [];
  if (reservarArranqueTP && ativos.has("TP4_MESMA_UC")) {
    const ucsComPL = new Set(poolTrabalho.filter(x => x.tipo === "PL").map(x => x.ucId));
    const ucsTP = [...new Set(poolTrabalho.filter(x => x.tipo === "TP").map(x => x.ucId))];
    for (const ucId of ucsTP.filter(id => ucsComPL.has(id))) {
      const limiteTP = maxSimultaneoTPPorUc.get(ucId);
      if (limiteTP != null && limiteTP > 0 && limiteTP < 4) continue;
      const disponivel = [0, 1, 2, 3].every(quarto =>
        poolTrabalho.some(x => x.tipo === "TP" && x.ucId === ucId && x.quarto === quarto));
      if (!disponivel) continue;
      const itens = [0, 1, 2, 3].flatMap(quarto =>
        take(poolTrabalho, "TP", ucId, quarto, 1) ?? []);
      if (itens.length === 4) {
        blocosArranque.push({ ...criarBloco(itens, "TP4_MESMA_UC"), arranqueTP: true });
      }
    }
  }

  const recursos = new Map<string, { tipo: "TP" | "PL"; ucId: string; quarto: number; quantidade: number }>();
  const chaveRecurso = (tipo: "TP" | "PL", ucId: string, quarto: number) => `${tipo}|${ucId}|${quarto}`;
  for (const item of poolTrabalho) {
    const chave = chaveRecurso(item.tipo, item.ucId, item.quarto);
    const atual = recursos.get(chave);
    if (atual) atual.quantidade++;
    else recursos.set(chave, { tipo: item.tipo, ucId: item.ucId, quarto: item.quarto, quantidade: 1 });
  }
  const tpUcs = [...new Set(poolTrabalho.filter(x => x.tipo === "TP").map(x => x.ucId))];
  const plUcs = [...new Set(poolTrabalho.filter(x => x.tipo === "PL").map(x => x.ucId))];
  const candidatos: CandidatoBloco[] = [];
  const adicionar = (padrao: PadraoBloco100Id, consumos: Consumo[]) => {
    if (!consumos.every(c => recursos.has(chaveRecurso(c.tipo, c.ucId, c.quarto)))) return;
    const tpPorUc = new Map<string, number>();
    const plPorUc = new Map<string, number>();
    for (const consumo of consumos.filter(c => c.tipo === "TP")) {
      tpPorUc.set(consumo.ucId, (tpPorUc.get(consumo.ucId) ?? 0) + consumo.quantidade);
    }
    for (const consumo of consumos.filter(c => c.tipo === "PL")) {
      plPorUc.set(consumo.ucId, (plPorUc.get(consumo.ucId) ?? 0) + consumo.quantidade);
    }
    if ([...tpPorUc].some(([ucId, quantidade]) => {
      const limite = maxSimultaneoTPPorUc.get(ucId);
      return limite != null && limite > 0 && quantidade > limite;
    })) return;
    if ([...plPorUc].some(([ucId, quantidade]) => {
      const limite = maxSimultaneoPLPorUc.get(ucId);
      return limite != null && limite > 0 && quantidade > limite;
    })) return;
    const ids = [...new Set(consumos.map(c => c.ucId))];
    if (slotsPermitidosPorUc && ids.length > 1) {
      const primeiro = slotsPermitidosPorUc.get(ids[0]);
      if (!primeiro || ![...primeiro].some(slot => ids.slice(1).every(id => slotsPermitidosPorUc.get(id)?.has(slot)))) return;
    }
    candidatos.push({ padrao, consumos });
  };

  if (ativos.has("TP4_MESMA_UC")) for (const ucId of tpUcs) adicionar("TP4_MESMA_UC", [0, 1, 2, 3].map(quarto => ({ tipo: "TP", ucId, quarto, quantidade: 1 })));
  if (ativos.has("TP2_DUAS_UCS")) for (let a = 0; a < tpUcs.length; a++) for (let b = a + 1; b < tpUcs.length; b++) {
    for (let mascara = 1; mascara < 15; mascara++) {
      const qsA = [0, 1, 2, 3].filter(q => mascara & (1 << q));
      if (qsA.length !== 2) continue;
      const qsB = [0, 1, 2, 3].filter(q => !qsA.includes(q));
      adicionar("TP2_DUAS_UCS", [
        ...qsA.map(quarto => ({ tipo: "TP" as const, ucId: tpUcs[a], quarto, quantidade: 1 })),
        ...qsB.map(quarto => ({ tipo: "TP" as const, ucId: tpUcs[b], quarto, quantidade: 1 })),
      ]);
    }
  }
  if (ativos.has("TP2_PL6_DUAS_UCS")) for (const ucTp of tpUcs) for (const ucPl of plUcs) {
    if (ucTp === ucPl) continue;
    for (let mascara = 1; mascara < 15; mascara++) {
      const qsTp = [0, 1, 2, 3].filter(q => mascara & (1 << q));
      if (qsTp.length !== 2) continue;
      const qsPl = [0, 1, 2, 3].filter(q => !qsTp.includes(q));
      adicionar("TP2_PL6_DUAS_UCS", [
        ...qsTp.map(quarto => ({ tipo: "TP" as const, ucId: ucTp, quarto, quantidade: 1 })),
        ...qsPl.map(quarto => ({ tipo: "PL" as const, ucId: ucPl, quarto, quantidade: 3 })),
      ]);
    }
  }
  if (ativos.has("TP2_PL3_PL3")) for (const ucTp of tpUcs) for (let a = 0; a < plUcs.length; a++) for (let b = a + 1; b < plUcs.length; b++) {
    if (ucTp === plUcs[a] || ucTp === plUcs[b]) continue;
    // Misturar PL de UCs diferentes só é autorizado quando ambas estão
    // explicitamente configuradas para grupos máximos de 3 no Supabase.
    if (maxSimultaneoPLPorUc.get(plUcs[a]) !== 3 || maxSimultaneoPLPorUc.get(plUcs[b]) !== 3) continue;
    for (let qA = 0; qA < 4; qA++) for (let qB = 0; qB < 4; qB++) {
      if (qA === qB) continue;
      const restantes = [0, 1, 2, 3].filter(q => q !== qA && q !== qB);
      adicionar("TP2_PL3_PL3", [
        { tipo: "PL", ucId: plUcs[a], quarto: qA, quantidade: 3 },
        { tipo: "PL", ucId: plUcs[b], quarto: qB, quantidade: 3 },
        ...restantes.map(quarto => ({ tipo: "TP" as const, ucId: ucTp, quarto, quantidade: 1 })),
      ]);
    }
  }
  if (ativos.has("TP3_PL3")) for (const ucTp of tpUcs) for (const ucPl of plUcs) {
    if (ucTp === ucPl) continue;
    for (let qPl = 0; qPl < 4; qPl++) adicionar("TP3_PL3", [
      { tipo: "PL", ucId: ucPl, quarto: qPl, quantidade: 3 },
      ...[0, 1, 2, 3].filter(q => q !== qPl).map(quarto => ({ tipo: "TP" as const, ucId: ucTp, quarto, quantidade: 1 })),
    ]);
  }

  const nomesRecursos = new Map([...recursos.keys()].map((chave, i) => [chave, `r${i}`]));
  const constraints: Model["constraints"] = {};
  for (const [chave, recurso] of recursos) constraints[nomesRecursos.get(chave)!] = { equal: recurso.quantidade };
  const variables: Model["variables"] = {};
  const ints: NonNullable<Model["ints"]> = {};
  candidatos.forEach((candidato, i) => {
    const nome = `b${i}`;
    const coeficientes: Record<string, number> = { custo: candidato.padrao === evitar ? 1001 : 1 };
    for (const consumo of candidato.consumos) coeficientes[nomesRecursos.get(chaveRecurso(consumo.tipo, consumo.ucId, consumo.quarto))!] = consumo.quantidade;
    variables[nome] = coeficientes;
    ints[nome] = 1;
  });
  const modelo: Model = { optimize: "custo", opType: "min", constraints, variables, ints, options: { timeout: 15000, presolve: true } };
  let solucao = solver.Solve(modelo) as SolveResult;
  if (!solucao.feasible) {
    if (blocosArranque.length) {
      return resolverPoolExato(
        poolOriginal,
        ativos,
        evitar,
        slotsPermitidosPorUc,
        maxSimultaneoTPPorUc,
        maxSimultaneoPLPorUc,
        false,
      );
    }
    // Se uma pequena sobra impedir a igualdade total, não se rejeita o grupo
    // inteiro. Maximiza-se a cobertura e devolvem-se apenas as sessões realmente
    // incompatíveis. Isto mantém utilizáveis todos os blocos completos.
    const constraintsParciais: Model["constraints"] = {};
    for (const [chave, recurso] of recursos) {
      constraintsParciais[nomesRecursos.get(chave)!] = { max: recurso.quantidade };
    }
    const variablesParciais: Model["variables"] = {};
    candidatos.forEach((candidato, i) => {
      const nome = `b${i}`;
      const totalSessoes = candidato.consumos.reduce((total, consumo) => total + consumo.quantidade, 0);
      const coeficientes: Record<string, number> = {
        cobertura: totalSessoes * 1_000 - Number(candidato.padrao === evitar),
      };
      for (const consumo of candidato.consumos) {
        coeficientes[nomesRecursos.get(chaveRecurso(consumo.tipo, consumo.ucId, consumo.quarto))!] = consumo.quantidade;
      }
      variablesParciais[nome] = coeficientes;
    });
    solucao = solver.Solve({
      optimize: "cobertura",
      opType: "max",
      constraints: constraintsParciais,
      variables: variablesParciais,
      ints,
      options: { timeout: 15000, presolve: true },
    }) as SolveResult;
    if (!solucao.feasible) return { blocos: [], sobras: [...poolOriginal] };
  }

  const pool = [...poolTrabalho];
  const blocos: Bloco[] = [...blocosArranque];
  candidatos.forEach((candidato, i) => {
    const repeticoes = Math.round(Number(solucao[`b${i}`] ?? 0));
    for (let n = 0; n < repeticoes; n++) {
      const itens = candidato.consumos.flatMap(c => take(pool, c.tipo, c.ucId, c.quarto, c.quantidade) ?? []);
      if (itens.length === candidato.consumos.reduce((total, c) => total + c.quantidade, 0)) blocos.push(criarBloco(itens, candidato.padrao));
    }
  });
  return { blocos, sobras: pool };
}

/**
 * O distribuidor geral tenta colocar cada sessão imediatamente num horário e,
 * quando não encontra espaço, pode devolver menos sessões numa turma do que a
 * carga curricular exige. Isso desequilibra os quartos da turma teórica e torna
 * impossível fechar blocos, apesar de a carga configurada estar correta.
 *
 * Antes de formar os blocos, repomos apenas essas sessões em falta. A colocação
 * provisória não é relevante: `organizarBlocos100` atribui depois um slot único
 * e completo a todo o bloco.
 */
export function completarCargaParaBlocos100(
  sessoesGeradas: SessaoHorario[],
  entradasAtivas: UCAtivaBlocos100[],
  sessoesFixas: SessaoHorario[] = [],
): SessaoHorario[] {
  const resultado = [...sessoesGeradas];
  let proximoId = Math.max(0, ...resultado.map(s => Number(s.id) || 0), ...sessoesFixas.map(s => Number(s.id) || 0)) + 1;
  const contar = (lista: SessaoHorario[], sigla: string, tipo: "TP" | "PL", turma: string) =>
    lista.filter(s => s.ucSigla === sigla && s.tipoAula === tipo && s.turma === turma).length;

  for (const entrada of entradasAtivas) {
    const { uc } = entrada;
    const semanas = entrada.semanas.map(s => s.numero + entrada.semanaGlobalOffset);
    if (!semanas.length) continue;
    for (const turma of uc.turmasConfig ?? []) {
      const tipo: "TP" | "PL" | null = turma.tipo === "TeoricoPratica" ? "TP" : turma.tipo === "Prática" ? "PL" : null;
      if (!tipo) continue;
      const horas = tipo === "TP" ? Number(uc.cargaHorariaTP || 0) : Number(uc.cargaHorariaPratica || 0);
      const esperadas = Math.floor(horas / 2);
      const existentes = contar(resultado, uc.sigla, tipo, turma.nome) + contar(sessoesFixas, uc.sigla, tipo, turma.nome);
      const emFalta = Math.max(0, esperadas - existentes);
      if (!emFalta) continue;
      const modelo = resultado.find(s => s.ucSigla === uc.sigla && s.tipoAula === tipo && s.turma === turma.nome)
        ?? sessoesFixas.find(s => s.ucSigla === uc.sigla && s.tipoAula === tipo && s.turma === turma.nome);
      for (let i = 0; i < emFalta; i++) {
        resultado.push({
          id: proximoId++,
          ucNome: uc.nome,
          ucSigla: uc.sigla,
          tipoAula: tipo,
          docente: modelo?.docente ?? "",
          sala: modelo?.sala ?? "",
          salaTipo: modelo?.salaTipo ?? turma.tipologiaSalaDesejada ?? (tipo === "PL" ? "Laboratório" : "Teórico-prática"),
          turma: turma.nome,
          diaSemana: modelo?.diaSemana ?? "Segunda",
          horaInicio: modelo?.horaInicio ?? "08:00",
          horaFim: modelo?.horaFim ?? "10:00",
          bloqueado: false,
          semana: semanas[(existentes + i) % semanas.length],
        });
      }
    }
  }
  return resultado;
}

/** Validação independente para horários importados, fixados ou já persistidos. */
export function validarBlocos100(sessoes: SessaoHorario[], ucsCatalogo: UC[]): ErroBloco100[] {
  const ucPorSigla = new Map(ucsCatalogo.map(u => [u.sigla, u]));
  const grupos = new Map<string, SessaoHorario[]>();
  for (const s of sessoes) {
    const uc = ucPorSigla.get(s.ucSigla); const fam = familiaTeorica(s.turma);
    if (!uc || !fam || s.semana == null) continue;
    const k = `${uc.anoCurricular}|${fam}|${s.semana}|${s.diaSemana}|${s.horaInicio}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(s);
  }
  const erros: ErroBloco100[] = [];
  for (const [chave, ss] of grupos) {
    const t = ss.filter(s => s.tipoAula === "T" || s.tipoAula === "S");
    const tp = ss.filter(s => s.tipoAula === "TP");
    const pl = ss.filter(s => s.tipoAula === "PL");
    const cobertura = Math.round((t.length ? 100 : tp.length * 25 + pl.length * 100 / 12) * 100) / 100;
    let valido = t.length === 1 && tp.length === 0 && pl.length === 0;
    const porUc = (lista: SessaoHorario[]) => {
      const m = new Map<string, number>(); for (const s of lista) m.set(s.ucSigla, (m.get(s.ucSigla) ?? 0) + 1); return m;
    };
    const tpUc = porUc(tp), plUc = porUc(pl);
    const limitesTpOk = [...tpUc].every(([sigla, quantidade]) => {
      const limite = ucPorSigla.get(sigla)?.maxSimultaneoTP;
      return limite == null || limite <= 0 || quantidade <= limite;
    });
    const limitesPlOk = [...plUc].every(([sigla, quantidade]) => {
      const limite = ucPorSigla.get(sigla)?.maxSimultaneoPL;
      return limite == null || limite <= 0 || quantidade <= limite;
    });
    const coberturaQuartos = [0, 0, 0, 0];
    for (const s of [...tp, ...pl]) {
      const x = familiaEQuarto(s.turma);
      if (x) coberturaQuartos[x.quarto] += s.tipoAula === "TP" ? 1 : 1 / 3;
    }
    const quartosOk = coberturaQuartos.every(n => Math.abs(n - 1) < 0.001);
    if (!t.length && quartosOk) {
      if (tp.length === 4 && pl.length === 0) {
        valido = (tpUc.size === 1 && [...tpUc.values()][0] === 4)
          || (tpUc.size === 2 && [...tpUc.values()].every(n => n === 2));
      } else if (tp.length === 2 && pl.length === 6) {
        const todasUcs = new Set([...tpUc.keys(), ...plUc.keys()]);
        valido = tpUc.size === 1 && [...tpUc.values()][0] === 2
          && (
            (plUc.size === 1 && [...plUc.values()][0] === 6 && todasUcs.size === 2)
            || (plUc.size === 2 && [...plUc.values()].every(n => n === 3) && todasUcs.size === 3)
          );
      } else if (tp.length === 3 && pl.length === 3) {
        valido = tpUc.size === 1 && plUc.size === 1 && [...tpUc.keys()][0] !== [...plUc.keys()][0];
      }
    }
    valido = valido && limitesTpOk && limitesPlOk;
    if (!valido) erros.push({ chave, cobertura, motivo: `Combinação não autorizada (${t.length} T/S, ${tp.length} TP, ${pl.length} PL).` });
  }
  const manchasGlobais = new Map<string, SessaoHorario[]>();
  for (const sessao of sessoes) {
    const uc = ucPorSigla.get(sessao.ucSigla);
    if (!uc || sessao.semana == null
      || (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL")) continue;
    const chave = `${uc.anoCurricular}|${sessao.semana}|${sessao.diaSemana}|${sessao.horaInicio}`;
    if (!manchasGlobais.has(chave)) manchasGlobais.set(chave, []);
    manchasGlobais.get(chave)!.push(sessao);
  }
  for (const [chave, sessoesMancha] of manchasGlobais) {
    for (const uc of ucsCatalogo) for (const tipo of ["TP", "PL"] as const) {
      const quantidade = sessoesMancha.filter(sessao =>
        sessao.ucSigla === uc.sigla && sessao.tipoAula === tipo).length;
      const limite = tipo === "TP" ? uc.maxSimultaneoTP : uc.maxSimultaneoPL;
      if (!limite || limite <= 0 || quantidade <= limite) continue;
      erros.push({
        chave: `${chave}|GLOBAL`,
        cobertura: 0,
        motivo: `${uc.sigla}: ${quantidade} ${tipo} em simultâneo nas duas turmas (máximo global ${limite}).`,
      });
    }
  }
  return erros;
}

/**
 * Reagrupa TP/PL em combinações pedagógicas fechadas. Nenhuma combinação parcial
 * entra no resultado: quando a carga configurada não permite perfazer 100%, as
 * sessões respetivas são devolvidas em `naoAlocadas` para correção explícita.
 */
export function organizarBlocos100(
  sessoes: SessaoHorario[],
  ucsCatalogo: UC[],
  config: Partial<ConfiguracaoBlocos100> = {},
  entradasAtivas: UCAtivaBlocos100[] = [],
  sessoesExternas: SessaoHorario[] = [],
): ResultadoBlocos100 {
  const cfg = {
    ...CONFIGURACAO_BLOCOS_100_DEFAULT,
    ...config,
    cargaDiariaEstudante: {
      ...CONFIGURACAO_BLOCOS_100_DEFAULT.cargaDiariaEstudante,
      ...(config.cargaDiariaEstudante || {}),
    },
  };
  if (!cfg.exigirCoberturaTotal) return { sessoes, naoAlocadas: [], blocosPorPadrao: {}, avisos: [] };

  const ucPorSigla = new Map(ucsCatalogo.map(u => [u.sigla, u]));
  const familiasOriginaisPorAnoSemana = new Map<string, Set<Familia>>();
  for (const sessao of sessoes) {
    const uc = ucPorSigla.get(sessao.ucSigla);
    const familia = familiaTeorica(sessao.turma);
    if (!uc || !familia || sessao.semana == null) continue;
    const chave = `${uc.anoCurricular}|${sessao.semana}`;
    if (!familiasOriginaisPorAnoSemana.has(chave)) familiasOriginaisPorAnoSemana.set(chave, new Set());
    familiasOriginaisPorAnoSemana.get(chave)!.add(familia);
  }
  const slotsPermitidosPorUc = entradasAtivas.length ? new Map<string, Set<string>>() : null;
  if (slotsPermitidosPorUc) for (const entrada of entradasAtivas) {
    const slots = new Set<string>();
    for (const semana of entrada.semanas) {
      const global = semana.numero + entrada.semanaGlobalOffset;
      for (const dia of DIAS) if (!semana.diasBloqueados?.includes(dia)) slots.add(`${global}|${dia}`);
    }
    slotsPermitidosPorUc.set(entrada.uc.id, slots);
  }
  const preservadas = sessoes.filter(s => s.tipoAula !== "TP" && s.tipoAula !== "PL");
  const primeiraSemanaS2 = Math.min(
    ...entradasAtivas
      .filter(entrada => entrada.semanaGlobalOffset === 15)
      .flatMap(entrada => entrada.semanas.map(semana => semana.numero + entrada.semanaGlobalOffset)),
  );
  const ucsComTNaQuartaDoArranqueS2 = new Map<string, Set<string>>();
  if (Number.isFinite(primeiraSemanaS2)) {
    for (const sessao of [...preservadas, ...sessoesExternas]) {
      if (sessao.semana !== primeiraSemanaS2 || sessao.diaSemana !== "Quarta" || sessao.tipoAula !== "T") continue;
      const ucT = ucPorSigla.get(sessao.ucSigla);
      const familiaT = familiaTeorica(sessao.turma);
      if (!ucT || !familiaT || ucT.anoCurricular !== 2) continue;
      const chave = `${ucT.anoCurricular}|${familiaT}`;
      if (!ucsComTNaQuartaDoArranqueS2.has(chave)) ucsComTNaQuartaDoArranqueS2.set(chave, new Set());
      ucsComTNaQuartaDoArranqueS2.get(chave)!.add(sessao.ucSigla);
    }
  }
  const grupoTemTresTIniciais = (ano: number, familia: Familia) =>
    (ucsComTNaQuartaDoArranqueS2.get(`${ano}|${familia}`)?.size ?? 0) >= 3;
  const naoReconhecidas: SessaoHorario[] = [];
  const grupos = new Map<string, Item[]>();

  for (const sessao of sessoes.filter(s => s.tipoAula === "TP" || s.tipoAula === "PL")) {
    const fq = familiaEQuarto(sessao.turma);
    const uc = ucPorSigla.get(sessao.ucSigla);
    if (!fq || !uc || sessao.semana == null) { naoReconhecidas.push(sessao); continue; }
    const semestre = sessao.semana <= 15 ? 1 : 2;
    const chave = `${uc.anoCurricular}|${semestre}|${fq.familia}`;
    const item: Item = { sessao, ucId: uc.id, ucSigla: uc.sigla, quarto: fq.quarto, tipo: sessao.tipoAula as "TP" | "PL" };
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(item);
  }

  const blocos: Bloco[] = [];
  const sobras: SessaoHorario[] = [...naoReconhecidas];
  const ativos = new Set(cfg.padroesAtivos);
  const maxSimultaneoTPPorUc = new Map(
    ucsCatalogo
      .filter(u => u.maxSimultaneoTP != null && u.maxSimultaneoTP > 0)
      .map(u => [u.id, u.maxSimultaneoTP!] as const),
  );
  const maxSimultaneoPLPorUc = new Map(
    ucsCatalogo
      .filter(u => u.maxSimultaneoPL != null && u.maxSimultaneoPL > 0)
      .map(u => [u.id, u.maxSimultaneoPL!] as const),
  );

  for (const poolOriginal of grupos.values()) {
    const resolvido = resolverPoolExato(
      poolOriginal,
      ativos,
      cfg.padraoAEvitar,
      slotsPermitidosPorUc,
      maxSimultaneoTPPorUc,
      maxSimultaneoPLPorUc,
    );
    blocos.push(...resolvido.blocos);
    sobras.push(...resolvido.sobras.map(x => x.sessao));
  }

  // Cada bloco usa a turma teórica completa; por isso recebe um slot exclusivo por
  // (ano, semestre, família). Segunda a quinta são sempre tentadas antes de sexta.
  const ocupados = new Set<string>();
  // Manchas já ocupadas por (ano, família, semana) — a carga semanal do estudante. É o termo
  // DOMINANTE do custo: entre os slots viáveis escolhe-se sempre o da semana menos carregada
  // dessa família (guloso "semana menos carregada primeiro"), o que espalha os blocos por
  // toda a janela de semanas das suas UCs em vez de saturar as primeiras.
  const cargaSemana = new Map<string, number>();
  const chaveCargaSemana = (ano: number, familia: Familia, semana: number) => `${ano}|${familia}|${semana}`;
  // Sem `entradasAtivas` não conhecemos a janela real de semanas de cada UC (os candidatos
  // abrangeriam o semestre inteiro), pelo que espalhar seria mover blocos para fora do
  // período letivo da sua UC. Nesse caso mantém-se o comportamento anterior.
  const equilibrarSemanas = slotsPermitidosPorUc !== null;
  const plPorMancha = new Map<string, number>();
  const chavePL = (semana: number, dia: string, hora: string) => `${semana}|${dia}|${hora}`;
  const tipologiasPorUcMancha = new Map<string, Set<"TP" | "PL">>();
  const chaveTipologia = (semana: number, dia: string, hora: string, sigla: string) =>
    `${semana}|${dia}|${hora}|${sigla}`;
  // Os máximos TP/PL configurados na UC são globais por mancha horária:
  // somam Turma A e Turma B, não recomeçam em cada família.
  const simultaneoPorUcMancha = new Map<string, number>();
  const chaveSimultaneo = (ucId: string, semana: number, dia: string, hora: string, tipo: "TP" | "PL") =>
    `${ucId}|${semana}|${dia}|${hora}|${tipo}`;
  const registarSimultaneo = (sessao: SessaoHorario) => {
    if ((sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") || sessao.semana == null) return;
    const uc = ucPorSigla.get(sessao.ucSigla);
    if (!uc) return;
    const chave = chaveSimultaneo(uc.id, sessao.semana, sessao.diaSemana, sessao.horaInicio, sessao.tipoAula);
    simultaneoPorUcMancha.set(chave, (simultaneoPorUcMancha.get(chave) || 0) + 1);
  };
  const cumpreMaximosGlobais = (bloco: Bloco, semana: number, dia: string, hora: string) => {
    const novas = new Map<string, number>();
    for (const sessao of bloco.sessoes) {
      if (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") continue;
      const uc = ucPorSigla.get(sessao.ucSigla);
      if (!uc) return false;
      const chave = chaveSimultaneo(uc.id, semana, dia, hora, sessao.tipoAula);
      novas.set(chave, (novas.get(chave) || 0) + 1);
    }
    return [...novas].every(([chave, quantidade]) => {
      const [ucId, , , , tipo] = chave.split("|");
      const limite = tipo === "TP"
        ? maxSimultaneoTPPorUc.get(ucId)
        : maxSimultaneoPLPorUc.get(ucId);
      return !limite || (simultaneoPorUcMancha.get(chave) || 0) + quantidade <= limite;
    });
  };
  const cargaDia = new Map<string, number>();
  const chaveCarga = (ano: number, semana: number, dia: string, folha: string) => `${ano}|${semana}|${dia}|${folha}`;
  const horasDia = new Map<string, Set<string>>();
  const registarCarga = (s: SessaoHorario) => {
    const uc = ucPorSigla.get(s.ucSigla);
    if (!uc || s.semana == null) return;
    for (const folha of gruposFolha(s.turma)) {
      const chave = chaveCarga(uc.anoCurricular, s.semana, s.diaSemana, folha);
      cargaDia.set(chave, (cargaDia.get(chave) || 0) + 1);
      if (!horasDia.has(chave)) horasDia.set(chave, new Set());
      horasDia.get(chave)!.add(s.horaInicio);
    }
  };
  const registarTipologia = (s: SessaoHorario) => {
    if ((s.tipoAula !== "TP" && s.tipoAula !== "PL") || s.semana == null) return;
    const chave = chaveTipologia(s.semana, s.diaSemana, s.horaInicio, s.ucSigla);
    if (!tipologiasPorUcMancha.has(chave)) tipologiasPorUcMancha.set(chave, new Set());
    tipologiasPorUcMancha.get(chave)!.add(s.tipoAula);
  };
  for (const s of [...preservadas, ...sessoesExternas]) {
    const uc = ucPorSigla.get(s.ucSigla); const fam = familiaTeorica(s.turma);
    if (uc && fam && s.semana != null) {
      const mancha = `${uc.anoCurricular}|${fam}|${s.semana}|${s.diaSemana}|${s.horaInicio}`;
      // As T e as sessões de outros anos já colocadas contam para o equilíbrio semanal.
      if (!ocupados.has(mancha)) {
        ocupados.add(mancha);
        const chave = chaveCargaSemana(uc.anoCurricular, fam, s.semana);
        cargaSemana.set(chave, (cargaSemana.get(chave) || 0) + 1);
      }
    }
    if (s.tipoAula === "PL" && s.semana != null) {
      const chave = chavePL(s.semana, s.diaSemana, s.horaInicio);
      plPorMancha.set(chave, (plPorMancha.get(chave) || 0) + 1);
    }
    registarCarga(s);
    registarTipologia(s);
    registarSimultaneo(s);
  }
  const blocosPorPadrao: Partial<Record<PadraoBloco100Id, number>> = {};
  const alocadas: SessaoHorario[] = [];
  const ordemDias = DIAS;
  const ordemSlot = (semana: number, dia: string, hora: string) =>
    semana * 1000 + DIAS.indexOf(dia) * 10 + HORAS.indexOf(hora);
  const cumprePrecedencias = (bloco: Bloco, semana: number, dia: string, hora: string): boolean => {
    const candidatoOrd = ordemSlot(semana, dia, hora);
    const anteriores = [...preservadas, ...alocadas, ...sessoesExternas];
    for (const regra of cfg.precedenciasUC ?? []) {
      const minimo = Math.max(1, Math.floor(regra.minimoAntes));
      for (const depois of bloco.sessoes.filter(s => s.tipoAula === regra.tipoDepois && regra.siglas.includes(s.ucSigla))) {
        const familia = familiaTeorica(depois.turma);
        const ucDepois = ucPorSigla.get(depois.ucSigla);
        if (!familia || !ucDepois) return false;
        const slotsAntes = new Set(
          anteriores
            .filter(s => s.tipoAula === regra.tipoAntes && s.ucSigla === depois.ucSigla
              && familiaTeorica(s.turma) === familia && s.semana != null
              && ordemSlot(s.semana, s.diaSemana, s.horaInicio) < candidatoOrd)
            .map(s => `${s.semana}|${s.diaSemana}|${s.horaInicio}`),
        );
        if (slotsAntes.size < minimo) return false;
      }
    }
    return true;
  };
  const penalizacaoCronologiaGeral = (bloco: Bloco, semana: number, dia: string, hora: string): number => {
    const candidatoOrd = ordemSlot(semana, dia, hora);
    const anteriores = [...preservadas, ...alocadas, ...sessoesExternas];
    let faltas = 0;
    for (const depois of bloco.sessoes) {
      const ucDepois = ucPorSigla.get(depois.ucSigla);
      const familia = familiaTeorica(depois.turma);
      if (!ucDepois || !familia) continue;
      const tipoAntes = depois.tipoAula === "TP" && Number(ucDepois.cargaHorariaTeorica || 0) > 0
        ? "T"
        : depois.tipoAula === "PL" && Number(ucDepois.cargaHorariaTP || 0) > 0
          ? "TP"
          : null;
      if (!tipoAntes) continue;
      const existeAnterior = anteriores.some(s =>
        s.tipoAula === tipoAntes && s.ucSigla === depois.ucSigla
        && familiaTeorica(s.turma) === familia && s.semana != null
        && ordemSlot(s.semana, s.diaSemana, s.horaInicio) < candidatoOrd);
      if (!existeAnterior) faltas++;
    }
    return faltas;
  };
  const cumpreSeparacaoTipologias = (bloco: Bloco, semana: number, dia: string, hora: string): boolean =>
    bloco.sessoes.every(sessao => {
      if (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") return true;
      const existentes = tipologiasPorUcMancha.get(
        chaveTipologia(semana, dia, hora, sessao.ucSigla),
      );
      const oposta = sessao.tipoAula === "TP" ? "PL" : "TP";
      return !existentes?.has(oposta);
    });
  const cumpreRestricoesUC = (bloco: Bloco, semana: number, dia: string, hora: string): boolean => {
    const periodo = Number(hora.slice(0, 2)) < 14 ? "manha" : "tarde";
    return !bloco.sessoes.some(sessao => (cfg.restricoesUC ?? []).some(regra => {
      if (!regra.siglas.includes(sessao.ucSigla)) return false;
      if (regra.tipos?.length && !regra.tipos.includes(sessao.tipoAula as "T" | "TP" | "PL" | "S")) return false;
      if (regra.semanasRestritas?.length && !regra.semanasRestritas.includes(semana)) return false;
      const restringeDias = !!regra.diasProibidos?.length;
      const restringePeriodos = !!regra.periodosProibidos?.length;
      const diaCoincide = !!regra.diasProibidos?.includes(dia);
      const periodoCoincide = !!regra.periodosProibidos?.includes(periodo);
      return restringeDias && restringePeriodos
        ? diaCoincide && periodoCoincide
        : diaCoincide || periodoCoincide;
    }));
  };

  const prioridadeBloco = (bloco: Bloco) =>
    bloco.arranqueTP ? 0 : bloco.sessoes.some(s => s.tipoAula === "PL") ? 1 : 2;
  for (const bloco of blocos.sort((a, b) =>
    prioridadeBloco(a) - prioridadeBloco(b)
    || b.sessoes.filter(s => s.tipoAula === "PL").length - a.sessoes.filter(s => s.tipoAula === "PL").length
    || a.semanaPreferida - b.semanaPreferida
    || Number(a.padrao === cfg.padraoAEvitar) - Number(b.padrao === cfg.padraoAEvitar))) {
    const uc = ucPorSigla.get(bloco.sessoes[0].ucSigla)!;
    const fam = familiaTeorica(bloco.sessoes[0].turma)!;
    const semestreBloco = bloco.semanaPreferida <= 15 ? 1 : 2;
    const turmaAManha = cfg.prefTurmaAManha?.[`${uc.anoCurricular}|${semestreBloco}`] ?? (semestreBloco === 1);
    const familiaManha = fam === "A" ? turmaAManha : !turmaAManha;
    const horasManha = ["08:00", "10:00", "12:00"];
    const horasTurno = familiaManha ? horasManha : ["14:00", "16:00", "18:00"];
    // Quarto bloco excecional com pausa de almoço: A 08-14 + 16-18; B 10-12 + 14-20.
    const horaAjuste8h = familiaManha ? "16:00" : "10:00";
    // Semanas em que só esta família tem aulas (a outra está em estágio): não há contenção
    // de laboratórios entre turmas, por isso o dia inteiro fica disponível — mas a manhã é a
    // preferida e a tarde continua reservada ao quarto bloco do dia (preserva o almoço).
    const semanasSoDestaFamilia = new Set(
      (fam === "A" ? cfg.semanasSoTurmaA : cfg.semanasSoTurmaB)?.[uc.anoCurricular] ?? [],
    );
    const idsUcsBloco = [...new Set(bloco.sessoes.map(s => ucPorSigla.get(s.ucSigla)?.id).filter((id): id is string => !!id))];
    const semInicio = bloco.semanaPreferida <= 15 ? 1 : 16;
    const semFim = bloco.semanaPreferida <= 15 ? 15 : 30;
    const semanas = Array.from({ length: semFim - semInicio + 1 }, (_, i) => semInicio + i)
      .sort((a, b) => Math.abs(a - bloco.semanaPreferida) - Math.abs(b - bloco.semanaPreferida));
    const folhasBloco = [...new Set(bloco.sessoes.flatMap(s => gruposFolha(s.turma)))];
    const plNesteBloco = bloco.sessoes.filter(s => s.tipoAula === "PL").length;
    const alvoBlocos = Math.max(1, Math.floor(cfg.cargaDiariaEstudante.alvoHoras / 2));
    const maxBlocos = Math.max(alvoBlocos, Math.floor(cfg.cargaDiariaEstudante.maxHoras / 2));
    const candidatosSlot: { semana: number; dia: string; hora: string; custo: number }[] = [];
    for (const semana of semanas) {
      // Numa semana de turma única a família ativa passa a ser "de manhã" e ganha a tarde
      // toda como reserva; fora dessas semanas mantém-se o modelo de turnos rígido, que é o
      // que evita a contenção dos 6 laboratórios entre as duas turmas teóricas.
      const soEstaFamilia = semanasSoDestaFamilia.has(semana)
        || familiasOriginaisPorAnoSemana.get(`${uc.anoCurricular}|${semana}`)?.size === 1;
      const temFixosNoTurnoOriginal = soEstaFamilia && [...preservadas, ...sessoesExternas].some(sessao => {
        const ucFixa = ucPorSigla.get(sessao.ucSigla);
        return ucFixa?.anoCurricular === uc.anoCurricular && sessao.semana === semana
          && familiaTeorica(sessao.turma) === fam && horasTurno.includes(sessao.horaInicio);
      });
      const horasPreferidas = new Set(
        soEstaFamilia && !temFixosNoTurnoOriginal ? horasManha : horasTurno,
      );
      const horasReserva = soEstaFamilia
        ? ["16:00", "14:00", "18:00"].filter(h => !horasPreferidas.has(h))
        : [horaAjuste8h];
      const horasDoTurno = new Set([...horasPreferidas, ...horasReserva]);
      for (const dia of ordemDias) for (const hora of HORAS) {
      if (!horasDoTurno.has(hora)) continue;
      if (slotsPermitidosPorUc && !idsUcsBloco.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
      if (!cumprePrecedencias(bloco, semana, dia, hora)) continue;
      if (!cumpreRestricoesUC(bloco, semana, dia, hora)) continue;
      if (!cumpreSeparacaoTipologias(bloco, semana, dia, hora)) continue;
      if (!cumpreMaximosGlobais(bloco, semana, dia, hora)) continue;
      if (semana === primeiraSemanaS2 && dia === "Quinta" && grupoTemTresTIniciais(uc.anoCurricular, fam)) {
        const permitidas = ucsComTNaQuartaDoArranqueS2.get(`${uc.anoCurricular}|${fam}`)!;
        if (bloco.sessoes.some(sessao =>
          sessao.tipoAula !== "TP" || !permitidas.has(sessao.ucSigla))) continue;
        // A quinta do arranque do 2.º semestre é deliberadamente um dia de
        // 6h. Os blocos adicionais seguem para outro dia, nunca para a reserva
        // que transformaria esta quinta num dia de 8h.
        if (!horasPreferidas.has(hora)) continue;
      }
      const k = `${uc.anoCurricular}|${fam}|${semana}|${dia}|${hora}`;
      if (ocupados.has(k)) continue;
      if ((plPorMancha.get(chavePL(semana, dia, hora)) || 0) + plNesteBloco > cfg.maxPLporMancha) continue;
      const cargasAtuais = folhasBloco.map(folha => cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0);
      const violaAlmoco = folhasBloco.some(folha => {
        const horas = horasDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha));
        return (hora === "12:00" && horas?.has("14:00"))
          || (hora === "14:00" && horas?.has("12:00"));
      });
      if (violaAlmoco) continue;
      // O bloco fora do turno só pode ser o quarto bloco do dia, nunca um atalho
      // para colocar a Turma B de manhã ou a Turma A à tarde.
      if (!horasPreferidas.has(hora) && cargasAtuais.some(carga => carga < alvoBlocos)) continue;
      if (folhasBloco.some(folha => (cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0) >= maxBlocos)) continue;
      const criaDiaMaximo = folhasBloco.some(folha => (cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0) + 1 === maxBlocos);
      let excedeDiasNoMaximo = false;
      if (criaDiaMaximo && cfg.cargaDiariaEstudante.maxDiasNoMaximoPorSemana >= 0) {
        excedeDiasNoMaximo = folhasBloco.some(folha => {
          const diasJaNoMaximo = DIAS.filter(d => d !== dia && (cargaDia.get(chaveCarga(uc.anoCurricular, semana, d, folha)) || 0) >= maxBlocos).length;
          return diasJaNoMaximo >= cfg.cargaDiariaEstudante.maxDiasNoMaximoPorSemana;
        });
      }
      const criaDia8h = cargasAtuais.some(carga => carga >= alvoBlocos);
      const abreNovoDia = cargasAtuais.every(carga => carga === 0);
      const existeDiaParcial = DIAS.some(d => folhasBloco.some(folha => {
        const carga = cargaDia.get(chaveCarga(uc.anoCurricular, semana, d, folha)) || 0;
        return carga > 0 && carga < alvoBlocos;
      }));
      const fragmentaDia = cfg.cargaDiariaEstudante.evitarDiasParciais === true && abreNovoDia && existeDiaParcial;
      const completaDiaAberto = cargasAtuais.some(carga => carga > 0 && carga < alvoBlocos);
      const minimoArranqueS2 = semana === primeiraSemanaS2 && dia === "Quinta"
        && grupoTemTresTIniciais(uc.anoCurricular, fam)
        ? alvoBlocos
        : 0;
      const minimoPrioritario = Math.max(minimoArranqueS2, (cfg.diasPrioritarios ?? []).find(
        prioridade => prioridade.semana === semana && prioridade.dia === dia,
      )?.minimoBlocos ?? 0);
      const faltaPreencherDataPrioritaria = minimoPrioritario > 0
        && cargasAtuais.some(carga => carga < minimoPrioritario);
      const distanciaSemana = Math.abs(semana - bloco.semanaPreferida);
      const rotacaoDia = (semana - 1) % DIAS.length;
      const indiceDia = soEstaFamilia
        ? DIAS.indexOf(dia)
        : cfg.preferirSextaLivre
        ? DIAS.indexOf(dia)
        : (DIAS.indexOf(dia) - rotacaoDia + DIAS.length) % DIAS.length;
      // Preferência suave por manhã (ou, fora das semanas de turma única, pelo turno da
      // família): as horas de reserva ficam sempre atrás das preferidas, e dentro de cada
      // grupo prefere-se a hora mais cedo. A reserva começa nas 16h para preservar o almoço.
      const custoHora = horasPreferidas.has(hora)
        ? HORAS.indexOf(hora)
        : 10 + Math.max(0, horasReserva.indexOf(hora));
      // Prioridades: completar primeiro um dia já aberto até 6h; evitar abrir
      // dias parciais; usar 8h apenas como exceção; só depois equilibrar semanas.
      const cargaDaSemana = equilibrarSemanas
        ? (cargaSemana.get(chaveCargaSemana(uc.anoCurricular, fam, semana)) || 0)
        : 0;
      const custo = Number(faltaPreencherDataPrioritaria) * -100_000_000
        + penalizacaoCronologiaGeral(bloco, semana, dia, hora) * 20_000_000
        + Number(completaDiaAberto) * -10_000_000
        + Number(fragmentaDia) * 10_000_000
        + Number(criaDia8h) * 5_000_000
        + Number(excedeDiasNoMaximo) * 15_000_000
        + cargaDaSemana * 100_000
        + Number(soEstaFamilia && (dia === "Terça" || dia === "Quinta")) * -1_000_000
        + Number(soEstaFamilia && dia === "Sexta") * 1_000_000
        + Number(cfg.preferirSextaLivre && dia === "Sexta") * 50_000
        + distanciaSemana * 1_000
        + indiceDia * 10 + custoHora;
      candidatosSlot.push({ semana, dia, hora, custo });
      }
    }
    let escolhido = candidatosSlot.sort((a, b) => a.custo - b.custo)[0] ?? null;
    if (!escolhido && bloco.padrao === "TP2_DUAS_UCS"
      && bloco.sessoes.every(sessao => sessao.tipoAula === "TP")) {
      // Último recurso estritamente limitado: encaixa este único bloco TP2+TP2
      // num dia que já tenha exatamente 6h para todos os seus estudantes.
      // O novo slot transforma-o num padrão válido de 8h com pausa de almoço.
      procurarDestino: for (const semana of semanas) for (const dia of [...DIAS.filter(d => d !== "Sexta"), "Sexta"]) {
        if (slotsPermitidosPorUc && !idsUcsBloco.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
        const extras = folhasBloco.map(folha => {
          const horas = horasDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) ?? new Set<string>();
          if (horas.size === 3 && ["08:00", "10:00", "12:00"].every(h => horas.has(h))) return "16:00";
          if (horas.size === 3 && ["14:00", "16:00", "18:00"].every(h => horas.has(h))) return "10:00";
          return null;
        });
        const hora = extras[0];
        if (!hora || extras.some(extra => extra !== hora)) continue;
        if (ocupados.has(`${uc.anoCurricular}|${fam}|${semana}|${dia}|${hora}`)) continue;
        if (!cumprePrecedencias(bloco, semana, dia, hora)
          || !cumpreRestricoesUC(bloco, semana, dia, hora)
          || !cumpreSeparacaoTipologias(bloco, semana, dia, hora)
          || !cumpreMaximosGlobais(bloco, semana, dia, hora)) continue;
        escolhido = { semana, dia, hora, custo: Number.MAX_SAFE_INTEGER };
        break procurarDestino;
      }
    }
    if (!escolhido) { sobras.push(...bloco.sessoes); continue; }
    ocupados.add(`${uc.anoCurricular}|${fam}|${escolhido.semana}|${escolhido.dia}|${escolhido.hora}`);
    const chaveSemana = chaveCargaSemana(uc.anoCurricular, fam, escolhido.semana);
    cargaSemana.set(chaveSemana, (cargaSemana.get(chaveSemana) || 0) + 1);
    if (plNesteBloco) {
      const chave = chavePL(escolhido.semana, escolhido.dia, escolhido.hora);
      plPorMancha.set(chave, (plPorMancha.get(chave) || 0) + plNesteBloco);
    }
    for (const s of bloco.sessoes) alocadas.push({
      ...s, semana: escolhido.semana, diaSemana: escolhido.dia, horaInicio: escolhido.hora,
      horaFim: `${String(Number(escolhido.hora.slice(0, 2)) + 2).padStart(2, "0")}:00`,
    });
    for (const sessao of bloco.sessoes) {
      registarTipologia({
        ...sessao,
        semana: escolhido.semana,
        diaSemana: escolhido.dia,
        horaInicio: escolhido.hora,
      });
      registarSimultaneo({
        ...sessao,
        semana: escolhido.semana,
        diaSemana: escolhido.dia,
        horaInicio: escolhido.hora,
      });
    }
    for (const folha of folhasBloco) {
      const chave = chaveCarga(uc.anoCurricular, escolhido.semana, escolhido.dia, folha);
      cargaDia.set(chave, (cargaDia.get(chave) || 0) + 1);
      if (!horasDia.has(chave)) horasDia.set(chave, new Set());
      horasDia.get(chave)!.add(escolhido.hora);
    }
    blocosPorPadrao[bloco.padrao] = (blocosPorPadrao[bloco.padrao] ?? 0) + 1;
  }

  // Recupera no máximo UM bloco TP2+TP2 residual, e apenas quando existe já
  // um dia válido de 6h que o possa absorver como quarto bloco. Esta limitação
  // impede que uma recuperação local volte a abrir ou redistribuir outros dias.
  recuperarResidual: for (const [chaveGrupo, sessoesGrupo] of (() => {
    const gruposResiduais = new Map<string, SessaoHorario[]>();
    for (const sessao of sobras.filter(s => s.tipoAula === "TP" && s.semana != null)) {
      const uc = ucPorSigla.get(sessao.ucSigla);
      const familia = familiaTeorica(sessao.turma);
      if (!uc || !familia) continue;
      const semestre = sessao.semana! <= 15 ? 1 : 2;
      const chave = `${uc.anoCurricular}|${semestre}|${familia}`;
      if (!gruposResiduais.has(chave)) gruposResiduais.set(chave, []);
      gruposResiduais.get(chave)!.push(sessao);
    }
    return gruposResiduais;
  })()) {
    const [anoTexto, semestreTexto, familiaTexto] = chaveGrupo.split("|");
    const ano = Number(anoTexto);
    const semestre = Number(semestreTexto);
    const familia = familiaTexto as Familia;
    const siglas = [...new Set(sessoesGrupo.map(s => s.ucSigla))];
    for (let a = 0; a < siglas.length; a++) for (let b = a + 1; b < siglas.length; b++) {
      const ucA = ucPorSigla.get(siglas[a]);
      const ucB = ucPorSigla.get(siglas[b]);
      if (!ucA || !ucB) continue;
      if ((ucA.maxSimultaneoTP != null && ucA.maxSimultaneoTP > 0 && ucA.maxSimultaneoTP < 2)
        || (ucB.maxSimultaneoTP != null && ucB.maxSimultaneoTP > 0 && ucB.maxSimultaneoTP < 2)) continue;
      for (let mascara = 1; mascara < 15; mascara++) {
        const quartosA = [0, 1, 2, 3].filter(q => mascara & (1 << q));
        if (quartosA.length !== 2) continue;
        const quartosB = [0, 1, 2, 3].filter(q => !quartosA.includes(q));
        const itens = [
          ...quartosA.map(q => sessoesGrupo.find(s => s.ucSigla === siglas[a] && familiaEQuarto(s.turma)?.quarto === q)),
          ...quartosB.map(q => sessoesGrupo.find(s => s.ucSigla === siglas[b] && familiaEQuarto(s.turma)?.quarto === q)),
        ];
        if (itens.some(item => !item)) continue;
        const sessoesBloco = itens as SessaoHorario[];
        const bloco: Bloco = {
          sessoes: sessoesBloco,
          padrao: "TP2_DUAS_UCS",
          semanaPreferida: modaSemana(sessoesBloco),
        };
        const folhas = [...new Set(sessoesBloco.flatMap(s => gruposFolha(s.turma)))];
        const semInicio = semestre === 1 ? 1 : 16;
        const semFim = semestre === 1 ? 15 : 30;
        const semanas = Array.from({ length: semFim - semInicio + 1 }, (_, i) => semInicio + i)
          .sort((x, y) => Math.abs(x - bloco.semanaPreferida) - Math.abs(y - bloco.semanaPreferida));
        for (const semana of semanas) for (const dia of [...DIAS.filter(d => d !== "Sexta"), "Sexta"]) {
          if (slotsPermitidosPorUc && ![ucA.id, ucB.id].every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
          const extras = folhas.map(folha => {
            const horas = horasDia.get(chaveCarga(ano, semana, dia, folha)) ?? new Set<string>();
            if (horas.size === 3 && ["08:00", "10:00", "12:00"].every(h => horas.has(h))) return "16:00";
            if (horas.size === 3 && ["14:00", "16:00", "18:00"].every(h => horas.has(h))) return "10:00";
            return null;
          });
          const hora = extras[0];
          if (!hora || extras.some(extra => extra !== hora)) continue;
          if (ocupados.has(`${ano}|${familia}|${semana}|${dia}|${hora}`)) continue;
          if (!cumprePrecedencias(bloco, semana, dia, hora)
            || !cumpreRestricoesUC(bloco, semana, dia, hora)
            || !cumpreSeparacaoTipologias(bloco, semana, dia, hora)
            || !cumpreMaximosGlobais(bloco, semana, dia, hora)) continue;
          for (const sessao of sessoesBloco) {
            const nova = {
              ...sessao,
              semana,
              diaSemana: dia,
              horaInicio: hora,
              horaFim: `${String(Number(hora.slice(0, 2)) + 2).padStart(2, "0")}:00`,
            };
            alocadas.push(nova);
            registarCarga(nova);
            registarTipologia(nova);
            registarSimultaneo(nova);
            sobras.splice(sobras.indexOf(sessao), 1);
          }
          ocupados.add(`${ano}|${familia}|${semana}|${dia}|${hora}`);
          blocosPorPadrao.TP2_DUAS_UCS = (blocosPorPadrao.TP2_DUAS_UCS ?? 0) + 1;
          break recuperarResidual;
        }
      }
    }
  }

  // A compactação nunca pode degradar a solução válida produzida acima.
  // Este snapshot permite recuperar se a reorganização semanal criar, por
  // interação entre as famílias A/B, mais de seis PL na mesma mancha.
  const alocadasAntesCompactacao = alocadas.map(sessao => ({ ...sessao }));

  // Compactação semanal exata: o posicionamento guloso acima encontra rapidamente
  // slots viáveis, mas uma carga de 10 blocos podia terminar como 3+3+3+1 em vez de
  // 4+3+3. Reorganizamos apenas os blocos TP/PL já formados, dentro da mesma semana,
  // escolhendo por dia exclusivamente 0h, 6h contínuas ou 8h com almoço.
  type EventoCompactacao = {
    sessoes: SessaoHorario[];
    semana: number;
    diaOriginal: string;
    horaOriginal: string;
    familia: Familia;
    ano: number;
  };
  const eventosPorGrupo = new Map<string, EventoCompactacao[]>();
  const eventosPorMancha = new Map<string, SessaoHorario[]>();
  for (const sessao of alocadas) {
    if (sessao.semana == null) continue;
    const uc = ucPorSigla.get(sessao.ucSigla);
    const familia = familiaTeorica(sessao.turma);
    if (!uc || !familia) continue;
    const chave = `${uc.anoCurricular}|${sessao.semana}|${familia}|${sessao.diaSemana}|${sessao.horaInicio}`;
    if (!eventosPorMancha.has(chave)) eventosPorMancha.set(chave, []);
    eventosPorMancha.get(chave)!.push(sessao);
  }
  for (const [chave, sessoesEvento] of eventosPorMancha) {
    const [anoTexto, semanaTexto, familia, dia, hora] = chave.split("|");
    const evento: EventoCompactacao = {
      sessoes: sessoesEvento,
      semana: Number(semanaTexto),
      diaOriginal: dia,
      horaOriginal: hora,
      familia: familia as Familia,
      ano: Number(anoTexto),
    };
    const grupo = `${evento.ano}|${evento.semana}|${evento.familia}`;
    if (!eventosPorGrupo.has(grupo)) eventosPorGrupo.set(grupo, []);
    eventosPorGrupo.get(grupo)!.push(evento);
  }

  const plCompactado = new Map<string, number>();
  const tipologiasCompactadas = new Map<string, Set<"TP" | "PL">>();
  const simultaneoCompactado = new Map<string, number>();
  const registarSimultaneoCompactado = (sessao: SessaoHorario) => {
    if ((sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") || sessao.semana == null) return;
    const uc = ucPorSigla.get(sessao.ucSigla);
    if (!uc) return;
    const chave = chaveSimultaneo(uc.id, sessao.semana, sessao.diaSemana, sessao.horaInicio, sessao.tipoAula);
    simultaneoCompactado.set(chave, (simultaneoCompactado.get(chave) || 0) + 1);
  };
  const eventoCabeNosMaximosGlobais = (
    sessoesEvento: SessaoHorario[],
    semana: number,
    dia: string,
    hora: string,
  ) => {
    const novas = new Map<string, number>();
    for (const sessao of sessoesEvento) {
      if (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") continue;
      const uc = ucPorSigla.get(sessao.ucSigla);
      if (!uc) return false;
      const chave = chaveSimultaneo(uc.id, semana, dia, hora, sessao.tipoAula);
      novas.set(chave, (novas.get(chave) || 0) + 1);
    }
    return [...novas].every(([chave, quantidade]) => {
      const [ucId, , , , tipo] = chave.split("|");
      const limite = tipo === "TP"
        ? maxSimultaneoTPPorUc.get(ucId)
        : maxSimultaneoPLPorUc.get(ucId);
      return !limite || (simultaneoCompactado.get(chave) || 0) + quantidade <= limite;
    });
  };
  const registarTipologiaCompactada = (sessao: SessaoHorario) => {
    if ((sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") || sessao.semana == null) return;
    const chave = chaveTipologia(sessao.semana, sessao.diaSemana, sessao.horaInicio, sessao.ucSigla);
    if (!tipologiasCompactadas.has(chave)) tipologiasCompactadas.set(chave, new Set());
    tipologiasCompactadas.get(chave)!.add(sessao.tipoAula);
  };
  for (const sessao of sessoesExternas.filter(s => s.tipoAula === "PL" && s.semana != null)) {
    const chave = chavePL(sessao.semana!, sessao.diaSemana, sessao.horaInicio);
    plCompactado.set(chave, (plCompactado.get(chave) || 0) + 1);
  }
  for (const sessao of sessoesExternas) {
    registarTipologiaCompactada(sessao);
    registarSimultaneoCompactado(sessao);
  }
  const padroesDia = (familiaManha: boolean) => ({
    seis: familiaManha ? ["08:00", "10:00", "12:00"] : ["14:00", "16:00", "18:00"],
    oito: familiaManha ? ["08:00", "10:00", "12:00", "16:00"] : ["10:00", "14:00", "16:00", "18:00"],
  });
  const familiasPorAnoSemana = new Map<string, Set<Familia>>();
  for (const sessao of [...preservadas, ...alocadas]) {
    const uc = ucPorSigla.get(sessao.ucSigla);
    const familia = familiaTeorica(sessao.turma);
    if (!uc || !familia || sessao.semana == null) continue;
    const chave = `${uc.anoCurricular}|${sessao.semana}`;
    if (!familiasPorAnoSemana.has(chave)) familiasPorAnoSemana.set(chave, new Set());
    familiasPorAnoSemana.get(chave)!.add(familia);
  }
  for (const [grupo, eventos] of eventosPorGrupo) {
    const [anoTexto, semanaTexto, familiaTexto] = grupo.split("|");
    const ano = Number(anoTexto);
    const semana = Number(semanaTexto);
    const familia = familiaTexto as Familia;
    const semestreGrupo = semana <= 15 ? 1 : 2;
    const turmaAManha = cfg.prefTurmaAManha?.[`${ano}|${semestreGrupo}`] ?? (semestreGrupo === 1);
    const semanaSoFamiliaConfigurada = new Set(
      (familia === "A" ? cfg.semanasSoTurmaA : cfg.semanasSoTurmaB)?.[ano] ?? [],
    ).has(semana);
    const semanaSoFamilia = semanaSoFamiliaConfigurada
      || (familiasPorAnoSemana.get(`${ano}|${semana}`)?.size === 1);
    const familiaManha = semanaSoFamilia || (familia === "A" ? turmaAManha : !turmaAManha);
    const padroes = padroesDia(familiaManha);

    const fixosPorDia = new Map(DIAS.map(dia => [dia, new Set<string>()]));
    for (const sessao of preservadas) {
      const uc = ucPorSigla.get(sessao.ucSigla);
      if (!uc || uc.anoCurricular !== ano || sessao.semana !== semana
        || familiaTeorica(sessao.turma) !== familia) continue;
      fixosPorDia.get(sessao.diaSemana)?.add(sessao.horaInicio);
    }

    const constraints: Model["constraints"] = {};
    const variables: Model["variables"] = {};
    const ints: NonNullable<Model["ints"]> = {};
    const nomeEvento = (i: number) => `evento_${i}`;
    const nomeDia = (dia: string) => `dia_${DIAS.indexOf(dia)}`;
    const nomeSlot = (dia: string, hora: string) => `slot_${DIAS.indexOf(dia)}_${HORAS.indexOf(hora)}`;
    eventos.forEach((_, i) => { constraints[nomeEvento(i)] = { equal: 1 }; });
    constraints.dias_oito = {
      max: Math.max(0, cfg.cargaDiariaEstudante.maxDiasNoMaximoPorSemana),
    };
    for (const dia of DIAS) {
      constraints[nomeDia(dia)] = { equal: 1 };
      for (const hora of HORAS) {
        constraints[nomeSlot(dia, hora)] = { equal: -(fixosPorDia.get(dia)?.has(hora) ? 1 : 0) };
      }
    }

    const prioridade = new Set(
      (cfg.diasPrioritarios ?? [])
        .filter(p => p.semana === semana && p.minimoBlocos > 0)
        .map(p => p.dia),
    );
    if (semana === primeiraSemanaS2 && grupoTemTresTIniciais(ano, familia)) {
      prioridade.add("Quinta");
    }
    const slotsFixos = new Set(
      [...fixosPorDia].flatMap(([dia, horas]) => [...horas].map(hora => `${dia}|${hora}`)),
    ).size;
    if (semanaSoFamilia && slotsFixos + eventos.length >= 3
      && !(fixosPorDia.get("Quinta")?.size)) {
      prioridade.add("Quinta");
    }
    if (semanaSoFamilia && slotsFixos + eventos.length >= 6
      && !(fixosPorDia.get("Terça")?.size)) {
      prioridade.add("Terça");
    }
    for (const dia of DIAS) {
      const fixos = fixosPorDia.get(dia) ?? new Set<string>();
      let candidatosBase = [
        { id: "vazio", horas: [] as string[], custo: 0 },
        {
          id: "seis",
          horas: padroes.seis,
          custo: 10 + Number(cfg.preferirSextaLivre && dia === "Sexta") * 100_000,
        },
        {
          id: "oito",
          horas: padroes.oito,
          custo: 10_000 + Number(cfg.preferirSextaLivre && dia === "Sexta") * 100_000,
        },
      ];
      // Uma T conjunta pode obrigar excecionalmente a família da tarde a ter
      // manhã nesse dia. Nesse caso, usa-se o padrão matinal completo, nunca 12h+14h.
      if (fixos.size && ![...fixos].every(hora => padroes.oito.includes(hora))) {
        const alternativo = padroesDia(!familiaManha);
        candidatosBase.push(
          { id: "seis_alt", horas: alternativo.seis, custo: 20 },
          { id: "oito_alt", horas: alternativo.oito, custo: 10_010 },
        );
      }
      if (semana === primeiraSemanaS2 && dia === "Quinta" && grupoTemTresTIniciais(ano, familia)) {
        candidatosBase = candidatosBase.filter(padrao => !padrao.id.startsWith("oito"));
      }
      const candidatosPadrao = candidatosBase.filter(padrao =>
        !(padrao.id === "vazio" && prioridade.has(dia))
        && [...fixos].every(hora => padrao.horas.includes(hora)));
      for (const padrao of candidatosPadrao) {
        const nome = `padrao_${DIAS.indexOf(dia)}_${padrao.id}`;
        variables[nome] = { custo: padrao.custo, [nomeDia(dia)]: 1 };
        if (padrao.id.startsWith("oito")) variables[nome].dias_oito = 1;
        for (const hora of padrao.horas) variables[nome][nomeSlot(dia, hora)] = -1;
        ints[nome] = 1;
      }
    }

    eventos.forEach((evento, i) => {
      const idsUc = [...new Set(evento.sessoes
        .map(s => ucPorSigla.get(s.ucSigla)?.id)
        .filter((id): id is string => !!id))];
      const plEvento = evento.sessoes.filter(s => s.tipoAula === "PL").length;
      for (const dia of DIAS) for (const hora of HORAS) {
        if (![...padroes.seis, ...padroes.oito].includes(hora)) continue;
        if (semana === primeiraSemanaS2 && dia === "Quinta" && grupoTemTresTIniciais(ano, familia)) {
          const permitidas = ucsComTNaQuartaDoArranqueS2.get(`${ano}|${familia}`)!;
          if (!padroes.seis.includes(hora)
            || evento.sessoes.some(sessao => sessao.tipoAula !== "TP" || !permitidas.has(sessao.ucSigla))) continue;
        }
        if (slotsPermitidosPorUc && !idsUc.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
        const blocoEvento: Bloco = { sessoes: evento.sessoes, padrao: "T1", semanaPreferida: semana };
        if (!cumpreRestricoesUC(blocoEvento, semana, dia, hora)) continue;
        if (!cumprePrecedencias(blocoEvento, semana, dia, hora)) continue;
        const misturaTipologias = evento.sessoes.some(sessao => {
          if (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") return false;
          const existentes = tipologiasCompactadas.get(
            chaveTipologia(semana, dia, hora, sessao.ucSigla),
          );
          return existentes?.has(sessao.tipoAula === "TP" ? "PL" : "TP");
        });
        if (misturaTipologias) continue;
        if (plEvento && (plCompactado.get(chavePL(semana, dia, hora)) || 0) + plEvento > cfg.maxPLporMancha) continue;
        if (!eventoCabeNosMaximosGlobais(evento.sessoes, semana, dia, hora)) continue;
        const nome = `x_${i}_${DIAS.indexOf(dia)}_${HORAS.indexOf(hora)}`;
        const deslocado = dia !== evento.diaOriginal || hora !== evento.horaOriginal;
        const ordemNaSemana = DIAS.indexOf(dia) * HORAS.length + HORAS.indexOf(hora);
        // Dentro do padrão diário escolhido, as TP puras ficam tão cedo quanto
        // possível e os blocos que contêm PL tão tarde quanto possível. Isto
        // preserva a sequência T→TP→PL sem voltar a excluir blocos completos.
        const custoCronologia = plEvento
          ? (DIAS.length * HORAS.length - ordemNaSemana) * 50
          : ordemNaSemana * 50;
        variables[nome] = {
          custo: custoCronologia + (deslocado ? 2 : 0),
          [nomeEvento(i)]: 1,
          [nomeSlot(dia, hora)]: 1,
        };
        ints[nome] = 1;
      }
    });

    const modelo: Model = {
      optimize: "custo",
      opType: "min",
      constraints,
      variables,
      ints,
      options: { timeout: 15000, presolve: true },
    };
    const solucao = solver.Solve(modelo) as SolveResult;
    if (!solucao.feasible) {
      for (const evento of eventos) for (const sessao of evento.sessoes) {
        registarTipologiaCompactada(sessao);
        registarSimultaneoCompactado(sessao);
        if (sessao.tipoAula === "PL" && sessao.semana != null) {
          const chave = chavePL(sessao.semana, sessao.diaSemana, sessao.horaInicio);
          plCompactado.set(chave, (plCompactado.get(chave) || 0) + 1);
        }
      }
      continue;
    }
    eventos.forEach((evento, i) => {
      for (const dia of DIAS) for (const hora of HORAS) {
        const nome = `x_${i}_${DIAS.indexOf(dia)}_${HORAS.indexOf(hora)}`;
        if (Number(solucao[nome] || 0) < 0.5) continue;
        for (const sessao of evento.sessoes) {
          sessao.diaSemana = dia;
          sessao.horaInicio = hora;
          sessao.horaFim = `${String(Number(hora.slice(0, 2)) + 2).padStart(2, "0")}:00`;
        }
      }
    });
    for (const evento of eventos) for (const sessao of evento.sessoes) {
      registarTipologiaCompactada(sessao);
      registarSimultaneoCompactado(sessao);
      if (sessao.tipoAula === "PL" && sessao.semana != null) {
        const chave = chavePL(sessao.semana, sessao.diaSemana, sessao.horaInicio);
        plCompactado.set(chave, (plCompactado.get(chave) || 0) + 1);
      }
    }
  }

  const plFinalPorMancha = new Map<string, number>();
  for (const sessao of [...sessoesExternas, ...alocadas]) {
    if (sessao.tipoAula !== "PL" || sessao.semana == null) continue;
    const chave = chavePL(sessao.semana, sessao.diaSemana, sessao.horaInicio);
    plFinalPorMancha.set(chave, (plFinalPorMancha.get(chave) || 0) + 1);
  }
  if ([...plFinalPorMancha.values()].some(total => total > cfg.maxPLporMancha)) {
    alocadas.splice(0, alocadas.length, ...alocadasAntesCompactacao);
  }

  // Última reparação segura para um residual TP isolado (20h = 6+6+6+2):
  // absorve-o num dia de 6h, formando 8h com almoço, em vez de manter um
  // quarto dia de apenas 2h. Não move PL nem altera a composição do bloco.
  const slotsIguais = (horas: Set<string>, esperadas: string[]) =>
    horas.size === esperadas.length && esperadas.every(hora => horas.has(hora));
  const chavesAnoSemanaFamilia = new Set<string>();
  for (const sessao of [...preservadas, ...alocadas]) {
    const uc = ucPorSigla.get(sessao.ucSigla);
    const familia = familiaTeorica(sessao.turma);
    if (uc && familia && sessao.semana != null) {
      chavesAnoSemanaFamilia.add(`${uc.anoCurricular}|${sessao.semana}|${familia}`);
    }
  }
  for (const chaveGrupo of chavesAnoSemanaFamilia) {
    const [anoTexto, semanaTexto, familiaTexto] = chaveGrupo.split("|");
    const ano = Number(anoTexto);
    const semana = Number(semanaTexto);
    const familia = familiaTexto as Familia;
    const sessoesGrupo = [...preservadas, ...alocadas].filter(sessao => {
      const uc = ucPorSigla.get(sessao.ucSigla);
      return uc?.anoCurricular === ano && sessao.semana === semana
        && familiaTeorica(sessao.turma) === familia;
    });
    const ocupacao = new Map(DIAS.map(dia => [dia, new Set<string>()]));
    for (const sessao of sessoesGrupo) ocupacao.get(sessao.diaSemana)?.add(sessao.horaInicio);
    const origem = DIAS.find(dia => ocupacao.get(dia)?.size === 1);
    if (!origem) continue;
    const horaOrigem = [...(ocupacao.get(origem) ?? [])][0];
    const blocoResidual = alocadas.filter(sessao => {
      const uc = ucPorSigla.get(sessao.ucSigla);
      return uc?.anoCurricular === ano && sessao.semana === semana
        && familiaTeorica(sessao.turma) === familia
        && sessao.diaSemana === origem && sessao.horaInicio === horaOrigem;
    });
    if (!blocoResidual.length || blocoResidual.some(sessao => sessao.tipoAula !== "TP")) continue;
    const idsUc = [...new Set(blocoResidual
      .map(sessao => ucPorSigla.get(sessao.ucSigla)?.id)
      .filter((id): id is string => !!id))];
    let destino: { dia: string; hora: string } | null = null;
    for (const dia of [...DIAS.filter(d => d !== "Sexta"), "Sexta"]) {
      if (dia === origem) continue;
      const ocupadas = ocupacao.get(dia) ?? new Set<string>();
      const padraoBase = [padroesDia(true), padroesDia(false)]
        .find(padrao => slotsIguais(ocupadas, padrao.seis));
      if (!padraoBase) continue;
      const hora = padraoBase.oito.find(h => !ocupadas.has(h));
      if (!hora) continue;
      if (slotsPermitidosPorUc && !idsUc.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
      const bloco: Bloco = { sessoes: blocoResidual, padrao: "T1", semanaPreferida: semana };
      if (!cumpreRestricoesUC(bloco, semana, dia, hora) || !cumprePrecedencias(bloco, semana, dia, hora)) continue;
      const existentes = [...sessoesExternas, ...preservadas, ...alocadas].filter(sessao =>
        sessao.semana === semana && sessao.diaSemana === dia && sessao.horaInicio === hora
        && !blocoResidual.includes(sessao));
      const mistura = blocoResidual.some(sessao =>
        existentes.some(existente => existente.ucSigla === sessao.ucSigla && existente.tipoAula === "PL"));
      if (mistura) continue;
      const excedeMaximo = blocoResidual.some(sessao => {
        const maximo = ucPorSigla.get(sessao.ucSigla)?.maxSimultaneoTP;
        if (!maximo || maximo <= 0) return false;
        const atuais = existentes.filter(existente =>
          existente.ucSigla === sessao.ucSigla && existente.tipoAula === "TP").length;
        const novas = blocoResidual.filter(nova =>
          nova.ucSigla === sessao.ucSigla && nova.tipoAula === "TP").length;
        return atuais + novas > maximo;
      });
      if (excedeMaximo) continue;
      destino = { dia, hora };
      break;
    }
    if (!destino) continue;
    for (const sessao of blocoResidual) {
      sessao.diaSemana = destino.dia;
      sessao.horaInicio = destino.hora;
      sessao.horaFim = `${String(Number(destino.hora.slice(0, 2)) + 2).padStart(2, "0")}:00`;
    }
  }

  // Correção pedagógica mínima: quando ESDAC/FT começam com PL, troca-se o
  // bloco completo dessa PL com um bloco TP puro posterior da mesma família.
  // A composição dos blocos não muda; mudam apenas os dois momentos.
  const ordemMomento = (sessao: SessaoHorario) =>
    (sessao.semana ?? 0) * 1000
    + DIAS.indexOf(sessao.diaSemana) * 10
    + HORAS.indexOf(sessao.horaInicio);
  const chaveMomento = (sessao: SessaoHorario) =>
    `${sessao.semana}|${sessao.diaSemana}|${sessao.horaInicio}`;
  const trocarMomento = (a: SessaoHorario[], b: SessaoHorario[]) => {
    const momentoA = {
      semana: a[0].semana, diaSemana: a[0].diaSemana,
      horaInicio: a[0].horaInicio, horaFim: a[0].horaFim,
    };
    const momentoB = {
      semana: b[0].semana, diaSemana: b[0].diaSemana,
      horaInicio: b[0].horaInicio, horaFim: b[0].horaFim,
    };
    for (const sessao of a) Object.assign(sessao, momentoB);
    for (const sessao of b) Object.assign(sessao, momentoA);
  };
  const trocaRespeitaMaximosGlobais = (a: SessaoHorario[], b: SessaoHorario[]) => {
    const excluidas = new Set([...a, ...b]);
    const cabe = (evento: SessaoHorario[], destino: SessaoHorario) => {
      const contagens = new Map<string, number>();
      for (const sessao of evento) {
        if (sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL") continue;
        const uc = ucPorSigla.get(sessao.ucSigla);
        if (!uc) return false;
        const chave = `${uc.id}|${sessao.tipoAula}`;
        contagens.set(chave, (contagens.get(chave) || 0) + 1);
      }
      return [...contagens].every(([chave, novas]) => {
        const [ucId, tipo] = chave.split("|");
        const limite = tipo === "TP"
          ? maxSimultaneoTPPorUc.get(ucId)
          : maxSimultaneoPLPorUc.get(ucId);
        if (!limite) return true;
        const uc = ucsCatalogo.find(item => item.id === ucId);
        if (!uc) return false;
        const atuais = [...sessoesExternas, ...preservadas, ...alocadas].filter(sessao =>
          !excluidas.has(sessao) && sessao.semana === destino.semana
          && sessao.diaSemana === destino.diaSemana && sessao.horaInicio === destino.horaInicio
          && sessao.ucSigla === uc.sigla && sessao.tipoAula === tipo).length;
        return atuais + novas <= limite;
      });
    };
    return cabe(a, b[0]) && cabe(b, a[0]);
  };
  for (const sigla of ["ESDAC", "FT"]) for (const familia of ["A", "B"] as const) {
    const eventos = new Map<string, SessaoHorario[]>();
    for (const sessao of alocadas) {
      if (familiaTeorica(sessao.turma) !== familia || sessao.semana == null) continue;
      const chave = chaveMomento(sessao);
      if (!eventos.has(chave)) eventos.set(chave, []);
      eventos.get(chave)!.push(sessao);
    }
    const ordenados = [...eventos.values()].sort((a, b) => ordemMomento(a[0]) - ordemMomento(b[0]));
    const primeiroPL = ordenados.find(evento =>
      evento.some(s => s.ucSigla === sigla && s.tipoAula === "PL"));
    const primeiraTP = ordenados.find(evento =>
      evento.some(s => s.ucSigla === sigla && s.tipoAula === "TP"));
    if (!primeiroPL || !primeiraTP || ordemMomento(primeiraTP[0]) < ordemMomento(primeiroPL[0])) continue;
    const plMovidas = primeiroPL.filter(s => s.tipoAula === "PL").length;
    const candidatosTP = ordenados.filter(evento => {
      if (ordemMomento(evento[0]) <= ordemMomento(primeiroPL[0])) return false;
      if (!evento.every(s => s.tipoAula === "TP")) return false;
      if (!evento.some(s => s.ucSigla === sigla)) return false;
      const plNoDestino = alocadas.filter(s =>
        s.tipoAula === "PL" && chaveMomento(s) === chaveMomento(evento[0])).length;
      return plNoDestino + plMovidas <= cfg.maxPLporMancha;
    });
    const candidatoTP = candidatosTP.sort((a, b) =>
      Number(b[0].diaSemana === primeiroPL[0].diaSemana)
      - Number(a[0].diaSemana === primeiroPL[0].diaSemana)
      || ordemMomento(a[0]) - ordemMomento(b[0]))[0];
    if (candidatoTP && trocaRespeitaMaximosGlobais(primeiroPL, candidatoTP)) {
      trocarMomento(primeiroPL, candidatoTP);
    }
  }

  // Fecho do 1.º semestre do 2.º ano: a última sexta-feira fica livre e a
  // semana 15 não fica com um dia de 8h. Move-se apenas um bloco TP/PL já
  // completo para uma semana anterior com margem, sem voltar a executar o
  // solver nem alterar a composição pedagógica do bloco.
  const todasAsSessoes = () => [...sessoesExternas, ...preservadas, ...alocadas];
  const sessoesDaFamilia = (semana: number, dia: string, familia: Familia) =>
    todasAsSessoes().filter(sessao => {
      const uc = ucPorSigla.get(sessao.ucSigla);
      return uc?.anoCurricular === 2 && sessao.semana === semana
        && sessao.diaSemana === dia && familiaTeorica(sessao.turma) === familia;
    });
  const horasDaFamilia = (semana: number, dia: string, familia: Familia) =>
    new Set(sessoesDaFamilia(semana, dia, familia).map(sessao => sessao.horaInicio));
  const horaFimDe = (hora: string) =>
    `${String(Number(hora.slice(0, 2)) + 2).padStart(2, "0")}:00`;
  const padroesDestino = [padroesDia(true), padroesDia(false)];

  for (const familia of ["A", "B"] as const) {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const horasSexta = horasDaFamilia(15, "Sexta", familia);
      const diaComOito = DIAS.find(dia => horasDaFamilia(15, dia, familia).size > 3);
      const origemDia = horasSexta.size ? "Sexta" : diaComOito;
      if (!origemDia) break;
      const horasOrigem = horasDaFamilia(15, origemDia, familia);
      const padraoOito = padroesDestino.find(padrao => slotsIguais(horasOrigem, padrao.oito));
      const horasCandidatas = origemDia === "Sexta"
        ? [...horasOrigem]
        : padraoOito
          ? padraoOito.oito.filter(hora => !padraoOito.seis.includes(hora))
          : [];
      let movido = false;

      for (const horaOrigem of horasCandidatas) {
        const preservadasNaOrigem = preservadas.some(sessao => {
          const uc = ucPorSigla.get(sessao.ucSigla);
          return uc?.anoCurricular === 2 && sessao.semana === 15
            && sessao.diaSemana === origemDia && sessao.horaInicio === horaOrigem
            && familiaTeorica(sessao.turma) === familia;
        });
        if (preservadasNaOrigem) continue;
        const evento = alocadas.filter(sessao => {
          const uc = ucPorSigla.get(sessao.ucSigla);
          return uc?.anoCurricular === 2 && sessao.semana === 15
            && sessao.diaSemana === origemDia && sessao.horaInicio === horaOrigem
            && familiaTeorica(sessao.turma) === familia;
        });
        if (!evento.length || evento.some(sessao =>
          sessao.tipoAula !== "TP" && sessao.tipoAula !== "PL")) continue;
        const idsUc = [...new Set(evento
          .map(sessao => ucPorSigla.get(sessao.ucSigla)?.id)
          .filter((id): id is string => !!id))];
        const bloco: Bloco = { sessoes: evento, padrao: "T1", semanaPreferida: 15 };
        const candidatos: { semana: number; dia: string; hora: string; custo: number }[] = [];

        for (let semana = 8; semana <= 14; semana++) for (const dia of DIAS.filter(d => d !== "Sexta")) {
          const horasAtuais = horasDaFamilia(semana, dia, familia);
          for (const padrao of padroesDestino) {
            const completaSeis = horasAtuais.size === 2
              && [...horasAtuais].every(hora => padrao.seis.includes(hora));
            const ampliaParaOito = slotsIguais(horasAtuais, padrao.seis);
            if (!completaSeis && !ampliaParaOito) continue;
            const hora = completaSeis
              ? padrao.seis.find(item => !horasAtuais.has(item))
              : padrao.oito.find(item => !horasAtuais.has(item));
            if (!hora) continue;
            if (slotsPermitidosPorUc
              && !idsUc.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
            if (!cumpreRestricoesUC(bloco, semana, dia, hora)
              || !cumprePrecedencias(bloco, semana, dia, hora)) continue;
            const existentes = todasAsSessoes().filter(sessao =>
              sessao.semana === semana && sessao.diaSemana === dia
              && sessao.horaInicio === hora && !evento.includes(sessao));
            const misturaTipologias = evento.some(sessao =>
              existentes.some(existente => existente.ucSigla === sessao.ucSigla
                && existente.tipoAula !== sessao.tipoAula
                && (existente.tipoAula === "TP" || existente.tipoAula === "PL")));
            if (misturaTipologias) continue;
            const plNovas = evento.filter(sessao => sessao.tipoAula === "PL").length;
            const plAtuais = existentes.filter(sessao => sessao.tipoAula === "PL").length;
            if (plAtuais + plNovas > cfg.maxPLporMancha) continue;
            const excedeLimiteUc = idsUc.some(id => {
              const uc = ucsCatalogo.find(item => item.id === id);
              if (!uc) return true;
              return (["TP", "PL"] as const).some(tipo => {
                const limite = tipo === "TP" ? uc.maxSimultaneoTP : uc.maxSimultaneoPL;
                if (!limite || limite <= 0) return false;
                const atuais = existentes.filter(sessao =>
                  sessao.ucSigla === uc.sigla && sessao.tipoAula === tipo).length;
                const novas = evento.filter(sessao =>
                  sessao.ucSigla === uc.sigla && sessao.tipoAula === tipo).length;
                return atuais + novas > limite;
              });
            });
            if (excedeLimiteUc) continue;
            const cargaSemanaDestino = new Set(todasAsSessoes()
              .filter(sessao => {
                const uc = ucPorSigla.get(sessao.ucSigla);
                return uc?.anoCurricular === 2 && sessao.semana === semana
                  && familiaTeorica(sessao.turma) === familia;
              })
              .map(sessao => `${sessao.diaSemana}|${sessao.horaInicio}`)).size;
            candidatos.push({
              semana,
              dia,
              hora,
              custo: Number(ampliaParaOito) * 1_000_000
                + cargaSemanaDestino * 1_000 + (semana - 8) * 10 + DIAS.indexOf(dia),
            });
          }
        }
        const destino = candidatos.sort((a, b) => a.custo - b.custo)[0];
        if (!destino) continue;
        for (const sessao of evento) {
          sessao.semana = destino.semana;
          sessao.diaSemana = destino.dia;
          sessao.horaInicio = destino.hora;
          sessao.horaFim = horaFimDe(destino.hora);
        }
        movido = true;
        break;
      }
      if (!movido) break;
    }
  }

  const avisos = sobras.length
    ? [`${sobras.length} sessões não foram alocadas porque não formam nenhuma combinação de 100%.`]
    : [];
  return { sessoes: [...preservadas, ...alocadas], naoAlocadas: sobras, blocosPorPadrao, avisos };
}
