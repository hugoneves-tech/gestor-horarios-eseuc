import type { SessaoHorario, UC } from "../types";
import solver, { type Model, type SolveResult } from "javascript-lp-solver";
import { gruposFolha } from "./validacao";

export type PadraoBloco100Id =
  | "T1"
  | "TP4_MESMA_UC"
  | "TP2_DUAS_UCS"
  | "TP2_PL3_PL3"
  | "TP3_PL3";

export interface ConfiguracaoBlocos100 {
  exigirCoberturaTotal: boolean;
  preferirSextaLivre: boolean;
  padroesAtivos: PadraoBloco100Id[];
  padraoAEvitar: PadraoBloco100Id;
  cargaDiariaEstudante: {
    alvoHoras: number;
    maxHoras: number;
    maxDiasNoMaximoPorSemana: number;
  };
}

export const CONFIGURACAO_BLOCOS_100_DEFAULT: ConfiguracaoBlocos100 = {
  exigirCoberturaTotal: true,
  preferirSextaLivre: true,
  padroesAtivos: ["T1", "TP4_MESMA_UC", "TP2_DUAS_UCS", "TP2_PL3_PL3", "TP3_PL3"],
  padraoAEvitar: "TP3_PL3",
  cargaDiariaEstudante: { alvoHoras: 6, maxHoras: 8, maxDiasNoMaximoPorSemana: 1 },
};

export const DESCRICAO_PADROES_BLOCOS_100: Record<PadraoBloco100Id, string> = {
  T1: "1 turma T da mesma UC",
  TP4_MESMA_UC: "4 turmas TP da mesma UC",
  TP2_DUAS_UCS: "2 TP de uma UC + 2 TP de outra UC",
  TP2_PL3_PL3: "2 TP da mesma UC + 3 PL de uma UC + 3 PL de outra UC (as três UCs diferentes)",
  TP3_PL3: "3 TP da mesma UC + 3 PL de outra UC (a evitar)",
};

