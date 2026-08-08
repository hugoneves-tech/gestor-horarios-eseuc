/**
 * CONTRATO DE REGRAS DO MOTOR DE HORÁRIOS — esquema tipado + validação.
 *
 * Princípio (Fase 2 do plano de reescrita): a fonte de verdade das regras é o
 * Supabase. Este ficheiro descreve o QUE pode vir de lá, valida-o e devolve
 * mensagens de erro legíveis em português.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular. As siglas são DADOS (vêm das regras e
 *     da tabela `ucs`), nunca literais de código.
 *  2. ZERO layouts concretos (nenhum dia/hora/UC específicos de um ano letivo).
 *  3. Os defaults são GENÉRICOS e cada um traz um comentário a explicar porquê
 *     é seguro assumi-lo na ausência da regra. Um default nunca substitui em
 *     silêncio uma regra que o motor precisa: o carregador reporta-o sempre.
 *
 * O ficheiro não contém lógica de motor — só tipos, defaults e validação.
 */

// ---------------------------------------------------------------------------
// 0. Diagnóstico
// ---------------------------------------------------------------------------

/** Gravidade de um apontamento produzido pela validação. */
export type NivelDiagnostico =
  /** A regra existe mas está inutilizável; o valor foi descartado. */
  | "erro"
  /** A regra foi aceite mas há algo a assinalar (conflito, redundância). */
  | "aviso"
  /** Não veio nada do Supabase e foi aplicado o default documentado. */
  | "default";

export interface Diagnostico {
  nivel: NivelDiagnostico;
  /** Caminho legível até ao valor, ex. `regra:h_x/config/motor/maxPLporMancha`. */
  caminho: string;
  /** Mensagem em português, dirigida a quem edita as regras. */
  mensagem: string;
}

export type Diagnosticos = Diagnostico[];

export function registarErro(d: Diagnosticos, caminho: string, mensagem: string): void {
  d.push({ nivel: "erro", caminho, mensagem });
}

export function registarAviso(d: Diagnosticos, caminho: string, mensagem: string): void {
  d.push({ nivel: "aviso", caminho, mensagem });
}

export function registarDefault(d: Diagnosticos, caminho: string, mensagem: string): void {
  d.push({ nivel: "default", caminho, mensagem });
}

// ---------------------------------------------------------------------------
// 1. Vocabulário base
// ---------------------------------------------------------------------------

export type TipoAula = "T" | "TP" | "PL" | "S";
export const TIPOS_AULA: readonly TipoAula[] = ["T", "TP", "PL", "S"];

export type Periodo = "manha" | "tarde";
export const PERIODOS: readonly Periodo[] = ["manha", "tarde"];

/** Identificador de família de turmas (turma teórica e os seus desdobramentos). */
export type Familia = "A" | "B";
export const FAMILIAS: readonly Familia[] = ["A", "B"];

/**
 * Dias úteis por omissão. Genérico: semana letiva de 2.ª a 6.ª, a convenção
 * do ensino superior português. A instituição pode redefinir a lista inteira.
 */
export const DIAS_UTEIS_PADRAO: readonly string[] = [
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
];

// ---------------------------------------------------------------------------
// 2. Grelha horária
// ---------------------------------------------------------------------------

export interface GrelhaHoraria {
  /** Dias úteis, pela ordem cronológica da semana. */
  dias: string[];
  /** Hora de abertura do edifício, formato `HH:MM`. */
  horaAbertura: string;
  /** Hora de fecho do edifício, formato `HH:MM`. */
  horaFecho: string;
  /** Duração, em horas, de um bloco letivo indivisível. */
  duracaoBlocoHoras: number;
  /** Horas de início possíveis; derivadas da abertura/fecho se não vierem. */
  horasInicio: string[];
  /** Hora a partir da qual um bloco conta como "tarde". */
  limiarTardeHora: number;
  /**
   * Par de horas mutuamente exclusivas que protege o almoço (ex. 12:00/14:00):
   * ocupar uma bloqueia a outra para o mesmo grupo. `null` desliga a proteção.
   */
  pausaAlmoco: { horaAntes: string; horaDepois: string } | null;
}

// ---------------------------------------------------------------------------
// 3. Estrutura de turmas
// ---------------------------------------------------------------------------

export interface EstruturaTurmas {
  /** Número de turmas teóricas (famílias). */
  turmasTeoricas: number;
  /** Nomes das turmas teóricas, se a instituição os fixar. Vazio = derivar. */
  nomesTurmasTeoricas: string[];
  /** Desdobramentos TP por turma teórica. */
  tpPorTurmaTeorica: number;
  /** Desdobramentos PL por cada turma TP. */
  plPorTP: number;
  /**
   * Número de meio-cohorts por família (subgrupos usados para emparelhar TP
   * com PL no mesmo bloco). 2 = a família parte-se ao meio.
   */
  meioCohortsPorFamilia: number;
  /** Prefixos usados na nomenclatura das turmas (`TP1`, `PL7`, ...). */
  prefixos: { teorica: string; tp: string; pl: string };
}

/** Total de turmas TP implícito na estrutura. */
export function totalTP(e: EstruturaTurmas): number {
  return e.turmasTeoricas * e.tpPorTurmaTeorica;
}

/** Total de turmas PL implícito na estrutura. */
export function totalPL(e: EstruturaTurmas): number {
  return totalTP(e) * e.plPorTP;
}

// ---------------------------------------------------------------------------
// 4. Padrões de bloco a 100%
// ---------------------------------------------------------------------------

/**
 * Composições que a configuração ANTIGA enumerava para um bloco a 100%.
 *
 * DEIXARAM DE SER A FONTE DE VERDADE. A validade de um bloco passou a sair de
 * uma REGRA GERAL (cobrir as folhas-aluno todas, no máximo `maxTPporUCporMancha`
 * TP e `maxPLporUCporMancha` PL da mesma unidade curricular, nunca TP e PL da
 * mesma UC) — ver `src/motor/padroes.ts`. Esta lista continua a ser lida por
 * RETROCOMPATIBILIDADE e vale apenas como PREFERÊNCIA: os custos que declara
 * ancoram a hierarquia entre formas, e a marca `ativo` NUNCA veta um bloco.
 */
export type IdPadraoBloco =
  | "T1"
  | "TP2_PL3_PL3"
  | "TP2_DUAS_UCS"
  | "TP4_MESMA_UC"
  | "TP2_PL6_DUAS_UCS"
  | "TP3_PL3"
  // Composições com um desdobramento ÍMPAR. Nascem de repartições de turmas por
  // docente que não são simétricas: com 8 turmas TP repartidas 5+3 por duas
  // docentes, a docente com 5 nunca consegue emparelhar todas duas a duas, e
  // sobra sempre um desdobramento solto que só fecha com uma terceira UC.
  | "TP2_TP1_PL3"
  | "TP2_TP1_TP1"
  // Nome livre: a lista é PREFERÊNCIA, não veto. Um identificador que o esquema
  // não conheça é aceite com aviso — quem decide a validade é a regra geral.
  | (string & {});

/** Os identificadores que o esquema conhece e para os quais tem custo próprio. */
export const IDS_PADRAO_BLOCO = [
  "T1",
  "TP2_PL3_PL3",
  "TP2_DUAS_UCS",
  "TP4_MESMA_UC",
  "TP2_PL6_DUAS_UCS",
  "TP3_PL3",
  "TP2_TP1_PL3",
  "TP2_TP1_TP1",
] as const;

export interface PadraoBloco {
  id: IdPadraoBloco;
  /**
   * Histórico. Já NÃO impede a geração de nada: com a regra geral, um bloco é
   * legal quando cabe nos limites, esteja o padrão homónimo ativo ou não.
   */
  ativo: boolean;
  /** Custo relativo. Menor = mais preferido. */
  custo: number;
  /**
   * Marca o padrão como último recurso: usado só quando nada mais fecha o
   * bloco, e obrigatoriamente contabilizado no relatório final.
   */
  ultimoRecurso: boolean;
  /** Explicação para a UI/relatório. Texto livre, sem siglas. */
  descricao: string;
}

export interface RegrasPadroesBloco {
  /** Se `true`, blocos abaixo de 100% não são publicados. */
  exigirCoberturaTotal: boolean;
  padroes: PadraoBloco[];
  /** Percentagem de ocupação de uma turma teórica por sessão de cada tipo. */
  percentagensOcupacao: Partial<Record<TipoAula, number>>;
  /**
   * Emparelhamentos preferenciais definidos por dados (listas de siglas vindas
   * do Supabase). O motor lê-os como preferência, nunca como obrigação.
   */
  emparelhamentosPreferenciais: EmparelhamentoPreferencial[];
}

export interface EmparelhamentoPreferencial {
  /** Siglas de UC cujas TP se preferem juntar duas a duas. Vazio = qualquer. */
  siglasTP: string[];
  /** Siglas de UC cujas PL se preferem cruzar com as TP acima. */
  siglasPL: string[];
  /** Quantos blocos deste tipo se pretendem por família, se especificado. */
  quantidadePorFamilia: number | null;
  origem: string;
}

// ---------------------------------------------------------------------------
// 5. Janelas de dia/período por tipo de aula
// ---------------------------------------------------------------------------

export interface JanelaDia {
  dia: string;
  /** Períodos autorizados nesse dia. Vazio = o dia inteiro. */
  periodos: Periodo[];
  /** Horas de início autorizadas nesse dia. Vazio = todas as do período. */
  horas: string[];
}

export interface JanelaTipoAula {
  tipo: TipoAula;
  /**
   * `veto`: fora da janela é PROIBIDO (restrição dura).
   * `preferencia`: fora da janela é permitido mas custa.
   *
   * A distinção é a correção central desta fase: no motor antigo a janela das
   * aulas T era uma simples ordem de tentativa, pelo que as T caíam em dias
   * não autorizados sempre que os preferidos estavam cheios.
   */
  modo: "veto" | "preferencia";
  janelas: JanelaDia[];
  /** Ordem de tentativa dos dias, quando o modo é `preferencia`. */
  ordemPreferenciaDias: string[];
  origem: string;
}

// ---------------------------------------------------------------------------
// 6. Capacidades
// ---------------------------------------------------------------------------

/**
 * Conjunto de salas com capacidade própria (ex.: laboratórios de simulação vs.
 * salas de computadores). A associação UC -> pool é DADO (campo da UC ou lista
 * de siglas numa regra), nunca literal de código.
 */
export interface PoolSala {
  id: string;
  descricao: string;
  /** Sessões simultâneas que o conjunto de salas comporta. */
  maxSimultaneo: number;
  /** Se `true`, as sessões deste pool também contam para o máximo global de PL. */
  contaParaMaximoGlobalPL: boolean;
  /** Siglas de UC associadas a este pool, quando definidas na própria regra. */
  siglas: string[];
  origem: string;
}

