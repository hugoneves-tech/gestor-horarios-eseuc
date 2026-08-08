/**
 * ESTADO DO HORÁRIO — o único registo do que já foi colocado.
 *
 * Fase 3A da reescrita do motor. Este ficheiro é ADITIVO: não substitui nem
 * altera nada do motor antigo.
 *
 * Princípio: o estado é um LIVRO DE REGISTO, não um decisor. Não valida nada,
 * não conhece regras e não recusa colocações — limita-se a manter índices que
 * respondem, em tempo constante, às perguntas que as restrições (restricoes.ts)
 * e o alocador (Fase 3B) precisam de fazer. Toda a decisão vive em
 * `restricoes.ts`; toda a contabilidade vive aqui. Foi a mistura das duas
 * coisas que levou o motor antigo a verificar o mesmo limite em doze sítios.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO estrutura de turmas literal: quantas turmas existem, como se
 *     desdobram e que grupos-aluno ("folhas") cada uma cobre vem SEMPRE de
 *     `EstruturaTurmas`, validada na Fase 2.
 */

import { DIAS_UTEIS_PADRAO, horaParaMinutos, totalPL, totalTP } from "../regras/esquema";
import type { EstruturaTurmas, Familia, TipoAula } from "../regras/esquema";

// ---------------------------------------------------------------------------
// 1. Vocabulário
// ---------------------------------------------------------------------------

/**
 * Uma "mancha" é a unidade indivisível de tempo do horário: um bloco letivo
 * de um ano curricular, numa semana, num dia, a uma hora.
 */
export interface Mancha {
  ano: number;
  semana: number;
  dia: string;
  hora: string;
}

/** Uma aula a colocar: uma turma de uma UC, de um tipo. */
export interface SessaoCandidata {
  ucId: string;
  ucSigla: string;
  turma: string;
  tipo: "T" | "TP" | "PL" | "S";
}

/**
 * O que o alocador propõe de cada vez: um conjunto de sessões que ocupam a
 * MESMA mancha, para a MESMA família de turmas. Um candidato completo fecha o
 * bloco a 100% (ver `padroes.ts`); um candidato parcial é um prefixo.
 */
export interface Candidato {
  sessoes: SessaoCandidata[];
  mancha: Mancha;
  familia: "A" | "B";
}

/** Contagem de sessões de uma UC numa mancha, por tipo de aula. */
export interface ContagemPorTipo {
  T: number;
  TP: number;
  PL: number;
}

// ---------------------------------------------------------------------------
// 2. Ordem cronológica total
// ---------------------------------------------------------------------------

/**
 * Índice dos dias. Arranca pelos dias úteis genéricos (convenção do ensino
 * superior português, sem qualquer layout concreto) e vai registando por ordem
 * de aparecimento qualquer dia que a instituição acrescente à grelha, para que
 * a ordem seja total e determinística seja qual for a grelha configurada.
 */
const ordemDosDias = new Map<string, number>(DIAS_UTEIS_PADRAO.map((d, i) => [d, i]));

function indiceDia(dia: string): number {
  const conhecido = ordemDosDias.get(dia);
  if (conhecido !== undefined) return conhecido;
  const novo = ordemDosDias.size;
  ordemDosDias.set(dia, novo);
  return novo;
}

/**
 * Posição de um momento numa ordem cronológica TOTAL. Serve para exprimir
 * precedências ("a T tem de vir antes da TP") sem comparar tuplos à mão em
 * cada sítio. Números maiores são mais tarde.
 */
export function ordemMomento(semana: number, dia: string, hora: string): number {
  const minutos = horaParaMinutos(hora);
  return semana * 100000 + indiceDia(dia) * 1440 + (Number.isFinite(minutos) ? minutos : 0);
}

/**
 * A semana de volta, a partir de uma ordem de `ordemMomento`. Quem guarda listas
 * de momentos (o ritmo entre turmas TP, as precedências) não precisa de guardar
 * também a semana ao lado.
 */
export function semanaDaOrdem(ordem: number): number {
  return Math.floor(ordem / 100000);
}

// ---------------------------------------------------------------------------
// 3. Hierarquia de turmas (turma -> folhas-aluno)
// ---------------------------------------------------------------------------

/**
 * Uma FOLHA é um grupo-aluno indivisível: o subgrupo mais fino em que a turma
 * teórica se desdobra. Uma aula T ocupa todas as folhas da família; uma aula TP
 * ocupa as folhas do seu desdobramento; uma aula PL ocupa uma folha.
 *
 * É esta relação que permite ter UMA só verificação de sobreposição e UMA só
 * verificação de carga diária — no motor antigo a mesma hierarquia estava
 * reescrita à mão em seis sítios.
 */
