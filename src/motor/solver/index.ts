/**
 * SOLVER — a alternativa exata ao alocador guloso.
 *
 * O alocador coloca blocos um a um, por custo, e nunca volta atrás: é rápido
 * (~17 s para 30 semanas) mas deixa dias por fechar. O solver decide todos os
 * blocos de uma janela ao mesmo tempo e fecha-os. Medido sobre as 30 semanas,
 * com o validador independente a dar o veredicto:
 *
 *     alocador  97,96 % de completude · 0 erros · 168 dias parciais ·  17 s
 *     solver   100,00 % de completude · 0 erros ·  24 dias parciais · 483 s
 *
 * Os 24 dias parciais que restam são os das semanas 1-7, os mesmos que o
 * horário feito à mão pelo coordenador tem — vêm do layout imposto na primeira
 * semana e não são do solver.
 *
 * ATENÇÃO — o solver NÃO é determinista. Corre com vários trabalhadores em
 * paralelo e com limite por relógio de parede, por isso duas execuções seguem
 * trajetórias diferentes. Medimos a MESMA janela a colocar 182/182 blocos numa
 * corrida e 179/182 noutra. É por isso que `otimizar` termina sempre com uma
 * comparação: se o resultado do solver não for melhor do que a proposta de
 * partida, devolve a proposta de partida. Nunca piora o que já lá estava.
 */

import { resolver, OPCOES_PADRAO, blocosDaJanela } from "./modelo";
import type { ContextoSolver, OpcoesModelo } from "./modelo";
import { janelasAutomaticas, blocosOrfaos, sessoesDeLayoutFixo, cortesLimpos } from "./janelas";
import { alocar } from "../alocador";
import { inventariar } from "../inventario";
import { construirCalendario, criarMapaTurmas } from "../planeador";
import type { EntradaAlocacao } from "../planeador";
import { validar } from "../../validacao/validador";
import type { UC, SessaoHorario } from "../../types";

export { cortesLimpos, janelasAutomaticas, blocosOrfaos } from "./janelas";
export type { ContextoSolver, OpcoesModelo } from "./modelo";

/** Segundos por janela. Abaixo disto o resultado degrada-se de forma medível:
 *  com 45 s ficam 567/570 blocos e 36 dias parciais; com 120 s, 570/570 e 24. */
export const SEGUNDOS_POR_JANELA_PADRAO = 120;

export interface ProgressoSolver {
  /** 1-based. */
  janela: number;
  totalJanelas: number;
  de: number;
  ate: number;
  fase: "a-construir" | "a-resolver" | "concluida";
  blocosColocados?: number;
  blocosTotais?: number;
  /** Texto cru do modelo, para quem quiser mostrar o detalhe. */
  linha?: string;
}

export interface MedidaHorario {
  sessoes: number;
  completude: number;
  erros: number;
  avisos: number;
  diasParciais: number;
}

export interface ResultadoOtimizacao {
  /** O horário escolhido — o do solver, ou o de partida se o solver não o bateu. */
  sessoes: SessaoHorario[];
  /** Qual dos dois ficou. */
  origem: "solver" | "proposta-de-partida";
  medidaSolver: MedidaHorario;
  medidaPartida: MedidaHorario;
  blocosColocados: number;
  blocosTotais: number;
  janelas: [number, number][];
  orfaos: number;
  segundos: number;
}

export interface OpcoesOtimizacao {
  /** Orçamento de tempo POR JANELA. */
  segundosPorJanela?: number;
  /** Janelas a usar. Por omissão, as que o inventário pedir. */
  janelas?: [number, number][];
  /**
   * O horário de partida. Serve de pista para o solver e de piso de qualidade.
   * Por omissão, corre-se o alocador para o obter.
   */
  propostaDePartida?: SessaoHorario[];
  onProgresso?: (p: ProgressoSolver) => void;
  /** Pesos do modelo, para quem quiser afinar. */
  pesos?: Partial<OpcoesModelo>;
}

