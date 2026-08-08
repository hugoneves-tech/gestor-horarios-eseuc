/**
 * RELATÓRIO DE ALOCAÇÃO — o que o motor conseguiu, o que ficou por colocar e
 * PORQUÊ.
 *
 * Fase 3B da reescrita do motor. Ficheiro ADITIVO.
 *
 * Princípio: o alocador nunca "falha em silêncio". Quando um bloco não cabe, o
 * motivo é o que a restrição devolveu — não uma frase inventada aqui. Este
 * ficheiro só define a FORMA do relatório e a sua impressão legível; quem o
 * preenche é `alocador.ts`.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO valores de negócio literais.
 */

import type { FormaId } from "./padroes";

/** Um motivo de recusa, com o número de vezes que apareceu. */
export interface MotivoContado {
  motivo: string;
  ocorrencias: number;
}

/** Blocos que ficaram por colocar numa turma de uma UC, e porquê. */
export interface DeficitItem {
  ucSigla: string;
  turma: string;
  tipo: "T" | "TP" | "PL" | "S";
  blocosEmFalta: number;
  /** PORQUE não coube — motivos devolvidos pelo registo de restrições. */
  motivosMaisFrequentes: MotivoContado[];
}

export interface CargaSemanal {
  ano: number;
  familia: "A" | "B";
  semana: number;
  horas: number;
}

export interface RelatorioAlocacao {
  /** Blocos de aula (um bloco = uma turma, um tipo, uma mancha) a colocar. */
  blocosAlvo: number;
  blocosColocados: number;
  /** 0-100. */
  completude: number;
  deficit: DeficitItem[];
  /**
   * As FORMAS de bloco que emergiram, e quantas vezes. As chaves não vêm de
   * nenhuma lista: são o nome canónico da composição de cada bloco colocado
   * (ex.: `TP2+PL3+PL3`, `TP2+TP1+PL3`).
   */
  padroesUsados: Partial<Record<FormaId, number>>;
  cargaPorSemana: CargaSemanal[];
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Impressão
// ---------------------------------------------------------------------------

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padE = (s: string | number, n: number) => String(s).padStart(n);

/**
 * Resumo da carga semanal por bloco contíguo de semanas: mínimo, máximo e
 * amplitude. É assim que se vê de relance se o equilíbrio semanal funcionou.
 */
export function resumirCargaPorSemana(
  carga: CargaSemanal[],
): { ano: number; familia: "A" | "B"; semanas: string; minimo: number; maximo: number; amplitude: number }[] {
  const grupos = new Map<string, CargaSemanal[]>();
  for (const c of carga) {
    const k = `${c.ano}|${c.familia}`;
    const lista = grupos.get(k) ?? [];
    lista.push(c);
    grupos.set(k, lista);
  }
  const saida: { ano: number; familia: "A" | "B"; semanas: string; minimo: number; maximo: number; amplitude: number }[] = [];
  for (const lista of grupos.values()) {
    // Só as semanas com carga contam para a amplitude: uma semana em que a
    // família está fora (ensino clínico) não é "desequilíbrio".
    const comAulas = lista.filter((c) => c.horas > 0).sort((a, b) => a.semana - b.semana);
    if (comAulas.length === 0) continue;
    // Parte em blocos contíguos de semanas.
    let inicio = 0;
    for (let i = 1; i <= comAulas.length; i++) {
      const quebra = i === comAulas.length || comAulas[i].semana !== comAulas[i - 1].semana + 1;
      if (!quebra) continue;
      const bloco = comAulas.slice(inicio, i);
      const horas = bloco.map((c) => c.horas);
      const minimo = Math.min(...horas);
      const maximo = Math.max(...horas);
      saida.push({
        ano: bloco[0].ano,
        familia: bloco[0].familia,
        semanas: `${bloco[0].semana}-${bloco[bloco.length - 1].semana}`,
        minimo,
        maximo,
        amplitude: maximo - minimo,
      });
      inicio = i;
    }
  }
  return saida;
}

export function formatarRelatorioAlocacao(rel: RelatorioAlocacao): string {
  const l: string[] = [];
  const secao = (titulo: string) => {
    l.push("");
    l.push(titulo);
    l.push("-".repeat(titulo.length));
  };

  l.push("RELATORIO DE ALOCACAO");
  l.push("=====================");
  l.push(`Blocos alvo:       ${rel.blocosAlvo}`);
  l.push(`Blocos colocados:  ${rel.blocosColocados}`);
  l.push(`Completude:        ${rel.completude.toFixed(1)}%`);

  secao(`Formas de bloco que emergiram`);
  const padroes = Object.entries(rel.padroesUsados).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (padroes.length === 0) l.push("  nenhum.");
  for (const [id, n] of padroes) l.push(`  ${pad(id, 22)} ${padE(n ?? 0, 5)} bloco(s)`);

  secao(`Carga por semana (min/max/amplitude por bloco de semanas)`);
  const resumo = resumirCargaPorSemana(rel.cargaPorSemana);
  if (resumo.length === 0) l.push("  sem carga.");
  for (const r of resumo) {
    l.push(
      `  ano ${r.ano} familia ${r.familia} semanas ${pad(r.semanas, 8)} min ${padE(r.minimo, 4)}h  max ${padE(r.maximo, 4)}h  amplitude ${padE(r.amplitude, 4)}h`,
    );
  }

  secao(`Defice (${rel.deficit.length} turma(s)/tipo com blocos em falta)`);
  if (rel.deficit.length === 0) l.push("  nenhum: tudo colocado.");
  for (const d of rel.deficit) {
    l.push(`  ${pad(d.ucSigla, 10)} ${pad(d.turma, 8)} ${pad(d.tipo, 4)} faltam ${padE(d.blocosEmFalta, 4)} bloco(s)`);
    if (d.motivosMaisFrequentes.length === 0) l.push("      (sem motivo registado)");
    for (const m of d.motivosMaisFrequentes) l.push(`      ${padE(m.ocorrencias, 6)}x ${m.motivo}`);
  }

  secao(`Avisos (${rel.avisos.length})`);
  if (rel.avisos.length === 0) l.push("  nenhum.");
  for (const a of rel.avisos) l.push(`  ${a}`);

  return l.join("\n");
}

/** Detalhe semana a semana, para quem quiser ver a distribuição inteira. */
export function formatarCargaSemanal(rel: RelatorioAlocacao): string {
  const l: string[] = [];
  l.push("CARGA SEMANAL (horas por familia)");
  l.push("=================================");
  const anos = [...new Set(rel.cargaPorSemana.map((c) => c.ano))].sort((a, b) => a - b);
  for (const ano of anos) {
    const doAno = rel.cargaPorSemana.filter((c) => c.ano === ano);
    const semanas = [...new Set(doAno.map((c) => c.semana))].sort((a, b) => a - b);
    l.push(`  ano ${ano}`);
    l.push(`    ${pad("semana", 8)}${["A", "B"].map((f) => padE(f, 7)).join("")}`);
    for (const s of semanas) {
      const celulas = (["A", "B"] as const).map((f) => {
        const c = doAno.find((x) => x.semana === s && x.familia === f);
        return padE(c ? `${c.horas}h` : "-", 7);
      });
      l.push(`    ${pad(s, 8)}${celulas.join("")}`);
    }
  }
  return l.join("\n");
}
