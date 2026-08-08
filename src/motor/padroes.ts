/**
 * FORMAS DE BLOCO A 100% — a REGRA GERAL, não uma lista de padrões.
 *
 * Até aqui um bloco só era válido se CORRESPONDESSE a um dos seis padrões
 * enumerados na configuração. A lista era a fonte de verdade e as formas eram
 * dados. Passou a ser ao contrário: a fonte de verdade são LIMITES, e as formas
 * são a CONSEQUÊNCIA aritmética desses limites.
 *
 * ------------------------------------------------------------------------
 * A REGRA GERAL
 * ------------------------------------------------------------------------
 * Um bloco é válido se, e só se:
 *
 *  1. cobre exatamente as folhas-aluno de uma turma teórica (`coberturaFolhas`);
 *  2. traz no máximo `maxTPporUC` aulas TP da MESMA unidade curricular,
 *     contando o BLOCO INTEIRO (as duas famílias e os outros anos);
 *  3. traz no máximo `maxPLporUC` aulas PL da MESMA unidade curricular, com o
 *     mesmo âmbito;
 *  4. nunca junta TP e PL da mesma unidade curricular;
 *  5. cumpre todas as restantes restrições do registo (`restricoes.ts`).
 *
 * Os pontos 2, 3 e 4 vivem UMA só vez, como restrições duras em
 * `restricoes.ts`. Este ficheiro não os reimplementa: usa-os para DERIVAR a
 * lista de formas que o gerador de candidatos tem de experimentar, e para dar a
 * cada forma um nome legível e um custo de preferência.
 *
 * ------------------------------------------------------------------------
 * O QUE OS LIMITES ELIMINAM E O QUE PASSAM A PERMITIR
 * ------------------------------------------------------------------------
 * Com `maxTPporUC = 2` e `maxPLporUC = 3` (os supletivos de toda a escola),
 * desaparecem por aritmética as formas com 4 TP da mesma UC, com 6 PL da mesma
 * UC e com 3 TP da mesma UC — o antigo "último recurso" deixa de existir. E
 * passam a existir formas que a lista não enumerava: `TP2+TP1+TP1`,
 * `TP1+TP1+TP1+TP1`, `TP2+TP1+PL3`, e todas as outras que fechem as folhas
 * dentro dos limites.
 *
 * ------------------------------------------------------------------------
 * `padroesAtivos` — RETROCOMPATIBILIDADE
 * ------------------------------------------------------------------------
 * A lista de padrões continua a poder existir na configuração (o Supabase ainda
 * a traz). Passou a ser SÓ PREFERÊNCIA: os custos que declara são usados como
 * âncoras da hierarquia (ver `custosDeForma`), e a marca `ativo` NUNCA veta
 * seja o que for. Um padrão desativado não impede um bloco: se os limites o
 * permitem, o bloco é legal.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO valores de negócio literais: os limites e a estrutura de turmas vêm
 *     da `ConfiguracaoMotor`. Os únicos números escritos aqui são ESCALÕES
 *     RELATIVOS de preferência, no bloco `ESCALAO_FORMA`, com a razão de cada um.
 */

import type { ConfiguracaoMotor, EstruturaTurmas, IdPadraoBloco } from "../regras/esquema";
import type { SessaoCandidata } from "./estado";
import type { UC } from "../types";

// ---------------------------------------------------------------------------
// 1. Vocabulário
// ---------------------------------------------------------------------------

/**
 * Nome canónico de uma forma de bloco, DERIVADO da composição — nunca escolhido
 * de uma lista. Exemplos: `T1`, `TP2+PL3+PL3`, `TP2+TP1+TP1`, `TP1+TP1+PL3+PL3`.
 * Cada termo é um grupo de uma unidade curricular DIFERENTE e diz quantas aulas
 * desse tipo essa unidade curricular traz.
 */
export type FormaId = string;

export interface FormaBloco {
  id: FormaId;
  /** Aulas teóricas (cada uma cobre a família inteira). */
  t: number;
  /** Um número por UC que entra com TP: quantas TP essa UC traz. */
  tp: number[];
  /** Um número por UC que entra com PL: quantas PL essa UC traz. */
  pl: number[];
}

