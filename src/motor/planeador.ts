/**
 * PLANEADOR SEMANAL — decide o MENU de cada semana antes de se disputarem horários.
 *
 * Fase 6A da reescrita. Ficheiro ADITIVO: acrescenta um nível ACIMA do alocador
 * e recolhe, sem os alterar, os utilitários de "o que há para dar" que até aqui
 * viviam dentro de `alocador.ts` (calendário, nomenclatura de turmas e procura).
 * O alocador passa a importá-los daqui, pelo que a dependência é de sentido
 * único: `alocador -> planeador`. Não há ciclo.
 *
 * ------------------------------------------------------------------------
 * O PROBLEMA
 * ------------------------------------------------------------------------
 * O ciclo de colocação escolhe, a cada passo, o bloco mais barato do momento.
 * Um guloso gasta cedo os recursos de que precisa tarde: consome o parceiro de
 * práticas que faltaria no fim, e carrega umas semanas mais do que outras.
 *
 * Este ficheiro responde à pergunta anterior — EM QUE SEMANA vive cada bloco —
 * antes de alguém escolher dias e horas. O resultado é um MENU por semana.
 *
 * ------------------------------------------------------------------------
 * O QUE ESTE FICHEIRO NÃO FAZ
 * ------------------------------------------------------------------------
 * NÃO decide QUE blocos existem nem de que são feitos: isso é uma consequência
 * das cargas e vem calculado do INVENTÁRIO (`inventario.ts`), que já traz cada
 * bloco com a composição exata e a lista de semanas em que o registo de
 * restrições o aceita. O planeador só sabe de CONTAGENS: quantos blocos há,
 * quantos dias úteis tem cada semana, e quantas manchas cabem em cada uma.
 *
 * NÃO reimplementa nenhuma restrição. Uma regra, um sítio.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO valores de negócio literais: padrões, estrutura de turmas, limites e
 *     calendário vêm todos da `ConfiguracaoMotor` e do catálogo de UCs.
 *
 * ------------------------------------------------------------------------
 * O ALGORITMO
 * ------------------------------------------------------------------------
 *  1. MENU. Os blocos do inventário, tal como vêm, com as suas semanas viáveis.
 *  2. DISTRIBUIÇÃO. Cada conjunto (semanas viáveis x padrão) é repartido pelas
 *     suas semanas PROPORCIONALMENTE AOS DIAS ÚTEIS de cada uma, pelo método dos
 *     maiores restos que o resto do projeto já usa (`distribuirBlocos`). Os
 *     conjuntos mais APERTADOS são servidos primeiro, e a repartição enche
 *     primeiro até à carga-ALVO em todas as semanas, usando a folga até ao teto
 *     só para o que não couber — é isso que impede que uma semana fique cheia ao
 *     lado de outra vazia.
 *  3. REVERSIBILIDADE. Se a colocação não conseguir arrumar uma mancha, chama
 *     `replanear(mancha)`: ela volta ao menu e é reposicionada noutra semana da
 *     sua lista — a menos carregada face ao alvo — em vez de se perder. Quando
 *     já não há semana, vira sobra explicada.
 */

import { calcularEndWeek, distribuirBlocos, mapearSemanasPedagogicasParaFisicas } from "../utils/distribuicao";
import type { SemanaInfo } from "../utils/distribuicao";
import { calcularSemanas } from "../utils/distribuicao";
import type { ConfiguracaoMotor, EstruturaTurmas, Familia, TipoAula } from "../regras/esquema";
import type { SessaoCandidata } from "./estado";
import type { FormaId } from "./padroes";
// Só o TIPO: é o inventário que depende do planeador (calendário, turmas,
// procura), e a dependência continua de sentido único. Quem o CONSTRÓI é o
// alocador, que o entrega já feito — daí entrar aqui como parâmetro.
import type { Inventario } from "./inventario";
import type {
  AnoLetivoSemestre,
  FeriadoInterrupcao,
  SemanaPersonalizada,
  SessaoHorario,
  UC,
} from "../types";

// ---------------------------------------------------------------------------
// 0. Entrada do motor (partilhada com o alocador)
// ---------------------------------------------------------------------------

export interface EntradaAlocacao {
  ucs: UC[];
  regras: ConfiguracaoMotor;
  feriados: FeriadoInterrupcao[];
  anosSemestres: AnoLetivoSemestre[];
  anoLetivo: string;
  /** Sessões importadas/fixadas: ocupam espaço e descontam carga. */
  sessoesFixas?: SessaoHorario[];
  /**
   * Planear o menu de cada semana antes de disputar horários (Fase 6A). Por
   * omissão, ligado. Desligar volta ao ciclo puramente guloso e serve para
   * medir a diferença — nunca para contornar uma regra.
   */
  planeamentoSemanal?: boolean;
}

// ---------------------------------------------------------------------------
// 1. Auxiliares partilhados
// ---------------------------------------------------------------------------

export const normalizar = (s: string): string => s.trim().toLocaleUpperCase("pt-PT");

export const FAMILIAS_POR_INDICE: readonly Familia[] = ["A", "B"];

/** Tradução do vocabulário do catálogo de UCs para o do motor. */
export const TIPO_DA_CONFIG: Readonly<Record<string, TipoAula>> = {
  "Teórica": "T",
  "TeoricoPratica": "TP",
  "Prática": "PL",
  "Seminário": "S",
};

export function cargaDaUC(uc: UC, tipo: TipoAula): number {
  if (tipo === "T") return uc.cargaHorariaTeorica ?? 0;
  if (tipo === "TP") return uc.cargaHorariaTP ?? 0;
  if (tipo === "PL") return uc.cargaHorariaPratica ?? 0;
  return uc.cargaHorariaS ?? 0;
}

