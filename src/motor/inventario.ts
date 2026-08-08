/**
 * INVENTÁRIO DE BLOCOS — calcular tudo ANTES de colocar seja o que for.
 *
 * Ideia do coordenador (02/08/2026): a composição dos blocos não é uma escolha
 * livre do motor, é uma CONSEQUÊNCIA das cargas. Dado que cada bloco tem de
 * cobrir as folhas-aluno de uma turma teórica DENTRO DOS LIMITES (no máximo
 * `maxTPporUCporMancha` TP e `maxPLporUCporMancha` PL da mesma unidade
 * curricular), e dadas as cargas de cada unidade curricular, o conjunto de
 * blocos possíveis é DETERMINADO. Este ficheiro enumera-o, mede a capacidade do
 * calendário e confronta os dois números.
 *
 * As FORMAS que este ficheiro percorre vêm de `formasPossiveis` — são calculadas
 * a partir dos limites, não lidas de uma lista de padrões.
 *
 * ------------------------------------------------------------------------
 * O QUE ESTE FICHEIRO NÃO FAZ
 * ------------------------------------------------------------------------
 * NÃO coloca nada. O inventário não conhece dias nem horas: sabe apenas QUE
 * blocos existem, de que são feitos, e em que SEMANAS podem viver. A escolha do
 * dia e da hora é do alocador, a repartição pelas semanas é do planeador, e as
 * regras que governam ambas continuam a viver em `restricoes.ts`. Quando o
 * inventário precisa de saber se uma composição é sequer legal, PERGUNTA ao
 * registo — não reimplementa nenhuma regra. Uma regra, um sítio.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO valores de negócio literais: padrões, estrutura de turmas, limites e
 *     calendário vêm todos da `ConfiguracaoMotor` e do catálogo de UCs.
 *  3. A contabilidade da carga é a MESMA do planeador (`construirProcura`), para
 *     que os dois nunca possam discordar sobre quanto há para dar.
 *
 * ------------------------------------------------------------------------
 * O ALGORITMO
 * ------------------------------------------------------------------------
 *  1. PROCURA. A carga por colocar, por (ano, família), convertida nas unidades
 *     com que os padrões trabalham: blocos de T na turma teórica, blocos de TP
 *     por desdobramento, e GRUPOS de PL (as `plPorTP` turmas de um desdobramento,
 *     que andam sempre juntas) por desdobramento.
 *  2. QUOTA ESTRUTURAL. Os grupos de práticas emparelham-se entre unidades
 *     curriculares DIFERENTES. Maximizar o número de pares é um problema de
 *     CORRESPONDÊNCIA, resolvido aqui de forma exata; o que sobra pertence todo
 *     à mesma UC e só fecha com o padrão que leva um grupo isolado. Essa quota é
 *     RESERVADA — sai da conta, não de uma heurística nem de uma sigla escrita
 *     aqui. Se um dia as cargas emparelharem, vai a zero sozinha.
 *  3. ENUMERAÇÃO. Cada bloco recebe uma composição concreta e as SEMANAS em que
 *     o registo de restrições o aceita. É o que o planeador reparte.
 *  4. CAPACIDADE. Por (ano, família, semana), a partir dos dias úteis reais e da
 *     regra de carga diária: o TETO (o mesmo limite que a restrição
 *     `carga-diaria` faz cumprir) e o ALVO (a carga-alvo do estudante).
 *  5. CONFRONTO. Necessário contra disponível, no total e semana a semana.
 */

import {
  construirCalendario,
  construirProcura,
  criarMapaTurmas,
  descontarJaColocado,
  limitesDaSemana,
} from "./planeador";
import type { EntradaAlocacao, ItemProcura, MapaTurmas, SemanaAlocacao } from "./planeador";
import { custoDaForma, custosDeForma, formasPossiveis, limitesDaComposicao } from "./padroes";
import type { FormaBloco, FormaId } from "./padroes";
import { criarEstado, criarHierarquia } from "./estado";
import type { Candidato, Mancha, SessaoCandidata } from "./estado";
import { construirRestricoes, primeiraViolacao } from "./restricoes";
import type { Restricao } from "./restricoes";
import type { ConfiguracaoMotor, Familia } from "../regras/esquema";
import { distribuirBlocos } from "../utils/distribuicao";
import type { SemanaInfo } from "../utils/distribuicao";
import type { SessaoHorario, UC } from "../types";

// ---------------------------------------------------------------------------
// 1. Contrato público
// ---------------------------------------------------------------------------

export interface BlocoInventariado {
  id: number;
  ano: number;
  familia: Familia;
  semestre: number;
  /** A FORMA que este bloco desenha — calculada dos limites, não escolhida de uma lista. */
  forma: FormaId;
  /** Composição exata do bloco, sem dia nem hora. */
  sessoes: SessaoCandidata[];
  /**
   * Semanas GLOBAIS onde este bloco PODE ir — não um intervalo, mas a LISTA que
   * o registo de restrições aceita. Uma unidade curricular pode ter as práticas
   * fechadas a semanas soltas dentro da sua janela letiva, e supor um intervalo
   * contínuo punha blocos onde nunca poderiam entrar.
   */
  semanasViaveis: number[];
}

export interface Capacidade {
  ano: number;
  familia: Familia;
  semana: number;
  diasUteis: number;
  /** Manchas que a regra de carga diária deixa caber (o teto duro). */
  tetoManchas: number;
  /** Manchas à carga-alvo do estudante (ex.: 6h/dia). */
  alvoManchas: number;
}

export interface SemanaCritica {
  ano: number;
  familia: Familia;
  semana: number;
  /** Procura repartida por dias úteis dentro de cada janela letiva. */
  procura: number;
  teto: number;
}

export interface Confronto {
  necessario: number;
  disponivelNoAlvo: number;
  disponivelNoTeto: number;
  folgaNoAlvo: number;
  folgaNoTeto: number;
  veredicto: "cabe com folga" | "cabe justo" | "nao cabe";
  semanasCriticas: SemanaCritica[];
}

export interface CargaNaoInventariada {
  ucSigla: string;
  turma: string;
  tipo: string;
  blocos: number;
  motivo: string;
}

/**
 * Diagnóstico de uma janela letiva: é por aqui que se lê PORQUE é que a conta
 * exige N blocos do padrão de grupo isolado.
 */
export interface EmparelhamentoJanela {
  ano: number;
  familia: Familia;
  primeira: number;
  ultima: number;
  /** Composição inventariada para esta janela, por forma. */
  porForma: Partial<Record<FormaId, number>>;
  /** Grupos de práticas a colocar nesta janela, somando todas as UCs. */
  trios: number;
  /** Grupos da unidade curricular que mais traz (a que não emparelha toda). */
  triosDaUCdominante: number;
  /** Limite superior de pares, provado a partir das contagens. */
  limiteDePares: number;
  /** Pares efetivamente construídos pela correspondência exata. */
  pares: number;
  /** Grupos que ficaram sem parceiro — a quota do padrão de grupo isolado. */
  semParceiro: number;
  /** `true` quando o construtor atingiu o limite superior (correspondência ótima). */
  otimo: boolean;
  /** A forma que fecha um grupo de práticas isolado, quando os limites a permitem. */
  formaDoGrupoIsolado: FormaId | null;
}