type Familia = "A" | "B";
type Item = { sessao: SessaoHorario; ucId: string; ucSigla: string; quarto: number; tipo: "TP" | "PL" };
type Bloco = { sessoes: SessaoHorario[]; padrao: PadraoBloco100Id; semanaPreferida: number };

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
): { blocos: Bloco[]; sobras: Item[] } {
  const recursos = new Map<string, { tipo: "TP" | "PL"; ucId: string; quarto: number; quantidade: number }>();
  const chaveRecurso = (tipo: "TP" | "PL", ucId: string, quarto: number) => `${tipo}|${ucId}|${quarto}`;
  for (const item of poolOriginal) {
    const chave = chaveRecurso(item.tipo, item.ucId, item.quarto);
    const atual = recursos.get(chave);
    if (atual) atual.quantidade++;
    else recursos.set(chave, { tipo: item.tipo, ucId: item.ucId, quarto: item.quarto, quantidade: 1 });
  }
  const tpUcs = [...new Set(poolOriginal.filter(x => x.tipo === "TP").map(x => x.ucId))];
  const plUcs = [...new Set(poolOriginal.filter(x => x.tipo === "PL").map(x => x.ucId))];
  const candidatos: CandidatoBloco[] = [];
  const adicionar = (padrao: PadraoBloco100Id, consumos: Consumo[]) => {
    if (!consumos.every(c => recursos.has(chaveRecurso(c.tipo, c.ucId, c.quarto)))) return;
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
  if (ativos.has("TP2_PL3_PL3")) for (const ucTp of tpUcs) for (let a = 0; a < plUcs.length; a++) for (let b = a + 1; b < plUcs.length; b++) {
    if (ucTp === plUcs[a] || ucTp === plUcs[b]) continue;
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
  const solucao = solver.Solve(modelo) as SolveResult;
  if (!solucao.feasible) return { blocos: [], sobras: [...poolOriginal] };

  const pool = [...poolOriginal];
  const blocos: Bloco[] = [];
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
          && plUc.size === 2 && [...plUc.values()].every(n => n === 3) && todasUcs.size === 3;
      } else if (tp.length === 3 && pl.length === 3) {
        valido = tpUc.size === 1 && plUc.size === 1 && [...tpUc.keys()][0] !== [...plUc.keys()][0];
      }
    }
    if (!valido) erros.push({ chave, cobertura, motivo: `Combinação não autorizada (${t.length} T/S, ${tp.length} TP, ${pl.length} PL).` });
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

  for (const poolOriginal of grupos.values()) {
    const resolvido = resolverPoolExato(poolOriginal, ativos, cfg.padraoAEvitar, slotsPermitidosPorUc);
    blocos.push(...resolvido.blocos);
    sobras.push(...resolvido.sobras.map(x => x.sessao));
  }

  // Cada bloco usa a turma teórica completa; por isso recebe um slot exclusivo por
  // (ano, semestre, família). Segunda a quinta são sempre tentadas antes de sexta.
  const ocupados = new Set<string>();
  const cargaDia = new Map<string, number>();
  const chaveCarga = (ano: number, semana: number, dia: string, folha: string) => `${ano}|${semana}|${dia}|${folha}`;
  const registarCarga = (s: SessaoHorario) => {
    const uc = ucPorSigla.get(s.ucSigla);
    if (!uc || s.semana == null) return;
    for (const folha of gruposFolha(s.turma)) {
      const chave = chaveCarga(uc.anoCurricular, s.semana, s.diaSemana, folha);
      cargaDia.set(chave, (cargaDia.get(chave) || 0) + 1);
    }
  };
  for (const s of [...preservadas, ...sessoesExternas]) {
    const uc = ucPorSigla.get(s.ucSigla); const fam = familiaTeorica(s.turma);
    if (uc && fam && s.semana != null) ocupados.add(`${uc.anoCurricular}|${fam}|${s.semana}|${s.diaSemana}|${s.horaInicio}`);
    registarCarga(s);
  }
  const blocosPorPadrao: Partial<Record<PadraoBloco100Id, number>> = {};
  const alocadas: SessaoHorario[] = [];
  const ordemDias = cfg.preferirSextaLivre ? DIAS : [...DIAS.slice(0, 4), "Sexta"];

  for (const bloco of blocos.sort((a, b) => a.semanaPreferida - b.semanaPreferida
    || Number(a.padrao === cfg.padraoAEvitar) - Number(b.padrao === cfg.padraoAEvitar))) {
    const uc = ucPorSigla.get(bloco.sessoes[0].ucSigla)!;
    const fam = familiaTeorica(bloco.sessoes[0].turma)!;
    const idsUcsBloco = [...new Set(bloco.sessoes.map(s => ucPorSigla.get(s.ucSigla)?.id).filter((id): id is string => !!id))];
    const semInicio = bloco.semanaPreferida <= 15 ? 1 : 16;
    const semFim = bloco.semanaPreferida <= 15 ? 15 : 30;
    const semanas = Array.from({ length: semFim - semInicio + 1 }, (_, i) => semInicio + i)
      .sort((a, b) => Math.abs(a - bloco.semanaPreferida) - Math.abs(b - bloco.semanaPreferida));
    const folhasBloco = [...new Set(bloco.sessoes.flatMap(s => gruposFolha(s.turma)))];
    const alvoBlocos = Math.max(1, Math.floor(cfg.cargaDiariaEstudante.alvoHoras / 2));
    const maxBlocos = Math.max(alvoBlocos, Math.floor(cfg.cargaDiariaEstudante.maxHoras / 2));
    const candidatosSlot: { semana: number; dia: string; hora: string; custo: number }[] = [];
    for (const semana of semanas) for (const dia of ordemDias) for (const hora of HORAS) {
      if (dia === "Sexta" && hora === "18:00") continue;
      if (slotsPermitidosPorUc && !idsUcsBloco.every(id => slotsPermitidosPorUc.get(id)?.has(`${semana}|${dia}`))) continue;
      const k = `${uc.anoCurricular}|${fam}|${semana}|${dia}|${hora}`;
      if (ocupados.has(k)) continue;
      if (folhasBloco.some(folha => (cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0) >= maxBlocos)) continue;
      const criaDiaMaximo = folhasBloco.some(folha => (cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0) + 1 === maxBlocos);
      if (criaDiaMaximo && cfg.cargaDiariaEstudante.maxDiasNoMaximoPorSemana >= 0) {
        const excedeDias = folhasBloco.some(folha => {
          const diasJaNoMaximo = DIAS.filter(d => d !== dia && (cargaDia.get(chaveCarga(uc.anoCurricular, semana, d, folha)) || 0) >= maxBlocos).length;
          return diasJaNoMaximo >= cfg.cargaDiariaEstudante.maxDiasNoMaximoPorSemana;
        });
        if (excedeDias) continue;
      }
      const folhasAcimaAlvo = folhasBloco.filter(folha => (cargaDia.get(chaveCarga(uc.anoCurricular, semana, dia, folha)) || 0) >= alvoBlocos).length;
      const distanciaSemana = Math.abs(semana - bloco.semanaPreferida);
      const custo = folhasAcimaAlvo * 1_000_000 + Number(dia === "Sexta") * 10_000 + distanciaSemana * 100
        + DIAS.indexOf(dia) * 10 + HORAS.indexOf(hora);
      candidatosSlot.push({ semana, dia, hora, custo });
    }
    const escolhido = candidatosSlot.sort((a, b) => a.custo - b.custo)[0] ?? null;
    if (!escolhido) { sobras.push(...bloco.sessoes); continue; }
    ocupados.add(`${uc.anoCurricular}|${fam}|${escolhido.semana}|${escolhido.dia}|${escolhido.hora}`);
    for (const s of bloco.sessoes) alocadas.push({
      ...s, semana: escolhido.semana, diaSemana: escolhido.dia, horaInicio: escolhido.hora,
      horaFim: `${String(Number(escolhido.hora.slice(0, 2)) + 2).padStart(2, "0")}:00`,
    });
    for (const folha of folhasBloco) {
      const chave = chaveCarga(uc.anoCurricular, escolhido.semana, escolhido.dia, folha);
      cargaDia.set(chave, (cargaDia.get(chave) || 0) + 1);
    }
    blocosPorPadrao[bloco.padrao] = (blocosPorPadrao[bloco.padrao] ?? 0) + 1;
  }

  const avisos = sobras.length
    ? [`${sobras.length} sessões não foram alocadas porque não formam nenhuma combinação de 100%.`]
    : [];
  return { sessoes: [...preservadas, ...alocadas], naoAlocadas: sobras, blocosPorPadrao, avisos };
}