export interface HierarquiaTurmas {
  /** Folhas cobertas por um nome de turma. Nome desconhecido = a própria. */
  folhasDe(turma: string): readonly string[];
  /** Família de uma turma, quando determinável pela estrutura. */
  familiaDe(turma: string): Familia | undefined;
  /** Todas as folhas de uma família. */
  folhasDaFamilia(familia: Familia): readonly string[];
}

/** Hierarquia degenerada: cada turma é a sua própria folha, sem famílias. */
export const HIERARQUIA_IDENTIDADE: HierarquiaTurmas = {
  folhasDe: (turma) => [turma],
  familiaDe: () => undefined,
  folhasDaFamilia: () => [],
};

const FAMILIAS_POR_INDICE: readonly Familia[] = ["A", "B"];

/**
 * Constrói a hierarquia a partir da estrutura declarada nas regras. Nada aqui
 * é específico de uma instituição: os nomes saem dos prefixos e dos nomes de
 * turma teórica configurados, e as proporções saem de `tpPorTurmaTeorica` e
 * `plPorTP`.
 */
export function criarHierarquia(estrutura: EstruturaTurmas): HierarquiaTurmas {
  const folhas = new Map<string, string[]>();
  const familias = new Map<string, Familia>();
  const porFamilia = new Map<Familia, string[]>();

  const nTP = totalTP(estrutura);
  const nPL = totalPL(estrutura);
  const familiaDeIndice = (i: number): Familia | undefined => FAMILIAS_POR_INDICE[i];

  // Folhas: as turmas do desdobramento mais fino (PL).
  const nomePL = (m: number) => `${estrutura.prefixos.pl}${m}`;
  for (let m = 1; m <= nPL; m++) {
    const tpPai = Math.ceil(m / estrutura.plPorTP);
    const fam = familiaDeIndice(Math.floor((tpPai - 1) / estrutura.tpPorTurmaTeorica));
    folhas.set(nomePL(m), [nomePL(m)]);
    if (fam) {
      familias.set(nomePL(m), fam);
      const lista = porFamilia.get(fam) ?? [];
      lista.push(nomePL(m));
      porFamilia.set(fam, lista);
    }
  }

  // Turmas TP: cada uma cobre as suas `plPorTP` folhas.
  for (let n = 1; n <= nTP; n++) {
    const nome = `${estrutura.prefixos.tp}${n}`;
    const primeiraPL = (n - 1) * estrutura.plPorTP + 1;
    const suas: string[] = [];
    for (let k = 0; k < estrutura.plPorTP; k++) suas.push(nomePL(primeiraPL + k));
    folhas.set(nome, suas);
    const fam = familiaDeIndice(Math.floor((n - 1) / estrutura.tpPorTurmaTeorica));
    if (fam) familias.set(nome, fam);
  }

  // Turmas teóricas: cobrem todas as folhas da família. Aceita-se tanto o nome
  // declarado (`nomesTurmasTeoricas`) como o nome derivado do prefixo, porque
  // as regras do Supabase usam as duas formas para o mesmo grupo.
  for (let i = 0; i < estrutura.turmasTeoricas; i++) {
    const fam = familiaDeIndice(i);
    const primeiraTP = i * estrutura.tpPorTurmaTeorica + 1;
    const suas: string[] = [];
    for (let n = 0; n < estrutura.tpPorTurmaTeorica; n++) {
      suas.push(...(folhas.get(`${estrutura.prefixos.tp}${primeiraTP + n}`) ?? []));
    }
    const nomes = new Set<string>([`${estrutura.prefixos.teorica}${i + 1}`]);
    const declarado = estrutura.nomesTurmasTeoricas[i];
    if (declarado) nomes.add(declarado);
    for (const nome of nomes) {
      folhas.set(nome, suas);
      if (fam) familias.set(nome, fam);
    }
  }

  return {
    folhasDe: (turma) => folhas.get(turma) ?? [turma],
    familiaDe: (turma) => familias.get(turma),
    folhasDaFamilia: (familia) => porFamilia.get(familia) ?? [],
  };
}

// ---------------------------------------------------------------------------
// 4. O estado
// ---------------------------------------------------------------------------