export interface RegrasCapacidade {
  /**
   * Máximo de sessões PL em simultâneo em toda a escola, numa mancha
   * (semana + dia + hora). Conta o BLOCO INTEIRO: todas as turmas, UCs e anos.
   */
  maxPLporMancha: number;
  /** Máximo de sessões TP em simultâneo por mancha. `null` = sem limite. */
  maxTPporMancha: number | null;
  /**
   * LIMITE UNIVERSAL: máximo de TP da MESMA UC por mancha, supletivo de toda a
   * escola. `null` = sem limite. Uma UC pode declarar um valor MAIS BAIXO (no
   * catálogo ou numa regra `limitesPorUC`) e o motor fica com o mínimo dos dois;
   * nunca pode declarar um valor mais alto. Vem das cargas de docentes, não de
   * preferência.
   */
  maxTPporUCporMancha: number | null;
  /**
   * LIMITE UNIVERSAL: máximo de PL da MESMA UC por mancha, com exatamente a
   * mesma semântica de `maxTPporUCporMancha`. Vem da capacidade de laboratórios.
   */
  maxPLporUCporMancha: number | null;
  /**
   * Âmbito da contagem dos máximos por UC. Decisão do coordenador: `bloco` —
   * soma-se o bloco inteiro (todas as famílias e anos), não por turma.
   */
  ambitoContagem: "bloco" | "turma";
  poolsSala: PoolSala[];
}

/** Limites de simultaneidade declarados na própria unidade curricular. */
export interface LimitesPorUC {
  ucId: string;
  sigla: string;
  maxSimultaneoT: number | null;
  maxSimultaneoTP: number | null;
  maxSimultaneoPL: number | null;
}

// ---------------------------------------------------------------------------
// 7. Carga diária do estudante
// ---------------------------------------------------------------------------

export interface RegrasCargaDiaria {
  /** Carga-alvo de um dia letivo, em horas. */
  alvoHoras: number;
  /** Teto absoluto de um dia letivo, em horas. */
  maxHoras: number;
  /** Quantos dias por semana podem chegar ao teto. */
  maxDiasNoMaximoPorSemana: number;
  /** Se `true`, penaliza abrir um dia novo com poucas horas. */
  evitarDiasParciais: boolean;
}

export interface CargaDiariaPorAmbito {
  /** Aplicável a todos os anos curriculares. */
  transversal: RegrasCargaDiaria;
  /** Sobreposições por ano curricular (têm precedência sobre a transversal). */
  porAno: Record<number, RegrasCargaDiaria>;
}

// ---------------------------------------------------------------------------
// 8. Precedências e restrições por UC
// ---------------------------------------------------------------------------

export interface PrecedenciaUC {
  /** Siglas abrangidas. Vazio = todas as UCs do âmbito da regra. */
  siglas: string[];
  tipoAntes: TipoAula;
  tipoDepois: TipoAula;
  /** Quantidade mínima do tipo anterior antes de abrir o tipo seguinte. */
  minimoAntes: number;
  unidade: "blocos" | "horas";
  /** `porTurma` conta por turma; `todas` exige o mínimo global. */
  contagem: "porTurma" | "todas";
  anos: number[];
  origem: string;
}

/**
 * PRECEDÊNCIA ESCALONADA: para a n-ésima aula PL de uma UC, quantas T e quantas
 * TP têm de estar dadas antes.
 *
 * A precedência proporcional (`racioTPPL`) exige que a percentagem de PL dadas
 * nunca ultrapasse a de TP dadas. É genérica, mas não é o que algumas
 * coordenações escrevem: elas escrevem uma TABELA — "antes da 1.ª e da 2.ª PL,
 * a 1.ª T e a 1.ª TP; antes da 3.ª e da 4.ª, a 2.ª T e a 2.ª TP; ...". Quando
 * uma UC traz tabela, é a tabela que manda e o rácio proporcional deixa de se
 * aplicar a essa UC; sem tabela, o rácio continua a ser o default.
 */
export interface EscalaoPrecedenciaPL {
  /** Vale para todas as PL até esta ordem (inclusive), a partir do escalão anterior. */
  ateNesimaPL: number;
  /** Aulas T da mesma UC que têm de estar dadas antes. */
  minimoT: number;
  /** Aulas TP da mesma UC (na turma/família do grupo) que têm de estar dadas antes. */
  minimoTP: number;
}

export interface PrecedenciaEscalonadaUC {
  /** Siglas abrangidas. Vazio = todas as UCs do âmbito da regra. */
  siglas: string[];
  anos: number[];
  /** A tabela, por ordem crescente de `ateNesimaPL`. */
  escaloes: EscalaoPrecedenciaPL[];
  origem: string;
}

/**
 * RITMO DAS TURMAS TP: as turmas TP da mesma unidade curricular não podem
 * divergir mais do que `maxDesvioBlocos` entre si, em qualquer momento da ordem
 * de calendário. É a resposta ao "desfasamento enorme entre as várias TP".
 *
 * `ambito` diz que turmas se comparam entre si: `familia` compara as TP dentro
 * da mesma turma teórica (é o desfasamento que o estudante e o docente sentem, e
 * o único que é comparável quando há semanas em que só uma família tem aulas);
 * `uc` compara todas as turmas TP da unidade curricular, atravessando famílias.
 */
export interface RegraRitmoTP {
  ativo: boolean;
  /**
   * A UNIDADE em que o desvio se mede, e é o que decide se a regra é justa.
   *
   * `blocos` compara CONTAGENS: a turma mais adiantada não pode ter mais do que
   * `maxDesvioBlocos` aulas de avanço. Trata todas as UCs por igual e por isso
   * castiga as densas: uma UC com 19 blocos de TP em 6 semanas anda a mais de
   * três blocos por semana, e dois blocos de avanço é meio dia de diferença.
   *
   * `semanas` compara CALENDÁRIO: a n-ésima aula de uma turma e a n-ésima aula
   * de outra não podem ficar a mais do que `maxDesvioSemanas` semanas de
   * distância. É o desfasamento que o estudante sente — estar uma quinzena
   * atrás, não estar dois exercícios atrás — e adapta-se sozinho ao ritmo de
   * cada UC. Medido no horário de referência do coordenador, o atraso máximo é
   * de exatamente 2 semanas em TODAS as UCs e nas duas famílias, tanto na UC de
   * 3 blocos como na de 19.
   */
  unidade: "blocos" | "semanas";
  /** Usado quando `unidade` é `blocos`. */
  maxDesvioBlocos: number;
  /** Usado quando `unidade` é `semanas`. */
  maxDesvioSemanas: number;
  ambito: "familia" | "uc";
}

/**
 * SEM MARATONAS: dois tetos independentes sobre a mesma unidade curricular no
 * mesmo dia, para o mesmo grupo de estudantes.
 *
 * - `maxBlocosSeguidosMesmaUC` limita a corrida CONTÍGUA na grelha de horas do
 *   dia (saltando as horas que o grupo tem livres);
 * - `maxBlocosMesmaUCporDia` limita o TOTAL do dia, seguidos ou não.
 *
 * A distinção não é decorativa. O horário de referência do coordenador tem
 * blocos de 6h seguidas da mesma UC e o coordenador aceita-os; a queixa original
 * da coordenação era sobre 8h da mesma UC no mesmo dia (6h seguidas de manhã
 * mais 2h à tarde), que é o que o teto diário proíbe.
 */
export interface RegraMaratonaUC {
  ativo: boolean;
  maxBlocosSeguidosMesmaUC: number;
  maxBlocosMesmaUCporDia: number;
}

/**
 * TP E PL DA MESMA UC NA MESMA MANCHA.
 *
 * Nasceu da suposição de que a TP e a PL da mesma unidade curricular são dadas
 * pela mesma docente e por isso não podem coexistir num bloco. O horário de
 * referência do coordenador fá-lo, com docentes diferentes, e o coordenador
 * confirmou-o. Fica CONFIGURÁVEL e DESLIGADA por omissão: quem tiver de facto
 * uma UC com docente único liga-a no Supabase.
 */
export interface RegraTPPLmesmaUC {
  ativo: boolean;
}

export interface RestricaoUC {
  /** Siglas abrangidas. Vazio = todas as UCs do âmbito da regra. */
  siglas: string[];
  /** Tipos de aula abrangidos. Vazio = todos. */
  tipos: TipoAula[];
  diasProibidos: string[];
  periodosProibidos: Periodo[];
  /** Semanas (pedagógicas) abrangidas. Vazio = todas. */
  semanasRestritas: number[];
  /**
   * Semestre a que `semanasRestritas` se refere. `null` = ambos os semestres.
   * Sem isto, uma regra sobre "a semana 1" aplica-se à semana 1 dos DOIS
   * semestres — foi o que deixou a semana global 16 (1.ª do 2.º semestre)
   * completamente vazia, por herdar o veto do arranque do 1.º semestre.
   */
  semestre: number | null;
  /**
   * Interpretação, preservada do motor antigo: se `diasProibidos` E
   * `periodosProibidos` estiverem ambos preenchidos, a proibição é a
   * INTERSEÇÃO (ex.: "quarta à tarde"); se só um estiver preenchido, vale
   * isoladamente.
   */
  anos: number[];
  origem: string;
}

/**
 * Rácio proporcional TP -> PL (Fase 6B): em qualquer momento, para cada UC e
 * família, a percentagem de PL já dadas nunca pode ultrapassar a percentagem
 * de TP já dadas. Substitui a verificação que só exigia UMA TP antes da
 * primeira PL — essa só olhava para o arranque, não para o resto do semestre.
 *
 * Adapta-se sozinho a cada UC a partir da sua carga horária: não há nenhum
 * número de UC concreto aqui, só o mecanismo genérico.
 */
export interface RegraRacioTPPL {
  /** Se `false`, a restrição não veta nada. */
  ativo: boolean;
  /**
   * Folga percentual (0 a 1) sobre o rácio estrito, para o coordenador afinar
   * se o rácio estrito se revelar demasiado apertado e criar défice — nunca
   * para o motor relaxar a regra em silêncio.
   */
  tolerancia: number;
}

// ---------------------------------------------------------------------------
// 9. Layout fixo de semanas
// ---------------------------------------------------------------------------

export interface SessaoLayoutFixo {
  semana: number;
  dia: string;
  hora: string;
  /** Sigla da UC. Dado vindo da regra — nunca literal de código. */
  ucSigla: string;
  tipo: TipoAula;
  turmas: string[];
}

export interface LayoutFixoSemanas {
  /** Ano curricular a que o layout se aplica. */
  ano: number | null;
  /** Semestre a que o layout se aplica. `null` = qualquer. */
  semestre: number | null;
  sessoes: SessaoLayoutFixo[];
  origem: string;
}

// ---------------------------------------------------------------------------
// 10. Turnos por família
// ---------------------------------------------------------------------------

export interface ExcecaoTurno {
  semestre: number;
  semanaInicio: number;
  semanaFim: number;
  familiaDeManha: Familia;
}

export interface RegraTurnos {
  /** Família que fica de manhã em cada semestre. */
  familiaDeManhaPorSemestre: Record<number, Familia>;
  excecoes: ExcecaoTurno[];
  /**
   * Semanas em que apenas uma família tem aulas (a outra em ensino clínico):
   * a família ativa pode usar o dia inteiro.
   */
  semanasTurmaUnica: SemanasTurmaUnica[];
}

export interface SemanasTurmaUnica {
  familia: Familia;
  semanas: number[];
  anos: number[];
  origem: string;
}

