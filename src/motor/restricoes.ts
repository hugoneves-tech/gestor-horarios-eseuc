/**
 * RESTRIÇÕES DO MOTOR — o registo único de tudo o que é proibido ou custa.
 *
 * Fase 3A da reescrita do motor. Ficheiro ADITIVO.
 *
 * PRINCÍPIO INEGOCIÁVEL: uma regra, um sítio. Cada restrição existe aqui UMA
 * única vez, como predicado puro sobre (estado, candidato, regras). O motor
 * antigo verificava `maxSimultaneo` em doze locais e o limite global de PL em
 * seis — implementações independentes da mesma regra, que divergiram e deram
 * origem aos bugs. Aqui não há segunda cópia: quem quiser saber se um candidato
 * é legal chama `primeiraViolacao`; quem quiser saber quanto custa chama
 * `custoTotal`.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados (vêm das regras e
 *     do catálogo de UCs).
 *  2. ZERO valores de negócio literais: limites, dias, horas, tetos e janelas
 *     vêm todos da `ConfiguracaoMotor` validada na Fase 2.
 *  3. Os únicos números escritos aqui são ESCALÕES RELATIVOS de custo soft, e
 *     estão todos no bloco `ESCALAO` abaixo, com a razão de cada um.
 */

import { horaParaMinutos } from "../regras/esquema";
import type {
  ConfiguracaoMotor,
  Familia,
  JanelaTipoAula,
  LimitesPorUC,
  Periodo,
  RegrasCargaDiaria,
  TipoAula,
} from "../regras/esquema";
import { criarHierarquia, ordemMomento, semanaDaOrdem } from "./estado";
import type { Candidato, EstadoHorario, Mancha, SessaoCandidata } from "./estado";
import {
  coberturaFolhas,
  custoDaComposicao,
  custosDeForma,
  formasPossiveis,
  limitesDaComposicao,
  podeCompletarBloco,
} from "./padroes";
import type { UC } from "../types";

// ---------------------------------------------------------------------------
// 1. Contrato
// ---------------------------------------------------------------------------

export interface ContextoRestricao {
  estado: EstadoHorario;
  candidato: Candidato;
  /** O tipo validado que sai de `src/regras/carregar.ts`. */
  regras: ConfiguracaoMotor;
  ucPorId: Map<string, UC>;
}

export interface Restricao {
  id: string;
  tipo: "hard" | "soft";
  descricao: string;
  /** hard: devolve o MOTIVO se for proibido, ou null se permitido. */
  verificar?(ctx: ContextoRestricao): string | null;
  /** soft: custo >= 0 (0 = ideal). Só para tipo "soft". */
  custo?(ctx: ContextoRestricao): number;
}

// ---------------------------------------------------------------------------
// 2. Escalões de custo soft
// ---------------------------------------------------------------------------

/**
 * Os custos soft são ESCALÕES, não medidas: o que importa é a ordem entre eles.
 *
 * O equilíbrio da carga semanal está duas ordens de grandeza acima de tudo o
 * resto por decisão explícita — foi a falta desse domínio que fez o motor
 * antigo amontoar semanas cheias ao lado de semanas vazias. A hierarquia de
 * padrões (0 a 1000) vem das regras, não daqui. As preferências de dia e de
 * turno ficam abaixo dos padrões, porque nunca devem impedir um bloco melhor.
 */
const ESCALAO = {
  /** Por cada bloco acima da média semanal da família. Dominante. */
  equilibrioSemanal: 1_000_000,
  /**
   * Composição que não fecha nenhuma forma nem pode vir a fechar uma. É um
   * custo, não um veto: quem PROÍBE são as restrições duras dos limites por UC.
   */
  formaImpossivel: 5_000,
  /** Bloco fora do turno (manhã/tarde) da família. */
  foraDoTurno: 400,
  /** Bloco no último dia útil, quando se prefere deixá-lo livre. */
  ultimoDiaUtil: 200,
  /** Por cada bloco acima da carga-alvo do dia (dia de 8h vs dia de 6h). */
  diaAcimaDoAlvo: 100,
} as const;

// ---------------------------------------------------------------------------
// 3. Auxiliares puros
// ---------------------------------------------------------------------------

const normalizar = (s: string): string => s.trim().toLocaleUpperCase("pt-PT");

/** Sessões do candidato agrupadas por (UC, tipo). */
function agruparPorUCeTipo(sessoes: SessaoCandidata[]): Map<string, { ucId: string; tipo: TipoAula; n: number }> {
  const mapa = new Map<string, { ucId: string; tipo: TipoAula; n: number }>();
  for (const s of sessoes) {
    const k = `${s.ucId}|${s.tipo}`;
    const atual = mapa.get(k);
    if (atual) atual.n += 1;
    else mapa.set(k, { ucId: s.ucId, tipo: s.tipo, n: 1 });
  }
  return mapa;
}

/**
 * Quantas sessões de uma UC/tipo já estão colocadas ANTES de um momento
 * cronológico (calendário: semana/dia/hora), para uma família. É a mesma
 * noção de "já colocadas" que `precedencias-uc` usa: cronológica, não a
 * ordem em que o alocador as foi experimentando. Um rácio que contasse pela
 * ordem de colocação do algoritmo dependeria dessa ordem para dar sempre o
 * mesmo veredicto — e deixaria de bater certo quando o horário final é
 * revalidado por ordem de calendário (que é como o validador o lê).
 */
function contarColocadasAntesDe(
  estado: EstadoHorario,
  ucId: string,
  tipo: "TP" | "PL",
  familia: Familia,
  ordemAlvo: number,
): number {
  return antesDe(estado.momentosDaFamilia(ucId, familia, tipo), ordemAlvo);
}

/**
 * Quantos momentos de uma lista ORDENADA são anteriores a `ordemAlvo`.
 * Pesquisa binária: estas contagens são feitas milhares de vezes por mancha.
 */
function antesDe(momentos: readonly number[], ordemAlvo: number): number {
  let baixo = 0;
  let alto = momentos.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    if (momentos[meio] < ordemAlvo) baixo = meio + 1;
    else alto = meio;
  }
  return baixo;
}

// ---------------------------------------------------------------------------
// 4. Construção do registo de restrições
// ---------------------------------------------------------------------------

/**
 * Constrói o registo de restrições para uma configuração. Tudo o que é fixo
 * para um dado conjunto de regras (índices, janelas, limites) é pré-calculado
 * aqui uma vez; os predicados devolvidos só olham para o estado e o candidato.
 */