export interface EstadoHorario {
  /** A turma (ou qualquer folha sua) já está ocupada nesta mancha? */
  ocupado(ano: number, semana: number, turma: string, dia: string, hora: string): boolean;
  /** Blocos que esta folha-aluno tem neste dia. */
  blocosNoDia(ano: number, semana: number, dia: string, folha: string): number;
  /** Dias da semana em que esta folha já atingiu `maxBlocos`. */
  diasNoMaximo(ano: number, semana: number, folha: string, maxBlocos: number): number;
  /** Manchas distintas ocupadas por esta família nesta semana. */
  manchasNaSemana(ano: number, familia: "A" | "B", semana: number): number;
  /** Composição da mancha para uma família: por UC, quantas T/TP/PL. */
  composicaoDaMancha(m: Mancha, familia: "A" | "B"): Map<string, ContagemPorTipo>;
  /** GLOBAL: toda a escola, todos os anos, todas as famílias. */
  plNaMancha(m: Mancha): number;
  /** Bloco inteiro: Turma A + Turma B + outros anos. */
  contagemUCnaMancha(m: Mancha, ucId: string, tipo: "TP" | "PL"): number;
  /** Momento da primeira aula deste tipo desta UC para esta família. */
  primeiroMomento(ucId: string, familia: "A" | "B", tipo: "T" | "TP" | "PL"): number | undefined;
  /**
   * Momentos de TODAS as aulas deste tipo desta UC para esta família, por ordem
   * cronológica. Quem precisa de "quantas já foram dadas antes de X" faz uma
   * pesquisa binária — a contabilidade fica aqui, a decisão fica nas restrições.
   */
  momentosDaFamilia(ucId: string, familia: "A" | "B", tipo: "T" | "TP" | "PL"): readonly number[];
  /** O mesmo, para uma TURMA concreta: é o grão que o ritmo entre turmas exige. */
  momentosDaTurma(ucId: string, turma: string, tipo: "T" | "TP" | "PL"): readonly number[];
  /** Esta folha-aluno tem, nesta mancha, uma aula desta unidade curricular? */
  ucDaFolhaNaMancha(m: Mancha, folha: string, ucId: string): boolean;
  /** GLOBAL: siglas presentes na mancha, em toda a escola. */
  siglasNaMancha(m: Mancha): Set<string>;
  colocar(c: Candidato): void;
  remover(c: Candidato): void;
  sessoes(): ReadonlyArray<{ sessao: SessaoCandidata; mancha: Mancha; familia: "A" | "B" }>;
}

interface Registo {
  sessao: SessaoCandidata;
  mancha: Mancha;
  familia: Familia;
}

const chaveCarga = (ano: number, semana: number, folha: string) => `${ano}|${semana}|${folha}`;
const chaveFamilia = (ano: number, familia: Familia, semana: number) => `${ano}|${familia}|${semana}`;
const chaveMancha = (m: Mancha) => `${m.ano}|${m.semana}|${m.dia}|${m.hora}`;
const chaveGlobal = (m: Mancha) => `${m.semana}|${m.dia}|${m.hora}`;
const chaveUC = (m: Mancha, ucId: string, tipo: TipoAula) => `${chaveGlobal(m)}|${ucId}|${tipo}`;
const chaveMomento = (ucId: string, familia: Familia, tipo: TipoAula) => `${ucId}|${familia}|${tipo}`;
const chaveMomentoTurma = (ucId: string, turma: string, tipo: TipoAula) => `${ucId}|${turma}|${tipo}`;
const chaveFolhaUC = (m: Mancha, folha: string, ucId: string) =>
  `${m.ano}|${m.semana}|${m.dia}|${m.hora}|${folha}|${ucId}`;

const VAZIO: readonly number[] = [];

function somar(mapa: Map<string, number>, chave: string, delta: number): void {
  const novo = (mapa.get(chave) ?? 0) + delta;
  if (novo > 0) mapa.set(chave, novo);
  else mapa.delete(chave);
}

/** Inserção ordenada num vetor crescente (os momentos são poucos por chave). */
function inserirOrdenado(lista: number[], valor: number): void {
  let i = lista.length;
  while (i > 0 && lista[i - 1] > valor) i--;
  lista.splice(i, 0, valor);
}

/**
 * Cria um estado vazio.
 *
 * Sem hierarquia, cada turma é a sua própria folha — útil para testes e para
 * quem só precisa da contabilidade por nome de turma. O motor real deve passar
 * `criarHierarquia(regras.estruturaTurmas)`, para que uma aula T ocupe as
 * folhas todas da família e a carga diária do estudante seja contada bem.
 */