// ---------------------------------------------------------------------------
// 11. Calendário
// ---------------------------------------------------------------------------

export interface BloqueioCalendario {
  nome: string;
  tipo: string;
  dataInicio: string;
  dataFim: string;
}

export interface SemanaPersonalizadaRegra {
  numero: number;
  dataSegunda: string;
  dataSexta: string;
  /**
   * Semanas de pausa letiva (Páscoa, Queima) são "semana zero": não recebem
   * aulas e NÃO contam na numeração pedagógica das UCs.
   */
  isPausa: boolean;
  motivoPausa: string;
}

export interface RegrasCalendario {
  /** Data para lá da qual não podem existir aulas. */
  dataFim: string | null;
  /** Última semana global admissível. */
  semanaMaximaGlobal: number | null;
  /** Última semana global do 1.º semestre (fronteira entre semestres). */
  fronteiraSemestre: number;
  /** Número de semanas letivas por semestre, quando não vem da UC. */
  semanasPorSemestre: number;
  bloqueios: BloqueioCalendario[];
  semanasPersonalizadas: SemanaPersonalizadaRegra[];
  /** Decisão do coordenador: as pausas não avançam a numeração pedagógica. */
  pausasNaoContamNaNumeracao: boolean;
  origem: string;
}

// ---------------------------------------------------------------------------
// 12. Aulas T conjuntas e conflitos entre UCs
// ---------------------------------------------------------------------------

export interface AulaTConjunta {
  anos: number[];
  semanas: number[];
  dias: string[];
  horarios: string[];
  sala: string;
  /** Se `true`, é obrigatório reservar pelo menos um bloco em cada dia listado. */
  obrigatoriaPorDia: boolean;
  /** Siglas obrigadas a usar esta janela. Vazio = qualquer UC do âmbito. */
  siglasObrigatorias: string[];
  origem: string;
}

export interface ConflitoUC {
  /** Par de siglas que não pode partilhar mancha (docente comum, sala comum). */
  siglaA: string;
  siglaB: string;
  motivo: string;
  origem: string;
}

// ---------------------------------------------------------------------------
// 13. Preferências gerais
// ---------------------------------------------------------------------------

export interface DiaPrioritario {
  /** Data no formato `YYYY-MM-DD`. */
  data: string;
  /** Blocos mínimos a colocar nesse dia. */
  minimoBlocos: number;
}

export interface RegrasPreferencias {
  /** Deixar a sexta livre sempre que a carga couber nos restantes dias. */
  preferirSextaLivre: boolean;
  diasPrioritarios: DiaPrioritario[];
  /** Dias em que as PL são permitidas. Vazio = todos. */
  diasPermitidosPL: string[];
}

// ---------------------------------------------------------------------------
// 14. Configuração completa
// ---------------------------------------------------------------------------

export interface ConfiguracaoMotor {
  grelha: GrelhaHoraria;
  estruturaTurmas: EstruturaTurmas;
  padroesBloco: RegrasPadroesBloco;
  janelasPorTipo: JanelaTipoAula[];
  capacidade: RegrasCapacidade;
  limitesPorUC: LimitesPorUC[];
  cargaDiaria: CargaDiariaPorAmbito;
  precedencias: PrecedenciaUC[];
  precedenciasEscalonadas: PrecedenciaEscalonadaUC[];
  ritmoTP: RegraRitmoTP;
  maratonaUC: RegraMaratonaUC;
  tpPLmesmaUC: RegraTPPLmesmaUC;
  restricoesUC: RestricaoUC[];
  layoutsFixos: LayoutFixoSemanas[];
  turnos: RegraTurnos;
  calendario: RegrasCalendario;
  aulasTConjuntas: AulaTConjunta[];
  conflitosUC: ConflitoUC[];
  preferencias: RegrasPreferencias;
  racioTPPL: RegraRacioTPPL;
}

// ---------------------------------------------------------------------------
// 15. Utilitários de validação
// ---------------------------------------------------------------------------

export function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function horaParaMinutos(hora: string): number {
  const m = RE_HORA.exec(hora);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function valNumero(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  op: { min?: number; max?: number; inteiro?: boolean } = {},
): number | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  const n = typeof bruto === "string" && bruto.trim() !== "" ? Number(bruto) : bruto;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    registarErro(d, caminho, `esperava um número e recebeu ${descrever(bruto)}.`);
    return undefined;
  }
  if (op.inteiro && !Number.isInteger(n)) {
    registarErro(d, caminho, `esperava um número inteiro e recebeu ${n}.`);
    return undefined;
  }
  if (op.min !== undefined && n < op.min) {
    registarErro(d, caminho, `o valor ${n} é inferior ao mínimo permitido (${op.min}).`);
    return undefined;
  }
  if (op.max !== undefined && n > op.max) {
    registarErro(d, caminho, `o valor ${n} é superior ao máximo permitido (${op.max}).`);
    return undefined;
  }
  return n;
}

export function valBooleano(bruto: unknown, caminho: string, d: Diagnosticos): boolean | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto === "boolean") return bruto;
  registarErro(d, caminho, `esperava verdadeiro/falso e recebeu ${descrever(bruto)}.`);
  return undefined;
}

export function valTexto(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  op: { naoVazio?: boolean } = {},
): string | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto !== "string") {
    registarErro(d, caminho, `esperava texto e recebeu ${descrever(bruto)}.`);
    return undefined;
  }
  const t = bruto.trim();
  if (op.naoVazio && t === "") {
    registarErro(d, caminho, "esperava texto não vazio.");
    return undefined;
  }
  return t;
}

export function valEnum<T extends string>(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  valores: readonly T[],
): T | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto !== "string") {
    registarErro(d, caminho, `esperava um de [${valores.join(", ")}] e recebeu ${descrever(bruto)}.`);
    return undefined;
  }
  const t = bruto.trim();
  const achado = valores.find((v) => v.toLowerCase() === t.toLowerCase());
  if (!achado) {
    registarErro(d, caminho, `valor "${t}" desconhecido; esperava um de [${valores.join(", ")}].`);
    return undefined;
  }
  return achado;
}

/**
 * Identificador de padrão de bloco.
 *
 * Aceita QUALQUER nome, porque a lista de padrões deixou de decidir a validade
 * de um bloco — quem decide é a regra geral (cobrir as folhas todas, no máximo
 * `maxTPporUCporMancha` TP e `maxPLporUCporMancha` PL da mesma UC). A lista vale
 * como preferência, e os identificadores servem para ancorar custos e para
 * nomear as formas nos relatórios.
 *
 * Um nome que o esquema não conheça gera AVISO, nunca erro: bloquear o motor por
 * causa de um nome novo seria pior do que ignorá-lo. Foi o que aconteceu com
 * `TP2_TP1_PL3` — uma composição legítima, nascida de uma repartição de turmas
 * 5+3 por duas docentes, que o esquema recusava só por não a ter na lista.
 */
export function valIdPadrao(bruto: unknown, caminho: string, d: Diagnosticos): IdPadraoBloco | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto !== "string" || bruto.trim() === "") {
    registarErro(d, caminho, `o identificador de padrão tem de ser texto e recebeu ${descrever(bruto)}.`);
    return undefined;
  }
  const t = bruto.trim();
  const conhecido = IDS_PADRAO_BLOCO.find((v) => v.toLowerCase() === t.toLowerCase());
  if (conhecido) return conhecido;
  registarAviso(
    d,
    caminho,
    `padrão "${t}" não é um dos que o esquema conhece (${IDS_PADRAO_BLOCO.join(", ")}). `
    + "É aceite: a validade de um bloco vem da regra geral, não desta lista. "
    + "Sem custo declarado, fica com o custo genérico da sua forma.",
  );
  return t as IdPadraoBloco;
}

export function valHora(bruto: unknown, caminho: string, d: Diagnosticos): string | undefined {
  const t = valTexto(bruto, caminho, d, { naoVazio: true });
  if (t === undefined) return undefined;
  if (!RE_HORA.test(t)) {
    registarErro(d, caminho, `"${t}" não é uma hora válida no formato HH:MM (00:00 a 23:59).`);
    return undefined;
  }
  return t;
}

export function valData(bruto: unknown, caminho: string, d: Diagnosticos): string | undefined {
  const t = valTexto(bruto, caminho, d, { naoVazio: true });
  if (t === undefined) return undefined;
  if (!RE_DATA.test(t) || Number.isNaN(Date.parse(t))) {
    registarErro(d, caminho, `"${t}" não é uma data válida no formato AAAA-MM-DD.`);
    return undefined;
  }
  return t;
}

export function valLista<T>(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  item: (b: unknown, c: string, d: Diagnosticos) => T | undefined,
): T[] | undefined {
  if (bruto === undefined || bruto === null) return undefined;
  if (!Array.isArray(bruto)) {
    registarErro(d, caminho, `esperava uma lista e recebeu ${descrever(bruto)}.`);
    return undefined;
  }
  const saida: T[] = [];
  bruto.forEach((b, i) => {
    const v = item(b, `${caminho}[${i}]`, d);
    if (v !== undefined) saida.push(v);
  });
  return saida;
}

/** Lista de texto simples, útil para siglas, dias e horas. */
export function valListaTexto(bruto: unknown, caminho: string, d: Diagnosticos): string[] | undefined {
  return valLista(bruto, caminho, d, (b, c, dd) => valTexto(b, c, dd, { naoVazio: true }));
}

export function valListaInteiros(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  op: { min?: number; max?: number } = {},
): number[] | undefined {
  return valLista(bruto, caminho, d, (b, c, dd) => valNumero(b, c, dd, { ...op, inteiro: true }));
}

function descrever(v: unknown): string {
  if (v === null) return "nulo";
  if (Array.isArray(v)) return `uma lista de ${v.length} elemento(s)`;
  if (typeof v === "object") return "um objeto";
  return `${typeof v} (${JSON.stringify(v)})`;
}

// ---------------------------------------------------------------------------
// 16. Defaults genéricos e documentados
// ---------------------------------------------------------------------------

/**
 * Deriva as horas de início a partir da abertura, do fecho e da duração do
 * bloco. Evita ter uma lista de horas literal no código.
 */
export function derivarHorasInicio(
  horaAbertura: string,
  horaFecho: string,
  duracaoBlocoHoras: number,
): string[] {
  const inicio = horaParaMinutos(horaAbertura);
  const fim = horaParaMinutos(horaFecho);
  const passo = Math.round(duracaoBlocoHoras * 60);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || passo <= 0) return [];
  const horas: string[] = [];
  for (let m = inicio; m + passo <= fim; m += passo) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    horas.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return horas;
}

/**
 * Custos por omissão dos padrões de bloco.
 *
 * A hierarquia foi fixada pelo coordenador: T1 · TP2_PL3_PL3 (preferido) ·
 * TP2_DUAS_UCS · TP4_MESMA_UC (custa mais do que o 2+2) · TP2_PL6_DUAS_UCS ·
 * TP3_PL3 (último recurso). Os números são escalões relativos, não medidas:
 * o que importa é a ordem. O último recurso custa duas ordens de grandeza
 * acima para nunca ser escolhido enquanto houver alternativa — mas continua
 * disponível, porque a cobertura a 100% nunca pode ser impedida.
 */