export interface Inventario {
  blocos: BlocoInventariado[];
  capacidade: Capacidade[];
  confronto: Confronto;
  /** Carga que não formou nenhum bloco válido, com a razão. */
  naoInventariada: CargaNaoInventariada[];
  /** Como o emparelhamento correu em cada janela letiva. */
  emparelhamentos: EmparelhamentoJanela[];
  /** Avisos herdados da leitura do catálogo de UCs e da enumeração. */
  avisos: string[];
}

// ---------------------------------------------------------------------------
// 2. Emparelhamento exato de grupos de práticas
// ---------------------------------------------------------------------------

/** Um trio é um grupo de práticas: uma unidade curricular num desdobramento. */
export interface Trio {
  uc: number;
  quarto: number;
}

export interface ResultadoEmparelhamento {
  pares: [Trio, Trio][];
  /** Limite superior provado a partir das contagens. */
  limite: number;
  /** O construtor atingiu o limite superior. */
  otimo: boolean;
}

const clonar = (m: number[][]): number[][] => m.map((l) => l.slice());

/**
 * Limite superior do número de pares de trios de UCs e desdobramentos DIFERENTES.
 *
 * Três majorantes, todos elementares e todos válidos:
 *  - cada par gasta dois trios: `floor(total / 2)`;
 *  - os trios de uma mesma UC nunca emparelham entre si, pelo que cada par gasta
 *    pelo menos um trio de FORA da UC dominante: `total - max(por UC)`;
 *  - o mesmo argumento vale para os desdobramentos: `total - max(por quarto)`.
 */
function limiteDePares(m: number[][]): number {
  let total = 0;
  const porUC = m.map((linha) => linha.reduce((s, n) => s + n, 0));
  const porQuarto = new Array<number>(m[0]?.length ?? 0).fill(0);
  for (const linha of m) {
    linha.forEach((n, q) => {
      porQuarto[q] += n;
      total += n;
    });
  }
  if (total === 0) return 0;
  const maxUC = Math.max(0, ...porUC);
  const maxQuarto = Math.max(0, ...porQuarto);
  return Math.max(0, Math.min(Math.floor(total / 2), total - maxUC, total - maxQuarto));
}

const compativel = (a: Trio, b: Trio): boolean => a.uc !== b.uc && a.quarto !== b.quarto;

/** Guloso: o trio mais abundante procura o parceiro compatível mais abundante. */
function emparelharGuloso(m: number[][]): [Trio, Trio][] {
  const pares: [Trio, Trio][] = [];
  const maior = (excluir?: Trio): Trio | null => {
    let melhor: Trio | null = null;
    let melhorN = 0;
    for (let u = 0; u < m.length; u++) {
      for (let q = 0; q < m[u].length; q++) {
        if (m[u][q] <= 0) continue;
        const c = { uc: u, quarto: q };
        if (excluir && !compativel(excluir, c)) continue;
        if (m[u][q] > melhorN) {
          melhorN = m[u][q];
          melhor = c;
        }
      }
    }
    return melhor;
  };

  for (;;) {
    let a: Trio | null = null;
    let b: Trio | null = null;
    // O primeiro extremo tem de ter parceiro; se o mais abundante não tiver,
    // tenta-se o seguinte, por ordem decrescente.
    const candidatos: Trio[] = [];
    for (let u = 0; u < m.length; u++) {
      for (let q = 0; q < m[u].length; q++) if (m[u][q] > 0) candidatos.push({ uc: u, quarto: q });
    }
    candidatos.sort((x, y) => m[y.uc][y.quarto] - m[x.uc][x.quarto] || x.uc - y.uc || x.quarto - y.quarto);
    for (const c of candidatos) {
      const parceiro = maior(c);
      if (parceiro) {
        a = c;
        b = parceiro;
        break;
      }
    }
    if (!a || !b) break;
    m[a.uc][a.quarto] -= 1;
    m[b.uc][b.quarto] -= 1;
    pares.push([a, b]);
  }
  return pares;
}

/**
 * Máximo de pares, exato.
 *
 * Ramifica sobre o parceiro do PRIMEIRO trio que ainda tem parceiro possível, o
 * que é legítimo: se um vértice com vizinhos ficasse por emparelhar num
 * emparelhamento máximo, o seu vizinho estaria emparelhado com um terceiro e
 * trocar as duas arestas daria um emparelhamento do mesmo tamanho que já o
 * inclui.
 *
 * O orçamento de nós existe para que um caso patológico nunca pendure o motor:
 * quando se esgota, o resultado é assinalado como não certificado em vez de ser
 * apresentado como ótimo.
 */
function emparelharExato(m: number[][], limite: number, orcamento: number): { pares: [Trio, Trio][]; otimo: boolean } {
  const memo = new Map<string, number>();
  let nos = 0;
  let esgotou = false;

  const chave = (c: number[][]) => c.map((l) => l.join(",")).join("|");

  const melhor = (c: number[][]): number => {
    const k = chave(c);
    const guardado = memo.get(k);
    if (guardado !== undefined) return guardado;
    if (nos++ > orcamento) {
      esgotou = true;
      return 0;
    }
    const teto = limiteDePares(c);
    if (teto === 0) {
      memo.set(k, 0);
      return 0;
    }
    let a: Trio | null = null;
    let parceiros: Trio[] = [];
    fora: for (let u = 0; u < c.length && !a; u++) {
      for (let q = 0; q < c[u].length; q++) {
        if (c[u][q] <= 0) continue;
        const cand = { uc: u, quarto: q };
        const lista: Trio[] = [];
        for (let v = 0; v < c.length; v++) {
          for (let r = 0; r < c[v].length; r++) {
            if (c[v][r] <= 0) continue;
            const outro = { uc: v, quarto: r };
            if (compativel(cand, outro)) lista.push(outro);
          }
        }
        if (lista.length > 0) {
          a = cand;
          parceiros = lista;
          break fora;
        }
      }
    }
    if (!a) {
      memo.set(k, 0);
      return 0;
    }
    let best = 0;
    for (const b of parceiros) {
      c[a.uc][a.quarto] -= 1;
      c[b.uc][b.quarto] -= 1;
      const v = 1 + melhor(c);
      c[a.uc][a.quarto] += 1;
      c[b.uc][b.quarto] += 1;
      if (v > best) best = v;
      if (best >= teto || esgotou) break;
    }
    memo.set(k, best);
    return best;
  };

  const c = clonar(m);
  const total = melhor(c);
  if (esgotou) return { pares: emparelharGuloso(clonar(m)), otimo: false };

  // Reconstrução: seguir sempre um parceiro que preserve o valor ótimo.
  const pares: [Trio, Trio][] = [];
  const estado = clonar(m);
  let restante = total;
  while (restante > 0) {
    let escolhido: [Trio, Trio] | null = null;
    fora: for (let u = 0; u < estado.length; u++) {
      for (let q = 0; q < estado[u].length; q++) {
        if (estado[u][q] <= 0) continue;
        const a = { uc: u, quarto: q };
        for (let v = 0; v < estado.length; v++) {
          for (let r = 0; r < estado[v].length; r++) {
            if (estado[v][r] <= 0) continue;
            const b = { uc: v, quarto: r };
            if (!compativel(a, b)) continue;
            estado[u][q] -= 1;
            estado[v][r] -= 1;
            if (melhor(estado) === restante - 1) {
              escolhido = [a, b];
              break fora;
            }
            estado[u][q] += 1;
            estado[v][r] += 1;
          }
        }
      }
    }
    if (!escolhido) break;
    pares.push(escolhido);
    restante -= 1;
  }
  return { pares, otimo: total >= limite };
}