export function criarEstado(hierarquia: HierarquiaTurmas = HIERARQUIA_IDENTIDADE): EstadoHorario {
  const registos: Registo[] = [];

  /** ano|semana|folha -> dia -> hora -> nº de sessões. */
  const carga = new Map<string, Map<string, Map<string, number>>>();
  /** ano|familia|semana -> "dia|hora" -> nº de sessões. */
  const porFamiliaSemana = new Map<string, Map<string, number>>();
  /** mancha|familia -> ucId -> contagem por tipo. */
  const composicao = new Map<string, Map<string, ContagemPorTipo>>();
  /** semana|dia|hora -> nº de PL em toda a escola. */
  const plGlobal = new Map<string, number>();
  /** semana|dia|hora|ucId|tipo -> nº de sessões em toda a escola. */
  const ucGlobal = new Map<string, number>();
  /** semana|dia|hora -> sigla -> nº de sessões em toda a escola. */
  const siglasGlobal = new Map<string, Map<string, number>>();
  /** ucId|familia|tipo -> momentos, por ordem cronológica. */
  const momentos = new Map<string, number[]>();
  /** ucId|turma|tipo -> momentos, por ordem cronológica. */
  const momentosPorTurma = new Map<string, number[]>();
  /** ano|semana|dia|hora|folha|ucId -> nº de sessões dessa UC nessa folha e mancha. */
  const ucPorFolha = new Map<string, number>();

  const aplicar = (r: Registo, delta: 1 | -1): void => {
    const { sessao, mancha, familia } = r;

    // Carga por folha-aluno.
    for (const folha of hierarquia.folhasDe(sessao.turma)) {
      const kc = chaveCarga(mancha.ano, mancha.semana, folha);
      let dias = carga.get(kc);
      if (!dias) {
        if (delta < 0) continue;
        dias = new Map();
        carga.set(kc, dias);
      }
      let horas = dias.get(mancha.dia);
      if (!horas) {
        if (delta < 0) continue;
        horas = new Map();
        dias.set(mancha.dia, horas);
      }
      const n = (horas.get(mancha.hora) ?? 0) + delta;
      if (n > 0) horas.set(mancha.hora, n);
      else horas.delete(mancha.hora);
      if (horas.size === 0) dias.delete(mancha.dia);
      if (dias.size === 0) carga.delete(kc);
    }

    // Manchas ocupadas por família e semana.
    const kf = chaveFamilia(mancha.ano, familia, mancha.semana);
    let manchasDaFamilia = porFamiliaSemana.get(kf);
    if (!manchasDaFamilia && delta > 0) {
      manchasDaFamilia = new Map();
      porFamiliaSemana.set(kf, manchasDaFamilia);
    }
    if (manchasDaFamilia) {
      somar(manchasDaFamilia, `${mancha.dia}|${mancha.hora}`, delta);
      if (manchasDaFamilia.size === 0) porFamiliaSemana.delete(kf);
    }

    // Composição da mancha, por família e UC.
    if (sessao.tipo !== "S") {
      const km = `${chaveMancha(mancha)}|${familia}`;
      let ucs = composicao.get(km);
      if (!ucs && delta > 0) {
        ucs = new Map();
        composicao.set(km, ucs);
      }
      if (ucs) {
        const atual = ucs.get(sessao.ucId) ?? { T: 0, TP: 0, PL: 0 };
        atual[sessao.tipo] += delta;
        if (atual.T <= 0 && atual.TP <= 0 && atual.PL <= 0) ucs.delete(sessao.ucId);
        else ucs.set(sessao.ucId, atual);
        if (ucs.size === 0) composicao.delete(km);
      }
    }

    // Capacidade física global de PL (toda a escola).
    if (sessao.tipo === "PL") somar(plGlobal, chaveGlobal(mancha), delta);

    // Contagem por UC e tipo no bloco inteiro (todas as famílias, todos os anos).
    somar(ucGlobal, chaveUC(mancha, sessao.ucId, sessao.tipo), delta);

    // Siglas presentes na mancha (conflitos entre UCs, docente partilhado).
    const kg = chaveGlobal(mancha);
    let siglas = siglasGlobal.get(kg);
    if (!siglas && delta > 0) {
      siglas = new Map();
      siglasGlobal.set(kg, siglas);
    }
    if (siglas) {
      somar(siglas, sessao.ucSigla, delta);
      if (siglas.size === 0) siglasGlobal.delete(kg);
    }

    // Cronologia por UC/família/tipo e por UC/turma/tipo.
    if (sessao.tipo !== "S") {
      const ordem = ordemMomento(mancha.semana, mancha.dia, mancha.hora);
      const registarMomento = (mapa: Map<string, number[]>, chave: string) => {
        const lista = mapa.get(chave);
        if (delta > 0) {
          if (lista) inserirOrdenado(lista, ordem);
          else mapa.set(chave, [ordem]);
        } else if (lista) {
          const i = lista.indexOf(ordem);
          if (i >= 0) lista.splice(i, 1);
          if (lista.length === 0) mapa.delete(chave);
        }
      };
      registarMomento(momentos, chaveMomento(sessao.ucId, familia, sessao.tipo));
      registarMomento(momentosPorTurma, chaveMomentoTurma(sessao.ucId, sessao.turma, sessao.tipo));

      // Que unidade curricular ocupa cada folha-aluno em cada mancha: é o que
      // permite ver blocos SEGUIDOS da mesma UC sem percorrer o horário todo.
      for (const folha of hierarquia.folhasDe(sessao.turma)) {
        somar(ucPorFolha, chaveFolhaUC(mancha, folha, sessao.ucId), delta);
      }
    }
  };

  return {
    ocupado(ano, semana, turma, dia, hora) {
      for (const folha of hierarquia.folhasDe(turma)) {
        const n = carga.get(chaveCarga(ano, semana, folha))?.get(dia)?.get(hora) ?? 0;
        if (n > 0) return true;
      }
      return false;
    },

    blocosNoDia(ano, semana, dia, folha) {
      return carga.get(chaveCarga(ano, semana, folha))?.get(dia)?.size ?? 0;
    },

    diasNoMaximo(ano, semana, folha, maxBlocos) {
      if (maxBlocos <= 0) return 0;
      const dias = carga.get(chaveCarga(ano, semana, folha));
      if (!dias) return 0;
      let n = 0;
      for (const horas of dias.values()) if (horas.size >= maxBlocos) n++;
      return n;
    },

    manchasNaSemana(ano, familia, semana) {
      return porFamiliaSemana.get(chaveFamilia(ano, familia, semana))?.size ?? 0;
    },

    composicaoDaMancha(m, familia) {
      const ucs = composicao.get(`${chaveMancha(m)}|${familia}`);
      const copia = new Map<string, ContagemPorTipo>();
      if (ucs) for (const [ucId, c] of ucs) copia.set(ucId, { ...c });
      return copia;
    },

    plNaMancha(m) {
      return plGlobal.get(chaveGlobal(m)) ?? 0;
    },

    contagemUCnaMancha(m, ucId, tipo) {
      return ucGlobal.get(chaveUC(m, ucId, tipo)) ?? 0;
    },

    primeiroMomento(ucId, familia, tipo) {
      return momentos.get(chaveMomento(ucId, familia, tipo))?.[0];
    },

    momentosDaFamilia(ucId, familia, tipo) {
      return momentos.get(chaveMomento(ucId, familia, tipo)) ?? VAZIO;
    },

    momentosDaTurma(ucId, turma, tipo) {
      return momentosPorTurma.get(chaveMomentoTurma(ucId, turma, tipo)) ?? VAZIO;
    },

    ucDaFolhaNaMancha(m, folha, ucId) {
      return (ucPorFolha.get(chaveFolhaUC(m, folha, ucId)) ?? 0) > 0;
    },

    siglasNaMancha(m) {
      const mapa = siglasGlobal.get(chaveGlobal(m));
      return new Set(mapa ? mapa.keys() : []);
    },

    colocar(c) {
      for (const sessao of c.sessoes) {
        const r: Registo = { sessao, mancha: { ...c.mancha }, familia: c.familia };
        registos.push(r);
        aplicar(r, 1);
      }
    },

    remover(c) {
      for (const sessao of c.sessoes) {
        const i = registos.findIndex(
          (r) =>
            r.familia === c.familia &&
            r.sessao.ucId === sessao.ucId &&
            r.sessao.turma === sessao.turma &&
            r.sessao.tipo === sessao.tipo &&
            r.mancha.ano === c.mancha.ano &&
            r.mancha.semana === c.mancha.semana &&
            r.mancha.dia === c.mancha.dia &&
            r.mancha.hora === c.mancha.hora,
        );
        if (i < 0) continue;
        aplicar(registos[i], -1);
        registos.splice(i, 1);
      }
    },

    sessoes() {
      return registos;
    },
  };
}