const PADROES_BLOCO_PADRAO: PadraoBloco[] = [
  {
    id: "T1",
    ativo: true,
    custo: 0,
    ultimoRecurso: false,
    descricao: "Uma aula teórica para toda a turma teórica.",
  },
  {
    id: "TP2_PL3_PL3",
    ativo: true,
    custo: 10,
    ultimoRecurso: false,
    descricao: "Duas TP de uma UC mais três e três PL de duas outras UCs.",
  },
  {
    id: "TP2_DUAS_UCS",
    ativo: true,
    custo: 20,
    ultimoRecurso: false,
    descricao: "Duas TP de uma UC mais duas TP de outra UC.",
  },
  {
    id: "TP4_MESMA_UC",
    ativo: true,
    custo: 30,
    ultimoRecurso: false,
    descricao: "Quatro TP da mesma UC.",
  },
  {
    id: "TP2_PL6_DUAS_UCS",
    ativo: true,
    custo: 40,
    ultimoRecurso: false,
    descricao: "Duas TP de uma UC mais seis PL de outra UC.",
  },
  {
    id: "TP3_PL3",
    ativo: true,
    custo: 1000,
    ultimoRecurso: true,
    descricao: "Três TP de uma UC mais três PL de outra UC — último recurso.",
  },
];

/**
 * Configuração por omissão. Cada default está aqui porque é uma convenção
 * genérica do ensino superior ou uma capacidade física declarada pela escola,
 * NÃO porque replique um horário concreto. Sempre que um destes valores é
 * usado, o carregador regista-o no relatório.
 */
export function configuracaoPadrao(): ConfiguracaoMotor {
  // Blocos de 2h entre as 08:00 e as 20:00: a grelha padrão do ensino superior.
  const horaAbertura = "08:00";
  const horaFecho = "20:00";
  const duracaoBlocoHoras = 2;

  return {
    grelha: {
      dias: [...DIAS_UTEIS_PADRAO],
      horaAbertura,
      horaFecho,
      duracaoBlocoHoras,
      horasInicio: derivarHorasInicio(horaAbertura, horaFecho, duracaoBlocoHoras),
      // Convenção: um bloco que começa às 14:00 ou depois é da tarde.
      limiarTardeHora: 14,
      // O almoço fica protegido entre o último bloco da manhã e o primeiro da
      // tarde: ocupar um bloqueia o outro para o mesmo grupo de estudantes.
      pausaAlmoco: { horaAntes: "12:00", horaDepois: "14:00" },
    },
    estruturaTurmas: {
      // Estrutura mínima viável e genérica: duas famílias, cada uma dividida em
      // TP e cada TP em PL. Os números concretos vêm sempre do Supabase.
      turmasTeoricas: 2,
      nomesTurmasTeoricas: [],
      tpPorTurmaTeorica: 4,
      plPorTP: 3,
      meioCohortsPorFamilia: 2,
      prefixos: { teorica: "T", tp: "TP", pl: "PL" },
    },
    padroesBloco: {
      exigirCoberturaTotal: true,
      padroes: PADROES_BLOCO_PADRAO.map((p) => ({ ...p })),
      percentagensOcupacao: {},
      emparelhamentosPreferenciais: [],
    },
    // Vazio de propósito: sem regra vinda do Supabase, NÃO se assume nenhuma
    // janela de dias. Assumir uma seria inventar um layout concreto. O
    // carregador reporta a ausência como regra em falta, com destaque para as T.
    janelasPorTipo: [],
    capacidade: {
      // Seis laboratórios partilhados por toda a escola — capacidade física
      // declarada pela instituição, transversal a anos e turmas.
      maxPLporMancha: 6,
      maxTPporMancha: null,
      // LIMITES UNIVERSAIS de composição de bloco, supletivos de toda a escola.
      // Duas TP da mesma UC em simultâneo é o que duas docentes conseguem dar;
      // três PL da mesma UC é um desdobramento completo de práticas. São eles
      // que tornam impossíveis, por aritmética, os blocos de 4 TP da mesma UC,
      // de 6 PL da mesma UC e de 3 TP da mesma UC. Uma UC pode declarar menos,
      // nunca mais.
      maxTPporUCporMancha: 2,
      maxPLporUCporMancha: 3,
      ambitoContagem: "bloco",
      poolsSala: [],
    },
    limitesPorUC: [],
    cargaDiaria: {
      transversal: {
        // 6h/dia como alvo e 8h como teto absoluto: prática corrente e o que a
        // escola declara. `maxDiasNoMaximoPorSemana` igual ao número de dias
        // úteis significa "sem restrição adicional" na ausência de regra.
        alvoHoras: 6,
        maxHoras: 8,
        maxDiasNoMaximoPorSemana: DIAS_UTEIS_PADRAO.length,
        evitarDiasParciais: false,
      },
      porAno: {},
    },
    precedencias: [],
    // Sem tabela declarada, a precedência escalonada não existe e vale o rácio
    // proporcional. A tabela é dado do Supabase, por UC.
    precedenciasEscalonadas: [],
    ritmoTP: {
      // Duas SEMANAS de desvio é o que o horário de referência do coordenador
      // pratica, de forma uniforme em todas as UCs e nas duas famílias.
      //
      // A contagem em blocos, que era o que aqui estava, media a coisa errada:
      // com um único bloco de folga todas as UCs se sincronizavam nos mesmos
      // desdobramentos, deixava de existir procura para emparelhar TP com TP e
      // a composição dos blocos a 100% ficava sem parceiros.
      ativo: true,
      unidade: "semanas",
      maxDesvioBlocos: 2,
      maxDesvioSemanas: 2,
      ambito: "familia",
    },
    maratonaUC: {
      // Três blocos seguidos (6h) é o que o horário de referência pratica e o
      // coordenador aceita; o que se proíbe é o dia com mais do que três blocos
      // da mesma UC (as 8h/dia da queixa original).
      ativo: true,
      maxBlocosSeguidosMesmaUC: 3,
      maxBlocosMesmaUCporDia: 3,
    },
    tpPLmesmaUC: {
      // Desligada por omissão: a referência junta TP e PL da mesma UC na mesma
      // mancha com docentes diferentes. Liga-se por regra, para as UCs em que a
      // docente seja de facto a mesma.
      ativo: false,
    },
    restricoesUC: [],
    layoutsFixos: [],
    turnos: {
      // Sem regra, não se assume nenhuma rotação de turnos: as duas famílias
      // podem usar qualquer período. `{}` = indefinido, e o carregador reporta.
      familiaDeManhaPorSemestre: {},
      excecoes: [],
      semanasTurmaUnica: [],
    },
    calendario: {
      dataFim: null,
      semanaMaximaGlobal: null,
      // 15 semanas por semestre e fronteira na 15 é a convenção do ano letivo
      // de dois semestres com 30 semanas globais.
      fronteiraSemestre: 15,
      semanasPorSemestre: 15,
      bloqueios: [],
      semanasPersonalizadas: [],
      pausasNaoContamNaNumeracao: true,
      origem: "(default)",
    },
    aulasTConjuntas: [],
    conflitosUC: [],
    preferencias: {
      preferirSextaLivre: true,
      diasPrioritarios: [],
      diasPermitidosPL: [],
    },
    racioTPPL: {
      // O rácio proporcional TP->PL é a garantia pedagógica central da Fase 6B:
      // a prática nunca deve ultrapassar percentualmente a teórico-prática que
      // a sustenta.
      //
      // DESLIGADO POR OMISSÃO, TEMPORARIAMENTE. O rácio avalia-se por ordem de
      // CALENDÁRIO, mas o alocador da Fase 3B decide por ordem de CUSTO: uma
      // colocação válida no momento da decisão fica inválida quando, mais tarde,
      // se preenchem PL de semanas anteriores sem a TP correspondente. Medido:
      // com o rácio ativo a completude cai de 98,7% para 96,3% e sobram 93
      // violações residuais — e a tolerância não corrige (0,1 piora para 95,8%),
      // porque mascara um problema de ordem, não um rácio demasiado apertado.
      //
      // Volta a `true` quando o planeador semanal da Fase 6A planear as semanas
      // por ordem cronológica. A restrição em si está correta e testada.
      ativo: false,
      tolerancia: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 17. Validadores de domínio
// ---------------------------------------------------------------------------

export function validarGrelha(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<GrelhaHoraria> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a grelha horária tem de ser um objeto.");
    return undefined;
  }
  const g: Partial<GrelhaHoraria> = {};
  const dias = valListaTexto(bruto.dias, `${caminho}/dias`, d);
  if (dias) {
    if (dias.length === 0) registarErro(d, `${caminho}/dias`, "a lista de dias úteis não pode ser vazia.");
    else g.dias = dias;
  }
  const abertura = valHora(bruto.horaAbertura, `${caminho}/horaAbertura`, d);
  if (abertura) g.horaAbertura = abertura;
  const fecho = valHora(bruto.horaFecho, `${caminho}/horaFecho`, d);
  if (fecho) g.horaFecho = fecho;
  if (abertura && fecho && horaParaMinutos(abertura) >= horaParaMinutos(fecho)) {
    registarErro(d, caminho, `a hora de abertura (${abertura}) tem de ser anterior à de fecho (${fecho}).`);
    delete g.horaAbertura;
    delete g.horaFecho;
  }
  const dur = valNumero(bruto.duracaoBlocoHoras, `${caminho}/duracaoBlocoHoras`, d, { min: 0.5, max: 8 });
  if (dur !== undefined) g.duracaoBlocoHoras = dur;
  const horas = valLista(bruto.horasInicio, `${caminho}/horasInicio`, d, valHora);
  if (horas && horas.length > 0) g.horasInicio = horas;
  const limiar = valNumero(bruto.limiarTardeHora, `${caminho}/limiarTardeHora`, d, { min: 0, max: 23, inteiro: true });
  if (limiar !== undefined) g.limiarTardeHora = limiar;
  if (bruto.pausaAlmoco === null) {
    g.pausaAlmoco = null;
  } else if (bruto.pausaAlmoco !== undefined) {
    if (!ehObjeto(bruto.pausaAlmoco)) {
      registarErro(d, `${caminho}/pausaAlmoco`, "a pausa de almoço tem de ser um objeto ou nulo.");
    } else {
      const antes = valHora(bruto.pausaAlmoco.horaAntes, `${caminho}/pausaAlmoco/horaAntes`, d);
      const depois = valHora(bruto.pausaAlmoco.horaDepois, `${caminho}/pausaAlmoco/horaDepois`, d);
      if (antes && depois) {
        if (horaParaMinutos(antes) >= horaParaMinutos(depois)) {
          registarErro(
            d,
            `${caminho}/pausaAlmoco`,
            `a hora anterior ao almoço (${antes}) tem de ser mais cedo do que a posterior (${depois}).`,
          );
        } else {
          g.pausaAlmoco = { horaAntes: antes, horaDepois: depois };
        }
      }
    }
  }
  return g;
}

export function validarEstruturaTurmas(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<EstruturaTurmas> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a estrutura de turmas tem de ser um objeto.");
    return undefined;
  }
  const e: Partial<EstruturaTurmas> = {};
  const t = valNumero(bruto.turmasTeoricas, `${caminho}/turmasTeoricas`, d, { min: 1, max: 20, inteiro: true });
  if (t !== undefined) e.turmasTeoricas = t;
  const tp = valNumero(bruto.tpPorTurmaTeorica, `${caminho}/tpPorTurmaTeorica`, d, { min: 1, max: 40, inteiro: true });
  if (tp !== undefined) e.tpPorTurmaTeorica = tp;
  const pl = valNumero(bruto.plPorTP, `${caminho}/plPorTP`, d, { min: 1, max: 20, inteiro: true });
  if (pl !== undefined) e.plPorTP = pl;
  const mc = valNumero(bruto.meioCohortsPorFamilia, `${caminho}/meioCohortsPorFamilia`, d, {
    min: 1,
    max: 10,
    inteiro: true,
  });
  if (mc !== undefined) e.meioCohortsPorFamilia = mc;
  const nomes = valListaTexto(bruto.nomesTurmasTeoricas, `${caminho}/nomesTurmasTeoricas`, d);
  if (nomes) e.nomesTurmasTeoricas = nomes;
  if (ehObjeto(bruto.prefixos)) {
    const teorica = valTexto(bruto.prefixos.teorica, `${caminho}/prefixos/teorica`, d, { naoVazio: true });
    const pTp = valTexto(bruto.prefixos.tp, `${caminho}/prefixos/tp`, d, { naoVazio: true });
    const pPl = valTexto(bruto.prefixos.pl, `${caminho}/prefixos/pl`, d, { naoVazio: true });
    if (teorica && pTp && pPl) e.prefixos = { teorica, tp: pTp, pl: pPl };
  } else if (bruto.prefixos !== undefined) {
    registarErro(d, `${caminho}/prefixos`, "os prefixos das turmas têm de ser um objeto com teorica, tp e pl.");
  }
  if (e.turmasTeoricas !== undefined && e.nomesTurmasTeoricas && e.nomesTurmasTeoricas.length > 0) {
    if (e.nomesTurmasTeoricas.length !== e.turmasTeoricas) {
      registarErro(
        d,
        `${caminho}/nomesTurmasTeoricas`,
        `foram indicados ${e.nomesTurmasTeoricas.length} nomes de turma teórica mas a estrutura declara ${e.turmasTeoricas}.`,
      );
      delete e.nomesTurmasTeoricas;
    }
  }
  return e;
}

export function validarPadroesBloco(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<RegrasPadroesBloco> & { ativos?: IdPadraoBloco[]; ultimoRecurso?: IdPadraoBloco } | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a configuração de blocos a 100% tem de ser um objeto.");
    return undefined;
  }
  const saida: Partial<RegrasPadroesBloco> & { ativos?: IdPadraoBloco[]; ultimoRecurso?: IdPadraoBloco } = {};

  const cobertura = valBooleano(bruto.exigirCoberturaTotal, `${caminho}/exigirCoberturaTotal`, d);
  if (cobertura !== undefined) saida.exigirCoberturaTotal = cobertura;

  const ativos = valLista(bruto.padroesAtivos, `${caminho}/padroesAtivos`, d, (b, c, dd) =>
    valIdPadrao(b, c, dd),
  );
  if (ativos) {
    if (ativos.length === 0) {
      registarErro(d, `${caminho}/padroesAtivos`, "a lista de padrões ativos não pode ser vazia — sem padrões nenhum bloco fecha a 100%.");
    } else {
      saida.ativos = ativos;
    }
  }

  // `padraoAEvitar` é o nome histórico do padrão de último recurso.
  const evitarBruto = bruto.padraoUltimoRecurso ?? bruto.padraoAEvitar;
  const evitar = valIdPadrao(evitarBruto, `${caminho}/padraoUltimoRecurso`, d);
  if (evitar) saida.ultimoRecurso = evitar;

  if (bruto.custosPadroes !== undefined) {
    if (!ehObjeto(bruto.custosPadroes)) {
      registarErro(d, `${caminho}/custosPadroes`, "os custos dos padrões têm de ser um objeto {padrão: custo}.");
    } else {
      const custos: PadraoBloco[] = [];
      for (const [chave, valor] of Object.entries(bruto.custosPadroes)) {
        const id = valIdPadrao(chave, `${caminho}/custosPadroes/${chave}`, d);
        if (!id) continue;
        const custo = valNumero(valor, `${caminho}/custosPadroes/${chave}`, d, { min: 0 });
        if (custo === undefined) continue;
        custos.push({
          id,
          ativo: true,
          custo,
          ultimoRecurso: false,
          descricao: "",
        });
      }
      if (custos.length > 0) saida.padroes = custos;
    }
  }

  if (bruto.percentagens !== undefined) {
    if (!ehObjeto(bruto.percentagens)) {
      registarErro(d, `${caminho}/percentagens`, "as percentagens de ocupação têm de ser um objeto {tipo: percentagem}.");
    } else {
      const pct: Partial<Record<TipoAula, number>> = {};
      for (const [chave, valor] of Object.entries(bruto.percentagens)) {
        const tipo = valEnum(chave, `${caminho}/percentagens/${chave}`, d, TIPOS_AULA);
        if (!tipo) continue;
        const v = valNumero(valor, `${caminho}/percentagens/${chave}`, d, { min: 0, max: 100 });
        if (v !== undefined) pct[tipo] = v;
      }
      saida.percentagensOcupacao = pct;
    }
  }

  const emparelhamentos: EmparelhamentoPreferencial[] = [];
  const pares = valLista(bruto.paresTP2Prioritarios, `${caminho}/paresTP2Prioritarios`, d, (b, c, dd) => {
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada par prioritário tem de ser um objeto.");
      return undefined;
    }
    const siglas = valListaTexto(b.siglas, `${c}/siglas`, dd) ?? [];
    const qtd = valNumero(b.quantidadePorFamilia, `${c}/quantidadePorFamilia`, dd, { min: 0, inteiro: true });
    return { siglasTP: siglas, siglasPL: [], quantidadePorFamilia: qtd ?? null, origem: caminho };
  });
  if (pares) emparelhamentos.push(...pares);

  const cruzamentos = valLista(bruto.cruzamentosTPPLPrioritarios, `${caminho}/cruzamentosTPPLPrioritarios`, d, (b, c, dd) => {
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada cruzamento prioritário tem de ser um objeto.");
      return undefined;
    }
    const siglaTP = valTexto(b.siglaTP, `${c}/siglaTP`, dd, { naoVazio: true });
    const siglasPL = valListaTexto(b.siglasPL, `${c}/siglasPL`, dd) ?? [];
    if (!siglaTP) return undefined;
    return { siglasTP: [siglaTP], siglasPL, quantidadePorFamilia: null, origem: caminho };
  });
  if (cruzamentos) emparelhamentos.push(...cruzamentos);

  if (emparelhamentos.length > 0) saida.emparelhamentosPreferenciais = emparelhamentos;

  const sexta = valBooleano(bruto.preferirSextaLivre, `${caminho}/preferirSextaLivre`, d);
  if (sexta !== undefined) (saida as any).preferirSextaLivre = sexta;

  return saida;
}

