import type { SessaoHorario, UC } from "../types";

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
}
export const CONFIGURACAO_BLOCOS_100_DEFAULT: ConfiguracaoBlocos100 = {
  exigirCoberturaTotal: true,
  preferirSextaLivre: true,
  padroesAtivos: ["T1", "TP4_MESMA_UC", "TP2_DUAS_UCS", "TP2_PL3_PL3", "TP3_PL3"],
  padraoAEvitar: "TP3_PL3",
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

function tem(pool: Item[], tipo: "TP" | "PL", ucId: string, quarto: number, quantidade: number): boolean {
  return pool.filter(x => x.tipo === tipo && x.ucId === ucId && x.quarto === quarto).length >= quantidade;
}

function ucs(pool: Item[], tipo: "TP" | "PL"): string[] {
  return [...new Set(pool.filter(x => x.tipo === tipo).map(x => x.ucId))];
}

function criarBloco(itens: Item[], padrao: PadraoBloco100Id): Bloco {
  const sessoes = itens.map(x => x.sessao);
  return { sessoes, padrao, semanaPreferida: modaSemana(sessoes) };
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
): ResultadoBlocos100 {
  const cfg = { ...CONFIGURACAO_BLOCOS_100_DEFAULT, ...config };
  if (!cfg.exigirCoberturaTotal) return { sessoes, naoAlocadas: [], blocosPorPadrao: {}, avisos: [] };

  const ucPorSigla = new Map(ucsCatalogo.map(u => [u.sigla, u]));
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
    const pool = [...poolOriginal];

    // As PL têm menos alternativas: são empacotadas primeiro em 3+3+2TP;
    // o padrão 3TP+3PL fica apenas para quando não existe um par PL compatível.
    if (ativos.has("TP2_PL3_PL3")) {
      let progresso = true;
      while (progresso) {
        progresso = false;
        externo: for (const ucPl1 of ucs(pool, "PL")) for (let q1 = 0; q1 < 4; q1++) {
          if (!tem(pool, "PL", ucPl1, q1, 3)) continue;
          for (const ucPl2 of ucs(pool, "PL")) for (let q2 = 0; q2 < 4; q2++) {
            if (ucPl2 === ucPl1 || q2 === q1 || !tem(pool, "PL", ucPl2, q2, 3)) continue;
            const restantes = [0, 1, 2, 3].filter(q => q !== q1 && q !== q2);
            const ucTp = ucs(pool, "TP").find(u => u !== ucPl1 && u !== ucPl2 && restantes.every(q => tem(pool, "TP", u, q, 1)));
            if (!ucTp) continue;
            const itens = [
              ...take(pool, "PL", ucPl1, q1, 3)!, ...take(pool, "PL", ucPl2, q2, 3)!,
              ...restantes.flatMap(q => take(pool, "TP", ucTp, q, 1)!),
            ];
            blocos.push(criarBloco(itens, "TP2_PL3_PL3"));
            progresso = true;
            break externo;
          }
        }
      }
    }

    if (ativos.has("TP3_PL3")) {
      let progresso = true;
      while (progresso) {
        progresso = false;
        externo: for (const ucPl of ucs(pool, "PL")) for (let qPl = 0; qPl < 4; qPl++) {
          if (!tem(pool, "PL", ucPl, qPl, 3)) continue;
          const restantes = [0, 1, 2, 3].filter(q => q !== qPl);
          const ucTp = ucs(pool, "TP").find(u => u !== ucPl && restantes.every(q => tem(pool, "TP", u, q, 1)));
          if (!ucTp) continue;
          const itens = [...take(pool, "PL", ucPl, qPl, 3)!, ...restantes.flatMap(q => take(pool, "TP", ucTp, q, 1)!)];
          blocos.push(criarBloco(itens, "TP3_PL3"));
          progresso = true;
          break externo;
        }
      }
    }

    if (ativos.has("TP4_MESMA_UC")) {
      for (const uc of ucs(pool, "TP")) {
        while ([0, 1, 2, 3].every(q => tem(pool, "TP", uc, q, 1))) {
          blocos.push(criarBloco([0, 1, 2, 3].flatMap(q => take(pool, "TP", uc, q, 1)!), "TP4_MESMA_UC"));
        }
      }
    }

    if (ativos.has("TP2_DUAS_UCS")) {
      let progresso = true;
      while (progresso) {
        progresso = false;
        externo: for (const uc1 of ucs(pool, "TP")) for (const uc2 of ucs(pool, "TP")) {
          if (uc1 === uc2) continue;
          for (const qs1 of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) {
            const qs2 = [0, 1, 2, 3].filter(q => !qs1.includes(q));
            if (!qs1.every(q => tem(pool, "TP", uc1, q, 1)) || !qs2.every(q => tem(pool, "TP", uc2, q, 1))) continue;
            const itens = [...qs1.flatMap(q => take(pool, "TP", uc1, q, 1)!), ...qs2.flatMap(q => take(pool, "TP", uc2, q, 1)!)];
            blocos.push(criarBloco(itens, "TP2_DUAS_UCS"));
            progresso = true;
            break externo;
          }
        }
      }
    }

    sobras.push(...pool.map(x => x.sessao));
  }

  // Cada bloco usa a turma teórica completa; por isso recebe um slot exclusivo por
  // (ano, semestre, família). Segunda a quinta são sempre tentadas antes de sexta.
  const ocupados = new Set<string>();
  for (const s of preservadas) {
    const uc = ucPorSigla.get(s.ucSigla); const fam = familiaTeorica(s.turma);
    if (uc && fam && s.semana != null) ocupados.add(`${uc.anoCurricular}|${fam}|${s.semana}|${s.diaSemana}|${s.horaInicio}`);
  }
  const blocosPorPadrao: Partial<Record<PadraoBloco100Id, number>> = {};
  const alocadas: SessaoHorario[] = [];
  const ordemDias = cfg.preferirSextaLivre ? DIAS : [...DIAS.slice(0, 4), "Sexta"];

  for (const bloco of blocos.sort((a, b) => a.semanaPreferida - b.semanaPreferida
    || Number(a.padrao === cfg.padraoAEvitar) - Number(b.padrao === cfg.padraoAEvitar))) {
    const uc = ucPorSigla.get(bloco.sessoes[0].ucSigla)!;
    const fam = familiaTeorica(bloco.sessoes[0].turma)!;
    const semInicio = bloco.semanaPreferida <= 15 ? 1 : 16;
    const semFim = bloco.semanaPreferida <= 15 ? 15 : 30;
    const semanas = Array.from({ length: semFim - semInicio + 1 }, (_, i) => semInicio + i)
      .sort((a, b) => Math.abs(a - bloco.semanaPreferida) - Math.abs(b - bloco.semanaPreferida));
    let escolhido: { semana: number; dia: string; hora: string } | null = null;
    procurarSlot: for (const semana of semanas) for (const dia of ordemDias) for (const hora of HORAS) {
      if (dia === "Sexta" && hora === "18:00") continue;
      const k = `${uc.anoCurricular}|${fam}|${semana}|${dia}|${hora}`;
      if (!ocupados.has(k)) { escolhido = { semana, dia, hora }; ocupados.add(k); break procurarSlot; }
    }
    if (!escolhido) { sobras.push(...bloco.sessoes); continue; }
    for (const s of bloco.sessoes) alocadas.push({
      ...s, semana: escolhido.semana, diaSemana: escolhido.dia, horaInicio: escolhido.hora,
      horaFim: `${String(Number(escolhido.hora.slice(0, 2)) + 2).padStart(2, "0")}:00`,
    });
    blocosPorPadrao[bloco.padrao] = (blocosPorPadrao[bloco.padrao] ?? 0) + 1;
  }

  const avisos = sobras.length
    ? [`${sobras.length} sessões não foram alocadas porque não formam nenhuma combinação de 100%.`]
    : [];
  return { sessoes: [...preservadas, ...alocadas], naoAlocadas: sobras, blocosPorPadrao, avisos };
}