// ---------------------------------------------------------------------------
// 2. Nomenclatura de turmas derivada da estrutura
// ---------------------------------------------------------------------------

/**
 * Os nomes das turmas saem SEMPRE da `EstruturaTurmas` validada: nada aqui sabe
 * quantas turmas existem nem como se chamam. Mantém-se a correspondência entre
 * o nome canónico (derivado do prefixo, ex. `T1`) e o nome de apresentação que
 * a instituição declarou (`nomesTurmasTeoricas`), porque as regras do Supabase
 * usam as duas formas para o mesmo grupo.
 */
export interface MapaTurmas {
  familias: Familia[];
  quartosPorFamilia: number;
  plPorQuarto: number;
  teorica(f: number): string;
  tp(f: number, quarto: number): string;
  pl(f: number, quarto: number): string[];
  canonico(nome: string): string;
  apresentacao(nome: string): string;
  familiaDe(nome: string): number | undefined;
}

export function criarMapaTurmas(e: EstruturaTurmas): MapaTurmas {
  const canonicos = new Map<string, string>();
  const apresentacoes = new Map<string, string>();
  const familiaPorCanonico = new Map<string, number>();
  const familias: Familia[] = [];

  const teorica = (f: number) => `${e.prefixos.teorica}${f + 1}`;
  const tp = (f: number, q: number) => `${e.prefixos.tp}${f * e.tpPorTurmaTeorica + q + 1}`;
  const pl = (f: number, q: number) => {
    const primeira = (f * e.tpPorTurmaTeorica + q) * e.plPorTP + 1;
    const nomes: string[] = [];
    for (let k = 0; k < e.plPorTP; k++) nomes.push(`${e.prefixos.pl}${primeira + k}`);
    return nomes;
  };

  for (let f = 0; f < e.turmasTeoricas; f++) {
    const fam = FAMILIAS_POR_INDICE[f];
    if (fam) familias.push(fam);
    const nomeCanonico = teorica(f);
    const declarado = e.nomesTurmasTeoricas[f];
    canonicos.set(normalizar(nomeCanonico), nomeCanonico);
    if (declarado) canonicos.set(normalizar(declarado), nomeCanonico);
    apresentacoes.set(nomeCanonico, declarado ?? nomeCanonico);
    familiaPorCanonico.set(nomeCanonico, f);
    for (let q = 0; q < e.tpPorTurmaTeorica; q++) {
      const nomeTP = tp(f, q);
      canonicos.set(normalizar(nomeTP), nomeTP);
      apresentacoes.set(nomeTP, nomeTP);
      familiaPorCanonico.set(nomeTP, f);
      for (const nomePL of pl(f, q)) {
        canonicos.set(normalizar(nomePL), nomePL);
        apresentacoes.set(nomePL, nomePL);
        familiaPorCanonico.set(nomePL, f);
      }
    }
  }

  return {
    familias,
    quartosPorFamilia: e.tpPorTurmaTeorica,
    plPorQuarto: e.plPorTP,
    teorica,
    tp,
    pl,
    canonico: (nome) => canonicos.get(normalizar(nome)) ?? nome,
    apresentacao: (nome) => apresentacoes.get(nome) ?? nome,
    familiaDe: (nome) => familiaPorCanonico.get(canonicos.get(normalizar(nome)) ?? nome),
  };
}

export function turmasDerivadas(mapa: MapaTurmas, tipo: TipoAula): string[] {
  const nomes: string[] = [];
  for (let f = 0; f < mapa.familias.length; f++) {
    if (tipo === "T" || tipo === "S") nomes.push(mapa.teorica(f));
    else if (tipo === "TP") for (let q = 0; q < mapa.quartosPorFamilia; q++) nomes.push(mapa.tp(f, q));
    else for (let q = 0; q < mapa.quartosPorFamilia; q++) nomes.push(...mapa.pl(f, q));
  }
  return nomes;
}

// ---------------------------------------------------------------------------
// 3. Calendário
// ---------------------------------------------------------------------------

export interface SemanaAlocacao {
  /** Semana GLOBAL do ano letivo (1..semanaMaximaGlobal). */
  global: number;
  semestre: number;
  /** Semana dentro do semestre — a numeração em que as regras e as UCs falam. */
  relativa: number;
  /** Dias com aulas nesta semana (feriados e pausas já descontados). */
  dias: string[];
  /** Data ISO de cada dia com aulas. */
  datas: Map<string, string>;
}

/**
 * Constrói o calendário POR ANO CURRICULAR: cada ano pode arrancar num dia
 * diferente do semestre (`dataInicioAnoN`), e é isso que faz, por exemplo, que
 * a primeira semana de um ano só tenha os últimos dias úteis.
 *
 * A numeração é a PEDAGÓGICA: as pausas letivas não recebem aulas e não
 * deslocam os números das semanas seguintes — é o que
 * `mapearSemanasPedagogicasParaFisicas` garante.
 */
