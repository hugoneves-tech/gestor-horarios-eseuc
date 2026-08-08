/**
 * O solver dentro de um Web Worker.
 *
 * Isto não é uma preferência de arquitetura — é obrigatório. Uma resolução leva
 * minutos e o OR-Tools compilado para WebAssembly bloqueia a thread onde corre.
 * Na thread principal, a aplicação ficaria congelada todo esse tempo: sem
 * ecrã, sem botão de cancelar, e o browser a oferecer-se para matar o separador.
 */

import { otimizar } from "./index";
import type { OpcoesOtimizacao, ProgressoSolver, ResultadoOtimizacao } from "./index";
import type { EntradaAlocacao } from "../planeador";

export interface PedidoSolver {
  entrada: EntradaAlocacao;
  segundosPorJanela?: number;
  janelas?: [number, number][];
  pesos?: OpcoesOtimizacao["pesos"];
}

export type RespostaSolver =
  | { tipo: "progresso"; progresso: ProgressoSolver }
  | { tipo: "fim"; resultado: ResultadoOtimizacao }
  | { tipo: "erro"; mensagem: string };

self.onmessage = async (ev: MessageEvent<PedidoSolver>) => {
  const responder = (r: RespostaSolver) => self.postMessage(r);
  try {
    const resultado = await otimizar(ev.data.entrada, {
      segundosPorJanela: ev.data.segundosPorJanela,
      janelas: ev.data.janelas,
      pesos: ev.data.pesos,
      onProgresso: (progresso) => responder({ tipo: "progresso", progresso }),
    });
    responder({ tipo: "fim", resultado });
  } catch (e) {
    responder({ tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) });
  }
};