/** Os limites de que as formas são consequência. Todos vêm das regras. */
export interface LimitesComposicao {
  /** Máximo de aulas TP da MESMA unidade curricular num bloco. */
  maxTPporUC: number;
  /** Máximo de aulas PL da MESMA unidade curricular num bloco. */
  maxPLporUC: number;
  /**
   * Capacidade física de aulas PL em simultâneo em toda a escola. Uma forma que
   * sozinha já a exceda nunca poderia ser legal em mancha nenhuma, e por isso
   * nem sequer é gerada — é uma poda estrutural, não uma regra nova.
   */
  maxPLporBloco: number;
}

/**
 * Os limites de composição em vigor, lidos das regras.
 *
 * `maxTPporUCporMancha` e `maxPLporUCporMancha` são os supletivos de TODA a
 * escola: uma UC pode declarar um valor mais baixo (e a restrição dura
 * `max-simultaneo-uc` fica com o mínimo dos dois), nunca mais alto. Sem regra
 * nenhuma, o limite degenera na própria estrutura de turmas — que é o mesmo que
 * não haver limite.
 */
export function limitesDaComposicao(regras: ConfiguracaoMotor): LimitesComposicao {
  const e = regras.estruturaTurmas;
  const folhas = e.tpPorTurmaTeorica * e.plPorTP;
  return {
    maxTPporUC: regras.capacidade.maxTPporUCporMancha ?? e.tpPorTurmaTeorica,
    maxPLporUC: regras.capacidade.maxPLporUCporMancha ?? folhas,
    maxPLporBloco: regras.capacidade.maxPLporMancha,
  };
}

// ---------------------------------------------------------------------------
// 2. Nome canónico de uma forma
// ---------------------------------------------------------------------------

const decrescente = (a: number, b: number) => b - a;

export function idDaForma(f: { t: number; tp: number[]; pl: number[] }): FormaId {
  if (f.t > 0 && f.tp.length === 0 && f.pl.length === 0) return `T${f.t}`;
  const termos = [
    ...(f.t > 0 ? [`T${f.t}`] : []),
    ...[...f.tp].sort(decrescente).map((n) => `TP${n}`),
    ...[...f.pl].sort(decrescente).map((n) => `PL${n}`),
  ];
  return termos.length === 0 ? "(vazio)" : termos.join("+");
}

// ---------------------------------------------------------------------------
// 3. Assinatura de um conjunto de sessões
// ---------------------------------------------------------------------------

export interface Assinatura {
  t: number;
  tp: number[];
  pl: number[];
  /**
   * A composição não é sequer uma forma de bloco: tem seminários, uma UC que o
   * catálogo desconhece, uma UC com TP e PL ao mesmo tempo, ou uma UC que junta
   * teórica com desdobramentos. Não é aqui que isso se veta — é em
   * `restricoes.ts`; aqui só se diz que não há nome canónico a dar.
   */
  invalida: boolean;
}

/**
 * Reduz um conjunto de sessões à sua forma: contagens por UC e por tipo,
 * esquecendo quais são as UCs e as turmas. Agrupar por UC garante que dois
 * termos do mesmo tipo são sempre de UCs diferentes.
 */
export function assinar(sessoes: SessaoCandidata[], ucPorId: Map<string, UC>): Assinatura {
  const a: Assinatura = { t: 0, tp: [], pl: [], invalida: false };
  const porUC = new Map<string, { T: number; TP: number; PL: number }>();

  for (const s of sessoes) {
    // Uma UC que o catálogo não conhece não pode ser classificada.
    if (!ucPorId.has(s.ucId)) a.invalida = true;
    if (s.tipo === "S") {
      // Um seminário não ocupa folhas-aluno: nenhum bloco a 100% o inclui.
      a.invalida = true;
      continue;
    }
    const c = porUC.get(s.ucId) ?? { T: 0, TP: 0, PL: 0 };
    c[s.tipo] += 1;
    porUC.set(s.ucId, c);
  }

  for (const c of porUC.values()) {
    if (c.TP > 0 && c.PL > 0) a.invalida = true;
    if (c.T > 0 && (c.TP > 0 || c.PL > 0)) a.invalida = true;
    a.t += c.T;
    if (c.TP > 0) a.tp.push(c.TP);
    if (c.PL > 0) a.pl.push(c.PL);
  }

  a.tp.sort(decrescente);
  a.pl.sort(decrescente);
  return a;
}