/**
 * Máximo de pares de trios de UCs e desdobramentos DIFERENTES. Exato.
 *
 * `m[uc][quarto]` = quantos trios essa unidade curricular tem nesse
 * desdobramento. O guloso resolve o caso corrente em tempo linear; quando não
 * atinge o limite superior provado, entra a pesquisa exaustiva.
 */
export function emparelharTrios(m: number[][], orcamentoNos = 200_000): ResultadoEmparelhamento {
  const limite = limiteDePares(m);
  if (limite === 0) return { pares: [], limite: 0, otimo: true };
  const guloso = emparelharGuloso(clonar(m));
  if (guloso.length >= limite) return { pares: guloso, limite, otimo: true };
  const exato = emparelharExato(m, limite, orcamentoNos);
  if (exato.pares.length >= guloso.length) return { pares: exato.pares, limite, otimo: exato.otimo };
  return { pares: guloso, limite, otimo: false };
}

// ---------------------------------------------------------------------------
// 3. Balanço: da procura por turma para as unidades dos padrões
// ---------------------------------------------------------------------------

/**
 * O que falta dar a um (ano, família), já convertido nas unidades com que os
 * padrões trabalham: blocos de T na turma teórica, blocos de TP por
 * desdobramento, e GRUPOS de PL (as `plPorTP` turmas de um desdobramento, que
 * andam sempre juntas) por desdobramento.
 */
interface Balanco {
  ano: number;
  familia: Familia;
  fIdx: number;
  /** ucId -> blocos de T por colocar. */
  t: Map<string, number>;
  /** `ucId|TP` ou `ucId|PL` -> por desdobramento, quantos blocos/grupos faltam. */
  quartos: Map<string, number[]>;
  /** ucId -> janela letiva em semanas globais. */
  janela: Map<string, Janela>;
  ucSigla: Map<string, string>;
  semestre: Map<string, number>;
}

/** Intervalo de semanas GLOBAIS. */
interface Janela {
  primeira: number;
  ultima: number;
}

const intersetar = (a: Janela, b: Janela): Janela => ({
  primeira: Math.max(a.primeira, b.primeira),
  ultima: Math.min(a.ultima, b.ultima),
});

const vazia = (j: Janela): boolean => j.primeira > j.ultima;

const chaveQuartos = (ucId: string, tipo: "TP" | "PL") => `${ucId}|${tipo}`;

const somar = (lista: number[] | undefined): number => (lista ?? []).reduce((s, n) => s + n, 0);

function construirBalanco(
  ano: number,
  familia: Familia,
  fIdx: number,
  mapa: MapaTurmas,
  procura: Map<string, ItemProcura>,
  naoInventariada: CargaNaoInventariada[],
): Balanco {
  const bal: Balanco = {
    ano,
    familia,
    fIdx,
    t: new Map(),
    quartos: new Map(),
    janela: new Map(),
    ucSigla: new Map(),
    semestre: new Map(),
  };

  const registarJanela = (p: ItemProcura) => {
    bal.ucSigla.set(p.ucId, p.ucSigla);
    bal.semestre.set(p.ucId, p.semestre);
    const atual = bal.janela.get(p.ucId);
    if (!atual) bal.janela.set(p.ucId, { primeira: p.primeira, ultima: p.ultima });
    else {
      atual.primeira = Math.min(atual.primeira, p.primeira);
      atual.ultima = Math.max(atual.ultima, p.ultima);
    }
  };

  const teorica = mapa.teorica(fIdx);
  for (const p of procura.values()) {
    if (p.ano !== ano || p.familiaIdx !== fIdx) continue;
    const falta = p.alvo - p.colocados;
    if (falta <= 0) continue;
    if (p.tipo === "S") {
      naoInventariada.push({
        ucSigla: p.ucSigla,
        turma: mapa.apresentacao(p.turma),
        tipo: p.tipo,
        blocos: falta,
        motivo: "nenhum padrão de bloco a 100% inclui seminários; o inventário não os enumera.",
      });
      continue;
    }
    if (p.tipo === "T") {
      if (p.turma !== teorica) {
        naoInventariada.push({
          ucSigla: p.ucSigla,
          turma: mapa.apresentacao(p.turma),
          tipo: p.tipo,
          blocos: falta,
          motivo:
            `a turma "${p.turma}" recebe aulas teóricas mas não é a turma teórica da família ${familia} ` +
            `("${teorica}"); só se inventariam manchas de T que cubram a família inteira.`,
        });
        continue;
      }
      bal.t.set(p.ucId, (bal.t.get(p.ucId) ?? 0) + falta);
      registarJanela(p);
      continue;
    }
    if (p.tipo === "TP") {
      for (let q = 0; q < mapa.quartosPorFamilia; q++) {
        if (mapa.tp(fIdx, q) !== p.turma) continue;
        const k = chaveQuartos(p.ucId, "TP");
        const lista = bal.quartos.get(k) ?? new Array<number>(mapa.quartosPorFamilia).fill(0);
        lista[q] += falta;
        bal.quartos.set(k, lista);
        registarJanela(p);
      }
    }
  }

  // As PL de um desdobramento andam sempre juntas: um GRUPO é o conjunto das
  // `plPorQuarto` turmas desse desdobramento. O grupo só existe enquanto as três
  // turmas tiverem carga; o que ficar por fora é carga não inventariada.
  for (let q = 0; q < mapa.quartosPorFamilia; q++) {
    const nomes = mapa.pl(fIdx, q);
    const porUC = new Map<string, number[]>();
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familiaIdx !== fIdx || p.tipo !== "PL") continue;
      const i = nomes.indexOf(p.turma);
      if (i < 0) continue;
      const falta = Math.max(0, p.alvo - p.colocados);
      const lista = porUC.get(p.ucId) ?? new Array<number>(nomes.length).fill(0);
      lista[i] = falta;
      porUC.set(p.ucId, lista);
      registarJanela(p);
    }
    for (const [ucId, faltas] of porUC) {
      const grupos = Math.min(...faltas);
      const desalinhadas = faltas.reduce((s, n) => s + n, 0) - grupos * nomes.length;
      if (grupos > 0) {
        const k = chaveQuartos(ucId, "PL");
        const lista = bal.quartos.get(k) ?? new Array<number>(mapa.quartosPorFamilia).fill(0);
        lista[q] += grupos;
        bal.quartos.set(k, lista);
      }
      if (desalinhadas > 0) {
        naoInventariada.push({
          ucSigla: bal.ucSigla.get(ucId) ?? ucId,
          turma: nomes.join("+"),
          tipo: "PL",
          blocos: desalinhadas,
          motivo:
            `as ${nomes.length} turmas de práticas do desdobramento não têm a mesma carga por colocar; ` +
            "só se inventariam grupos completos, porque é assim que os padrões fecham o bloco a 100%.",
        });
      }
    }
  }

  return bal;
}

// ---------------------------------------------------------------------------
// 4. Prova de legalidade: perguntar ao registo, nunca reimplementar
// ---------------------------------------------------------------------------