export function validarJanelaTipoAula(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  origem: string,
): JanelaTipoAula | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada janela de tipo de aula tem de ser um objeto.");
    return undefined;
  }
  const tipo = valEnum(bruto.tipo, `${caminho}/tipo`, d, TIPOS_AULA);
  if (!tipo) {
    registarErro(d, caminho, "a janela não indica a que tipo de aula se aplica (T, TP, PL ou S).");
    return undefined;
  }
  const modo = valEnum(bruto.modo, `${caminho}/modo`, d, ["veto", "preferencia"] as const) ?? "veto";
  const janelas = valLista(bruto.janelas, `${caminho}/janelas`, d, (b, c, dd) => {
    if (typeof b === "string") {
      const dia = valTexto(b, c, dd, { naoVazio: true });
      return dia ? { dia, periodos: [] as Periodo[], horas: [] as string[] } : undefined;
    }
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada entrada da janela tem de ser um dia (texto) ou um objeto {dia, periodos, horas}.");
      return undefined;
    }
    const dia = valTexto(b.dia, `${c}/dia`, dd, { naoVazio: true });
    if (!dia) return undefined;
    const periodos = valLista(b.periodos, `${c}/periodos`, dd, (x, cc, ddd) => valEnum(x, cc, ddd, PERIODOS)) ?? [];
    const horas = valLista(b.horas, `${c}/horas`, dd, valHora) ?? [];
    return { dia, periodos, horas };
  });
  if (!janelas || janelas.length === 0) {
    registarErro(
      d,
      `${caminho}/janelas`,
      `a janela do tipo ${tipo} não lista nenhum dia — uma janela vazia proibiria todas as aulas deste tipo.`,
    );
    return undefined;
  }
  const ordem = valListaTexto(bruto.ordemPreferenciaDias, `${caminho}/ordemPreferenciaDias`, d) ?? [];
  return { tipo, modo, janelas, ordemPreferenciaDias: ordem, origem };
}

export function validarCargaDiaria(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<RegrasCargaDiaria> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a carga diária do estudante tem de ser um objeto.");
    return undefined;
  }
  const c: Partial<RegrasCargaDiaria> = {};
  const alvo = valNumero(bruto.alvoHoras, `${caminho}/alvoHoras`, d, { min: 0, max: 24 });
  if (alvo !== undefined) c.alvoHoras = alvo;
  const max = valNumero(bruto.maxHoras, `${caminho}/maxHoras`, d, { min: 0, max: 24 });
  if (max !== undefined) c.maxHoras = max;
  if (c.alvoHoras !== undefined && c.maxHoras !== undefined && c.alvoHoras > c.maxHoras) {
    registarErro(
      d,
      caminho,
      `a carga-alvo (${c.alvoHoras}h) não pode ser superior ao máximo diário (${c.maxHoras}h).`,
    );
    delete c.alvoHoras;
  }
  const dias = valNumero(bruto.maxDiasNoMaximoPorSemana, `${caminho}/maxDiasNoMaximoPorSemana`, d, {
    min: 0,
    max: 7,
    inteiro: true,
  });
  if (dias !== undefined) c.maxDiasNoMaximoPorSemana = dias;
  const parciais = valBooleano(bruto.evitarDiasParciais, `${caminho}/evitarDiasParciais`, d);
  if (parciais !== undefined) c.evitarDiasParciais = parciais;
  return c;
}