/**
 * A FORMA que estas sessões desenham, ou `null` quando a composição não é uma
 * forma de bloco. Serve para dar nome ao que emergiu — no relatório, no
 * inventário e no plano — nunca para autorizar ou recusar.
 */
export function formaDe(sessoes: SessaoCandidata[], ucPorId: Map<string, UC>): FormaId | null {
  if (sessoes.length === 0) return null;
  const a = assinar(sessoes, ucPorId);
  if (a.invalida) return null;
  return idDaForma(a);
}

// ---------------------------------------------------------------------------
// 4. Cobertura de folhas-aluno (a regra 1)
// ---------------------------------------------------------------------------

/**
 * Quantas folhas-aluno de uma turma teórica estas sessões cobrem.
 *
 * Uma T cobre a turma teórica inteira; uma TP cobre as folhas do seu
 * desdobramento; uma PL cobre uma folha; um seminário não conta para a
 * ocupação do bloco. Com a estrutura real (4 TP x 3 PL), 12 = 100%.
 */
export function coberturaFolhas(sessoes: SessaoCandidata[], estrutura: EstruturaTurmas): number {
  const folhasPorFamilia = estrutura.tpPorTurmaTeorica * estrutura.plPorTP;
  let total = 0;
  for (const s of sessoes) {
    if (s.tipo === "T") total += folhasPorFamilia;
    else if (s.tipo === "TP") total += estrutura.plPorTP;
    else if (s.tipo === "PL") total += 1;
  }
  return total;
}

// ---------------------------------------------------------------------------
// 5. As formas que os limites permitem
// ---------------------------------------------------------------------------

/** Partições de `n` em partes não crescentes, cada uma no máximo `maxParte`. */
function particoes(n: number, maxParte: number): number[][] {
  if (n === 0) return [[]];
  if (maxParte <= 0) return [];
  const saida: number[][] = [];
  for (let parte = Math.min(n, maxParte); parte >= 1; parte--) {
    for (const resto of particoes(n - parte, parte)) saida.push([parte, ...resto]);
  }
  return saida;
}

/**
 * TODAS as formas que fecham um bloco a 100% dentro dos limites — calculadas,
 * não enumeradas à mão.
 *
 * Um bloco cobre `tpPorTurmaTeorica` desdobramentos. Cada termo da forma é uma
 * unidade curricular DIFERENTE que ocupa alguns desses desdobramentos: com TP
 * (uma aula por desdobramento) ou com PL (as `plPorTP` turmas do desdobramento,
 * que andam sempre juntas). Os limites por UC traduzem-se diretamente em quantos
 * desdobramentos cada termo pode ocupar, e a forma sai da aritmética.
 *
 * A lista vem por ordem CRESCENTE de custo de preferência.
 */