/**
 * Uma composição é ADMISSÍVEL se existir pelo menos uma mancha (semana da sua
 * janela, dia, hora) em que o registo de restrições a aceita.
 *
 * É a única pergunta que o inventário faz sobre legalidade, e faz-na ao registo:
 * o limite de práticas simultâneas por unidade curricular, a capacidade de
 * laboratórios e as janelas de dia/hora vivem lá e só lá.
 *
 * A pergunta é feita contra um PASSADO SINTÉTICO — um horário onde todas as
 * aulas T e TP de todas as unidades curriculares já foram dadas, numa semana
 * anterior a qualquer semana real. A razão é que o inventário quer saber o que é
 * ESTRUTURALMENTE impossível, não o que ainda não chegou a horas: as regras de
 * ORDEM (as precedências e o rácio TP->PL) recusam qualquer prática num horário
 * vazio, e recusá-las aqui apagaria do inventário toda a carga prática. Essas
 * regras dizem QUANDO, e o "quando" decide-se na repartição pelas semanas e na
 * colocação; as regras de COMPOSIÇÃO (limites por UC, capacidade da mancha, TP e
 * PL da mesma UC) contam dentro da mancha e continuam a responder na mesma,
 * porque o passado vive noutra semana.
 */
function criarProvaDeLegalidade(
  regras: ConfiguracaoMotor,
  calendario: Map<number, SemanaAlocacao[]>,
  restricoes: Restricao[],
  ucPorId: Map<string, UC>,
  procura: Map<string, ItemProcura>,
): (ano: number, familia: Familia, janela: Janela, sessoes: SessaoCandidata[]) => number[] {
  const estadoVazio = criarEstado(criarHierarquia(regras.estruturaTurmas));
  const diaBase = regras.grelha.dias[0];
  const horaBase = regras.grelha.horasInicio[0];
  const SEMANA_DO_PASSADO = 0;
  for (const p of procura.values()) {
    if (p.tipo !== "T" && p.tipo !== "TP") continue;
    const falta = p.alvo - p.colocados;
    for (let i = 0; i < falta; i++) {
      estadoVazio.colocar({
        sessoes: [{ ucId: p.ucId, ucSigla: p.ucSigla, turma: p.turma, tipo: p.tipo }],
        mancha: { ano: p.ano, semana: SEMANA_DO_PASSADO, dia: diaBase, hora: horaBase },
        familia: p.familia,
      });
    }
  }
  const cache = new Map<string, number[]>();

  return (ano, familia, janela, sessoes) => {
    const assinatura =
      `${ano}|${familia}|${janela.primeira}-${janela.ultima}|` +
      sessoes
        .map((s) => `${s.ucId}/${s.tipo}/${s.turma}`)
        .sort()
        .join(",");
    const guardado = cache.get(assinatura);
    if (guardado !== undefined) return guardado;

    const viaveis: number[] = [];
    for (const s of calendario.get(ano) ?? []) {
      if (s.global < janela.primeira || s.global > janela.ultima) continue;
      let cabe = false;
      for (const dia of s.dias) {
        for (const hora of regras.grelha.horasInicio) {
          const mancha: Mancha = { ano, semana: s.global, dia, hora };
          const candidato: Candidato = { sessoes, mancha, familia };
          if (primeiraViolacao(restricoes, { estado: estadoVazio, candidato, regras, ucPorId }) === null) {
            cabe = true;
            break;
          }
        }
        if (cabe) break;
      }
      if (cabe) viaveis.push(s.global);
    }
    cache.set(assinatura, viaveis);
    return viaveis;
  };
}

type ProvaLegalidade = ReturnType<typeof criarProvaDeLegalidade>;

// ---------------------------------------------------------------------------
// 5. O inventário
// ---------------------------------------------------------------------------

/**
 * @param jaColocadas Quando vem, é a lista COMPLETA do que já está no horário e
 *   substitui as sessões fixas e os layouts fixos como fonte do que descontar —
 *   é por aqui que o alocador inventaria a meio, depois de já ter colocado
 *   alguma coisa, sem descontar a mesma aula duas vezes.
 * @param registo Registo de restrições a consultar. Por omissão usa o registo
 *   base; o alocador passa o COMPLETO, para que a pergunta seja feita exatamente
 *   às mesmas regras que depois julgam a colocação.
 */
export function inventariar(
  entrada: EntradaAlocacao,
  regras: ConfiguracaoMotor,
  jaColocadas?: SessaoHorario[],
  registo?: Restricao[],
): Inventario {
  const mapa = criarMapaTurmas(regras.estruturaTurmas);
  const anos = [...new Set(entrada.ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);
  const calendario = construirCalendario(entrada, anos);
  const { itens: procura, avisos } = construirProcura(entrada, mapa);
  const ucPorId = new Map<string, UC>(entrada.ucs.map((u) => [u.id, u]));
  descontarJaColocado(entrada, regras, mapa, procura, ucPorId, jaColocadas);

  const restricoes = registo ?? construirRestricoes(regras);
  const legal = criarProvaDeLegalidade(regras, calendario, restricoes, ucPorId, procura);

  const blocos: BlocoInventariado[] = [];
  const naoInventariada: CargaNaoInventariada[] = [];
  const emparelhamentos: EmparelhamentoJanela[] = [];
  let proximoId = 1;

  for (const ano of anos) {
    for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
      const familia = mapa.familias[fIdx];
      const balanco = construirBalanco(ano, familia, fIdx, mapa, procura, naoInventariada);
      enumerar(balanco, regras, mapa, legal, blocos, naoInventariada, emparelhamentos, avisos, () => proximoId++);
    }
  }

  const capacidade: Capacidade[] = [];
  for (const [ano, semanas] of calendario) {
    for (const s of semanas) {
      const limites = limitesDaSemana(regras, ano, s.dias.length);
      for (const familia of mapa.familias) {
        capacidade.push({
          ano,
          familia,
          semana: s.global,
          diasUteis: s.dias.length,
          tetoManchas: limites.teto,
          alvoManchas: limites.alvo,
        });
      }
    }
  }

  const confronto = confrontar(blocos, capacidade, calendario, regras);

  return { blocos, capacidade, confronto, naoInventariada, emparelhamentos, avisos };
}

// ---------------------------------------------------------------------------
// 6. A enumeração dos blocos
// ---------------------------------------------------------------------------

/** Grupos (desdobramentos por UC) que uma forma de padrão exige. */
interface GrupoForma {
  tipo: "TP" | "PL";
  nQuartos: number;
}

/** Todas as combinações de `k` elementos de `itens`, por ordem estável. */
function combinacoes(itens: number[], k: number): number[][] {
  if (k < 0 || k > itens.length) return [];
  if (k === 0) return [[]];
  if (k === itens.length) return [itens.slice()];
  const saida: number[][] = [];
  const escolher = (i: number, atual: number[]) => {
    if (atual.length === k) {
      saida.push(atual.slice());
      return;
    }
    if (i >= itens.length) return;
    if (itens.length - i < k - atual.length) return;
    atual.push(itens[i]);
    escolher(i + 1, atual);
    atual.pop();
    escolher(i + 1, atual);
  };
  escolher(0, []);
  return saida;
}