export function construirCalendario(entrada: EntradaAlocacao, anos: number[]): Map<number, SemanaAlocacao[]> {
  const { regras } = entrada;
  const fronteira = regras.calendario.fronteiraSemestre;
  const maxGlobal = regras.calendario.semanaMaximaGlobal;
  const porAno = new Map<number, SemanaAlocacao[]>();

  const doAnoLetivo = entrada.anosSemestres.filter(
    (a) => a.anoLetivo === entrada.anoLetivo && (a.ativo === undefined || a.ativo),
  );

  for (const ano of anos) {
    const semanas: SemanaAlocacao[] = [];
    for (const semestre of [1, 2]) {
      const linha = doAnoLetivo.find((a) => a.semestre === semestre);
      if (!linha) continue;
      const personalizadas: SemanaPersonalizada[] = linha.semanasPersonalizadas ?? [];
      const inicio =
        (linha as unknown as Record<string, string | undefined>)[`dataInicioAno${ano}`] ??
        linha.dataInicioSemestre;
      if (!inicio) continue;
      const ultimaDeclarada = personalizadas.reduce((m, s) => Math.max(m, s.numero), 0);
      const ultima = ultimaDeclarada > 0 ? ultimaDeclarada : regras.calendario.semanasPorSemestre;
      const janela = mapearSemanasPedagogicasParaFisicas(1, ultima, personalizadas);
      const infos: SemanaInfo[] = calcularSemanas(
        inicio,
        janela.start,
        janela.end,
        entrada.feriados,
        personalizadas,
      );
      for (const info of infos) {
        const global = semestre === 1 ? info.numero : fronteira + info.numero;
        if (maxGlobal !== null && global > maxGlobal) continue;
        if (info.isPausa) continue;
        const dias = regras.grelha.dias.filter((d) => !info.diasBloqueados.includes(d));
        if (dias.length === 0) continue;
        const datas = new Map<string, string>();
        const base = new Date(`${info.dataSegunda}T00:00:00`);
        regras.grelha.dias.forEach((d, i) => {
          const data = new Date(base);
          data.setDate(base.getDate() + i);
          datas.set(
            d,
            `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`,
          );
        });
        semanas.push({ global, semestre, relativa: info.numero, dias, datas });
      }
    }
    semanas.sort((a, b) => a.global - b.global);
    porAno.set(ano, semanas);
  }
  return porAno;
}

/**
 * Quantas manchas uma semana comporta, para uma família.
 *
 * O TETO é o limite DURO: o mesmo que a restrição `carga-diaria` faz cumprir na
 * colocação — cada dia leva no máximo `maxHoras`, só `maxDiasNoMaximoPorSemana`
 * dias podem lá chegar, e os restantes ficam um bloco abaixo. Nunca passa do
 * número de blocos que a grelha tem por dia. Planear acima do teto é planear
 * para o lixo.
 *
 * O ALVO é a carga-alvo do estudante (ex.: 6h/dia): o que se quer de facto. O
 * teto é o que a regra TOLERA em cima disso, não o que se procura. É por isso
 * que a distribuição enche primeiro até ao alvo em todas as semanas e só depois
 * usa a folga até ao teto — encher uma semana até ao teto enquanto a semana ao
 * lado está abaixo do alvo satura os dias dessa semana e deixa sem lugar,
 * precisamente, as manchas que só ali podiam entrar.
 */
export function limitesDaSemana(
  regras: ConfiguracaoMotor,
  ano: number,
  diasUteis: number,
): { teto: number; alvo: number } {
  const carga = regras.cargaDiaria.porAno[ano] ?? regras.cargaDiaria.transversal;
  const bloco = regras.grelha.duracaoBlocoHoras;
  if (bloco <= 0 || diasUteis <= 0) return { teto: 0, alvo: 0 };
  const maxBlocos = Math.max(0, Math.floor(carga.maxHoras / bloco));
  if (maxBlocos === 0) return { teto: 0, alvo: 0 };
  const blocosPorDia = regras.grelha.horasInicio.length;
  const noMaximo = Math.min(Math.max(0, carga.maxDiasNoMaximoPorSemana), diasUteis);
  const teto = Math.min(
    noMaximo * maxBlocos + (diasUteis - noMaximo) * Math.max(0, maxBlocos - 1),
    diasUteis * blocosPorDia,
  );
  const alvoBlocos = Math.max(0, Math.floor(carga.alvoHoras / bloco));
  return { teto, alvo: Math.min(diasUteis * alvoBlocos, teto) };
}

// ---------------------------------------------------------------------------
// 4. A procura (a carga a colocar)
// ---------------------------------------------------------------------------

export interface ItemProcura {
  ucId: string;
  ucSigla: string;
  tipo: TipoAula;
  /** Nome canónico da turma. */
  turma: string;
  ano: number;
  familia: Familia;
  familiaIdx: number;
  semestre: number;
  /** Janela letiva em semanas GLOBAIS. */
  primeira: number;
  ultima: number;
  alvo: number;
  colocados: number;
}

export const chaveProcura = (ucId: string, tipo: TipoAula, turma: string) => `${ucId}|${tipo}|${turma}`;

/**
 * Converte o catálogo de UCs na carga a colocar, turma a turma, com a janela
 * letiva já em semanas GLOBAIS. É a única leitura das cargas horárias do motor:
 * o alocador e o planeador partilham exatamente esta contabilidade.
 */