export function formasPossiveis(
  estrutura: EstruturaTurmas,
  limites: LimitesComposicao,
  custos: CustosDeForma,
): FormaBloco[] {
  const desdobramentos = estrutura.tpPorTurmaTeorica;
  const plPorDesdobramento = estrutura.plPorTP;
  const maxDesdobramentosTP = Math.max(0, Math.min(limites.maxTPporUC, desdobramentos));
  const maxDesdobramentosPL = Math.max(
    0,
    Math.min(Math.floor(limites.maxPLporUC / Math.max(1, plPorDesdobramento)), desdobramentos),
  );

  const formas: FormaBloco[] = [];
  // A aula teórica cobre a família inteira: é a única forma com T.
  formas.push({ id: idDaForma({ t: 1, tp: [], pl: [] }), t: 1, tp: [], pl: [] });

  for (let comTP = desdobramentos; comTP >= 0; comTP--) {
    const comPL = desdobramentos - comTP;
    for (const partesTP of particoes(comTP, maxDesdobramentosTP)) {
      for (const partesPL of particoes(comPL, maxDesdobramentosPL)) {
        const pl = partesPL.map((n) => n * plPorDesdobramento);
        // Poda estrutural: uma forma que sozinha excede a capacidade física de
        // laboratórios da escola nunca poderia entrar em mancha nenhuma.
        if (pl.reduce((s, n) => s + n, 0) > limites.maxPLporBloco) continue;
        formas.push({ id: idDaForma({ t: 0, tp: partesTP, pl }), t: 0, tp: partesTP, pl });
      }
    }
  }

  return formas.sort(
    (a, b) => custoDaForma(a, custos) - custoDaForma(b, custos) || a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// 5.1 Composições PARCIAIS: ainda podem vir a fechar um bloco?
// ---------------------------------------------------------------------------

/**
 * Os grupos já formados cabem nos lugares de uma forma?
 *
 * Ambos os vetores vêm por ordem decrescente: atribuir o maior grupo ao maior
 * lugar é ótimo, porque os lugares só têm CAPACIDADE — nenhuma outra propriedade
 * os distingue. Se o maior grupo não couber no maior lugar, não cabe em nenhum.
 */
function cabeEm(atual: number[], lugares: number[]): boolean {
  if (atual.length > lugares.length) return false;
  return atual.every((v, i) => v <= lugares[i]);
}

/**
 * Esta composição PARCIAL ainda pode vir a fechar um bloco válido?
 *
 * É o predicado que substitui o antigo `prefixoValido`, e a diferença é de onde
 * vem a resposta. Dantes perguntava-se "isto é o princípio de algum dos seis
 * padrões da lista?". Agora pergunta-se "existe alguma FORMA — e as formas são a
 * consequência dos limites de TP e de PL por UC e das 12 folhas-aluno — em cujos
 * lugares esta composição ainda caiba?". A lista de formas deixou de ser escrita
 * à mão, mas continua a ser uma lista FINITA e pequena (com a estrutura real,
 * oito formas), por isso o corte antecipado que o alocador fazia continua a
 * existir e a custar o mesmo.
 *
 * Um exemplo do que muda: `TP+TP+TP` da mesma UC era um prefixo válido enquanto
 * existisse o padrão de 4 TP da mesma UC; com `maxTPporUC = 2` deixa de haver
 * forma nenhuma que o comporte, e o candidato é descartado à terceira sessão em
 * vez de à décima segunda folha.
 */
export function podeCompletarBloco(
  sessoes: SessaoCandidata[],
  ucPorId: Map<string, UC>,
  formas: FormaBloco[],
): boolean {
  if (sessoes.length === 0) return formas.length > 0;
  const a = assinar(sessoes, ucPorId);
  if (a.invalida) return false;
  return formas.some((f) => a.t <= f.t && cabeEm(a.tp, f.tp) && cabeEm(a.pl, f.pl));
}

// ---------------------------------------------------------------------------
// 6. Preferência entre formas (custo soft, nunca veto)
// ---------------------------------------------------------------------------

/**
 * Escalões de PREFERÊNCIA entre formas. São ordens relativas, não medidas.
 *
 * A hierarquia do coordenador: um bloco teórico é o mais barato (cobre a família
 * inteira com uma aula); a seguir vêm os blocos que levam DOIS grupos de
 * práticas de unidades curriculares diferentes — as práticas são o recurso
 * escasso e um bloco que leve dois grupos aproveita o dobro; depois os que levam
 * um só grupo; por fim os que não levam nenhum. Dentro de cada nível, menos
 * unidades curriculares distintas é melhor do que mais fragmentado.
 *
 * Quando a configuração declara custos para os padrões antigos, são ESSES que
 * mandam nas formas correspondentes (ver `custosDeForma`): estes escalões são o
 * que preenche as formas novas, que a lista antiga não nomeava.
 */
const ESCALAO_FORMA = {
  soTeorica: 0,
  duasPraticas: 10,
  umaPratica: 15,
  semPraticas: 20,
  /** Por cada grupo além dos dois primeiros: penaliza a fragmentação. */
  porGrupoAlemDeDois: 1,
} as const;

export interface CustosDeForma {
  /** Custos declarados nas regras, por forma. Retrocompatibilidade. */
  declarados: Map<FormaId, number>;
  soTeorica: number;
  duasPraticas: number;
  umaPratica: number;
  semPraticas: number;
  porGrupoAlemDeDois: number;
}

/**
 * As formas dos padrões que a configuração antiga enumerava. É a ÚNICA ponte
 * entre os ids antigos e as formas calculadas, e existe só para que os custos
 * que o coordenador afinou no Supabase continuem a mandar nas formas que já
 * nomeava. Nenhuma delas é um veto: as que os limites tornam impossíveis
 * (4 TP da mesma UC, 6 PL da mesma UC, 3 TP da mesma UC) simplesmente nunca são
 * geradas, e o custo que declaram nunca chega a ser consultado.
 */
const FORMAS_LEGADO: Record<string, { t: number; tp: number[]; pl: number[] }> = {
  T1: { t: 1, tp: [], pl: [] },
  TP2_PL3_PL3: { t: 0, tp: [2], pl: [3, 3] },
  TP2_DUAS_UCS: { t: 0, tp: [2, 2], pl: [] },
  TP4_MESMA_UC: { t: 0, tp: [4], pl: [] },
  TP2_PL6_DUAS_UCS: { t: 0, tp: [2], pl: [6] },
  TP3_PL3: { t: 0, tp: [3], pl: [3] },
  // Desdobramento ímpar: com as turmas TP repartidas 5+3 por duas docentes, a
  // que tem 5 nunca emparelha todas duas a duas e sobra sempre uma solta, que
  // só fecha o bloco com uma terceira unidade curricular.
  TP2_TP1_PL3: { t: 0, tp: [2, 1], pl: [3] },
  TP2_TP1_TP1: { t: 0, tp: [2, 1, 1], pl: [] },
};

export function custosDeForma(regras: ConfiguracaoMotor): CustosDeForma {
  const declarados = new Map<FormaId, number>();
  for (const p of regras.padroesBloco.padroes) {
    const legado = FORMAS_LEGADO[p.id as IdPadraoBloco];
    if (!legado) continue;
    const id = idDaForma(legado);
    // Quando dois padrões antigos desenham a mesma forma, prevalece o mais barato.
    const atual = declarados.get(id);
    if (atual === undefined || p.custo < atual) declarados.set(id, p.custo);
  }
  return {
    declarados,
    soTeorica: ESCALAO_FORMA.soTeorica,
    duasPraticas: ESCALAO_FORMA.duasPraticas,
    umaPratica: ESCALAO_FORMA.umaPratica,
    semPraticas: ESCALAO_FORMA.semPraticas,
    porGrupoAlemDeDois: ESCALAO_FORMA.porGrupoAlemDeDois,
  };
}

/** Custo de preferência de uma forma. Nunca um veto: só ordena as tentativas. */
export function custoDaForma(f: { t: number; tp: number[]; pl: number[] }, custos: CustosDeForma): number {
  const id = idDaForma(f);
  const declarado = custos.declarados.get(id);
  if (declarado !== undefined) return declarado;
  if (f.t > 0) return custos.soTeorica;
  const base =
    f.pl.length >= 2 ? custos.duasPraticas : f.pl.length === 1 ? custos.umaPratica : custos.semPraticas;
  const grupos = f.tp.length + f.pl.length;
  return base + Math.max(0, grupos - 2) * custos.porGrupoAlemDeDois;
}

/** Custo de preferência da forma que estas sessões desenham. */
export function custoDaComposicao(
  sessoes: SessaoCandidata[],
  ucPorId: Map<string, UC>,
  custos: CustosDeForma,
): number | null {
  const a = assinar(sessoes, ucPorId);
  if (a.invalida) return null;
  return custoDaForma(a, custos);
}