export function validarPrecedencia(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  anos: number[],
  origem: string,
): PrecedenciaUC | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada precedência tem de ser um objeto.");
    return undefined;
  }
  const tipoAntes = valEnum(bruto.tipoAntes, `${caminho}/tipoAntes`, d, TIPOS_AULA);
  const tipoDepois = valEnum(bruto.tipoDepois, `${caminho}/tipoDepois`, d, TIPOS_AULA);
  if (!tipoAntes || !tipoDepois) {
    registarErro(d, caminho, "a precedência tem de indicar tipoAntes e tipoDepois (T, TP, PL ou S).");
    return undefined;
  }
  if (tipoAntes === tipoDepois) {
    registarErro(d, caminho, `tipoAntes e tipoDepois são ambos ${tipoAntes}: uma aula não pode preceder-se a si própria.`);
    return undefined;
  }
  const minimo = valNumero(bruto.minimoAntes, `${caminho}/minimoAntes`, d, { min: 0 });
  if (minimo === undefined) {
    registarErro(d, caminho, "a precedência tem de indicar `minimoAntes` (quantidade mínima do tipo anterior).");
    return undefined;
  }
  const unidade = valEnum(bruto.unidade, `${caminho}/unidade`, d, ["blocos", "horas"] as const) ?? "blocos";
  const contagem = valEnum(bruto.contagem, `${caminho}/contagem`, d, ["porTurma", "todas"] as const) ?? "porTurma";
  const siglas = valListaTexto(bruto.siglas, `${caminho}/siglas`, d) ?? [];
  return { siglas, tipoAntes, tipoDepois, minimoAntes: minimo, unidade, contagem, anos, origem };
}

/**
 * Tabela de precedência escalonada de uma UC (ou de um conjunto de UCs).
 *
 * Aceita a forma tabular que as coordenações escrevem: uma linha por escalão,
 * com a ordem da última PL a que o escalão se aplica e o que tem de estar dado
 * antes. `ateNesimaPL` também se pode dar como intervalo (`de`/`ate`), porque é
 * assim que a tabela aparece nos emails ("1.ª e 2.ª PL", "8.ª, 9.ª e 10.ª PL").
 */
export function validarPrecedenciaEscalonada(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  anos: number[],
  origem: string,
): PrecedenciaEscalonadaUC | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada tabela de precedência escalonada tem de ser um objeto.");
    return undefined;
  }
  const siglas = valListaTexto(bruto.siglas, `${caminho}/siglas`, d) ?? [];
  const escaloes = valLista(bruto.escaloes, `${caminho}/escaloes`, d, (b, c, dd) => {
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada escalão tem de ser um objeto {ateNesimaPL, minimoT, minimoTP}.");
      return undefined;
    }
    const ate =
      valNumero(b.ateNesimaPL, `${c}/ateNesimaPL`, dd, { min: 1, inteiro: true }) ??
      valNumero(b.ate, `${c}/ate`, dd, { min: 1, inteiro: true });
    if (ate === undefined) {
      registarErro(dd, c, "o escalão tem de indicar `ateNesimaPL` (a ordem da última PL a que se aplica).");
      return undefined;
    }
    const minimoT = valNumero(b.minimoT, `${c}/minimoT`, dd, { min: 0, inteiro: true }) ?? 0;
    const minimoTP = valNumero(b.minimoTP, `${c}/minimoTP`, dd, { min: 0, inteiro: true }) ?? 0;
    return { ateNesimaPL: ate, minimoT, minimoTP };
  });
  if (!escaloes || escaloes.length === 0) {
    registarErro(d, caminho, "a tabela de precedência escalonada não tem nenhum escalão.");
    return undefined;
  }
  escaloes.sort((a, b) => a.ateNesimaPL - b.ateNesimaPL);
  return { siglas, anos, escaloes, origem };
}

export function validarRitmoTP(bruto: unknown, caminho: string, d: Diagnosticos): Partial<RegraRitmoTP> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "o ritmo das turmas TP tem de ser um objeto.");
    return undefined;
  }
  const saida: Partial<RegraRitmoTP> = {};
  const ativo = valBooleano(bruto.ativo, `${caminho}/ativo`, d);
  if (ativo !== undefined) saida.ativo = ativo;
  const unidade = valEnum(bruto.unidade, `${caminho}/unidade`, d, ["blocos", "semanas"] as const);
  if (unidade) saida.unidade = unidade;
  const desvio = valNumero(bruto.maxDesvioBlocos, `${caminho}/maxDesvioBlocos`, d, { min: 0, inteiro: true });
  if (desvio !== undefined) saida.maxDesvioBlocos = desvio;
  const semanas = valNumero(bruto.maxDesvioSemanas, `${caminho}/maxDesvioSemanas`, d, { min: 0, inteiro: true });
  if (semanas !== undefined) saida.maxDesvioSemanas = semanas;
  const ambito = valEnum(bruto.ambito, `${caminho}/ambito`, d, ["familia", "uc"] as const);
  if (ambito) saida.ambito = ambito;
  return saida;
}

export function validarMaratonaUC(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<RegraMaratonaUC> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a regra de blocos seguidos da mesma UC tem de ser um objeto.");
    return undefined;
  }
  const saida: Partial<RegraMaratonaUC> = {};
  const ativo = valBooleano(bruto.ativo, `${caminho}/ativo`, d);
  if (ativo !== undefined) saida.ativo = ativo;
  const max = valNumero(bruto.maxBlocosSeguidosMesmaUC, `${caminho}/maxBlocosSeguidosMesmaUC`, d, {
    min: 0,
    inteiro: true,
  });
  if (max !== undefined) saida.maxBlocosSeguidosMesmaUC = max;
  const porDia = valNumero(bruto.maxBlocosMesmaUCporDia, `${caminho}/maxBlocosMesmaUCporDia`, d, {
    min: 0,
    inteiro: true,
  });
  if (porDia !== undefined) saida.maxBlocosMesmaUCporDia = porDia;
  return saida;
}

export function validarTPPLmesmaUC(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<RegraTPPLmesmaUC> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a regra de TP e PL da mesma UC na mesma mancha tem de ser um objeto.");
    return undefined;
  }
  const saida: Partial<RegraTPPLmesmaUC> = {};
  const ativo = valBooleano(bruto.ativo, `${caminho}/ativo`, d);
  if (ativo !== undefined) saida.ativo = ativo;
  return saida;
}

export function validarRestricaoUC(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  anos: number[],
  origem: string,
): RestricaoUC | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada restrição por UC tem de ser um objeto.");
    return undefined;
  }
  const siglas = valListaTexto(bruto.siglas, `${caminho}/siglas`, d) ?? [];
  const tipos = valLista(bruto.tipos, `${caminho}/tipos`, d, (b, c, dd) => valEnum(b, c, dd, TIPOS_AULA)) ?? [];
  const diasProibidos = valListaTexto(bruto.diasProibidos, `${caminho}/diasProibidos`, d) ?? [];
  const periodosProibidos =
    valLista(bruto.periodosProibidos, `${caminho}/periodosProibidos`, d, (b, c, dd) => valEnum(b, c, dd, PERIODOS)) ??
    [];
  const semanas = valListaInteiros(bruto.semanasRestritas, `${caminho}/semanasRestritas`, d, { min: 1 }) ?? [];
  const semestre = valNumero(bruto.semestre, `${caminho}/semestre`, d, { min: 1, max: 2, inteiro: true });
  if (diasProibidos.length === 0 && periodosProibidos.length === 0) {
    registarErro(
      d,
      caminho,
      "a restrição não proíbe nada: tem de indicar pelo menos `diasProibidos` ou `periodosProibidos`.",
    );
    return undefined;
  }
  return {
    siglas, tipos, diasProibidos, periodosProibidos,
    semanasRestritas: semanas, semestre: semestre ?? null, anos, origem,
  };
}

export function validarLayoutFixo(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  origem: string,
): LayoutFixoSemanas | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "o layout fixo tem de ser um objeto.");
    return undefined;
  }
  const ano = valNumero(bruto.ano, `${caminho}/ano`, d, { min: 1, max: 10, inteiro: true });
  const semestre = valNumero(bruto.semestre, `${caminho}/semestre`, d, { min: 1, max: 2, inteiro: true });
  const sessoes = valLista(bruto.sessoes, `${caminho}/sessoes`, d, (b, c, dd) => {
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada sessão do layout fixo tem de ser um objeto.");
      return undefined;
    }
    const semana = valNumero(b.semana, `${c}/semana`, dd, { min: 1, inteiro: true });
    const dia = valTexto(b.dia, `${c}/dia`, dd, { naoVazio: true });
    const hora = valHora(b.hora, `${c}/hora`, dd);
    const ucSigla = valTexto(b.uc ?? b.ucSigla, `${c}/uc`, dd, { naoVazio: true });
    const tipo = valEnum(b.tipo, `${c}/tipo`, dd, TIPOS_AULA);
    const turmas = valListaTexto(b.turmas, `${c}/turmas`, dd) ?? [];
    if (semana === undefined || !dia || !hora || !ucSigla || !tipo) {
      registarErro(dd, c, "a sessão do layout fixo tem de indicar semana, dia, hora, uc e tipo.");
      return undefined;
    }
    if (turmas.length === 0) {
      registarErro(dd, `${c}/turmas`, "a sessão do layout fixo tem de indicar pelo menos uma turma.");
      return undefined;
    }
    return { semana, dia, hora, ucSigla, tipo, turmas };
  });
  if (!sessoes || sessoes.length === 0) {
    registarErro(d, `${caminho}/sessoes`, "o layout fixo não tem nenhuma sessão utilizável.");
    return undefined;
  }
  return { ano: ano ?? null, semestre: semestre ?? null, sessoes, origem };
}

export function validarAulaTConjunta(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  origem: string,
): AulaTConjunta | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada regra de aula T conjunta tem de ser um objeto.");
    return undefined;
  }
  const anos = valListaInteiros(bruto.anos, `${caminho}/anos`, d, { min: 1 }) ?? [];
  const semanas = valListaInteiros(bruto.semanas, `${caminho}/semanas`, d, { min: 1 }) ?? [];
  const dias = valListaTexto(bruto.dias, `${caminho}/dias`, d) ?? [];
  const horarios = valLista(bruto.horarios, `${caminho}/horarios`, d, valHora) ?? [];
  const sala = valTexto(bruto.sala, `${caminho}/sala`, d) ?? "";
  const obrigatoria = valBooleano(bruto.obrigatoriaPorDia, `${caminho}/obrigatoriaPorDia`, d) ?? false;
  const siglas = valListaTexto(bruto.siglasObrigatorias, `${caminho}/siglasObrigatorias`, d) ?? [];
  if (dias.length === 0 && horarios.length === 0 && semanas.length === 0) {
    registarErro(
      d,
      caminho,
      "a regra de aula T conjunta não delimita nada: indique pelo menos semanas, dias ou horários.",
    );
    return undefined;
  }
  return { anos, semanas, dias, horarios, sala, obrigatoriaPorDia: obrigatoria, siglasObrigatorias: siglas, origem };
}

export function validarPoolSala(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
  origem: string,
): PoolSala | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada conjunto de salas tem de ser um objeto.");
    return undefined;
  }
  const id = valTexto(bruto.id, `${caminho}/id`, d, { naoVazio: true });
  const max = valNumero(bruto.maxSimultaneo, `${caminho}/maxSimultaneo`, d, { min: 1, inteiro: true });
  if (!id || max === undefined) {
    registarErro(d, caminho, "o conjunto de salas tem de indicar `id` e `maxSimultaneo`.");
    return undefined;
  }
  const conta = valBooleano(bruto.contaParaMaximoGlobalPL, `${caminho}/contaParaMaximoGlobalPL`, d) ?? true;
  const descricao = valTexto(bruto.descricao, `${caminho}/descricao`, d) ?? "";
  const siglas = valListaTexto(bruto.siglas, `${caminho}/siglas`, d) ?? [];
  return { id, descricao, maxSimultaneo: max, contaParaMaximoGlobalPL: conta, siglas, origem };
}