export function construirProcura(
  entrada: EntradaAlocacao,
  mapa: MapaTurmas,
): { itens: Map<string, ItemProcura>; avisos: string[] } {
  const { regras, ucs } = entrada;
  const bloco = regras.grelha.duracaoBlocoHoras;
  const fronteira = regras.calendario.fronteiraSemestre;
  const avisos: string[] = [];
  const itens = new Map<string, ItemProcura>();

  for (const uc of ucs) {
    const semestre = uc.semestre;
    const linha = entrada.anosSemestres.find(
      (a) => a.anoLetivo === entrada.anoLetivo && a.semestre === semestre,
    );
    const personalizadas = linha?.semanasPersonalizadas ?? [];
    const inicioRel = uc.semanaInicio ?? 1;
    const fimRel =
      uc.semanaFim ??
      calcularEndWeek(inicioRel, uc.numSemanas ?? regras.calendario.semanasPorSemestre, personalizadas);
    const janela = mapearSemanasPedagogicasParaFisicas(inicioRel, fimRel, personalizadas);
    const desloc = semestre === 1 ? 0 : fronteira;

    const turmasConfig = uc.turmasConfig ?? [];
    const porTipo = new Map<TipoAula, string[]>();
    for (const t of turmasConfig) {
      const tipo = TIPO_DA_CONFIG[t.tipo];
      if (!tipo) continue;
      const lista = porTipo.get(tipo) ?? [];
      lista.push(mapa.canonico(t.nome));
      porTipo.set(tipo, lista);
    }

    for (const tipo of ["T", "TP", "PL", "S"] as TipoAula[]) {
      const horas = cargaDaUC(uc, tipo);
      if (horas <= 0) continue;
      const blocos = Math.floor(horas / bloco);
      if (blocos <= 0) continue;
      let turmas = porTipo.get(tipo);
      if (!turmas || turmas.length === 0) {
        turmas = turmasDerivadas(mapa, tipo);
        avisos.push(
          `${uc.sigla}: nenhuma turma de tipo ${tipo} declarada no catálogo; foram assumidas todas as turmas da estrutura (${turmas.length}).`,
        );
      }
      for (const turma of turmas) {
        const fIdx = mapa.familiaDe(turma);
        if (fIdx === undefined) {
          avisos.push(`${uc.sigla}: a turma "${turma}" não pertence à estrutura de turmas e foi ignorada.`);
          continue;
        }
        const familia = FAMILIAS_POR_INDICE[fIdx];
        if (!familia) continue;
        itens.set(chaveProcura(uc.id, tipo, turma), {
          ucId: uc.id,
          ucSigla: uc.sigla,
          tipo,
          turma,
          ano: uc.anoCurricular,
          familia,
          familiaIdx: fIdx,
          semestre,
          primeira: janela.start + desloc,
          ultima: janela.end + desloc,
          alvo: blocos,
          colocados: 0,
        });
      }
    }
  }

  return { itens, avisos };
}

// ---------------------------------------------------------------------------
// 5. Contrato público do plano
// ---------------------------------------------------------------------------

export interface ManchaPlaneada {
  /** Identidade estável: é por aqui que a colocação devolve a mancha ao plano. */
  id: number;
  ano: number;
  familia: Familia;
  semana: number;
  forma: FormaId;
  /** As sessões que compõem esta mancha (UC + turma + tipo), ainda SEM dia/hora. */
  sessoes: SessaoCandidata[];
  /**
   * Semanas GLOBAIS em que esta mancha pode viver — não um intervalo, mas a
   * LISTA que o registo de restrições aceita. Uma unidade curricular pode ter
   * as práticas fechadas a semanas soltas dentro da sua janela letiva, e supor
   * um intervalo contínuo punha manchas onde nunca poderiam entrar.
   */
  semanas: number[];
  /** Primeira e última das `semanas`, para leitura. */
  primeira: number;
  ultima: number;
}

export interface SobraPlaneada {
  ucSigla: string;
  turma: string;
  tipo: string;
  blocos: number;
  motivo: string;
}

export interface ResumoSemana {
  ano: number;
  familia: Familia;
  semana: number;
  /** Dias com aulas nesta semana: é o peso da distribuição. */
  diasUteis: number;
  /** Manchas que a distribuição proporcional atribuiu a esta semana. */
  alvo: number;
  porForma: Partial<Record<FormaId, number>>;
}

/**
 * Orçamento de um (ano, família) dentro de uma janela letiva — o "bloco de
 * semanas" de que fala o coordenador. É aqui que se lê quantos grupos de
 * práticas ficaram sem parceiro e, portanto, quantas manchas do padrão de
 * último recurso foram RESERVADAS.
 */
export interface OrcamentoBloco {
  ano: number;
  familia: Familia;
  primeira: number;
  ultima: number;
  porForma: Partial<Record<FormaId, number>>;
  /** Grupos de PL a colocar nesta janela, somando todas as UCs. */
  gruposPL: number;
  /** Grupos da unidade curricular com mais práticas (a que não emparelha toda). */
  gruposDaUCdominante: number;
  /** Pares de grupos de UCs DIFERENTES que é possível formar. */
  paresPossiveis: number;
  /** Grupos que sobram sem parceiro: a quota reservada do padrão de grupo isolado. */
  quotaSemParceiro: number;
  /** O padrão que fecha um grupo isolado, quando existe um ativo. */
  formaDoGrupoIsolado: FormaId | null;
}

export interface PlanoSemanal {
  manchas: ManchaPlaneada[];
  /** Carga que não coube no plano, com a razão. */
  sobras: SobraPlaneada[];
  /** Diagnóstico por semana: quantas manchas de cada padrão. */
  resumo: ResumoSemana[];
  /** O orçamento de que o plano saiu, por (ano, família, janela letiva). */
  orcamentos: OrcamentoBloco[];
  /** Avisos herdados da leitura do catálogo. */
  avisos: string[];

  /** Manchas ainda por colocar numa semana, pela ordem em que devem ser tentadas. */
  pendentes(ano: number, familia: Familia, semana: number): ManchaPlaneada[];
  /** A mancha foi colocada: sai do menu. */
  confirmar(mancha: ManchaPlaneada): void;
  /**
   * A colocação não conseguiu arrumar a mancha: ela volta ao orçamento e é
   * reposicionada na semana menos carregada da sua janela que ainda não foi
   * tentada. Devolve a mancha com a semana nova, ou `null` quando já não há
   * semana — e nesse caso passa a sobra explicada.
   */
  replanear(mancha: ManchaPlaneada): ManchaPlaneada | null;
}

