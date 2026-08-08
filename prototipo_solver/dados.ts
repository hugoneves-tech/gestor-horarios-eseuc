/**
 * PROTOTIPO DE SOLVER — camada de dados. ISOLADO: nada em src/** é alterado.
 *
 * Carrega o snapshot real do Supabase, corre o INVENTÁRIO existente
 * (`src/motor/inventario.ts`, que é agnóstico ao algoritmo) e recorta a JANELA
 * do estudo: 1.º semestre, semanas 1-7.
 *
 * Zero siglas de unidade curricular escritas aqui — a janela é definida por
 * números de semana, e as UCs que lá vivem saem dos dados.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { carregarRegras } from "../src/regras/carregar";
import type { LinhaRegra } from "../src/regras/carregar";
import { comMigracaoRegraGeral } from "../test_migracao_regra_geral";
import { rowToAnoSem, rowToFeriado, rowToUc } from "../src/data/mappers";
import { construirCalendario, criarMapaTurmas } from "../src/motor/planeador";
import type { EntradaAlocacao, MapaTurmas, SemanaAlocacao } from "../src/motor/planeador";
import { inventariar } from "../src/motor/inventario";
import type { BlocoInventariado, Inventario } from "../src/motor/inventario";
import { limitesDaComposicao } from "../src/motor/padroes";
import type { ConfiguracaoMotor } from "../src/regras/esquema";
import type { AnoLetivoSemestre, FeriadoInterrupcao, UC } from "../src/types";

export const PASTA_SNAPSHOT =
  process.env.SB_SNAPSHOT_DIR ?? "C:\\Users\\hugon\\AppData\\Local\\Temp\\sb";

const ler = (n: string) => JSON.parse(readFileSync(join(PASTA_SNAPSHOT, n), "utf8"));

export interface Contexto {
  entrada: EntradaAlocacao;
  regras: ConfiguracaoMotor;
  ucs: UC[];
  inventario: Inventario;
  /** Calendário por ano curricular. */
  calendario: Map<number, SemanaAlocacao[]>;
  anos: number[];
  familias: readonly string[];
  mapa: MapaTurmas;
}

export function carregarContexto(): Contexto {
  const linhasRegras = ler("regras.json") as LinhaRegra[];
  const linhasUcs = ler("ucs.json");
  const linhasAnos = ler("anos_semestres.json");
  const linhasFeriados = ler("feriados.json");

  const ucs: UC[] = linhasUcs.map(rowToUc);
  const anosSemestres: AnoLetivoSemestre[] = linhasAnos.map(rowToAnoSem);
  const feriados: FeriadoInterrupcao[] = linhasFeriados.map(rowToFeriado);
  const anoLetivo = anosSemestres[0]?.anoLetivo ?? "";

  // O snapshot em `SB_SNAPSHOT_DIR` é ANTERIOR às migrações da regra geral
  // (ainda traz `maxTPporUCporMancha = 4`). O `test_referencia.ts` — o teste que
  // confronta as regras com o horário do coordenador — aplica-lhes as migrações
  // lidas do SQL. Este protótipo tem de usar exatamente a MESMA configuração,
  // senão estaria a medir-se contra regras mais frouxas do que as reais.
  const { config: regras } = carregarRegras({
    regras: comMigracaoRegraGeral(linhasRegras),
    ucs: linhasUcs,
    anosSemestres: linhasAnos,
  });

  const entrada: EntradaAlocacao = { ucs, regras, feriados, anosSemestres, anoLetivo };
  const mapa = criarMapaTurmas(regras.estruturaTurmas);
  const anos = [...new Set(ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);
  const calendario = construirCalendario(entrada, anos);
  const inventario = inventariar(entrada, regras);

  return { entrada, regras, ucs, inventario, calendario, anos, familias: mapa.familias, mapa };
}

/** Blocos cuja janela de semanas viáveis cai INTEIRAMENTE dentro de [de, ate]. */
export function blocosDaJanela(inv: Inventario, de: number, ate: number): BlocoInventariado[] {
  return inv.blocos.filter(
    (b) =>
      b.semanasViaveis.length > 0 &&
      b.semanasViaveis.every((s) => s >= de && s <= ate),
  );
}

/** Blocos que tocam a janela mas também vivem fora dela (carga partilhada). */
export function blocosParciais(inv: Inventario, de: number, ate: number): BlocoInventariado[] {
  return inv.blocos.filter(
    (b) =>
      b.semanasViaveis.some((s) => s >= de && s <= ate) &&
      b.semanasViaveis.some((s) => s < de || s > ate),
  );
}

export function resumoLimites(regras: ConfiguracaoMotor) {
  const lim = limitesDaComposicao(regras);
  const e = regras.estruturaTurmas;
  return {
    ...lim,
    folhasPorFamilia: e.tpPorTurmaTeorica * e.plPorTP,
    quartos: e.tpPorTurmaTeorica,
    plPorQuarto: e.plPorTP,
    familias: e.turmasTeoricas,
  };
}