export function validarTurnos(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): { familiaDeManhaPorSemestre?: Record<number, Familia>; excecoes?: ExcecaoTurno[] } | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "a regra de turnos tem de ser um objeto.");
    return undefined;
  }
  const saida: { familiaDeManhaPorSemestre?: Record<number, Familia>; excecoes?: ExcecaoTurno[] } = {};
  if (bruto.familiaDeManhaPorSemestre !== undefined) {
    if (!ehObjeto(bruto.familiaDeManhaPorSemestre)) {
      registarErro(
        d,
        `${caminho}/familiaDeManhaPorSemestre`,
        "esperava um objeto {semestre: família}, por exemplo {\"1\": \"A\", \"2\": \"B\"}.",
      );
    } else {
      const mapa: Record<number, Familia> = {};
      for (const [chave, valor] of Object.entries(bruto.familiaDeManhaPorSemestre)) {
        const sem = valNumero(chave, `${caminho}/familiaDeManhaPorSemestre/${chave}`, d, {
          min: 1,
          max: 2,
          inteiro: true,
        });
        const fam = valEnum(valor, `${caminho}/familiaDeManhaPorSemestre/${chave}`, d, FAMILIAS);
        if (sem !== undefined && fam) mapa[sem] = fam;
      }
      if (Object.keys(mapa).length > 0) saida.familiaDeManhaPorSemestre = mapa;
    }
  }
  const excecoes = valLista(bruto.excecoes, `${caminho}/excecoes`, d, (b, c, dd) => {
    if (!ehObjeto(b)) {
      registarErro(dd, c, "cada exceção de turno tem de ser um objeto.");
      return undefined;
    }
    const semestre = valNumero(b.semestre, `${c}/semestre`, dd, { min: 1, max: 2, inteiro: true });
    const ini = valNumero(b.semanaInicio, `${c}/semanaInicio`, dd, { min: 1, inteiro: true });
    const fim = valNumero(b.semanaFim, `${c}/semanaFim`, dd, { min: 1, inteiro: true });
    const fam = valEnum(b.familiaDeManha, `${c}/familiaDeManha`, dd, FAMILIAS);
    if (semestre === undefined || ini === undefined || fim === undefined || !fam) {
      registarErro(dd, c, "a exceção de turno tem de indicar semestre, semanaInicio, semanaFim e familiaDeManha.");
      return undefined;
    }
    if (ini > fim) {
      registarErro(dd, c, `a semana inicial (${ini}) é posterior à final (${fim}).`);
      return undefined;
    }
    return { semestre, semanaInicio: ini, semanaFim: fim, familiaDeManha: fam };
  });
  if (excecoes) saida.excecoes = excecoes;
  return saida;
}

export function validarBloqueioCalendario(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): BloqueioCalendario | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada bloqueio de calendário tem de ser um objeto.");
    return undefined;
  }
  const inicio = valData(bruto.dataInicio, `${caminho}/dataInicio`, d);
  const fim = valData(bruto.dataFim, `${caminho}/dataFim`, d);
  if (!inicio || !fim) {
    registarErro(d, caminho, "o bloqueio de calendário tem de indicar `dataInicio` e `dataFim`.");
    return undefined;
  }
  if (Date.parse(inicio) > Date.parse(fim)) {
    registarErro(d, caminho, `a data de início (${inicio}) é posterior à data de fim (${fim}).`);
    return undefined;
  }
  const nome = valTexto(bruto.nome, `${caminho}/nome`, d) ?? "";
  const tipo = valTexto(bruto.tipo, `${caminho}/tipo`, d) ?? "Interrupção Letiva";
  return { nome, tipo, dataInicio: inicio, dataFim: fim };
}

export function validarSemanaPersonalizada(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): SemanaPersonalizadaRegra | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada semana personalizada tem de ser um objeto.");
    return undefined;
  }
  const numero = valNumero(bruto.numero, `${caminho}/numero`, d, { min: 1, inteiro: true });
  const seg = valData(bruto.dataSegunda, `${caminho}/dataSegunda`, d);
  const sex = valData(bruto.dataSexta, `${caminho}/dataSexta`, d);
  if (numero === undefined || !seg || !sex) {
    registarErro(d, caminho, "a semana personalizada tem de indicar `numero`, `dataSegunda` e `dataSexta`.");
    return undefined;
  }
  if (Date.parse(seg) > Date.parse(sex)) {
    registarErro(d, caminho, `a segunda-feira (${seg}) é posterior à sexta-feira (${sex}).`);
    return undefined;
  }
  const isPausa = valBooleano(bruto.isPausa, `${caminho}/isPausa`, d) ?? false;
  const motivo = valTexto(bruto.motivoPausa, `${caminho}/motivoPausa`, d) ?? "";
  return { numero, dataSegunda: seg, dataSexta: sex, isPausa, motivoPausa: motivo };
}

export function validarLimitesUC(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): LimitesPorUC | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "cada unidade curricular tem de ser um objeto.");
    return undefined;
  }
  const ucId = valTexto(bruto.id, `${caminho}/id`, d, { naoVazio: true }) ?? "";
  const sigla = valTexto(bruto.sigla, `${caminho}/sigla`, d, { naoVazio: true });
  if (!sigla) {
    registarErro(d, caminho, "a unidade curricular não tem sigla: sem ela não é possível aplicar regras por UC.");
    return undefined;
  }
  const leia = (campoSnake: string, campoCamel: string) => {
    const v = (bruto as any)[campoSnake] ?? (bruto as any)[campoCamel];
    if (v === undefined || v === null) return null;
    const n = valNumero(v, `${caminho}/${campoSnake}`, d, { min: 1, inteiro: true });
    return n ?? null;
  };
  return {
    ucId,
    sigla,
    maxSimultaneoT: leia("max_simultaneo_t", "maxSimultaneoT"),
    maxSimultaneoTP: leia("max_simultaneo_tp", "maxSimultaneoTP"),
    maxSimultaneoPL: leia("max_simultaneo_pl", "maxSimultaneoPL"),
  };
}

/** Rácio proporcional TP -> PL (Fase 6B). Ver `RegraRacioTPPL`. */
export function validarRacioTPPL(
  bruto: unknown,
  caminho: string,
  d: Diagnosticos,
): Partial<RegraRacioTPPL> | undefined {
  if (!ehObjeto(bruto)) {
    registarErro(d, caminho, "o rácio TP -> PL tem de ser um objeto.");
    return undefined;
  }
  const saida: Partial<RegraRacioTPPL> = {};
  const ativo = valBooleano(bruto.ativo, `${caminho}/ativo`, d);
  if (ativo !== undefined) saida.ativo = ativo;
  const tolerancia = valNumero(bruto.tolerancia, `${caminho}/tolerancia`, d, { min: 0, max: 1 });
  if (tolerancia !== undefined) saida.tolerancia = tolerancia;
  return saida;
}

// ---------------------------------------------------------------------------
// 18. Coerência global
// ---------------------------------------------------------------------------

/**
 * Verificações que só fazem sentido depois de toda a configuração estar
 * montada (referências cruzadas entre secções).
 */
