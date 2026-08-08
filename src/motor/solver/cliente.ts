/**
 * A ponte entre a aplicação e o worker do solver.
 *
 * Quem chama não vê workers nem mensagens: chama `otimizarEmSegundoPlano`,
 * recebe progresso e uma promessa, e pode cancelar. O worker é criado e
 * destruído a cada corrida — o WebAssembly do OR-Tools ocupa centenas de
 * megabytes e não vale a pena mantê-lo vivo entre gerações.
 */

import type { PedidoSolver, RespostaSolver } from "./worker";
import type { ProgressoSolver, ResultadoOtimizacao } from "./index";
import type { EntradaAlocacao } from "../planeador";

export interface CorridaSolver {
  resultado: Promise<ResultadoOtimizacao>;
  cancelar: () => void;
}

export function otimizarEmSegundoPlano(
  entrada: EntradaAlocacao,
  op: {
    segundosPorJanela?: number;
    janelas?: [number, number][];
    onProgresso?: (p: ProgressoSolver) => void;
  } = {},
): CorridaSolver {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let terminado = false;

  const resultado = new Promise<ResultadoOtimizacao>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<RespostaSolver>) => {
      const m = ev.data;
      if (m.tipo === "progresso") return op.onProgresso?.(m.progresso);
      terminado = true;
      worker.terminate();
      if (m.tipo === "fim") resolve(m.resultado);
      else reject(new Error(m.mensagem));
    };
    worker.onerror = (e) => {
      terminado = true;
      worker.terminate();
      reject(new Error(e.message || "O solver falhou dentro do worker."));
    };

    const pedido: PedidoSolver = {
      entrada,
      segundosPorJanela: op.segundosPorJanela,
      janelas: op.janelas,
    };
    worker.postMessage(pedido);
  });

  return {
    resultado,
    cancelar: () => {
      if (terminado) return;
      terminado = true;
      worker.terminate();
    },
  };
}