export function construirRestricoes(regras: ConfiguracaoMotor): Restricao[] {
  const hierarquia = criarHierarquia(regras.estruturaTurmas);
  const grelha = regras.grelha;
  const bloco = grelha.duracaoBlocoHoras;

  const periodoDe = (hora: string): Periodo =>
    horaParaMinutos(hora) >= grelha.limiarTardeHora * 60 ? "tarde" : "manha";

  const fronteira = regras.calendario.fronteiraSemestre;
  const semestreDaSemana = (semana: number): number => (semana <= fronteira ? 1 : 2);
  /** Número da semana dentro do semestre — é assim que as regras a exprimem. */
  const semanaRelativa = (semana: number): number =>
    semana <= fronteira ? semana : semana - fronteira;

  // Janelas em modo veto, por tipo de aula.
  const janelasVeto = new Map<TipoAula, JanelaTipoAula>();
  for (const j of regras.janelasPorTipo) if (j.modo === "veto") janelasVeto.set(j.tipo, j);

  // Limites de simultaneidade declarados nas UCs (tabela `ucs`), por id e sigla.
  const limitesPorId = new Map<string, LimitesPorUC>();
  const limitesPorSigla = new Map<string, LimitesPorUC>();
  for (const l of regras.limitesPorUC) {
    if (l.ucId) limitesPorId.set(l.ucId, l);
    limitesPorSigla.set(normalizar(l.sigla), l);
  }

  // Conjuntos de salas com capacidade própria. É o mecanismo genérico que
  // substitui o "esta UC usa as salas de computadores" que o motor antigo tinha
  // amarrado a uma sigla literal: aqui a associação UC -> conjunto é dado.
  const poolsPreparados = regras.capacidade.poolsSala.map((p) => ({
    id: p.id,
    maxSimultaneo: p.maxSimultaneo,
    siglas: new Set(p.siglas.map(normalizar)),
  }));
  const siglasForaDoLimiteGlobal = new Set<string>(
    regras.capacidade.poolsSala
      .filter((p) => !p.contaParaMaximoGlobalPL)
      .flatMap((p) => p.siglas.map(normalizar)),
  );

  const diasPermitidosPL = new Set(regras.preferencias.diasPermitidosPL);

  // Conflitos entre UCs, nos dois sentidos.
  const conflitos = new Map<string, Set<string>>();
  for (const c of regras.conflitosUC) {
    const a = normalizar(c.siglaA);
    const b = normalizar(c.siglaB);
    if (!conflitos.has(a)) conflitos.set(a, new Set());
    if (!conflitos.has(b)) conflitos.set(b, new Set());
    conflitos.get(a)!.add(b);
    conflitos.get(b)!.add(a);
  }

  // Semanas de pausa letiva (semana zero: não recebem aulas). As semanas
  // personalizadas são numeradas dentro do semestre e não trazem o semestre a
  // que pertencem; quando o mesmo número chega marcado como pausa por um
  // semestre e como semana normal por outro, a informação é ambígua e não se
  // veta nada — mais vale deixar passar do que apagar uma semana boa.
  const totalPorNumero = new Map<number, number>();
  const pausasPorNumero = new Map<number, number>();
  for (const s of regras.calendario.semanasPersonalizadas) {
    totalPorNumero.set(s.numero, (totalPorNumero.get(s.numero) ?? 0) + 1);
    if (s.isPausa) pausasPorNumero.set(s.numero, (pausasPorNumero.get(s.numero) ?? 0) + 1);
  }
  const semanasDePausa = new Set<number>(
    [...pausasPorNumero.entries()]
      .filter(([numero, n]) => n === totalPorNumero.get(numero))
      .map(([numero]) => numero),
  );

  // AS FORMAS DE BLOCO SÃO CALCULADAS, NÃO ENUMERADAS. Saem dos limites de
  // composição (quantas TP e quantas PL da mesma UC cabem num bloco) e da
  // estrutura de turmas. A lista de padrões da configuração só entra como
  // hierarquia de PREFERÊNCIA, nunca como veto.
  const limitesComposicao = limitesDaComposicao(regras);
  const custosForma = custosDeForma(regras);
  const formas = formasPossiveis(regras.estruturaTurmas, limitesComposicao, custosForma);
  const folhasPorFamilia = regras.estruturaTurmas.tpPorTurmaTeorica * regras.estruturaTurmas.plPorTP;

  // -------------------------------------------------------------------------
  // Nomenclatura de turmas derivada da estrutura (nada literal).
  // -------------------------------------------------------------------------
  const estrutura = regras.estruturaTurmas;
  const nomeTP = (n: number) => `${estrutura.prefixos.tp}${n}`;
  const familiaDaTPporIndice = (n: number): Familia | undefined =>
    (["A", "B"] as const)[Math.floor((n - 1) / estrutura.tpPorTurmaTeorica)];
  const todasAsTP: string[] = [];
  for (let n = 1; n <= estrutura.turmasTeoricas * estrutura.tpPorTurmaTeorica; n++) todasAsTP.push(nomeTP(n));

  /**
   * Turmas TP que uma unidade curricular serve. Sai do catálogo (dado), e só na
   * ausência de declaração é que se assumem todas as turmas da estrutura. É o
   * universo sobre o qual o RITMO das TP se mede: uma UC que só tem TP numa das
   * famílias não pode ser acusada de estar desfasada da outra.
   */
  const cacheTurmasTP = new Map<string, string[]>();
  const turmasTPdaUC = (uc: UC | undefined, ucId: string): string[] => {
    const guardado = cacheTurmasTP.get(ucId);
    if (guardado) return guardado;
    const declaradas = new Set(
      (uc?.turmasConfig ?? [])
        .filter((t) => t.tipo === "TeoricoPratica")
        .map((t) => normalizar(t.nome)),
    );
    const lista =
      declaradas.size === 0 ? todasAsTP.slice() : todasAsTP.filter((n) => declaradas.has(normalizar(n)));
    const efetiva = lista.length === 0 ? todasAsTP.slice() : lista;
    cacheTurmasTP.set(ucId, efetiva);
    return efetiva;
  };

  /** Desdobramento (turma TP) a que uma turma PL pertence, pela estrutura. */
  const tpDaPL = (turmaPL: string): string | null => {
    if (!turmaPL.startsWith(estrutura.prefixos.pl)) return null;
    const m = Number(turmaPL.slice(estrutura.prefixos.pl.length));
    if (!Number.isFinite(m) || m <= 0) return null;
    return nomeTP(Math.ceil(m / estrutura.plPorTP));
  };

  // Tabelas de precedência escalonada, por sigla. Quando uma UC tem tabela, é a
  // tabela que manda e o rácio proporcional deixa de se lhe aplicar.
  const escaloesPorSigla = new Map<string, (typeof regras.precedenciasEscalonadas)[number]>();
  const escaloesGerais: (typeof regras.precedenciasEscalonadas)[number][] = [];
  for (const p of regras.precedenciasEscalonadas) {
    if (p.siglas.length === 0) escaloesGerais.push(p);
    else for (const s of p.siglas) escaloesPorSigla.set(normalizar(s), p);
  }
  const tabelaDe = (sigla: string, ano: number) => {
    const propria = escaloesPorSigla.get(normalizar(sigla));
    if (propria && (propria.anos.length === 0 || propria.anos.includes(ano))) return propria;
    return escaloesGerais.find((p) => p.anos.length === 0 || p.anos.includes(ano));
  };

  const cargaDe = (ano: number): RegrasCargaDiaria =>
    regras.cargaDiaria.porAno[ano] ?? regras.cargaDiaria.transversal;

  /** Família que fica de manhã nesta semana, se as regras o definirem. */
  const familiaDeManha = (semana: number): Familia | undefined => {
    const semestre = semestreDaSemana(semana);
    for (const e of regras.turnos.excecoes) {
      if (e.semestre === semestre && semana >= e.semanaInicio && semana <= e.semanaFim) {
        return e.familiaDeManha;
      }
    }
    return regras.turnos.familiaDeManhaPorSemestre[semestre];
  };

  const folhasDoCandidato = (c: Candidato): Set<string> => {
    const folhas = new Set<string>();
    for (const s of c.sessoes) for (const f of hierarquia.folhasDe(s.turma)) folhas.add(f);
    return folhas;
  };

  /**
   * Limite de sessões simultâneas de uma UC num bloco, por tipo. É a ÚNICA
   * definição deste limite no motor: junta o LIMITE UNIVERSAL da escola
   * (`maxTPporUCporMancha` / `maxPLporUCporMancha`) com o que a UC declara no
   * catálogo e com o que as regras declaram por UC.
   *
   * O mínimo dos três é o que vale — e é isso que faz cumprir, sem nenhum caso
   * particular, a decisão de que "uma UC pode declarar um valor mais baixo,
   * nunca mais alto": um valor declarado acima do universal simplesmente perde
   * para o universal.
   */
  const limiteDaUC = (uc: UC | undefined, ucId: string, tipo: "TP" | "PL"): number | null => {
    const candidatos: number[] = [];
    const doCatalogo = tipo === "TP" ? uc?.maxSimultaneoTP : uc?.maxSimultaneoPL;
    if (typeof doCatalogo === "number" && doCatalogo > 0) candidatos.push(doCatalogo);

    const daRegra =
      limitesPorId.get(ucId) ?? (uc ? limitesPorSigla.get(normalizar(uc.sigla)) : undefined);
    const valor = tipo === "TP" ? daRegra?.maxSimultaneoTP : daRegra?.maxSimultaneoPL;
    if (typeof valor === "number" && valor > 0) candidatos.push(valor);

    const universal =
      tipo === "TP" ? regras.capacidade.maxTPporUCporMancha : regras.capacidade.maxPLporUCporMancha;
    if (typeof universal === "number") candidatos.push(universal);

    return candidatos.length === 0 ? null : Math.min(...candidatos);
  };

  /**
   * Sessões desta UC/tipo já colocadas na mancha. O âmbito vem das regras:
   * `bloco` soma o bloco inteiro (Turma A + Turma B + outros anos), `turma`
   * conta só a família do candidato.
   */
  const jaNaMancha = (
    estado: EstadoHorario,
    m: Mancha,
    familia: Familia,
    ucId: string,
    tipo: "TP" | "PL",
  ): number => {
    if (regras.capacidade.ambitoContagem === "turma") {
      return estado.composicaoDaMancha(m, familia).get(ucId)?.[tipo] ?? 0;
    }
    return estado.contagemUCnaMancha(m, ucId, tipo);
  };

  const restricoes: Restricao[] = [];

  // -------------------------------------------------------------------------
  // HARD
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "sobreposicao",
    tipo: "hard",
    descricao: "A mesma turma (ou qualquer folha-aluno sua) não pode estar em dois sítios na mesma mancha.",
    verificar({ estado, candidato }) {
      const m = candidato.mancha;
      const vistas = new Map<string, string>();
      for (const s of candidato.sessoes) {
        for (const folha of hierarquia.folhasDe(s.turma)) {
          const anterior = vistas.get(folha);
          if (anterior !== undefined && anterior !== s.turma) {
            return `o grupo ${folha} ficaria em duas aulas ao mesmo tempo (${anterior} e ${s.turma}).`;
          }
          vistas.set(folha, s.turma);
        }
        if (estado.ocupado(m.ano, m.semana, s.turma, m.dia, m.hora)) {
          return `a turma ${s.turma} já tem aula na semana ${m.semana}, ${m.dia} às ${m.hora}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "janela-tipo-aula",
    tipo: "hard",
    descricao:
      "Cada tipo de aula só pode ocorrer nos dias/períodos da sua janela, quando a janela está em modo veto.",
    verificar({ candidato }) {
      const m = candidato.mancha;
      for (const s of candidato.sessoes) {
        const janela = janelasVeto.get(s.tipo);
        if (!janela) continue;
        const doDia = janela.janelas.find((j) => j.dia === m.dia);
        if (!doDia) {
          return `aulas ${s.tipo} não são permitidas à ${m.dia} (janela definida em ${janela.origem}).`;
        }
        if (doDia.horas.length > 0 && !doDia.horas.includes(m.hora)) {
          return `aulas ${s.tipo} à ${m.dia} só podem começar às ${doDia.horas.join(", ")}, não às ${m.hora}.`;
        }
        if (doDia.periodos.length > 0 && !doDia.periodos.includes(periodoDe(m.hora))) {
          return `aulas ${s.tipo} à ${m.dia} só são permitidas de ${doDia.periodos.join("/")}, e ${m.hora} é de ${periodoDe(m.hora)}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "capacidade-pl-mancha",
    tipo: "hard",
    descricao:
      "Capacidade física global de aulas PL em simultâneo numa mancha, em toda a escola. As UCs de conjuntos de salas declarados fora do limite global não contam.",
    verificar({ estado, candidato, ucPorId }) {
      const daMancha = (s: SessaoCandidata) =>
        siglasForaDoLimiteGlobal.has(normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla));
      const novas = candidato.sessoes.filter((s) => s.tipo === "PL" && !daMancha(s)).length;
      if (novas === 0) return null;
      let isentas = 0;
      if (siglasForaDoLimiteGlobal.size > 0) {
        for (const [ucId, uc] of ucPorId) {
          if (siglasForaDoLimiteGlobal.has(normalizar(uc.sigla))) {
            isentas += estado.contagemUCnaMancha(candidato.mancha, ucId, "PL");
          }
        }
      }
      const total = estado.plNaMancha(candidato.mancha) - isentas + novas;
      if (total > regras.capacidade.maxPLporMancha) {
        return `ficariam ${total} aulas PL em simultâneo em toda a escola, acima da capacidade de ${regras.capacidade.maxPLporMancha}.`;
      }
      return null;
    },
  });

  restricoes.push({
    id: "capacidade-pool-sala",
    tipo: "hard",
    descricao:
      "Capacidade própria de cada conjunto de salas (ex.: salas de informática em paralelo com os laboratórios).",
    verificar({ estado, candidato, ucPorId }) {
      for (const pool of poolsPreparados) {
        if (pool.siglas.size === 0) continue;
        const novas = candidato.sessoes.filter(
          (s) => s.tipo === "PL" && pool.siglas.has(normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla)),
        ).length;
        if (novas === 0) continue;
        let existentes = 0;
        for (const [ucId, uc] of ucPorId) {
          if (pool.siglas.has(normalizar(uc.sigla))) {
            existentes += estado.contagemUCnaMancha(candidato.mancha, ucId, "PL");
          }
        }
        if (existentes + novas > pool.maxSimultaneo) {
          return `o conjunto de salas ${pool.id} ficaria com ${existentes + novas} aulas em simultâneo, acima da sua capacidade de ${pool.maxSimultaneo}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "dias-permitidos-pl",
    tipo: "hard",
    descricao: "Quando as regras listam os dias em que as aulas PL podem ocorrer, fora deles é proibido.",
    verificar({ candidato }) {
      if (diasPermitidosPL.size === 0) return null;
      if (!candidato.sessoes.some((s) => s.tipo === "PL")) return null;
      if (!diasPermitidosPL.has(candidato.mancha.dia)) {
        return `as aulas PL só são permitidas em ${[...diasPermitidosPL].join(", ")}, e esta mancha é à ${candidato.mancha.dia}.`;
      }
      return null;
    },
  });

  restricoes.push({
    id: "capacidade-tp-mancha",
    tipo: "hard",
    descricao: "Máximo de aulas TP em simultâneo numa mancha, em toda a escola.",
    verificar({ estado, candidato, ucPorId }) {
      const max = regras.capacidade.maxTPporMancha;
      if (max === null) return null;
      const novas = candidato.sessoes.filter((s) => s.tipo === "TP").length;
      if (novas === 0) return null;
      let existentes = 0;
      for (const ucId of ucPorId.keys()) {
        existentes += estado.contagemUCnaMancha(candidato.mancha, ucId, "TP");
      }
      if (existentes + novas > max) {
        return `ficariam ${existentes + novas} aulas TP em simultâneo, acima do máximo de ${max}.`;
      }
      return null;
    },
  });

  restricoes.push({
    id: "max-simultaneo-uc",
    tipo: "hard",
    descricao:
      "Máximo de TP/PL da MESMA unidade curricular numa mancha, contando o BLOCO INTEIRO (Turma A + Turma B + " +
      "outros anos). É a restrição de que as formas de bloco são consequência: com o limite universal de 2 TP e " +
      "3 PL por UC, as composições com 4 TP, com 6 PL ou com 3 TP da mesma UC deixam de existir por aritmética.",
    verificar({ estado, candidato, ucPorId }) {
      for (const g of agruparPorUCeTipo(candidato.sessoes).values()) {
        if (g.tipo !== "TP" && g.tipo !== "PL") continue;
        const uc = ucPorId.get(g.ucId);
        const limite = limiteDaUC(uc, g.ucId, g.tipo);
        if (limite === null) continue;
        const total = jaNaMancha(estado, candidato.mancha, candidato.familia, g.ucId, g.tipo) + g.n;
        if (total > limite) {
          const nome = uc?.sigla ?? g.ucId;
          return `ficariam ${total} aulas ${g.tipo} de ${nome} na mesma mancha, acima do máximo de ${limite}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "tp-pl-mesma-uc",
    tipo: "hard",
    descricao:
      "TP e PL da mesma unidade curricular nunca partilham a mesma mancha (docente partilhado). DESLIGADA por " +
      "omissão: no horário de referência do coordenador as duas são dadas por docentes diferentes.",
    verificar({ estado, candidato, ucPorId }) {
      if (!regras.tpPLmesmaUC.ativo) return null;
      const grupos = agruparPorUCeTipo(candidato.sessoes);
      for (const g of grupos.values()) {
        if (g.tipo !== "TP" && g.tipo !== "PL") continue;
        const oposto: "TP" | "PL" = g.tipo === "TP" ? "PL" : "TP";
        const nome = ucPorId.get(g.ucId)?.sigla ?? g.ucId;
        if (grupos.has(`${g.ucId}|${oposto}`)) {
          return `o candidato junta ${g.tipo} e ${oposto} de ${nome} na mesma mancha.`;
        }
        if (estado.contagemUCnaMancha(candidato.mancha, g.ucId, oposto) > 0) {
          return `${nome} já tem ${oposto} nesta mancha; não pode ter também ${g.tipo}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "carga-diaria",
    tipo: "hard",
    descricao: "Teto de blocos por dia do estudante e número máximo de dias no teto por semana.",
    verificar({ estado, candidato }) {
      const m = candidato.mancha;
      const carga = cargaDe(m.ano);
      const maxBlocos = Math.floor(carga.maxHoras / bloco);
      if (maxBlocos <= 0) return null;
      for (const folha of folhasDoCandidato(candidato)) {
        const antes = estado.blocosNoDia(m.ano, m.semana, m.dia, folha);
        const depois = antes + 1;
        if (depois > maxBlocos) {
          return `o grupo ${folha} ficaria com ${depois * bloco}h em ${m.dia}, acima do teto de ${carga.maxHoras}h.`;
        }
        if (depois === maxBlocos && antes < maxBlocos) {
          const dias = estado.diasNoMaximo(m.ano, m.semana, folha, maxBlocos);
          if (dias + 1 > carga.maxDiasNoMaximoPorSemana) {
            return `o grupo ${folha} ficaria com ${dias + 1} dias de ${carga.maxHoras}h na semana ${m.semana}, acima do máximo de ${carga.maxDiasNoMaximoPorSemana}.`;
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "pausa-almoco",
    tipo: "hard",
    descricao: "As duas horas que protegem o almoço são mutuamente exclusivas para o mesmo grupo-aluno.",
    verificar({ estado, candidato }) {
      const pausa = grelha.pausaAlmoco;
      if (!pausa) return null;
      const m = candidato.mancha;
      const outra =
        m.hora === pausa.horaAntes ? pausa.horaDepois : m.hora === pausa.horaDepois ? pausa.horaAntes : null;
      if (!outra) return null;
      for (const s of candidato.sessoes) {
        if (estado.ocupado(m.ano, m.semana, s.turma, m.dia, outra)) {
          return `a turma ${s.turma} já tem aula às ${outra} em ${m.dia}; ocupar também as ${m.hora} eliminaria a pausa de almoço.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "precedencias-uc",
    tipo: "hard",
    descricao: "Precedências entre tipos de aula dentro da mesma UC (ex.: um mínimo de T antes da primeira TP).",
    verificar({ estado, candidato, ucPorId }) {
      const m = candidato.mancha;
      const ordemAlvo = ordemMomento(m.semana, m.dia, m.hora);
      for (const p of regras.precedencias) {
        if (p.anos.length > 0 && !p.anos.includes(m.ano)) continue;
        const minimo =
          p.unidade === "horas" ? Math.ceil(p.minimoAntes / bloco) : Math.ceil(p.minimoAntes);
        if (minimo <= 0) continue;
        const siglas = new Set(p.siglas.map(normalizar));
        for (const s of candidato.sessoes) {
          if (s.tipo !== p.tipoDepois) continue;
          const uc = ucPorId.get(s.ucId);
          const sigla = normalizar(uc?.sigla ?? s.ucSigla);
          if (siglas.size > 0 && !siglas.has(sigla)) continue;

          let anteriores: number;
          if (minimo === 1 && p.contagem === "porTurma" && p.tipoAntes !== "S") {
            const primeiro = estado.primeiroMomento(s.ucId, candidato.familia, p.tipoAntes);
            anteriores = primeiro !== undefined && primeiro < ordemAlvo ? 1 : 0;
          } else {
            anteriores = 0;
            for (const r of estado.sessoes()) {
              if (r.sessao.ucId !== s.ucId || r.sessao.tipo !== p.tipoAntes) continue;
              if (p.contagem === "porTurma" && r.familia !== candidato.familia) continue;
              if (ordemMomento(r.mancha.semana, r.mancha.dia, r.mancha.hora) < ordemAlvo) anteriores++;
            }
          }
          if (anteriores < minimo) {
            return `${sigla} precisa de ${minimo} bloco(s) de ${p.tipoAntes} antes da primeira ${p.tipoDepois} e só tem ${anteriores} (regra ${p.origem}).`;
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "ritmo-tp",
    tipo: "hard",
    descricao:
      "As turmas TP da mesma unidade curricular não podem divergir mais do que o desvio permitido entre si, em " +
      "NENHUM momento da ordem de calendário. O desvio mede-se em SEMANAS de atraso entre aulas homólogas, ou em " +
      "blocos de avanço, conforme `ritmoTP.unidade`.",
    /**
     * A verificação é sobre a SEQUÊNCIA INTEIRA, não sobre o instante em que o
     * bloco é colocado, e isso é deliberado.
     *
     * O alocador coloca por ordem de CUSTO, não por ordem de calendário: uma
     * colocação feita agora pode cair numa semana anterior a blocos que já
     * estão no horário. Uma verificação que só olhasse para "o que existe antes
     * deste momento" daria o veredicto certo no instante da decisão e o
     * veredicto errado no fim — foi exatamente esse o defeito que obrigou a
     * desligar o rácio proporcional (`racioTPPL`).
     *
     * A formulação usada aqui é equivalente ao invariante "em qualquer prefixo
     * cronológico, a turma mais adiantada não leva mais do que `maxDesvio`
     * blocos de avanço à mais atrasada", mas é INDEPENDENTE DA ORDEM em que as
     * colocações foram feitas: com as listas de momentos de cada turma já
     * ordenadas, há divergência excessiva se, e só se, existirem duas turmas i e
     * j e um inteiro c tais que a (c+D+1)-ésima aula de i acontece quando j
     * ainda só tem c. Verificado a cada inserção sobre a sequência completa, o
     * invariante vale também no horário final.
     */
    verificar({ estado, candidato, ucPorId }) {
      if (!regras.ritmoTP.ativo) return null;
      const porSemanas = regras.ritmoTP.unidade === "semanas";
      const desvio = regras.ritmoTP.maxDesvioBlocos;
      const desvioSemanas = regras.ritmoTP.maxDesvioSemanas;
      const m = candidato.mancha;
      const ordemAlvo = ordemMomento(m.semana, m.dia, m.hora);

      const novasPorUC = new Map<string, Map<string, number>>();
      for (const s of candidato.sessoes) {
        if (s.tipo !== "TP") continue;
        const daUC = novasPorUC.get(s.ucId) ?? new Map<string, number>();
        daUC.set(s.turma, (daUC.get(s.turma) ?? 0) + 1);
        novasPorUC.set(s.ucId, daUC);
      }

      for (const [ucId, novas] of novasPorUC) {
        const uc = ucPorId.get(ucId);
        const universo = turmasTPdaUC(uc, ucId).filter((turma) => {
          if (regras.ritmoTP.ambito === "uc") return true;
          return familiaDaTPporIndice(Number(turma.slice(estrutura.prefixos.tp.length))) === candidato.familia;
        });
        if (universo.length <= 1) continue;

        // Momentos de cada turma, com as sessões do candidato já inseridas.
        const listas = universo.map((turma) => {
          const base = estado.momentosDaTurma(ucId, turma, "TP");
          const quantas = novas.get(turma) ?? 0;
          if (quantas === 0) return base;
          const copia = base.slice();
          for (let i = 0; i < quantas; i++) {
            let k = copia.length;
            while (k > 0 && copia[k - 1] > ordemAlvo) k--;
            copia.splice(k, 0, ordemAlvo);
          }
          return copia;
        });

        for (let i = 0; i < listas.length; i++) {
          const avancada = listas[i];
          for (let j = 0; j < listas.length; j++) {
            if (i === j) continue;
            const atrasada = listas[j];
            if (porSemanas) {
              // A n-ésima aula de uma turma e a n-ésima aula de outra não podem
              // ficar a mais do que `desvioSemanas` semanas de distância. As
              // aulas que a turma atrasada ainda NÃO TEM não contam aqui: por
              // enquanto podem ainda vir a ser colocadas dentro da janela, e o
              // que fica por colocar no fim é défice, não desfasamento.
              const comuns = Math.min(avancada.length, atrasada.length);
              for (let c = 0; c < comuns; c++) {
                const semanaAvancada = semanaDaOrdem(avancada[c]);
                const semanaAtrasada = semanaDaOrdem(atrasada[c]);
                if (semanaAtrasada - semanaAvancada <= desvioSemanas) continue;
                const nome = uc?.sigla ?? ucId;
                return (
                  `${nome} teria a ${c + 1}.ª TP de ${universo[i]} na semana ${semanaAvancada} e a ${c + 1}.ª de ` +
                  `${universo[j]} só na semana ${semanaAtrasada}: ${semanaAtrasada - semanaAvancada} semanas de ` +
                  `atraso entre turmas TP, acima do máximo de ${desvioSemanas}.`
                );
              }
              continue;
            }
            for (let c = 0; c + desvio < avancada.length; c++) {
              // Quando a (c+desvio+1)-ésima aula da turma `i` acontece, a turma
              // `j` ainda só tem `c`: são `desvio + 1` blocos de avanço.
              if (atrasada.length > c && atrasada[c] <= avancada[c + desvio]) continue;
              const nome = uc?.sigla ?? ucId;
              return (
                `${nome} ficaria com ${c + desvio + 1} bloco(s) de TP em ${universo[i]} enquanto ${universo[j]} ` +
                `ainda só tem ${Math.min(c, atrasada.length)}: um avanço de ${desvio + 1} blocos entre turmas TP, ` +
                `acima do desvio máximo de ${desvio}.`
              );
            }
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "maratona-uc",
    tipo: "hard",
    descricao:
      "Dois tetos sobre a mesma unidade curricular no mesmo dia para o mesmo grupo: o de blocos SEGUIDOS e o do " +
      "TOTAL do dia. O segundo é o que proíbe o dia de 8h da mesma UC (seguidas de manhã mais outra à tarde).",
    verificar({ estado, candidato }) {
      if (!regras.maratonaUC.ativo) return null;
      const maxSeguidos = regras.maratonaUC.maxBlocosSeguidosMesmaUC;
      const maxPorDia = regras.maratonaUC.maxBlocosMesmaUCporDia;
      const m = candidato.mancha;
      const horas = grelha.horasInicio;
      const i = horas.indexOf(m.hora);
      if (i < 0) return null;

      for (const s of candidato.sessoes) {
        for (const folha of hierarquia.folhasDe(s.turma)) {
          // Uma só passagem pela grelha do dia: conta a corrida contígua à volta
          // da hora do candidato e o total do dia. O bloco a colocar ainda não
          // está no estado, por isso entra como +1 nas duas contas.
          let seguidos = 1;
          let noDia = 1;
          for (let k = i - 1; k >= 0; k--) {
            if (!estado.ucDaFolhaNaMancha({ ...m, hora: horas[k] }, folha, s.ucId)) break;
            seguidos++;
          }
          for (let k = i + 1; k < horas.length; k++) {
            if (!estado.ucDaFolhaNaMancha({ ...m, hora: horas[k] }, folha, s.ucId)) break;
            seguidos++;
          }
          for (let k = 0; k < horas.length; k++) {
            if (k === i) continue;
            if (estado.ucDaFolhaNaMancha({ ...m, hora: horas[k] }, folha, s.ucId)) noDia++;
          }
          if (seguidos > maxSeguidos) {
            return (
              `o grupo ${folha} ficaria com ${seguidos} blocos seguidos de ${s.ucSigla} em ${m.dia} ` +
              `(${seguidos * bloco}h de enfiada), acima do máximo de ${maxSeguidos} blocos.`
            );
          }
          if (noDia > maxPorDia) {
            return (
              `o grupo ${folha} ficaria com ${noDia} blocos de ${s.ucSigla} em ${m.dia} ` +
              `(${noDia * bloco}h no mesmo dia), acima do máximo de ${maxPorDia} blocos por dia.`
            );
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "precedencia-escalonada-pl",
    tipo: "hard",
    descricao:
      "Tabela por UC: para a n-ésima aula PL de um desdobramento, quantas T e quantas TP têm de estar dadas antes.",
    /**
     * Verifica-se a SEQUÊNCIA INTEIRA de PL do desdobramento, não só a aula que
     * se está a colocar — pela mesma razão que obrigou a formular assim o ritmo
     * das TP.
     *
     * A ordem de uma PL dentro do seu desdobramento é a posição CRONOLÓGICA, e
     * o alocador coloca por ordem de CUSTO: uma PL colocada agora pode cair
     * numa semana anterior a PL que já estão no horário, e empurra a ordem de
     * todas elas um degrau acima. Uma verificação que só olhasse para a aula do
     * candidato dava o veredicto certo no instante da decisão e o veredicto
     * errado no fim — era exatamente o defeito que deixava violações desta
     * regra no output final do alocador.
     *
     * Ao reavaliar todas as PL do desdobramento com o candidato já inserido, o
     * predicado é INDEPENDENTE DA ORDEM das colocações e o invariante que
     * verifica é o mesmo que o validador aplica ao horário completo.
     */
    verificar({ estado, candidato, ucPorId }) {
      if (regras.precedenciasEscalonadas.length === 0) return null;
      const m = candidato.mancha;
      const ordemAlvo = ordemMomento(m.semana, m.dia, m.hora);

      for (const s of candidato.sessoes) {
        if (s.tipo !== "PL") continue;
        const uc = ucPorId.get(s.ucId);
        const sigla = uc?.sigla ?? s.ucSigla;
        const tabela = tabelaDe(sigla, m.ano);
        if (!tabela) continue;

        // A sequência de PL deste desdobramento COM a aula do candidato já lá
        // dentro, em ordem cronológica.
        const existentes = estado.momentosDaTurma(s.ucId, s.turma, "PL");
        const posicao = antesDe(existentes, ordemAlvo);
        const sequencia = [...existentes.slice(0, posicao), ordemAlvo, ...existentes.slice(posicao)];

        // Aulas T da família e TP do desdobramento não mudam com esta colocação;
        // lêem-se uma vez e reutilizam-se em todos os degraus.
        const turmaTP = tpDaPL(s.turma);
        const momentosT = estado.momentosDaFamilia(s.ucId, candidato.familia, "T");
        const momentosTP = turmaTP
          ? estado.momentosDaTurma(s.ucId, turmaTP, "TP")
          : estado.momentosDaFamilia(s.ucId, candidato.familia, "TP");

        for (let k = 0; k < sequencia.length; k++) {
          const ordemDaPL = k + 1;
          const escalao =
            tabela.escaloes.find((e) => ordemDaPL <= e.ateNesimaPL) ?? tabela.escaloes[tabela.escaloes.length - 1];
          if (!escalao) continue;
          const quando = sequencia[k];

          if (escalao.minimoT > 0) {
            const dadas = antesDe(momentosT, quando);
            if (dadas < escalao.minimoT) {
              return (
                `${sigla}: a ${ordemDaPL}.ª PL de ${s.turma} exige ${escalao.minimoT} aula(s) T dadas antes e só há ` +
                `${dadas} (tabela ${tabela.origem}).`
              );
            }
          }
          if (escalao.minimoTP > 0) {
            const dadas = antesDe(momentosTP, quando);
            if (dadas < escalao.minimoTP) {
              return (
                `${sigla}: a ${ordemDaPL}.ª PL de ${s.turma} exige ${escalao.minimoTP} aula(s) TP de ` +
                `${turmaTP ?? "do desdobramento"} dadas antes e só há ${dadas} (tabela ${tabela.origem}).`
              );
            }
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "racio-tp-pl",
    tipo: "hard",
    descricao:
      "Rácio proporcional: a percentagem de PL já dadas de uma UC (por família) nunca pode ultrapassar a " +
      "percentagem de TP já dadas, com a tolerância configurada. Substitui a verificação que só olhava para a " +
      "primeira PL.",
    verificar({ estado, candidato, ucPorId }) {
      if (!regras.racioTPPL.ativo) return null;
      const tolerancia = regras.racioTPPL.tolerancia;
      // Turmas TP e PL por família: a estrutura garante que todas as turmas
      // teóricas se desdobram da mesma forma, por isso o total por família é
      // sempre nº de turmas × blocos por turma, seja qual for a família.
      const nTPporFamilia = regras.estruturaTurmas.tpPorTurmaTeorica;
      const nPLporFamilia = nTPporFamilia * regras.estruturaTurmas.plPorTP;
      const m = candidato.mancha;
      const ordemAlvo = ordemMomento(m.semana, m.dia, m.hora);

      for (const g of agruparPorUCeTipo(candidato.sessoes).values()) {
        if (g.tipo !== "PL") continue;
        const uc = ucPorId.get(g.ucId);
        if (!uc) continue;
        // Quando a UC tem TABELA de precedência escalonada, é a tabela que manda:
        // é mais precisa (diz a ordem exata) e sobrepor-lhe o rácio proporcional
        // seria julgar a mesma coisa duas vezes com duas réguas diferentes.
        if (tabelaDe(uc.sigla, m.ano)) continue;

        const blocosTPporTurma = Math.floor((uc.cargaHorariaTP ?? 0) / bloco);
        const blocosPLporTurma = Math.floor((uc.cargaHorariaPratica ?? 0) / bloco);
        const tpTotal = nTPporFamilia * blocosTPporTurma;
        const plTotal = nPLporFamilia * blocosPLporTurma;
        // UC sem TP ou sem PL: não há rácio nenhum a proteger.
        if (tpTotal <= 0 || plTotal <= 0) continue;

        // Cronológico, não pela ordem em que o alocador as experimentou: a
        // PL do candidato conta sempre a seguir às TP que a antecedem no
        // calendário, mesmo que o algoritmo as tenha colocado depois.
        const tpColocadas = contarColocadasAntesDe(estado, g.ucId, "TP", candidato.familia, ordemAlvo);
        const plColocadas = contarColocadasAntesDe(estado, g.ucId, "PL", candidato.familia, ordemAlvo);
        const plDepois = plColocadas + g.n;

        // Comparação por multiplicação cruzada (em vez de dividir), para não
        // sofrer de arredondamento de vírgula flutuante nos dois lados:
        //   plDepois/plTotal > tpColocadas/tpTotal + tolerancia
        const excesso = plDepois * tpTotal - tpColocadas * plTotal - tolerancia * tpTotal * plTotal;
        if (excesso > 1e-9) {
          const pctTP = Math.round((tpColocadas / tpTotal) * 100);
          const pctPLdepois = Math.round((plDepois / plTotal) * 100);
          return `${uc.sigla} tem ${pctTP}% das TP dadas; esta PL levaria as PL a ${pctPLdepois}%.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "restricoes-uc",
    tipo: "hard",
    descricao: "Proibições por UC: dias, períodos, tipos de aula e semanas em que a aula não pode ocorrer.",
    verificar({ candidato, ucPorId }) {
      const m = candidato.mancha;
      const rel = semanaRelativa(m.semana);
      const periodo = periodoDe(m.hora);
      const semestreDaMancha = m.semana <= regras.calendario.fronteiraSemestre ? 1 : 2;
      for (const r of regras.restricoesUC) {
        if (r.anos.length > 0 && !r.anos.includes(m.ano)) continue;
        // Uma regra com `semestre` definido só vale nesse semestre. Sem isto, um veto
        // sobre "a semana 1" apanharia também a 1.ª semana do 2.º semestre.
        if (r.semestre != null && r.semestre !== semestreDaMancha) continue;
        if (r.semanasRestritas.length > 0 && !r.semanasRestritas.includes(rel)) continue;
        const siglas = new Set(r.siglas.map(normalizar));
        const restringeDias = r.diasProibidos.length > 0;
        const restringePeriodos = r.periodosProibidos.length > 0;
        const diaCoincide = r.diasProibidos.includes(m.dia);
        const periodoCoincide = r.periodosProibidos.includes(periodo);
        // Interpretação preservada do motor antigo: dias E períodos = interseção;
        // só um deles preenchido = vale isoladamente.
        const proibido =
          restringeDias && restringePeriodos ? diaCoincide && periodoCoincide : diaCoincide || periodoCoincide;
        if (!proibido) continue;
        for (const s of candidato.sessoes) {
          if (r.tipos.length > 0 && !r.tipos.includes(s.tipo)) continue;
          const sigla = normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla);
          if (siglas.size > 0 && !siglas.has(sigla)) continue;
          return `${sigla} não pode ter ${s.tipo} na semana ${rel}, ${m.dia} de ${periodo} (regra ${r.origem}).`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "conflitos-uc",
    tipo: "hard",
    descricao: "Pares de unidades curriculares que não podem partilhar a mesma mancha (docente ou sala comum).",
    verificar({ estado, candidato, ucPorId }) {
      if (conflitos.size === 0) return null;
      const presentes = new Set<string>();
      for (const sigla of estado.siglasNaMancha(candidato.mancha)) presentes.add(normalizar(sigla));
      const doCandidato = new Set(
        candidato.sessoes.map((s) => normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla)),
      );
      for (const a of doCandidato) {
        const incompativeis = conflitos.get(a);
        if (!incompativeis) continue;
        for (const b of incompativeis) {
          if (presentes.has(b) || (doCandidato.has(b) && b !== a)) {
            return `${a} e ${b} não podem partilhar a mesma mancha.`;
          }
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "janela-letiva-uc",
    tipo: "hard",
    descricao: "A semana tem de estar dentro da janela letiva declarada pela UC (semestre, semanas e semanas de PL).",
    verificar({ candidato, ucPorId }) {
      const m = candidato.mancha;
      const semestre = semestreDaSemana(m.semana);
      const rel = semanaRelativa(m.semana);
      for (const s of candidato.sessoes) {
        const uc = ucPorId.get(s.ucId);
        if (!uc) return `a unidade curricular ${s.ucSigla} (${s.ucId}) não existe no catálogo.`;
        if (uc.semestre !== semestre) {
          return `${uc.sigla} é do ${uc.semestre}.º semestre e a semana ${m.semana} é do ${semestre}.º.`;
        }
        if (uc.semanaInicio !== undefined && rel < uc.semanaInicio) {
          return `${uc.sigla} só começa na semana ${uc.semanaInicio} do semestre e esta é a ${rel}.`;
        }
        if (uc.semanaFim !== undefined && rel > uc.semanaFim) {
          return `${uc.sigla} termina na semana ${uc.semanaFim} do semestre e esta é a ${rel}.`;
        }
        if (s.tipo === "PL" && uc.semanasPL && uc.semanasPL.length > 0 && !uc.semanasPL.includes(rel)) {
          return `${uc.sigla} só tem PL nas semanas ${uc.semanasPL.join(", ")} do semestre, não na ${rel}.`;
        }
      }
      return null;
    },
  });

  restricoes.push({
    id: "janela-calendario",
    tipo: "hard",
    descricao: "A semana tem de existir no calendário letivo: não pode ser de pausa nem estar além da última semana.",
    verificar({ candidato }) {
      const m = candidato.mancha;
      const max = regras.calendario.semanaMaximaGlobal;
      if (max !== null && m.semana > max) {
        return `a semana ${m.semana} está além da última semana letiva (${max}).`;
      }
      if (semanasDePausa.has(semanaRelativa(m.semana))) {
        return `a semana ${m.semana} é uma pausa letiva e não recebe aulas.`;
      }
      return null;
    },
  });

  // -------------------------------------------------------------------------
  // SOFT
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "equilibrio-semanal",
    tipo: "soft",
    descricao: "Penaliza colocar mais carga numa semana que já está acima da média da família. Custo dominante.",
    custo({ estado, candidato }) {
      const m = candidato.mancha;
      const semestre = semestreDaSemana(m.semana);
      const primeira = semestre === 1 ? 1 : fronteira + 1;
      const ultima =
        semestre === 1 ? fronteira : fronteira + Math.max(1, regras.calendario.semanasPorSemestre);
      const nSemanas = Math.max(1, ultima - primeira + 1);
      let total = 0;
      for (let w = primeira; w <= ultima; w++) {
        total += estado.manchasNaSemana(m.ano, candidato.familia, w);
      }
      const media = (total + 1) / nSemanas;
      const depois = estado.manchasNaSemana(m.ano, candidato.familia, m.semana) + 1;
      return Math.max(0, depois - media) * ESCALAO.equilibrioSemanal;
    },
  });

  restricoes.push({
    id: "forma-bloco",
    tipo: "soft",
    descricao:
      "Hierarquia de PREFERÊNCIA entre as formas de bloco que os limites permitem. Nunca um veto: a forma " +
      "preferida continua a ser a que leva dois grupos de práticas de UCs diferentes, e um bloco mais " +
      "fragmentado (mais UCs distintas) custa mais do que um menos fragmentado.",
    custo({ candidato, ucPorId }) {
      // Um candidato PARCIAL ainda não diz nada sobre a forma final: só se
      // pergunta se ainda pode vir a fechar alguma.
      if (coberturaFolhas(candidato.sessoes, regras.estruturaTurmas) < folhasPorFamilia) {
        return podeCompletarBloco(candidato.sessoes, ucPorId, formas) ? 0 : ESCALAO.formaImpossivel;
      }
      const custo = custoDaComposicao(candidato.sessoes, ucPorId, custosForma);
      return custo === null ? ESCALAO.formaImpossivel : custo;
    },
  });

  restricoes.push({
    id: "turno-familia",
    tipo: "soft",
    descricao: "Preferir o turno (manhã/tarde) que as regras atribuem à família, e as horas mais cedo dentro dele.",
    custo({ candidato }) {
      const m = candidato.mancha;
      const deManha = familiaDeManha(m.semana);
      const indice = grelha.horasInicio.indexOf(m.hora);
      const desempate = indice < 0 ? 0 : indice;
      if (deManha === undefined) return desempate;
      const esperaManha = deManha === candidato.familia;
      const ehManha = periodoDe(m.hora) === "manha";
      return (esperaManha === ehManha ? 0 : ESCALAO.foraDoTurno) + desempate;
    },
  });

  restricoes.push({
    id: "ultimo-dia-livre",
    tipo: "soft",
    descricao: "Quando se prefere deixar o último dia útil livre, penaliza os blocos colocados nesse dia.",
    custo({ candidato }) {
      if (!regras.preferencias.preferirSextaLivre) return 0;
      const ultimo = grelha.dias[grelha.dias.length - 1];
      return candidato.mancha.dia === ultimo ? ESCALAO.ultimoDiaUtil : 0;
    },
  });

  restricoes.push({
    id: "dia-acima-do-alvo",
    tipo: "soft",
    descricao: "Penaliza dias acima da carga-alvo do estudante (um dia de 8h custa mais do que um de 6h).",
    custo({ estado, candidato }) {
      const m = candidato.mancha;
      const carga = cargaDe(m.ano);
      const alvo = Math.floor(carga.alvoHoras / bloco);
      if (alvo <= 0) return 0;
      let pior = 0;
      for (const folha of folhasDoCandidato(candidato)) {
        const depois = estado.blocosNoDia(m.ano, m.semana, m.dia, folha) + 1;
        pior = Math.max(pior, depois - alvo);
      }
      return Math.max(0, pior) * ESCALAO.diaAcimaDoAlvo;
    },
  });

  return restricoes;
}

// ---------------------------------------------------------------------------
// 5. Avaliação
// ---------------------------------------------------------------------------

/** Devolve o motivo da PRIMEIRA restrição hard violada, ou null. */
export function primeiraViolacao(restricoes: Restricao[], ctx: ContextoRestricao): string | null {
  for (const r of restricoes) {
    if (r.tipo !== "hard" || !r.verificar) continue;
    const motivo = r.verificar(ctx);
    if (motivo) return `[${r.id}] ${motivo}`;
  }
  return null;
}

/** Soma dos custos soft. */
export function custoTotal(restricoes: Restricao[], ctx: ContextoRestricao): number {
  let total = 0;
  for (const r of restricoes) {
    if (r.tipo !== "soft" || !r.custo) continue;
    total += Math.max(0, r.custo(ctx));
  }
  return total;
}
