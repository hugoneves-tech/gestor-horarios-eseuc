/**
 * JANELAS — onde é que o ano letivo se pode cortar, e a resolução encadeada.
 *
 * O solver não aguenta o ano inteiro de uma só vez: 15 semanas são ~40 000
 * variáveis e, com um orçamento de tempo realista, deixa dezenas de blocos por
 * colocar. Medido: monolítico de 15 semanas = 240/285 blocos; as mesmas semanas
 * partidas em duas janelas = 285/285.
 *
 * Mas o corte não pode ser em qualquer sítio. Um bloco só entra numa janela se
 * TODAS as suas semanas viáveis lá couberem; um corte a meio da janela de
 * viabilidade de um bloco deixa-o ÓRFÃO — nenhuma janela o reclama e ele
 * desaparece do horário sem erro nenhum. Por isso os cortes não se escrevem à
 * mão: derivam-se do inventário.
 */

import { blocosDaJanela } from "./modelo";
import type { Inventario } from "../inventario";
import type { ConfiguracaoMotor } from "../../regras/esquema";
import type { SessaoHorario } from "../../types";

/** Semanas onde bloco nenhum atravessa — os únicos pontos de corte seguros. */
export function cortesLimpos(inv: Inventario): number[] {
  const semanas = inv.blocos.flatMap((b) => b.semanasViaveis);
  if (semanas.length === 0) return [];
  const ultima = Math.max(...semanas);
  const out: number[] = [];
  for (let c = 2; c <= ultima; c++) {
    const atravessa = inv.blocos.some(
      (b) => b.semanasViaveis.some((s) => s < c) && b.semanasViaveis.some((s) => s >= c),
    );
    if (!atravessa) out.push(c);
  }
  return out;
}

/**
 * As janelas que o inventário pede. Cada grupo de blocos cujas janelas de
 * viabilidade se tocam forma uma janela; os intervalos mortos entre grupos são
 * absorvidos pela janela seguinte, para que nenhuma mancha do calendário fique
 * inacessível.
 */
export function janelasAutomaticas(inv: Inventario): [number, number][] {
  const intervalos = inv.blocos
    .filter((b) => b.semanasViaveis.length > 0)
    .map((b) => [Math.min(...b.semanasViaveis), Math.max(...b.semanasViaveis)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (intervalos.length === 0) return [];

  // Componentes ligados: intervalos que se sobrepõem pertencem à mesma janela.
  const comps: [number, number][] = [];
  for (const [de, ate] of intervalos) {
    const ultimo = comps[comps.length - 1];
    if (ultimo && de <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], ate);
    else comps.push([de, ate]);
  }

  // Estica cada janela até encostar à anterior: a primeira começa na semana 1
  // (onde vive o layout fixo, que não tem blocos mas ocupa manchas).
  return comps.map(([, ate], i) => [i === 0 ? 1 : comps[i - 1][1] + 1, ate] as [number, number]);
}

/** Blocos que nenhuma das janelas reclama. Se não for vazio, os cortes estão errados. */
export function blocosOrfaos(inv: Inventario, janelas: [number, number][]): number {
  const reclamados = new Set<number>();
  for (const [de, ate] of janelas) {
    for (const b of blocosDaJanela(inv, de, ate)) reclamados.add(inv.blocos.indexOf(b));
  }
  return inv.blocos.length - reclamados.size;
}

/**
 * As sessões que uma regra de layout impõe dentro de [de, ate]. O solver não as
 * decide — ocupa o resto à volta delas.
 */
export function sessoesDeLayoutFixo(
  regras: ConfiguracaoMotor,
  de: number,
  ate: number,
  idBase = 1_000_000,
): SessaoHorario[] {
  const blocoH = regras.grelha.duracaoBlocoHoras;
  const out: SessaoHorario[] = [];
  let id = idBase;
  for (const l of regras.layoutsFixos) {
    for (const s of l.sessoes) {
      if (s.semana < de || s.semana > ate) continue;
      for (const turma of s.turmas) {
        const hh = Number(s.hora.slice(0, 2)) + blocoH;
        out.push({
          id: id++,
          ucNome: s.ucSigla,
          ucSigla: s.ucSigla,
          tipoAula: s.tipo,
          docente: "",
          sala: "",
          salaTipo: "",
          turma,
          diaSemana: s.dia,
          horaInicio: s.hora,
          horaFim: `${String(hh).padStart(2, "0")}:${s.hora.slice(3)}`,
          bloqueado: true,
          semana: s.semana,
        });
      }
    }
  }
  return out;
}