function gruposDaForma(forma: FormaBloco, plPorQuarto: number): GrupoForma[] | null {
  const grupos: GrupoForma[] = [];
  for (const n of forma.tp) grupos.push({ tipo: "TP", nQuartos: n });
  for (const n of forma.pl) {
    if (n % plPorQuarto !== 0) return null;
    grupos.push({ tipo: "PL", nQuartos: n / plPorQuarto });
  }
  return grupos;
}

function enumerar(
  bal: Balanco,
  regras: ConfiguracaoMotor,
  mapa: MapaTurmas,
  legal: ProvaLegalidade,
  blocos: BlocoInventariado[],
  naoInventariada: CargaNaoInventariada[],
  emparelhamentos: EmparelhamentoJanela[],
  avisos: string[],
  proximoId: () => number,
): void {
  // AS FORMAS SÃO CALCULADAS. Já não há lista de padrões a filtrar por `ativo`:
  // o que existe é o que os limites de composição permitem, por ordem crescente
  // de custo de preferência.
  const formas = formasPossiveis(
    regras.estruturaTurmas,
    limitesDaComposicao(regras),
    custosDeForma(regras),
  );

  const formaT = formas.find((f) => f.t > 0) ?? null;
  const comPL = formas.filter((f) => f.pl.length > 0);
  const soTP = formas.filter((f) => f.t === 0 && f.pl.length === 0);
  /** Forma que fecha o bloco com UM grupo isolado de práticas. */
  const formaGrupoIsolado = comPL.find((f) => f.pl.length === 1 && f.pl[0] === mapa.plPorQuarto) ?? null;
  /**
   * Forma que junta DOIS grupos da MESMA unidade curricular. Com o limite
   * universal de 3 PL por UC deixa de existir — fica `null` e o ramo que a usava
   * simplesmente não corre. Mantém-se porque a conta continua a ser válida se um
   * dia o limite subir.
   */
  const formaGrupoDuplo = comPL.find((f) => f.pl.length === 1 && f.pl[0] === 2 * mapa.plPorQuarto) ?? null;

  const semestreDe = (ucs: string[]): number => {
    for (const ucId of ucs) {
      const s = bal.semestre.get(ucId);
      if (s !== undefined) return s;
    }
    return 0;
  };

  /**
   * As semanas de um bloco não são a interseção das janelas letivas, são as que
   * o REGISTO aceita: uma unidade curricular pode ter as práticas fechadas a
   * semanas soltas dentro da sua janela, e é ao registo que isso se pergunta.
   */
  const emitir = (forma: FormaBloco, sessoes: SessaoCandidata[], janela: Janela): BlocoInventariado | null => {
    const semanasViaveis = legal(bal.ano, bal.familia, janela, sessoes);
    if (semanasViaveis.length === 0) return null;
    const b: BlocoInventariado = {
      id: proximoId(),
      ano: bal.ano,
      familia: bal.familia,
      semestre: semestreDe([...new Set(sessoes.map((s) => s.ucId))]),
      forma: forma.id,
      sessoes,
      semanasViaveis,
    };
    blocos.push(b);
    return b;
  };

  // -------------------------------------------------------------------------
  // 6.1 Teóricas: uma mancha por bloco (a aula T cobre a família inteira)
  // -------------------------------------------------------------------------

  if (formaT !== null) {
    for (const [ucId, n] of bal.t) {
      const janela = bal.janela.get(ucId) ?? { primeira: 1, ultima: Number.MAX_SAFE_INTEGER };
      const sessao: SessaoCandidata = {
        ucId,
        ucSigla: bal.ucSigla.get(ucId) ?? ucId,
        turma: mapa.teorica(bal.fIdx),
        tipo: "T",
      };
      let colocadas = 0;
      for (let i = 0; i < n; i++) {
        if (emitir(formaT, [sessao], janela) !== null) colocadas++;
      }
      if (colocadas < n) {
        naoInventariada.push({
          ucSigla: sessao.ucSigla,
          turma: sessao.turma,
          tipo: "T",
          blocos: n - colocadas,
          motivo:
            `o registo de restrições não aceita uma aula teórica desta unidade curricular em nenhuma semana ` +
            `da sua janela letiva (${janela.primeira}-${janela.ultima}).`,
        });
      }
    }
    bal.t.clear();
  }

  // -------------------------------------------------------------------------
  // 6.2 Práticas: quota estrutural primeiro, emparelhamentos depois
  // -------------------------------------------------------------------------

  for (const grupo of gruposDeJanelaComPL(bal)) {
    const comPLnaJanela = grupo.ucs
      .map((ucId) => ({ ucId, quartos: bal.quartos.get(chaveQuartos(ucId, "PL")) ?? [] }))
      .filter((x) => somar(x.quartos) > 0);

    // A QUOTA SAI DE UMA CORRESPONDÊNCIA EXATA, não de uma estimativa: os grupos
    // de práticas emparelham entre UCs e desdobramentos DIFERENTES, e o máximo
    // de pares é o máximo de um emparelhamento. O que sobra é a quota do padrão
    // de grupo isolado, e é RESERVADA aqui, antes de qualquer colocação.
    const matriz = comPLnaJanela.map((x) => x.quartos.slice());
    const total = matriz.reduce((s, l) => s + somar(l), 0);
    const resultado = emparelharTrios(matriz);
    const porUC = matriz.map(somar);
    const maior = Math.max(0, ...porUC);
    const dominante = comPLnaJanela[porUC.indexOf(maior)] ?? null;
    const pares = resultado.pares.length;
    let semParceiro = total - 2 * pares;

    // O padrão que junta dois grupos da MESMA UC absorveria a sobra a metade do
    // preço — mas só se o registo o permitir para ESTA unidade curricular (o
    // limite de práticas simultâneas por UC costuma proibi-lo). Pergunta-se.
    const escopo = new Set(grupo.ucs);
    let duplos = 0;
    if (formaGrupoDuplo !== null && semParceiro >= 2 && dominante) {
      const prova = compor(bal, formaGrupoDuplo, mapa, { ucId: dominante.ucId, tipo: "PL" }, true, escopo);
      if (prova && legal(bal.ano, bal.familia, prova.janela, prova.sessoes).length > 0) {
        duplos = Math.floor(semParceiro / 2);
        semParceiro -= 2 * duplos;
      }
    }

    const diagnostico: EmparelhamentoJanela = {
      ano: bal.ano,
      familia: bal.familia,
      primeira: grupo.janela.primeira,
      ultima: grupo.janela.ultima,
      porForma: {},
      trios: total,
      triosDaUCdominante: maior,
      limiteDePares: resultado.limite,
      pares,
      semParceiro,
      otimo: resultado.otimo,
      formaDoGrupoIsolado: formaGrupoIsolado?.id ?? null,
    };

    const contar = (forma: FormaBloco) => {
      diagnostico.porForma[forma.id] = (diagnostico.porForma[forma.id] ?? 0) + 1;
    };

    /** `null` = inventariado; caso contrário, a razão por que esta forma não serviu. */
    const emitirSeLegal = (forma: FormaBloco, exigirUC?: string): string | null => {
      const c = compor(
        bal,
        forma,
        mapa,
        exigirUC === undefined ? undefined : { ucId: exigirUC, tipo: "PL" },
        false,
        escopo,
      );
      if (!c) return "não há unidades curriculares com carga por colocar que preencham esta forma";
      if (emitir(forma, c.sessoes, c.janela) === null) {
        const composicao = [...new Set(c.sessoes.map((s) => `${s.ucSigla}/${s.tipo}`))].join(" + ");
        desfazer(bal, c);
        return `o registo de restrições recusa a composição ${composicao} em todas as semanas da janela`;
      }
      contar(forma);
      return null;
    };

    // (a) A quota reservada: os grupos que nenhuma outra UC pode acompanhar.
    if (formaGrupoIsolado !== null && dominante) {
      for (let i = 0; i < semParceiro; i++) {
        if (emitirSeLegal(formaGrupoIsolado, dominante.ucId) !== null) break;
      }
    }

    // (b) Os duplos da mesma UC, quando os limites e o registo os aceitam.
    if (formaGrupoDuplo !== null && dominante) {
      for (let i = 0; i < duplos; i++) {
        if (emitirSeLegal(formaGrupoDuplo, dominante.ucId) !== null) break;
      }
    }

    // (c) O resto emparelha entre unidades curriculares diferentes, pela forma
    //     mais barata que ainda feche o bloco. Quando a mais barata não serve, a
    //     razão é registada: uma forma mais cara do que a preferida é um facto
    //     que o coordenador tem de ver, não um detalhe a esconder.
    const preferida = comPL[0] ?? null;
    let seguranca = total + 1;
    while (seguranca-- > 0) {
      if (grupo.ucs.every((ucId) => somar(bal.quartos.get(chaveQuartos(ucId, "PL"))) === 0)) break;
      let feito = false;
      let razaoDaPreferida = "";
      for (const forma of comPL) {
        const razao = emitirSeLegal(forma);
        if (razao === null) {
          if (forma !== preferida) {
            avisos.push(
              `ano ${bal.ano}, família ${bal.familia}, semanas ${grupo.janela.primeira}-${grupo.janela.ultima}: ` +
                `bloco de ${forma.id} acima da quota de ${semParceiro} reservada, porque ${preferida?.id} não coube — ` +
                `${razaoDaPreferida}.`,
            );
          }
          feito = true;
          break;
        }
        if (forma === preferida) razaoDaPreferida = razao;
      }
      if (!feito) break;
    }

    emparelhamentos.push(diagnostico);
  }

  // -------------------------------------------------------------------------
  // 6.3 As TP que sobraram: pelos padrões só-TP, do mais barato ao mais caro
  // -------------------------------------------------------------------------

  let seguranca = 10_000;
  while (seguranca-- > 0) {
    let feito = false;
    for (const forma of soTP) {
      const c = compor(bal, forma, mapa, undefined, false);
      if (!c) continue;
      if (emitir(forma, c.sessoes, c.janela) === null) {
        desfazer(bal, c);
        continue;
      }
      feito = true;
      break;
    }
    if (!feito) break;
  }

  // -------------------------------------------------------------------------
  // 6.4 O que não coube em nenhuma forma
  // -------------------------------------------------------------------------

  for (const [chave, lista] of bal.quartos) {
    const restante = somar(lista);
    if (restante <= 0) continue;
    const [ucId, tipo] = chave.split("|") as [string, "TP" | "PL"];
    naoInventariada.push({
      ucSigla: bal.ucSigla.get(ucId) ?? ucId,
      turma: lista
        .map((n, q) => (n > 0 ? (tipo === "TP" ? mapa.tp(bal.fIdx, q) : mapa.pl(bal.fIdx, q).join("+")) : ""))
        .filter((s) => s !== "")
        .join(", "),
      tipo,
      blocos: tipo === "PL" ? restante * mapa.plPorQuarto : restante,
      motivo:
        "não sobrou nenhuma unidade curricular com carga por colocar para acompanhar estes blocos " +
        "num padrão que feche o bloco a 100% das folhas-aluno.",
    });
    lista.fill(0);
  }
  for (const [ucId, n] of bal.t) {
    if (n <= 0) continue;
    naoInventariada.push({
      ucSigla: bal.ucSigla.get(ucId) ?? ucId,
      turma: mapa.teorica(bal.fIdx),
      tipo: "T",
      blocos: n,
      motivo: "nenhuma forma de bloco fecha as folhas-aluno com uma aula teórica.",
    });
  }
  bal.t.clear();
}