// ---------------------------------------------------------------------------
// 6. O planeador
// ---------------------------------------------------------------------------

/**
 * @param inventario A lista de blocos que existem, com a composição exata e as
 *   semanas em que cada um pode viver. Vem já feito de fora — é o alocador que o
 *   constrói, com o registo COMPLETO de restrições, para que a dependência entre
 *   planeador e inventário continue de sentido único.
 */
export function planear(
  entrada: EntradaAlocacao,
  regras: ConfiguracaoMotor,
  inventario: Inventario,
): PlanoSemanal {
  const mapa = criarMapaTurmas(regras.estruturaTurmas);
  const anos = [...new Set(entrada.ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);
  const calendario = construirCalendario(entrada, anos);

  const avisos = [...inventario.avisos];
  const sobras: SobraPlaneada[] = [];

  // -------------------------------------------------------------------------
  // O MENU SAI DO INVENTÁRIO
  //
  // Que blocos existem, de que são feitos e em que semanas podem viver é uma
  // CONSEQUÊNCIA das cargas — não uma descoberta a fazer pelo caminho. O
  // inventário responde a isso antes de o planeador abrir o calendário, e o
  // planeador limita-se a REPARTI-LOS pelas semanas. Uma conta, um sítio: se o
  // inventário e o plano discordassem sobre quantos blocos há, um dos dois
  // estaria a inventar carga.
  // -------------------------------------------------------------------------

  const manchas: ManchaPlaneada[] = inventario.blocos.map((b) => ({
    id: b.id,
    ano: b.ano,
    familia: b.familia,
    semana: 0,
    forma: b.forma,
    sessoes: b.sessoes,
    semanas: b.semanasViaveis,
    primeira: b.semanasViaveis[0],
    ultima: b.semanasViaveis[b.semanasViaveis.length - 1],
  }));

  for (const n of inventario.naoInventariada) {
    sobras.push({ ucSigla: n.ucSigla, turma: n.turma, tipo: n.tipo, blocos: n.blocos, motivo: n.motivo });
  }

  const orcamentos: OrcamentoBloco[] = inventario.emparelhamentos.map((e) => ({
    ano: e.ano,
    familia: e.familia,
    primeira: e.primeira,
    ultima: e.ultima,
    porForma: e.porForma,
    gruposPL: e.trios,
    gruposDaUCdominante: e.triosDaUCdominante,
    paresPossiveis: e.pares,
    quotaSemParceiro: e.semParceiro,
    formaDoGrupoIsolado: e.formaDoGrupoIsolado,
  }));

  // -------------------------------------------------------------------------
  // Distribuição pelas semanas, ponderada pelos dias úteis
  // -------------------------------------------------------------------------

  const estadoSemanas = new Map<string, EstadoSemana>();
  const semanaPorGlobal = new Map<string, SemanaAlocacao>();
  for (const [ano, lista] of calendario) {
    for (const s of lista) {
      semanaPorGlobal.set(`${ano}|${s.global}`, s);
      const limites = limitesDaSemana(regras, ano, s.dias.length);
      for (const familia of mapa.familias) {
        estadoSemanas.set(chaveSemana(ano, familia, s.global), {
          alvo: 0,
          atribuidas: 0,
          diasUteis: s.dias.length,
          teto: limites.teto,
          confortavel: limites.alvo,
        });
      }
    }
  }

  /** As semanas que o registo aceitou para esta mancha, na ordem do calendário. */
  const semanasDaMancha = (m: ManchaPlaneada): SemanaAlocacao[] => {
    const permitidas = new Set(m.semanas);
    return (calendario.get(m.ano) ?? []).filter((s) => permitidas.has(s.global) && s.dias.length > 0);
  };

  /**
   * Peso de uma semana = fração de dias úteis que tem. É exatamente o `fator`
   * que `distribuirBlocos` já usa no resto do projeto, para que a repartição
   * por maiores restos seja a mesma em todo o lado.
   */
  const pesoDaSemana = (s: SemanaAlocacao): number => s.dias.length / Math.max(1, regras.grelha.dias.length);

  // Um conjunto por (ano, família, conjunto de semanas viáveis, padrão): assim a
  // proporcionalidade vale para cada tipo de mancha e a quota do padrão de
  // último recurso fica espalhada (~1 por semana) em vez de amontoada no fim.
  const conjuntos = new Map<string, ManchaPlaneada[]>();
  for (const m of manchas) {
    const k = `${m.ano}|${m.familia}|${m.semanas.join(".")}|${m.forma}`;
    const lista = conjuntos.get(k) ?? [];
    lista.push(m);
    conjuntos.set(k, lista);
  }

  // OS CONJUNTOS MAIS APERTADOS PRIMEIRO. Uma unidade curricular pode ter as
  // práticas fechadas a três semanas dentro de uma janela de sete; se as manchas
  // livres se servirem primeiro, essas três semanas chegam ao teto de carga
  // diária e as práticas deixam de caber onde SÓ ali podiam caber. Servido o
  // apertado, o folgado espalha-se pelo que sobra.
  const porApertoCrescente = [...conjuntos.values()].sort(
    (a, b) => a[0].semanas.length - b[0].semanas.length || b.length - a.length || a[0].id - b[0].id,
  );

  for (const lista of porApertoCrescente) {
    const modelo = lista[0];
    const semanas = semanasDaMancha(modelo);
    if (semanas.length === 0) {
      for (const m of lista) {
        sobras.push({
          ucSigla: [...new Set(m.sessoes.map((s) => s.ucSigla))].join("+"),
          turma: mapa.teorica(mapa.familias.indexOf(m.familia)),
          tipo: m.forma,
          blocos: m.sessoes.length,
          motivo: "nenhuma das semanas que o registo aceita para esta mancha tem dias de aulas.",
        });
      }
      lista.length = 0;
      continue;
    }
    const quotas = repartirComTeto(lista.length, semanas, modelo.ano, modelo.familia, estadoSemanas, pesoDaSemana);
    let i = 0;
    semanas.forEach((s, k) => {
      const chave = chaveSemana(modelo.ano, modelo.familia, s.global);
      const estado = estadoSemanas.get(chave);
      if (estado) estado.alvo += quotas[k];
      for (let n = 0; n < quotas[k]; n++) {
        const m = lista[i++];
        if (!m) break;
        m.semana = s.global;
        if (estado) estado.atribuidas += 1;
      }
    });
    // Restos: quando nem todas as semanas juntas chegam ao teto, a carga tem de
    // ir para algum lado. Vai para a menos carregada face ao alvo — e a
    // colocação, com a hierarquia de cedências, decide o que fazer com ela.
    for (; i < lista.length; i++) {
      const m = lista[i];
      const escolhida = semanaMenosCarregada(semanas, modelo.ano, modelo.familia, estadoSemanas, new Set());
      m.semana = escolhida?.global ?? semanas[0].global;
      const estado = estadoSemanas.get(chaveSemana(modelo.ano, modelo.familia, m.semana));
      if (estado) {
        estado.alvo += 1;
        estado.atribuidas += 1;
      }
    }
  }

  const vivas = manchas.filter((m) => m.semana > 0);

  // -------------------------------------------------------------------------
  // Resumo e reversibilidade
  // -------------------------------------------------------------------------

  const resumo = construirResumo(vivas, calendario, mapa, estadoSemanas);
  const porColocar = new Set<number>(vivas.map((m) => m.id));
  const tentadas = new Map<number, Set<number>>();

  const plano: PlanoSemanal = {
    manchas: vivas,
    sobras,
    resumo,
    orcamentos,
    avisos,

    pendentes(ano, familia, semana) {
      return vivas
        .filter((m) => porColocar.has(m.id) && m.ano === ano && m.familia === familia && m.semana === semana)
        .sort(ordemDentroDaSemana);
    },

    confirmar(mancha) {
      porColocar.delete(mancha.id);
    },

    replanear(mancha) {
      if (!porColocar.has(mancha.id)) return null;
      const jaTentadas = tentadas.get(mancha.id) ?? new Set<number>();
      jaTentadas.add(mancha.semana);
      tentadas.set(mancha.id, jaTentadas);

      const anterior = estadoSemanas.get(chaveSemana(mancha.ano, mancha.familia, mancha.semana));
      if (anterior) anterior.atribuidas = Math.max(0, anterior.atribuidas - 1);

      const candidatas = semanasDaMancha(mancha).filter((s) => !jaTentadas.has(s.global));
      const escolhida = semanaMenosCarregada(candidatas, mancha.ano, mancha.familia, estadoSemanas, jaTentadas);
      if (!escolhida) {
        porColocar.delete(mancha.id);
        sobras.push({
          ucSigla: [...new Set(mancha.sessoes.map((s) => s.ucSigla))].join("+"),
          turma: [...new Set(mancha.sessoes.map((s) => s.turma))].join("+"),
          tipo: mancha.forma,
          blocos: mancha.sessoes.length,
          motivo:
            `a colocação não arrumou esta mancha em nenhuma das ${jaTentadas.size} semana(s) que o registo ` +
            `aceita para ela (${mancha.semanas.join(", ")}).`,
        });
        return null;
      }
      mancha.semana = escolhida.global;
      const novo = estadoSemanas.get(chaveSemana(mancha.ano, mancha.familia, mancha.semana));
      if (novo) novo.atribuidas += 1;
      return mancha;
    },
  };

  return plano;
}

const chaveSemana = (ano: number, familia: Familia, semana: number) => `${ano}|${familia}|${semana}`;

/** O que uma semana já recebeu e o que ainda comporta, para uma família. */
interface EstadoSemana {
  /** Manchas que a distribuição prometeu a esta semana. */
  alvo: number;
  /** Manchas que lá estão neste momento (baixa quando `replanear` as tira). */
  atribuidas: number;
  diasUteis: number;
  /** Limite DURO da regra de carga diária. */
  teto: number;
  /** Manchas à carga-ALVO do estudante: o que se procura, abaixo do teto. */
  confortavel: number;
}

/**
 * Ordem de tentativa dentro de uma semana: primeiro as teóricas, depois as
 * manchas só de TP, por fim as que levam práticas. É a ordem pedagógica
 * T -> TP -> PL aplicada com grão fino dentro da semana, e é também a que dá
 * mais hipóteses às práticas (o tipo com menos manchas ao seu dispor) de
 * encontrarem lugar depois de as TP que as sustentam já estarem no horário.
 */
function ordemDentroDaSemana(a: ManchaPlaneada, b: ManchaPlaneada): number {
  const grau = (m: ManchaPlaneada) =>
    m.sessoes.some((s) => s.tipo === "T") ? 0 : m.sessoes.some((s) => s.tipo === "PL") ? 2 : 1;
  return grau(a) - grau(b) || a.id - b.id;
}

/**
 * Reparte `quantas` manchas pelas `semanas`, proporcionalmente aos dias úteis de
 * cada uma (maiores restos, como `distribuirBlocos` faz no resto do projeto) mas
 * LIMITADA pela capacidade que resta em cada semana.
 *
 * A repartição é feita em DUAS PASSAGENS, e a ordem é o essencial:
 *
 *  1. Até ao ALVO de carga diária (ex.: 6h/dia). É o que se quer de facto, e é
 *     aqui que a proporcionalidade aos dias úteis manda.
 *  2. Só o que não coube na primeira é que usa a folga até ao TETO (ex.: 8h/dia),
 *     outra vez proporcionalmente, sobre as semanas que ainda a têm.
 *
 * A passagem única pelo teto era o que fazia falhar os últimos blocos: os
 * conjuntos apertados (as manchas que só cabem em 2 ou 3 semanas) são servidos
 * primeiro, e a seguir os conjuntos livres enchiam ESSAS MESMAS semanas até ao
 * teto — porque a repartição proporcional não distingue uma semana já carregada
 * de uma vazia enquanto houver folga até ao teto. Resultado: os dias dessas
 * semanas ficavam saturados (carga diária no máximo, pausa de almoço gasta) e as
 * manchas que só ali podiam entrar deixavam de caber, enquanto as semanas ao
 * lado ficavam abaixo do alvo. Encher primeiro até ao alvo em toda a parte
 * nivela a procura e devolve essa folga a quem não tem alternativa.
 *
 * Devolve um array alinhado com `semanas`. A soma pode ser inferior a `quantas`
 * quando nem todas as semanas juntas chegam para a carga; quem chama trata o
 * resto (ver "Restos" no ciclo de repartição).
 */
function repartirComTeto(
  quantas: number,
  semanas: SemanaAlocacao[],
  ano: number,
  familia: Familia,
  estadoSemanas: Map<string, EstadoSemana>,
  pesoDaSemana: (s: SemanaAlocacao) => number,
): number[] {
  const n = semanas.length;
  const quotas = new Array<number>(n).fill(0);
  if (quantas <= 0 || n === 0) return quotas;

  const estados = semanas.map((s) => estadoSemanas.get(chaveSemana(ano, familia, s.global)));
  const pesos = semanas.map(pesoDaSemana);

  /** Manchas que ainda cabem em cada semana até um dos dois limites. */
  const folgaAte = (limite: (e: EstadoSemana) => number): number[] =>
    estados.map((e, i) => (e ? Math.max(0, limite(e) - e.atribuidas - quotas[i]) : 0));

  const repartir = (aRepartir: number, capacidade: number[]): number => {
    const total = capacidade.reduce((a, b) => a + b, 0);
    const quantidade = Math.min(aRepartir, total);
    if (quantidade <= 0) return 0;

    const somaPesos = pesos.reduce((a, b) => a + b, 0);
    const ideais =
      somaPesos > 0 ? pesos.map((p) => (quantidade * p) / somaPesos) : pesos.map(() => quantidade / n);
    const parte = ideais.map((v, i) => Math.min(Math.floor(v), capacidade[i]));
    let colocadas = parte.reduce((a, b) => a + b, 0);

    // Maiores restos, servindo só quem ainda tem capacidade. O ciclo repete
    // porque uma semana que atinge o limite devolve a sua vez às outras.
    const porResto = semanas
      .map((_, i) => i)
      .sort((a, b) => ideais[b] - parte[b] - (ideais[a] - parte[a]) || a - b);
    while (colocadas < quantidade) {
      let avancou = false;
      for (const i of porResto) {
        if (colocadas >= quantidade) break;
        if (parte[i] < capacidade[i]) {
          parte[i] += 1;
          colocadas += 1;
          avancou = true;
        }
      }
      if (!avancou) break;
    }
    for (let i = 0; i < n; i++) quotas[i] += parte[i];
    return colocadas;
  };

  // 1.ª passagem: até à carga-alvo do estudante, em todas as semanas.
  let feitas = repartir(quantas, folgaAte((e) => e.confortavel));
  // 2.ª passagem: o que sobrou usa a folga até ao teto duro.
  if (feitas < quantas) feitas += repartir(quantas - feitas, folgaAte((e) => e.teto));
  return quotas;
}

function semanaMenosCarregada(
  semanas: SemanaAlocacao[],
  ano: number,
  familia: Familia,
  estadoSemanas: Map<string, EstadoSemana>,
  excluir: Set<number>,
): SemanaAlocacao | null {
  let melhor: SemanaAlocacao | null = null;
  let melhorFolga = Number.NEGATIVE_INFINITY;
  for (const s of semanas) {
    if (excluir.has(s.global)) continue;
    const e = estadoSemanas.get(chaveSemana(ano, familia, s.global));
    const folga = e ? e.alvo - e.atribuidas : 0;
    if (folga > melhorFolga) {
      melhorFolga = folga;
      melhor = s;
    }
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// 8. Descontar o que já está imposto (sessões fixas e layouts fixos)
// ---------------------------------------------------------------------------

/**
 * Desconta da procura o que já está imposto de fora: as sessões fixadas ou
 * importadas e os layouts que o coordenador escreveu à mão. O planeador nunca
 * orçamenta o que já tem dia e hora.
 *
 * `jaColocadas`, quando vem, SUBSTITUI as duas fontes: é a lista completa do que
 * já está no horário. É por aqui que o alocador replaneia a meio, depois de já
 * ter colocado alguma coisa, sem descontar a mesma aula duas vezes.
 */
export function descontarJaColocado(
  entrada: EntradaAlocacao,
  regras: ConfiguracaoMotor,
  mapa: MapaTurmas,
  procura: Map<string, ItemProcura>,
  ucPorId: Map<string, UC>,
  jaColocadas?: SessaoHorario[],
): void {
  const porSigla = new Map<string, UC>();
  for (const uc of ucPorId.values()) porSigla.set(normalizar(uc.sigla), uc);

  const descontar = (ucId: string, tipo: TipoAula, turma: string) => {
    const p = procura.get(chaveProcura(ucId, tipo, mapa.canonico(turma)));
    if (p) p.colocados += 1;
  };

  if (jaColocadas) {
    for (const s of jaColocadas) {
      const uc = porSigla.get(normalizar(s.ucSigla));
      if (uc) descontar(uc.id, s.tipoAula, s.turma);
    }
    return;
  }

  for (const s of entrada.sessoesFixas ?? []) {
    const uc = porSigla.get(normalizar(s.ucSigla));
    if (uc) descontar(uc.id, s.tipoAula, s.turma);
  }
  for (const layout of regras.layoutsFixos) {
    for (const s of layout.sessoes) {
      const uc = porSigla.get(normalizar(s.ucSigla));
      if (!uc) continue;
      for (const turma of s.turmas) descontar(uc.id, s.tipo, turma);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Resumo
// ---------------------------------------------------------------------------

function construirResumo(
  manchas: ManchaPlaneada[],
  calendario: Map<number, SemanaAlocacao[]>,
  mapa: MapaTurmas,
  estadoSemanas: Map<string, EstadoSemana>,
): ResumoSemana[] {
  const linhas = new Map<string, ResumoSemana>();
  for (const [ano, semanas] of calendario) {
    for (const s of semanas) {
      for (const familia of mapa.familias) {
        const e = estadoSemanas.get(chaveSemana(ano, familia, s.global));
        linhas.set(chaveSemana(ano, familia, s.global), {
          ano,
          familia,
          semana: s.global,
          diasUteis: s.dias.length,
          alvo: e?.alvo ?? 0,
          porForma: {},
        });
      }
    }
  }
  for (const m of manchas) {
    const linha = linhas.get(chaveSemana(m.ano, m.familia, m.semana));
    if (!linha) continue;
    linha.porForma[m.forma] = (linha.porForma[m.forma] ?? 0) + 1;
  }
  return [...linhas.values()].sort(
    (a, b) => a.ano - b.ano || a.familia.localeCompare(b.familia) || a.semana - b.semana,
  );
}

// ---------------------------------------------------------------------------
// 8. Formatação para relatório
// ---------------------------------------------------------------------------

export function formatarPlano(plano: PlanoSemanal): string {
  const linhas: string[] = [];
  linhas.push("PLANO SEMANAL");
  linhas.push("=============");
  linhas.push(`Manchas planeadas: ${plano.manchas.length}`);
  const porForma = new Map<FormaId, number>();
  for (const m of plano.manchas) porForma.set(m.forma, (porForma.get(m.forma) ?? 0) + 1);
  for (const [id, n] of [...porForma].sort((a, b) => b[1] - a[1])) {
    linhas.push(`  ${String(id).padEnd(22)} ${String(n).padStart(5)}`);
  }

  linhas.push("");
  linhas.push("Orcamento por (ano, familia, janela)");
  linhas.push("------------------------------------");
  for (const o of plano.orcamentos) {
    linhas.push(
      `  ano ${o.ano} familia ${o.familia} semanas ${o.primeira}-${o.ultima}: ` +
        `${o.gruposPL} grupos de PL, o maior contribuinte traz ${o.gruposDaUCdominante}; ` +
        `${o.paresPossiveis} pares possiveis; quota sem parceiro = ${o.quotaSemParceiro}` +
        (o.formaDoGrupoIsolado ? ` (forma ${o.formaDoGrupoIsolado})` : ""),
    );
  }

  const formas = [...new Set(plano.manchas.map((m) => m.forma))].sort();
  linhas.push("");
  linhas.push("Manchas por semana");
  linhas.push("------------------");
  linhas.push(
    `  ${"ano/fam".padEnd(10)}${"sem".padStart(4)}${"dias".padStart(6)}${"alvo".padStart(6)}${"total".padStart(7)}  ` +
      formas.map((p) => p.padStart(18)).join(""),
  );
  for (const r of plano.resumo) {
    const total = Object.values(r.porForma).reduce((s, n) => s + (n ?? 0), 0);
    linhas.push(
      `  ${`${r.ano}/${r.familia}`.padEnd(10)}${String(r.semana).padStart(4)}${String(r.diasUteis).padStart(6)}` +
        `${String(r.alvo).padStart(6)}${String(total).padStart(7)}  ` +
        formas.map((p) => String(r.porForma[p] ?? 0).padStart(18)).join(""),
    );
  }

  if (plano.avisos.length > 0) {
    linhas.push("");
    linhas.push(`Avisos (${plano.avisos.length})`);
    linhas.push("-------");
    for (const a of plano.avisos) linhas.push(`  ${a}`);
  }

  if (plano.sobras.length > 0) {
    linhas.push("");
    linhas.push(`Sobras (${plano.sobras.length})`);
    linhas.push("-------");
    for (const s of plano.sobras) {
      linhas.push(`  ${s.ucSigla} ${s.turma} ${s.tipo}: ${s.blocos} bloco(s) — ${s.motivo}`);
    }
  }

  return linhas.join("\n");
}