function medir(ss: SessaoHorario[], ucs: UC[], ctx: ContextoSolver): MedidaHorario {
  const v = validar(ss, ucs, ctx.regras);
  return {
    sessoes: ss.length,
    completude: v.completude.pct,
    erros: v.violacoes.filter((x) => x.gravidade === "erro").length,
    avisos: v.violacoes.filter((x) => x.gravidade === "aviso").length,
    diasParciais: v.violacoes.filter((x) => x.regra === "dia-abaixo-do-alvo").length,
  };
}

/**
 * Melhor = menos erros; em empate, mais completude; em empate, menos avisos.
 * A ordem não é arbitrária: um erro é uma regra violada, um aviso é uma
 * preferência contrariada, e um horário incompleto é pior do que um feio.
 */
function melhorQue(a: MedidaHorario, b: MedidaHorario): boolean {
  if (a.erros !== b.erros) return a.erros < b.erros;
  if (Math.abs(a.completude - b.completude) > 1e-9) return a.completude > b.completude;
  return a.avisos < b.avisos;
}

/** Constrói o contexto que o modelo precisa, a partir da mesma entrada do alocador. */
export function contextoDe(entrada: EntradaAlocacao): ContextoSolver {
  const anos = [...new Set(entrada.ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);
  return {
    regras: entrada.regras,
    inventario: inventariar(entrada, entrada.regras),
    calendario: construirCalendario(entrada, anos),
    mapa: criarMapaTurmas(entrada.regras.estruturaTurmas),
  };
}

export async function otimizar(
  entrada: EntradaAlocacao,
  op: OpcoesOtimizacao = {},
): Promise<ResultadoOtimizacao> {
  const t0 = Date.now();
  const ctx = contextoDe(entrada);
  const tempo = op.segundosPorJanela ?? SEGUNDOS_POR_JANELA_PADRAO;
  const janelas = op.janelas ?? janelasAutomaticas(ctx.inventario);
  const orfaos = blocosOrfaos(ctx.inventario, janelas);
  const partida = op.propostaDePartida ?? alocar(entrada).sessoes;

  let acumulado: SessaoHorario[] = [];
  let colocados = 0;
  let totais = 0;

  for (let i = 0; i < janelas.length; i++) {
    const [de, ate] = janelas[i];
    const base = { janela: i + 1, totalJanelas: janelas.length, de, ate };
    op.onProgresso?.({ ...base, fase: "a-construir" });

    const layout = sessoesDeLayoutFixo(entrada.regras, de, ate, 1_000_000 + i * 10_000);
    const res = await resolver(ctx, {
      ...OPCOES_PADRAO,
      ...op.pesos,
      de,
      ate,
      tempo,
      verboso: true,
      onLog: (linha) => op.onProgresso?.({ ...base, fase: "a-resolver", linha }),
      // Tudo o que as janelas anteriores decidiram conta como pré-requisito
      // cumprido: estão cronologicamente antes de tudo o que esta vai colocar.
      sessoesFixas: [...acumulado, ...layout],
      pista: partida.filter((s) => (s.semana ?? 0) >= de && (s.semana ?? 0) <= ate),
    });

    colocados += res.blocosColocados;
    totais += res.blocosTotais;
    acumulado = [...acumulado, ...layout, ...res.sessoes];
    op.onProgresso?.({
      ...base,
      fase: "concluida",
      blocosColocados: res.blocosColocados,
      blocosTotais: res.blocosTotais,
    });
  }

  const medidaSolver = medir(acumulado, entrada.ucs, ctx);
  const medidaPartida = medir(partida, entrada.ucs, ctx);
  const ganhou = melhorQue(medidaSolver, medidaPartida);

  return {
    sessoes: ganhou ? acumulado : partida,
    origem: ganhou ? "solver" : "proposta-de-partida",
    medidaSolver,
    medidaPartida,
    blocosColocados: colocados,
    blocosTotais: totais,
    janelas,
    orfaos,
    segundos: (Date.now() - t0) / 1000,
  };
}

/** Quantos blocos cada janela vai ter de colocar — útil para estimar o tempo. */
export function dimensaoDasJanelas(
  ctx: ContextoSolver,
  janelas: [number, number][],
): { de: number; ate: number; blocos: number }[] {
  return janelas.map(([de, ate]) => ({ de, ate, blocos: blocosDaJanela(ctx.inventario, de, ate).length }));
}