/**
 * Unidades curriculares com práticas por colocar, agrupadas por janelas que se
 * cruzam. Os grupos são o "bloco de semanas" de que o coordenador fala: só
 * dentro de um grupo é que os grupos de práticas se podem emparelhar.
 */
function gruposDeJanelaComPL(bal: Balanco): { ucs: string[]; janela: Janela }[] {
  const comPL = [...bal.janela.keys()].filter((ucId) => somar(bal.quartos.get(chaveQuartos(ucId, "PL"))) > 0);
  const grupos: { ucs: string[]; janela: Janela }[] = [];
  for (const ucId of comPL) {
    const minha = bal.janela.get(ucId)!;
    const existente = grupos.find((g) => !vazia(intersetar(g.janela, minha)));
    if (existente) {
      existente.ucs.push(ucId);
      existente.janela = {
        primeira: Math.min(existente.janela.primeira, minha.primeira),
        ultima: Math.max(existente.janela.ultima, minha.ultima),
      };
    } else {
      grupos.push({ ucs: [ucId], janela: { ...minha } });
    }
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// 7. Composição de um bloco a partir de uma forma de padrão
// ---------------------------------------------------------------------------

interface Composicao {
  sessoes: SessaoCandidata[];
  janela: Janela;
  /** O que foi descontado do balanço, para poder ser devolvido. */
  consumo: { chave: string; quarto: number }[];
}

/**
 * Preenche a FORMA de um padrão com unidades curriculares concretas, descontando
 * o que usa do balanço. Cada grupo da forma recebe uma UC DIFERENTE (é isso que
 * a forma significa) e desdobramentos disjuntos; entre as UCs possíveis escolhe
 * a que tem mais carga por colocar, para que nenhuma fique para trás.
 *
 * `simular` compõe e devolve tudo ao balanço: serve para perguntar ao registo se
 * a forma seria sequer legal, sem gastar procura.
 */
function compor(
  bal: Balanco,
  forma: FormaBloco,
  mapa: MapaTurmas,
  exigir: { ucId: string; tipo: "TP" | "PL" } | undefined,
  simular: boolean,
  restringirPL?: Set<string>,
): Composicao | null {
  const grupos = gruposDaForma(forma, mapa.plPorQuarto);
  if (grupos === null) return null;
  if (forma.t > 0) return null;
  if (grupos.reduce((s, g) => s + g.nQuartos, 0) !== mapa.quartosPorFamilia) return null;

  // AS PRÁTICAS PRIMEIRO. É a escolha que decide se o emparelhamento fecha: as
  // TP são um recurso abundante e partilhado, as práticas não. Escolher a TP
  // antes tirava do jogo uma unidade curricular de que os grupos de práticas
  // ainda precisavam como parceira — e o que sobrava, sendo todo da mesma UC,
  // só fechava com o padrão de último recurso. Dentro de cada tipo, os grupos
  // mais exigentes vêm à frente, para reduzir o retrocesso.
  const ordem = grupos
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "PL" ? -1 : 1) || b.nQuartos - a.nQuartos || a.i - b.i);

  const consumo: { chave: string; quarto: number }[] = [];
  const sessoes: SessaoCandidata[] = [];
  const usados = new Set<string>();
  let janela: Janela = { primeira: 1, ultima: Number.MAX_SAFE_INTEGER };

  /**
   * Carga que ainda falta em cada desdobramento, somando TODAS as unidades
   * curriculares. Serve para esvaziar primeiro os desdobramentos mais cheios e
   * manter os quatro nivelados: uma forma que separa grupos por desdobramentos
   * DIFERENTES deixa de fechar quando o que resta se concentra todo no mesmo.
   */
  const cargaGlobalDoQuarto = (tipo: "TP" | "PL"): number[] => {
    const total = new Array<number>(mapa.quartosPorFamilia).fill(0);
    for (const [chave, lista] of bal.quartos) {
      const [ucId, seuTipo] = chave.split("|") as [string, "TP" | "PL"];
      if (seuTipo !== tipo) continue;
      if (tipo === "PL" && restringirPL && !restringirPL.has(ucId)) continue;
      for (let q = 0; q < total.length; q++) total[q] += lista[q];
    }
    return total;
  };

  const candidatos = (
    tipo: "TP" | "PL",
    nQuartos: number,
    livres: number[],
    janelaAtual: Janela,
  ): string[] => {
    const lista: { ucId: string; peso: number }[] = [];
    for (const ucId of bal.janela.keys()) {
      if (usados.has(ucId)) continue;
      if (tipo === "PL" && restringirPL && !restringirPL.has(ucId)) continue;
      const jan = bal.janela.get(ucId)!;
      if (vazia(intersetar(janelaAtual, jan))) continue;
      const quartos = bal.quartos.get(chaveQuartos(ucId, tipo));
      if (!quartos) continue;
      const disponiveis = livres.filter((q) => quartos[q] > 0);
      if (disponiveis.length < nQuartos) continue;
      lista.push({ ucId, peso: somar(quartos) });
    }
    lista.sort((a, b) => b.peso - a.peso || a.ucId.localeCompare(b.ucId));
    if (exigir && !usados.has(exigir.ucId) && exigir.tipo === tipo) {
      const i = lista.findIndex((x) => x.ucId === exigir.ucId);
      if (i > 0) lista.unshift(...lista.splice(i, 1));
      else if (i < 0) return [];
    }
    return lista.map((x) => x.ucId);
  };

  const escolher = (k: number, livres: number[], janelaAtual: Janela): boolean => {
    if (k === ordem.length) {
      if (exigir && !usados.has(exigir.ucId)) return false;
      janela = janelaAtual;
      return true;
    }
    const g = ordem[k];
    const lista = candidatos(g.tipo, g.nQuartos, livres, janelaAtual);

    for (const ucId of lista) {
      const jan = intersetar(janelaAtual, bal.janela.get(ucId)!);
      if (vazia(jan)) continue;
      const quartos = bal.quartos.get(chaveQuartos(ucId, g.tipo))!;
      const disponiveis = livres.filter((q) => quartos[q] > 0);
      if (disponiveis.length < g.nQuartos) continue;
      // Que desdobramentos usar é uma escolha com retrocesso: servir sempre os
      // mais carregados mantém-nos nivelados, mas quando o que sobra não encaixa
      // é preciso poder experimentar outra combinação em vez de desistir do
      // padrão — desistir empurrava a carga para o padrão de último recurso.
      const global = cargaGlobalDoQuarto(g.tipo);
      const soma = (c: number[], peso: number[]) => c.reduce((s, q) => s + peso[q], 0);
      // A carga da PRÓPRIA unidade curricular manda, e a global só desempata.
      // A razão é o fim da história: as formas só de TP juntam duas UCs com
      // desdobramentos DISJUNTOS, o que exige que o que resta a cada uma esteja
      // espalhado pelos quatro. Servir primeiro os desdobramentos mais cheios da
      // escola inteira deixa a UC escolhida com o resto todo amontoado nos
      // mesmos dois desdobramentos, e no fim ninguém tem o complemento de
      // ninguém — sobra carga que cabia perfeitamente.
      const opcoes = combinacoes(disponiveis, g.nQuartos).sort(
        (a, b) => soma(b, quartos) - soma(a, quartos) || soma(b, global) - soma(a, global),
      );

      const chave = chaveQuartos(ucId, g.tipo);
      for (const escolhidos of opcoes) {
        const novas: SessaoCandidata[] = [];
        for (const q of escolhidos) {
          quartos[q] -= 1;
          consumo.push({ chave, quarto: q });
          if (g.tipo === "TP") {
            novas.push({
              ucId,
              ucSigla: bal.ucSigla.get(ucId) ?? ucId,
              turma: mapa.tp(bal.fIdx, q),
              tipo: "TP",
            });
          } else {
            for (const nome of mapa.pl(bal.fIdx, q)) {
              novas.push({ ucId, ucSigla: bal.ucSigla.get(ucId) ?? ucId, turma: nome, tipo: "PL" });
            }
          }
        }
        sessoes.push(...novas);
        usados.add(ucId);

        if (escolher(k + 1, livres.filter((q) => !escolhidos.includes(q)), jan)) return true;

        usados.delete(ucId);
        sessoes.length -= novas.length;
        for (const q of escolhidos) {
          quartos[q] += 1;
          consumo.pop();
        }
      }
    }
    return false;
  };

  const todos: number[] = [];
  for (let q = 0; q < mapa.quartosPorFamilia; q++) todos.push(q);

  if (!escolher(0, todos, { primeira: 1, ultima: Number.MAX_SAFE_INTEGER })) return null;

  const resultado: Composicao = { sessoes: sessoes.slice(), janela, consumo: consumo.slice() };
  if (simular) desfazer(bal, resultado);
  return resultado;
}