export function validarCoerencia(cfg: ConfiguracaoMotor): Diagnosticos {
  const d: Diagnosticos = [];
  const dias = new Set(cfg.grelha.dias);
  const horas = new Set(cfg.grelha.horasInicio);

  for (const janela of cfg.janelasPorTipo) {
    for (const j of janela.janelas) {
      if (!dias.has(j.dia)) {
        registarErro(
          d,
          `janelas/${janela.tipo}`,
          `o dia "${j.dia}" não existe na grelha horária (dias válidos: ${cfg.grelha.dias.join(", ")}).`,
        );
      }
      for (const h of j.horas) {
        if (!horas.has(h)) {
          registarErro(
            d,
            `janelas/${janela.tipo}`,
            `a hora "${h}" não é uma hora de início da grelha (${cfg.grelha.horasInicio.join(", ")}).`,
          );
        }
      }
    }
    for (const dia of janela.ordemPreferenciaDias) {
      if (!dias.has(dia)) {
        registarAviso(
          d,
          `janelas/${janela.tipo}`,
          `o dia "${dia}" está na ordem de preferência mas não existe na grelha horária.`,
        );
      }
    }
  }

  for (const r of cfg.restricoesUC) {
    for (const dia of r.diasProibidos) {
      if (!dias.has(dia)) {
        registarAviso(
          d,
          `restricoesUC (${r.origem})`,
          `o dia proibido "${dia}" não existe na grelha horária e por isso não terá efeito.`,
        );
      }
    }
  }

  for (const a of cfg.aulasTConjuntas) {
    for (const dia of a.dias) {
      if (!dias.has(dia)) {
        registarAviso(d, `aulasTConjuntas (${a.origem})`, `o dia "${dia}" não existe na grelha horária.`);
      }
    }
    for (const h of a.horarios) {
      if (!horas.has(h)) {
        registarAviso(d, `aulasTConjuntas (${a.origem})`, `a hora "${h}" não é uma hora de início da grelha.`);
      }
    }
  }

  for (const l of cfg.layoutsFixos) {
    for (const s of l.sessoes) {
      if (!dias.has(s.dia)) {
        registarErro(d, `layoutFixo (${l.origem})`, `o dia "${s.dia}" não existe na grelha horária.`);
      }
      if (!horas.has(s.hora)) {
        registarErro(d, `layoutFixo (${l.origem})`, `a hora "${s.hora}" não é uma hora de início da grelha.`);
      }
    }
  }

  const bloco = cfg.grelha.duracaoBlocoHoras;
  const verificarCarga = (c: RegrasCargaDiaria, ambito: string) => {
    if (c.maxHoras % bloco !== 0) {
      registarAviso(
        d,
        `cargaDiaria/${ambito}`,
        `o máximo diário de ${c.maxHoras}h não é múltiplo do bloco de ${bloco}h; o motor arredonda por defeito.`,
      );
    }
    if (c.maxDiasNoMaximoPorSemana > cfg.grelha.dias.length) {
      registarAviso(
        d,
        `cargaDiaria/${ambito}`,
        `permite ${c.maxDiasNoMaximoPorSemana} dias no máximo mas a semana só tem ${cfg.grelha.dias.length} dias úteis.`,
      );
    }
  };
  verificarCarga(cfg.cargaDiaria.transversal, "transversal");
  for (const [ano, c] of Object.entries(cfg.cargaDiaria.porAno)) verificarCarga(c, `ano ${ano}`);

  // A lista de padrões deixou de ser um veto: a validade de um bloco sai da
  // regra geral (cobertura + limites por UC). O que aqui se verifica é só que a
  // regra geral consegue fechar um bloco — e isso depende dos LIMITES.
  const desdobramentos = cfg.estruturaTurmas.tpPorTurmaTeorica;
  const maxTPporUC = cfg.capacidade.maxTPporUCporMancha ?? desdobramentos;
  const maxPLporUC = cfg.capacidade.maxPLporUCporMancha ?? desdobramentos * cfg.estruturaTurmas.plPorTP;
  if (maxTPporUC <= 0 && maxPLporUC < cfg.estruturaTurmas.plPorTP) {
    registarErro(
      d,
      "capacidade",
      `os limites por UC (${maxTPporUC} TP, ${maxPLporUC} PL) não deixam nenhum grupo entrar num bloco: ` +
        "nenhum bloco conseguiria fechar a 100% das folhas-aluno.",
    );
  }
  const desativados = cfg.padroesBloco.padroes.filter((p) => !p.ativo);
  if (desativados.length > 0) {
    registarAviso(
      d,
      "padroesBloco",
      `${desativados.length} padrão(ões) marcado(s) como inativo(s) (${desativados.map((p) => p.id).join(", ")}): ` +
        "a lista de padrões passou a ser só PREFERÊNCIA e a marca `ativo` já não veta nenhum bloco. " +
        "Para proibir uma composição, baixe os limites `maxTPporUCporMancha`/`maxPLporUCporMancha`.",
    );
  }

  if (cfg.ritmoTP.ativo && cfg.ritmoTP.unidade === "blocos" && cfg.ritmoTP.maxDesvioBlocos < 1) {
    registarErro(
      d,
      "ritmoTP",
      `o desvio máximo entre turmas TP é ${cfg.ritmoTP.maxDesvioBlocos}: com menos de 1 bloco de folga nenhuma ` +
        "turma poderia ser servida antes das outras e o motor não conseguiria colocar a primeira TP.",
    );
  }
  if (cfg.ritmoTP.ativo && cfg.ritmoTP.unidade === "semanas" && cfg.ritmoTP.maxDesvioSemanas < 1) {
    registarAviso(
      d,
      "ritmoTP",
      `o desvio máximo entre turmas TP é de ${cfg.ritmoTP.maxDesvioSemanas} semana(s): as turmas da mesma UC ficam ` +
        "obrigadas a ter a n-ésima aula na MESMA semana, o que só é praticável em UCs com poucos blocos.",
    );
  }
  if (cfg.maratonaUC.ativo && cfg.maratonaUC.maxBlocosSeguidosMesmaUC < 1) {
    registarErro(
      d,
      "maratonaUC",
      `o máximo de blocos seguidos da mesma UC é ${cfg.maratonaUC.maxBlocosSeguidosMesmaUC}: abaixo de 1 nenhuma ` +
        "aula poderia ser colocada.",
    );
  }
  if (cfg.maratonaUC.ativo && cfg.maratonaUC.maxBlocosMesmaUCporDia < 1) {
    registarErro(
      d,
      "maratonaUC",
      `o máximo de blocos da mesma UC por dia é ${cfg.maratonaUC.maxBlocosMesmaUCporDia}: abaixo de 1 nenhuma ` +
        "aula poderia ser colocada.",
    );
  }
  if (cfg.maratonaUC.ativo && cfg.maratonaUC.maxBlocosMesmaUCporDia < cfg.maratonaUC.maxBlocosSeguidosMesmaUC) {
    registarAviso(
      d,
      "maratonaUC",
      `o teto diário da mesma UC (${cfg.maratonaUC.maxBlocosMesmaUCporDia}) é menor do que o de blocos seguidos ` +
        `(${cfg.maratonaUC.maxBlocosSeguidosMesmaUC}): o teto diário passa a ser o único a mandar, porque uma ` +
        "corrida contígua nunca poderá chegar ao seu próprio máximo.",
    );
  }
  for (const p of cfg.precedenciasEscalonadas) {
    let anterior = 0;
    for (const e of p.escaloes) {
      if (e.ateNesimaPL <= anterior) {
        registarErro(
          d,
          "precedenciasEscalonadas",
          `a tabela de ${p.siglas.join(", ") || "todas as UCs"} (${p.origem}) tem escalões fora de ordem: ` +
            `${e.ateNesimaPL} depois de ${anterior}.`,
        );
      }
      anterior = Math.max(anterior, e.ateNesimaPL);
    }
  }

  const poolsSomam = cfg.capacidade.poolsSala
    .filter((p) => p.contaParaMaximoGlobalPL)
    .reduce((s, p) => s + p.maxSimultaneo, 0);
  if (poolsSomam > cfg.capacidade.maxPLporMancha) {
    registarAviso(
      d,
      "capacidade/poolsSala",
      `os conjuntos de salas que contam para o limite global somam ${poolsSomam} sessões, acima do máximo global de ${cfg.capacidade.maxPLporMancha} PL por mancha.`,
    );
  }

  if (
    cfg.calendario.semanaMaximaGlobal !== null &&
    cfg.calendario.semanaMaximaGlobal < cfg.calendario.fronteiraSemestre
  ) {
    registarErro(
      d,
      "calendario",
      `a semana máxima global (${cfg.calendario.semanaMaximaGlobal}) é anterior à fronteira entre semestres (${cfg.calendario.fronteiraSemestre}).`,
    );
  }

  const janelaT = cfg.janelasPorTipo.find((j) => j.tipo === "T");
  if (janelaT && janelaT.modo === "preferencia") {
    registarAviso(
      d,
      "janelas/T",
      "a janela das aulas T está em modo `preferencia`: fora dos dias indicados as T continuam a ser permitidas. Para as impedir, use o modo `veto`.",
    );
  }

  return d;
}

// ---------------------------------------------------------------------------
// 19. O que o motor precisa de encontrar no Supabase
// ---------------------------------------------------------------------------

export interface RegraNecessaria {
  /** Chave em `config.motor` que transporta a regra. */
  chaveMotor: string;
  /** Secção da configuração que preenche. */
  secao: keyof ConfiguracaoMotor;
  /** `true` se a ausência degrada o resultado de forma visível. */
  critica: boolean;
  /** Explicação para o relatório. */
  porque: string;
}

export const REGRAS_NECESSARIAS: readonly RegraNecessaria[] = [
  {
    chaveMotor: "janelasPorTipoAula",
    secao: "janelasPorTipo",
    critica: true,
    porque:
      "sem janela por tipo de aula, as teóricas podem cair em qualquer dia — é a causa das T à terça e à quinta.",
  },
  {
    chaveMotor: "estruturaTurmas",
    secao: "estruturaTurmas",
    critica: true,
    porque: "define quantas turmas T/TP/PL existem e como se desdobram; sem ela o motor usa uma estrutura suposta.",
  },
  {
    chaveMotor: "grelhaHoraria",
    secao: "grelha",
    critica: false,
    porque: "dias úteis, horas de início, duração do bloco e proteção do almoço.",
  },
  {
    chaveMotor: "blocos100",
    secao: "padroesBloco",
    critica: false,
    porque:
      "hierarquia de PREFERÊNCIA entre formas de bloco. Já não veta nada: a validade de um bloco sai da regra " +
      "geral (cobertura das folhas-aluno + limites por UC). Sem a regra, valem os escalões genéricos.",
  },
  {
    chaveMotor: "limitesUniversaisPorUC",
    secao: "capacidade",
    critica: true,
    porque:
      "limites universais de TP e de PL da mesma UC por mancha. São eles que definem que blocos existem: sem " +
      "eles, o motor volta a admitir composições que nenhuma equipa de docentes consegue dar.",
  },
  {
    chaveMotor: "precedenciasEscalonadasPL",
    secao: "precedenciasEscalonadas",
    critica: false,
    porque:
      "tabela por UC de quantas T e TP têm de estar dadas antes da n-ésima PL. Substitui o rácio proporcional " +
      "nas UCs que a declaram; sem tabela, o rácio continua a ser o default.",
  },
  {
    chaveMotor: "ritmoTP",
    secao: "ritmoTP",
    critica: false,
    porque: "desvio máximo entre as turmas TP da mesma UC, para não haver desfasamento entre desdobramentos.",
  },
  {
    chaveMotor: "maratonaUC",
    secao: "maratonaUC",
    critica: false,
    porque:
      "máximo de blocos SEGUIDOS e máximo TOTAL da mesma UC no mesmo dia, para o mesmo grupo de estudantes.",
  },
  {
    chaveMotor: "tpPLmesmaUC",
    secao: "tpPLmesmaUC",
    critica: false,
    porque:
      "proibir TP e PL da mesma UC na mesma mancha. Desligada por omissão: só faz sentido nas UCs em que a " +
      "docente da TP e a da PL sejam a mesma pessoa.",
  },
  {
    chaveMotor: "maxPLporMancha",
    secao: "capacidade",
    critica: false,
    porque: "capacidade física global de PL em simultâneo em toda a escola.",
  },
  {
    chaveMotor: "capacidadeTP",
    secao: "capacidade",
    critica: false,
    porque: "máximo de TP por mancha e de TP da mesma UC por mancha.",
  },
  {
    chaveMotor: "cargaDiariaEstudante",
    secao: "cargaDiaria",
    critica: false,
    porque: "carga-alvo e teto diário do estudante.",
  },
  {
    chaveMotor: "turnos",
    secao: "turnos",
    critica: true,
    porque: "define que família fica de manhã em cada semestre e as exceções por intervalo de semanas.",
  },
  {
    chaveMotor: "limitesCalendario",
    secao: "calendario",
    critica: true,
    porque: "data-limite e última semana global do ano letivo.",
  },
  {
    chaveMotor: "bloqueiosCalendario",
    secao: "calendario",
    critica: true,
    porque: "feriados e interrupções letivas; as pausas são semana zero e não contam na numeração.",
  },
  {
    chaveMotor: "poolsSala",
    secao: "capacidade",
    critica: false,
    porque: "conjuntos de salas com capacidade própria (ex.: salas de informática em paralelo com laboratórios).",
  },
  {
    chaveMotor: "precedenciasUC",
    secao: "precedencias",
    critica: false,
    porque: "precedências entre tipos de aula dentro da mesma UC.",
  },
  {
    chaveMotor: "restricoesUC",
    secao: "restricoesUC",
    critica: false,
    porque: "proibições genéricas de dia/período/semana por UC.",
  },
  {
    chaveMotor: "layoutFixo",
    secao: "layoutsFixos",
    critica: false,
    porque: "semanas com layout imposto, que o motor não recalcula.",
  },
  {
    chaveMotor: "aulasTConjuntas",
    secao: "aulasTConjuntas",
    critica: false,
    porque: "janelas em que as turmas teóricas partilham a mesma aula e sala.",
  },
  {
    chaveMotor: "conflitosUC",
    secao: "conflitosUC",
    critica: false,
    porque: "pares de UCs que não podem partilhar a mesma mancha (docente ou sala comum).",
  },
  {
    chaveMotor: "semanasSoTurmaA",
    secao: "turnos",
    critica: false,
    porque: "semanas em que só uma família tem aulas.",
  },
  {
    chaveMotor: "racioTPPL",
    secao: "racioTPPL",
    critica: false,
    porque:
      "rácio proporcional TP->PL (a percentagem de PL dadas nunca à frente da percentagem de TP dadas), com tolerância ajustável. Sem a regra, o default genérico ativa o rácio estrito (tolerância 0).",
  },
];