/** Devolve ao balanço a procura que uma composição tinha consumido. */
function desfazer(bal: Balanco, c: Composicao): void {
  for (const { chave, quarto } of c.consumo) {
    const lista = bal.quartos.get(chave);
    if (lista) lista[quarto] += 1;
  }
  c.consumo.length = 0;
}

// ---------------------------------------------------------------------------
// 8. Confronto
// ---------------------------------------------------------------------------

const chaveSemana = (ano: number, familia: Familia, semana: number) => `${ano}|${familia}|${semana}`;

/**
 * Confronta o necessário com o disponível.
 *
 * O total responde "há espaço no ano?"; as semanas críticas respondem "há espaço
 * ONDE é preciso?". A procura de cada semana obtém-se repartindo cada conjunto
 * de blocos com as MESMAS semanas viáveis proporcionalmente aos dias úteis
 * dessas semanas — a mesma repartição por maiores restos que o resto do projeto
 * usa. Não é uma colocação: é a pressão mínima que aquela janela exerce.
 */
function confrontar(
  blocos: BlocoInventariado[],
  capacidade: Capacidade[],
  calendario: Map<number, SemanaAlocacao[]>,
  regras: ConfiguracaoMotor,
): Confronto {
  const necessario = blocos.length;
  const disponivelNoAlvo = capacidade.reduce((s, c) => s + c.alvoManchas, 0);
  const disponivelNoTeto = capacidade.reduce((s, c) => s + c.tetoManchas, 0);

  const diasPorSemana = new Map<string, number>();
  for (const [ano, semanas] of calendario) {
    for (const s of semanas) diasPorSemana.set(`${ano}|${s.global}`, s.dias.length);
  }

  const conjuntos = new Map<string, BlocoInventariado[]>();
  for (const b of blocos) {
    const k = `${b.ano}|${b.familia}|${b.semanasViaveis.join(".")}`;
    const lista = conjuntos.get(k) ?? [];
    lista.push(b);
    conjuntos.set(k, lista);
  }

  const procuraPorSemana = new Map<string, number>();
  for (const lista of conjuntos.values()) {
    const modelo = lista[0];
    const semanas = modelo.semanasViaveis;
    if (semanas.length === 0) continue;
    const quotas = distribuirBlocos(
      lista.length,
      semanas.map(
        (g) => ({ fator: (diasPorSemana.get(`${modelo.ano}|${g}`) ?? 0) / regras.grelha.dias.length }) as SemanaInfo,
      ),
    );
    semanas.forEach((g, i) => {
      const k = chaveSemana(modelo.ano, modelo.familia, g);
      procuraPorSemana.set(k, (procuraPorSemana.get(k) ?? 0) + (quotas[i] ?? 0));
    });
  }

  const semanasCriticas: SemanaCritica[] = [];
  let acimaDoTeto = false;
  for (const c of capacidade) {
    const p = procuraPorSemana.get(chaveSemana(c.ano, c.familia, c.semana)) ?? 0;
    if (p > c.tetoManchas) acimaDoTeto = true;
    if (p > c.alvoManchas) {
      semanasCriticas.push({ ano: c.ano, familia: c.familia, semana: c.semana, procura: p, teto: c.tetoManchas });
    }
  }
  semanasCriticas.sort((a, b) => a.ano - b.ano || a.familia.localeCompare(b.familia) || a.semana - b.semana);

  const folgaNoAlvo = disponivelNoAlvo - necessario;
  const folgaNoTeto = disponivelNoTeto - necessario;

  const veredicto: Confronto["veredicto"] =
    acimaDoTeto || folgaNoTeto < 0
      ? "nao cabe"
      : folgaNoAlvo < 0 || semanasCriticas.length > 0
        ? "cabe justo"
        : "cabe com folga";

  return {
    necessario,
    disponivelNoAlvo,
    disponivelNoTeto,
    folgaNoAlvo,
    folgaNoTeto,
    veredicto,
    semanasCriticas,
  };
}

// ---------------------------------------------------------------------------
// 9. Formatação para relatório
// ---------------------------------------------------------------------------

export function formatarInventario(inv: Inventario): string {
  const linhas: string[] = [];
  linhas.push("INVENTARIO DE BLOCOS");
  linhas.push("====================");
  linhas.push(`Blocos inventariados: ${inv.blocos.length}`);

  const porForma = new Map<FormaId, number>();
  for (const b of inv.blocos) porForma.set(b.forma, (porForma.get(b.forma) ?? 0) + 1);
  linhas.push("");
  linhas.push("Por forma");
  linhas.push("----------");
  for (const [id, n] of [...porForma].sort((a, b) => b[1] - a[1])) {
    linhas.push(`  ${String(id).padEnd(22)} ${String(n).padStart(5)}`);
  }

  linhas.push("");
  linhas.push("Por (ano, familia, semestre) e forma");
  linhas.push("-------------------------------------");
  const formas = [...porForma.keys()].sort();
  const grupos = new Map<string, Map<FormaId, number>>();
  for (const b of inv.blocos) {
    const k = `${b.ano}|${b.familia}|${b.semestre}`;
    const m = grupos.get(k) ?? new Map<FormaId, number>();
    m.set(b.forma, (m.get(b.forma) ?? 0) + 1);
    grupos.set(k, m);
  }
  linhas.push(`  ${"ano/fam/sem".padEnd(14)}${"total".padStart(7)}  ${formas.map((p) =>p.padStart(20)).join("")}`);
  for (const [k, m] of [...grupos].sort()) {
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    linhas.push(
      `  ${k.replace(/\|/g, "/").padEnd(14)}${String(total).padStart(7)}  ` +
        formas.map((p) =>String(m.get(p) ?? 0).padStart(20)).join(""),
    );
  }

  linhas.push("");
  linhas.push("Emparelhamento de grupos de praticas, por janela letiva");
  linhas.push("-------------------------------------------------------");
  for (const e of inv.emparelhamentos) {
    linhas.push(
      `  ano ${e.ano} familia ${e.familia} semanas ${e.primeira}-${e.ultima}: ${e.trios} grupos ` +
        `(o maior contribuinte traz ${e.triosDaUCdominante}); limite de pares ${e.limiteDePares}; ` +
        `pares ${e.pares}; sem parceiro ${e.semParceiro}${e.otimo ? "" : "  [NAO CERTIFICADO]"}` +
        (e.formaDoGrupoIsolado ? ` (forma ${e.formaDoGrupoIsolado})` : ""),
    );
    const comp = (Object.keys(e.porForma) as FormaId[])
      .sort()
      .map((p) => `${p} ${e.porForma[p]}`)
      .join(", ");
    if (comp !== "") linhas.push(`      inventariados: ${comp}`);
  }

  linhas.push("");
  linhas.push("Capacidade por semana");
  linhas.push("---------------------");
  linhas.push(
    `  ${"ano/fam".padEnd(10)}${"sem".padStart(4)}${"dias".padStart(6)}${"alvo".padStart(6)}${"teto".padStart(6)}`,
  );
  for (const c of inv.capacidade) {
    linhas.push(
      `  ${`${c.ano}/${c.familia}`.padEnd(10)}${String(c.semana).padStart(4)}${String(c.diasUteis).padStart(6)}` +
        `${String(c.alvoManchas).padStart(6)}${String(c.tetoManchas).padStart(6)}`,
    );
  }

  const cf = inv.confronto;
  linhas.push("");
  linhas.push("CONFRONTO");
  linhas.push("---------");
  linhas.push(`  necessario           ${String(cf.necessario).padStart(6)}`);
  linhas.push(`  disponivel ao alvo   ${String(cf.disponivelNoAlvo).padStart(6)}  folga ${cf.folgaNoAlvo}`);
  linhas.push(`  disponivel ao teto   ${String(cf.disponivelNoTeto).padStart(6)}  folga ${cf.folgaNoTeto}`);
  linhas.push(`  VEREDICTO: ${cf.veredicto}`);
  if (cf.semanasCriticas.length > 0) {
    linhas.push(`  Semanas criticas (${cf.semanasCriticas.length}) — procura acima do alvo de carga diaria:`);
    for (const s of cf.semanasCriticas) {
      linhas.push(`    ano ${s.ano} familia ${s.familia} semana ${s.semana}: procura ${s.procura}, teto ${s.teto}`);
    }
  }

  if (inv.naoInventariada.length > 0) {
    linhas.push("");
    linhas.push(`Carga nao inventariada (${inv.naoInventariada.length})`);
    linhas.push("-----------------------");
    for (const n of inv.naoInventariada) {
      linhas.push(`  ${n.ucSigla} ${n.turma} ${n.tipo}: ${n.blocos} bloco(s) — ${n.motivo}`);
    }
  }

  if (inv.avisos.length > 0) {
    linhas.push("");
    linhas.push(`Avisos (${inv.avisos.length})`);
    linhas.push("-------");
    for (const a of inv.avisos) linhas.push(`  ${a}`);
  }

  return linhas.join("\n");
}
