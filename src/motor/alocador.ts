/**
 * ALOCADOR — o ÚNICO ciclo de colocação do motor de horários.
 *
 * Fase 3B da reescrita. Ficheiro ADITIVO: não substitui nem altera o motor
 * antigo (`utils/distribuicao.ts`, `utils/blocos100.ts`), de que só importa os
 * utilitários de CALENDÁRIO.
 *
 * PRINCÍPIO INEGOCIÁVEL: existe um só ciclo de colocação. Toda a proibição
 * passa por `primeiraViolacao(...)` e todo o custo por `custoTotal(...)`, sobre
 * o registo único de `restricoes.ts`. Uma regra nova é uma `Restricao` — nunca
 * um `if` solto aqui dentro. As restrições que esta fase acrescenta estão todas
 * em `construirRestricoesAlocador` e entram no MESMO registo.
 *
 * Um bloco parcial NUNCA entra no horário: o alocador só coloca composições que
 * fecham a 100% (12/12 folhas-aluno, no caso da estrutura 4 TP x 3 PL) e que
 * correspondem exatamente a um padrão ativo.
 *
 * Regras deste ficheiro, inegociáveis:
 *  1. ZERO siglas de unidade curricular — as siglas são dados.
 *  2. ZERO valores de negócio literais: dias, horas, semanas, tetos e limites
 *     vêm todos da `ConfiguracaoMotor` e do catálogo de UCs.
 *  3. Os únicos números escritos aqui são ESCALÕES RELATIVOS de custo soft, no
 *     bloco `ESCALAO` abaixo, com a razão de cada um.
 *
 * ------------------------------------------------------------------------
 * COMO AS PREFERÊNCIAS DA FASE 3A FORAM IMPLEMENTADAS (decisão documentada)
 * ------------------------------------------------------------------------
 *  - `diasPrioritarios`      -> Restricao soft `dia-prioritario` (dominante).
 *  - `semanasTurmaUnica`     -> Restricao soft `semana-turma-unica`.
 *  - `emparelhamentosPrefer.`-> Restricao soft `emparelhamento-preferencial`,
 *    mas SÓ para os emparelhamentos com `quantidadePorFamilia` declarada. Sem
 *    quota, uma preferência é satisfeita sempre: escolheria eternamente a mesma
 *    unidade curricular para acompanhar as práticas e deixaria as outras sem
 *    par no fim do semestre. Sem quota, vale como desempate.
 *  - espelho A<->B           -> Restricao soft `espelho-familias`.
 *  - `ordemPreferenciaDias`  -> ORDENAÇÃO das manchas dentro da semana (é uma
 *    ordem de tentativa, não um custo: transformá-la em custo poria-a a
 *    competir com a hierarquia de padrões, que vem das regras e tem de mandar).
 *  - `aulasTConjuntas`       -> Restricoes HARD `auditorio-t-uma-uc` (duas
 *    turmas teóricas na mesma mancha têm de ser da MESMA UC) e
 *    `janela-t-conjunta` (a UC obrigada usa só os dias/horas da janela).
 *
 * Os escalões das preferências de COMPOSIÇÃO ficam todos abaixo da menor
 * diferença entre custos de padrão: desempatam dentro do mesmo padrão e nunca
 * invertem a hierarquia de padrões que vem do Supabase.
 *
 * ------------------------------------------------------------------------
 * O QUE FAZ A DIFERENÇA ENTRE COLOCAR TUDO E FICAR A MEIO
 * ------------------------------------------------------------------------
 * O ciclo é guloso, e num horário quase à capacidade é a ORDEM que decide se
 * tudo cabe. Três mecanismos existem só por causa disso, e nenhum deles relaxa
 * o que quer que seja — apenas adiam escolhas que fechariam portas:
 *
 *  1. DESBLOQUEIO DE PRECEDÊNCIAS (secção 9.5). O mínimo exigido por cada
 *     precedência é colocado o mais cedo possível na janela da UC. Se a
 *     primeira TP de uma unidade curricular só aparecer a meio do semestre,
 *     todas as manchas anteriores ficam fechadas às suas PL.
 *  2. RESERVA DE TP (`reserva-tp-para-pl`). Quase todos os padrões que levam
 *     práticas exigem TP de OUTRA unidade curricular no mesmo bloco: as TP são
 *     um recurso partilhado. Gastá-las cedo em blocos que não levam práticas
 *     deixa as PL sem par.
 *  3. RESERVA DE MANCHA (`reserva-mancha-para-pl`). As PL são o tipo com menos
 *     manchas ao seu dispor: as regras fecham-lhes dias inteiros e a capacidade
 *     de laboratórios é global à escola, o que põe as duas famílias a competir
 *     pela mesma mancha. As T e as TP têm alternativas — inclusive fora do
 *     turno da família — e é para lá que devem ir.
 */

import { horaParaMinutos } from "../regras/esquema";
import type { ConfiguracaoMotor, Familia, TipoAula } from "../regras/esquema";
import { criarEstado, criarHierarquia } from "./estado";
import type { Candidato, EstadoHorario, Mancha, SessaoCandidata } from "./estado";
import { construirRestricoes, custoTotal, primeiraViolacao } from "./restricoes";
import type { ContextoRestricao, Restricao } from "./restricoes";
import {
  coberturaFolhas,
  custoDaForma,
  custosDeForma,
  formaDe,
  formasPossiveis,
  limitesDaComposicao,
} from "./padroes";
import type { FormaBloco, FormaId } from "./padroes";
import {
  FAMILIAS_POR_INDICE,
  chaveProcura,
  construirCalendario,
  construirProcura,
  criarMapaTurmas,
  normalizar,
  planear,
} from "./planeador";
import type {
  EntradaAlocacao,
  ItemProcura,
  ManchaPlaneada,
  MapaTurmas,
  PlanoSemanal,
  SemanaAlocacao,
} from "./planeador";
import { inventariar } from "./inventario";
import type { SessaoHorario, UC } from "../types";
import type { DeficitItem, MotivoContado, RelatorioAlocacao } from "./relatorio";

// ---------------------------------------------------------------------------
// 0. Contrato público
// ---------------------------------------------------------------------------

/**
 * O vocabulário de "o que há para dar" (entrada, calendário, nomenclatura de
 * turmas e procura) vive agora em `planeador.ts`, porque é ele que decide o
 * MENU de cada semana antes de haver horários. O alocador continua a ser o
 * ponto de entrada público e reexporta-o para não partir quem já o importava.
 */
export type { EntradaAlocacao, ItemProcura, MapaTurmas, SemanaAlocacao } from "./planeador";
export { construirCalendario, construirProcura, criarMapaTurmas } from "./planeador";

export interface ResultadoAlocacao {
  sessoes: SessaoHorario[];
  relatorio: RelatorioAlocacao;
}

// ---------------------------------------------------------------------------
// 1. Escalões de custo soft acrescentados por esta fase
// ---------------------------------------------------------------------------

/**
 * Todos relativos aos escalões já fixados em `restricoes.ts`:
 *   equilíbrio semanal = 1 000 000 (dominante), padrões = 0..1000,
 *   turno = 400, último dia = 200, dia acima do alvo = 100.
 */
const ESCALAO = {
  /**
   * Um dia declarado prioritário pelo coordenador tem de ser preenchido antes
   * de tudo o resto — inclusive antes do equilíbrio semanal. É a única
   * preferência acima do equilíbrio, e só existe quando há datas declaradas.
   */
  diaPrioritarioPorPreencher: 2_000_000,
  /**
   * Semanas em que só uma família tem aulas: o último dia útil deve continuar
   * a ser o último a ser usado, mesmo com o dia inteiro disponível.
   */
  semanaTurmaUnicaUltimoDia: 2_000,
  /**
   * Gastar TP num bloco que não leva PL, quando as PL que faltam ainda precisam
   * dessas TP para poderem fechar um bloco a 100%.
   *
   * É a regra de escassez do motor: a maioria dos padrões que levam PL exige
   * TP de outra unidade curricular no mesmo bloco, pelo que as TP são um
   * recurso partilhado. Sem esta penalização, os blocos só-TP são colocados
   * cedo (são os únicos viáveis enquanto as precedências ainda não abriram as
   * PL) e deixam as PL sem par — era essa a maior fatia do défice.
   *
   * Fica acima da hierarquia de padrões (0..1000) e abaixo do equilíbrio
   * semanal (1 000 000): adia os blocos só-TP, nunca os proíbe nem desarruma a
   * distribuição pelas semanas.
   */
  reservaTPparaPL: 100_000,
  /**
   * Gastar uma mancha ONDE AS PL AINDA PODEM ENTRAR com um bloco que não leva
   * nenhuma PL, quando essas manchas já não chegam para as PL que faltam.
   *
   * É o par simétrico da reserva de TP. As PL são o tipo de aula com menos
   * manchas ao seu dispor (as regras fecham-lhes dias inteiros e a capacidade
   * de laboratórios limita quantas correm em paralelo), enquanto as T e as TP
   * têm alternativas — inclusive fora do turno da família. Sem esta
   * penalização, os blocos mais baratos (as teóricas) ocupam primeiro
   * exatamente as manchas de que as PL precisavam.
   *
   * Mesmo escalão da reserva de TP: adia, nunca proíbe.
   */
  reservaManchaParaPL: 100_000,
  /**
   * Preferências de COMPOSIÇÃO. Somadas, ficam abaixo da menor diferença entre
   * custos de padrão (10 na hierarquia por omissão): desempatam dentro do
   * padrão e nunca invertem a hierarquia que vem das regras.
   *
   * A equidade entre turmas (servir primeiro quem está mais atrasado) NÃO é um
   * custo: é o desempate da ordem de tentativa, aplicado depois destas. Como
   * custo competiria com a hierarquia de padrões e espalhava o défice por
   * todas as unidades curriculares em vez de o concentrar onde é inevitável.
   */
  emparelhamentoNaoPreferido: 4,
  espelhoQuebrado: 2,
} as const;

// ---------------------------------------------------------------------------
// 2. Auxiliares puros
// ---------------------------------------------------------------------------

function somarHoras(hora: string, horas: number): string {
  const minutos = horaParaMinutos(hora) + Math.round(horas * 60);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

// ---------------------------------------------------------------------------
// 5. Contexto do alocador (índices das restrições acrescentadas nesta fase)
// ---------------------------------------------------------------------------

/**
 * As restrições que esta fase acrescenta precisam de saber coisas que o estado
 * (deliberadamente mínimo) não indexa: que UC ocupa o anfiteatro numa mancha,
 * onde é que a família oposta já colocou cada UC, e quantos emparelhamentos
 * preferenciais já foram satisfeitos. Esses índices vivem aqui — nunca dentro
 * das próprias restrições, que continuam a ser predicados puros.
 */
export interface ContextoAlocador {
  /** semana|dia|hora -> UCs com aula teórica (toda a escola). */
  teoricasNaMancha: Map<string, Set<string>>;
  /** ano|semana|familia|ucId|tipo -> horas já usadas. */
  horasPorFamilia: Map<string, Set<string>>;
  /** índice do emparelhamento|familia -> blocos já satisfeitos. */
  emparelhamentosSatisfeitos: Map<string, number>;
  /** data ISO -> blocos ainda em falta nesse dia prioritário. */
  diasPrioritariosEmFalta: Map<string, number>;
  /** ano|semana|dia -> data ISO, para as datas prioritárias. */
  datasDasManchas: Map<string, string>;
  /**
   * Carga ainda por colocar num (ano, família) cuja janela letiva inclui esta
   * semana. O alocador substitui esta função pela sua contabilidade real; o
   * valor por omissão (zeros) deixa as restrições que a usam inertes, para que
   * o registo possa ser construído fora de uma alocação (revalidação, testes).
   */
  procuraRestante(
    ano: number,
    familia: Familia,
    semana: number,
  ): { sessoesTP: number; gruposPLporUC: number[] };
  /**
   * Pressão sobre as manchas em que as aulas PL ainda podem entrar. Como acima,
   * o valor por omissão deixa a restrição que a usa inerte.
   */
  pressaoPL(mancha: Mancha, familia: Familia): {
    /** Grupos de PL ainda por colocar em toda a janela. */
    gruposPL: number;
    /** Manchas livres desta SEMANA em que as PL NÃO podem entrar. */
    manchasLivresSemPL: number;
    /** Esta mancha aceita PL? */
    manchaAceitaPL: boolean;
  };
  /**
   * Fração de carga por colocar (0 a 1) nas turmas que estas sessões servem,
   * contada por grupo (UC + tipo). 1 = nada colocado ainda. Serve a ordem de
   * tentativa do alocador; o valor por omissão deixa-a neutra.
   */
  urgencia(sessoes: SessaoCandidata[]): number;
  registar(candidato: Candidato, ucPorId: Map<string, UC>): void;
}

const chaveManchaGlobal = (m: Mancha) => `${m.semana}|${m.dia}|${m.hora}`;
const chaveFamiliaUC = (m: Mancha, familia: Familia, ucId: string, tipo: TipoAula) =>
  `${m.ano}|${m.semana}|${familia}|${ucId}|${tipo}`;
const chaveData = (ano: number, semana: number, dia: string) => `${ano}|${semana}|${dia}`;

export function criarContextoAlocador(
  regras: ConfiguracaoMotor,
  calendario?: Map<number, SemanaAlocacao[]>,
): ContextoAlocador {
  const datasDasManchas = new Map<string, string>();
  if (calendario) {
    for (const [ano, semanas] of calendario) {
      for (const s of semanas) for (const [dia, data] of s.datas) datasDasManchas.set(chaveData(ano, s.global, dia), data);
    }
  }
  const diasPrioritariosEmFalta = new Map<string, number>();
  for (const d of regras.preferencias.diasPrioritarios) {
    diasPrioritariosEmFalta.set(d.data, Math.max(0, d.minimoBlocos));
  }

  const ctx: ContextoAlocador = {
    teoricasNaMancha: new Map(),
    horasPorFamilia: new Map(),
    emparelhamentosSatisfeitos: new Map(),
    diasPrioritariosEmFalta,
    datasDasManchas,
    procuraRestante: () => ({ sessoesTP: 0, gruposPLporUC: [] }),
    pressaoPL: () => ({ gruposPL: 0, manchasLivresSemPL: 0, manchaAceitaPL: false }),
    urgencia: () => 1,
    registar(candidato, ucPorId) {
      const m = candidato.mancha;
      for (const s of candidato.sessoes) {
        if (s.tipo === "T") {
          const k = chaveManchaGlobal(m);
          const set = ctx.teoricasNaMancha.get(k) ?? new Set<string>();
          set.add(s.ucId);
          ctx.teoricasNaMancha.set(k, set);
        }
        const kf = chaveFamiliaUC(m, candidato.familia, s.ucId, s.tipo);
        const horas = ctx.horasPorFamilia.get(kf) ?? new Set<string>();
        horas.add(m.hora);
        ctx.horasPorFamilia.set(kf, horas);
      }
      const data = ctx.datasDasManchas.get(chaveData(m.ano, m.semana, m.dia));
      if (data !== undefined) {
        const emFalta = ctx.diasPrioritariosEmFalta.get(data);
        if (emFalta !== undefined && emFalta > 0) ctx.diasPrioritariosEmFalta.set(data, emFalta - 1);
      }
      const emparelhamento = emparelhamentoSatisfeito(regras, candidato, ucPorId);
      if (emparelhamento !== null) {
        const k = `${emparelhamento}|${candidato.familia}`;
        ctx.emparelhamentosSatisfeitos.set(k, (ctx.emparelhamentosSatisfeitos.get(k) ?? 0) + 1);
      }
    },
  };
  return ctx;
}

/**
 * Índice do emparelhamento preferencial que este candidato realiza, ou null.
 * Um emparelhamento é uma preferência declarada nas regras — nunca uma lista de
 * siglas escrita aqui.
 */
function emparelhamentoSatisfeito(
  regras: ConfiguracaoMotor,
  candidato: Candidato,
  ucPorId: Map<string, UC>,
): number | null {
  const preferencias = regras.padroesBloco.emparelhamentosPreferenciais;
  if (preferencias.length === 0) return null;
  const siglaDe = (s: SessaoCandidata) => normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla);
  const tp = new Set(candidato.sessoes.filter((s) => s.tipo === "TP").map(siglaDe));
  const pl = new Set(candidato.sessoes.filter((s) => s.tipo === "PL").map(siglaDe));
  if (tp.size === 0) return null;

  for (let i = 0; i < preferencias.length; i++) {
    const p = preferencias[i];
    const alvoTP = new Set(p.siglasTP.map(normalizar));
    const alvoPL = new Set(p.siglasPL.map(normalizar));
    if (alvoTP.size === 0) continue;
    if (alvoPL.size === 0) {
      // Par de TP: todas as TP do bloco têm de vir da lista, e têm de ser mais
      // do que uma UC (é isso que faz o "par").
      if (pl.size > 0 || tp.size < 2) continue;
      if ([...tp].every((s) => alvoTP.has(s))) return i;
      continue;
    }
    // Cruzamento TP x PL: a TP indicada com PL de uma das UCs indicadas.
    if ([...tp].some((s) => alvoTP.has(s)) && [...pl].some((s) => alvoPL.has(s))) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Restrições acrescentadas por esta fase
// ---------------------------------------------------------------------------

/**
 * Estas restrições entram no MESMO registo das de `restricoes.ts`: quem quiser
 * saber se um candidato é legal continua a chamar `primeiraViolacao`, quem
 * quiser saber quanto custa continua a chamar `custoTotal`.
 */
export function construirRestricoesAlocador(
  regras: ConfiguracaoMotor,
  ctx: ContextoAlocador,
): Restricao[] {
  const formas = formasPossiveis(regras.estruturaTurmas, limitesDaComposicao(regras), custosDeForma(regras));
  const fronteira = regras.calendario.fronteiraSemestre;
  const semanaRelativa = (semana: number) => (semana <= fronteira ? semana : semana - fronteira);
  const ultimoDia = regras.grelha.dias[regras.grelha.dias.length - 1];

  // Espelho manhã <-> tarde: derivado da grelha, não de um mapa literal.
  const horas = regras.grelha.horasInicio;
  const limiar = regras.grelha.limiarTardeHora * 60;
  const manha = horas.filter((h) => horaParaMinutos(h) < limiar);
  const tarde = horas.filter((h) => horaParaMinutos(h) >= limiar);
  const espelhoDaHora = new Map<string, string>();
  for (let i = 0; i < Math.min(manha.length, tarde.length); i++) {
    espelhoDaHora.set(manha[i], tarde[i]);
    espelhoDaHora.set(tarde[i], manha[i]);
  }

  const restricoes: Restricao[] = [];

  // -------------------------------------------------------------------------
  // HARD
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "auditorio-t-uma-uc",
    tipo: "hard",
    descricao:
      "Duas turmas teóricas na mesma mancha partilham o anfiteatro: só podem estar lá aulas T da MESMA unidade curricular.",
    verificar({ candidato, ucPorId }) {
      const teoricas = candidato.sessoes.filter((s) => s.tipo === "T");
      if (teoricas.length === 0) return null;
      const doCandidato = new Set(teoricas.map((s) => s.ucId));
      if (doCandidato.size > 1) {
        return "o candidato junta aulas teóricas de unidades curriculares diferentes na mesma mancha.";
      }
      const presentes = ctx.teoricasNaMancha.get(chaveManchaGlobal(candidato.mancha));
      if (!presentes) return null;
      for (const ucId of presentes) {
        if (doCandidato.has(ucId)) continue;
        const nome = ucPorId.get(ucId)?.sigla ?? ucId;
        const minha = ucPorId.get([...doCandidato][0])?.sigla ?? [...doCandidato][0];
        return `o anfiteatro já está ocupado por uma aula teórica de ${nome} nesta mancha; ${minha} não pode entrar ao mesmo tempo.`;
      }
      return null;
    },
  });

  restricoes.push({
    id: "janela-t-conjunta",
    tipo: "hard",
    descricao:
      "As unidades curriculares obrigadas a uma janela de aula T conjunta só podem usar os dias e horas dessa janela.",
    verificar({ candidato, ucPorId }) {
      const m = candidato.mancha;
      const rel = semanaRelativa(m.semana);
      for (const regra of regras.aulasTConjuntas) {
        if (regra.siglasObrigatorias.length === 0) continue;
        if (regra.anos.length > 0 && !regra.anos.includes(m.ano)) continue;
        if (regra.semanas.length > 0 && !regra.semanas.includes(rel)) continue;
        const obrigadas = new Set(regra.siglasObrigatorias.map(normalizar));
        for (const s of candidato.sessoes) {
          if (s.tipo !== "T") continue;
          const sigla = normalizar(ucPorId.get(s.ucId)?.sigla ?? s.ucSigla);
          if (!obrigadas.has(sigla)) continue;
          if (regra.dias.length > 0 && !regra.dias.includes(m.dia)) {
            return `${sigla} só pode ter a aula teórica conjunta em ${regra.dias.join(", ")} na semana ${rel} (regra ${regra.origem}).`;
          }
          if (regra.horarios.length > 0 && !regra.horarios.includes(m.hora)) {
            return `${sigla} só pode ter a aula teórica conjunta às ${regra.horarios.join(", ")} na semana ${rel} (regra ${regra.origem}).`;
          }
        }
      }
      return null;
    },
  });

  // -------------------------------------------------------------------------
  // SOFT — composição-independentes (entram na escolha da mancha)
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "dia-prioritario",
    tipo: "soft",
    descricao:
      "Datas que o coordenador declarou prioritárias têm de receber o mínimo de blocos pedido antes de qualquer outra coisa.",
    custo({ candidato }) {
      if (ctx.diasPrioritariosEmFalta.size === 0) return 0;
      let pendentes = 0;
      for (const n of ctx.diasPrioritariosEmFalta.values()) pendentes += n > 0 ? 1 : 0;
      if (pendentes === 0) return 0;
      const m = candidato.mancha;
      const data = ctx.datasDasManchas.get(chaveData(m.ano, m.semana, m.dia));
      const emFalta = data === undefined ? undefined : ctx.diasPrioritariosEmFalta.get(data);
      return emFalta !== undefined && emFalta > 0 ? 0 : ESCALAO.diaPrioritarioPorPreencher;
    },
  });

  restricoes.push({
    id: "semana-turma-unica",
    tipo: "soft",
    descricao:
      "Nas semanas em que só uma família tem aulas, o dia inteiro fica disponível mas o último dia útil continua a ser o último recurso.",
    custo({ candidato }) {
      const m = candidato.mancha;
      const rel = semanaRelativa(m.semana);
      for (const s of regras.turnos.semanasTurmaUnica) {
        if (s.anos.length > 0 && !s.anos.includes(m.ano)) continue;
        if (!s.semanas.includes(rel)) continue;
        if (s.familia !== candidato.familia) continue;
        return m.dia === ultimoDia ? ESCALAO.semanaTurmaUnicaUltimoDia : 0;
      }
      return 0;
    },
  });

  // -------------------------------------------------------------------------
  // SOFT — dependentes da FORMA do bloco
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "reserva-tp-para-pl",
    tipo: "soft",
    descricao:
      "Enquanto faltarem aulas PL que precisam de TP de outra unidade curricular para fechar o bloco a 100%, adia-se gastar TP em blocos que não levam nenhuma PL.",
    custo({ candidato }) {
      const nTP = candidato.sessoes.filter((s) => s.tipo === "TP").length;
      if (nTP === 0) return 0;
      if (candidato.sessoes.some((s) => s.tipo === "PL")) return 0;
      const r = ctx.procuraRestante(candidato.mancha.ano, candidato.familia, candidato.mancha.semana);
      return custoDaReserva(regras, formas, nTP, r);
    },
  });

  restricoes.push({
    id: "reserva-mancha-para-pl",
    tipo: "soft",
    descricao:
      "Enquanto as manchas em que as aulas PL ainda podem entrar não chegarem para as PL que faltam, essas manchas não se gastam com blocos que não levam nenhuma PL.",
    custo({ candidato }) {
      if (candidato.sessoes.some((s) => s.tipo === "PL")) return 0;
      return custoDaReservaDeMancha(ctx.pressaoPL(candidato.mancha, candidato.familia));
    },
  });

  // -------------------------------------------------------------------------
  // SOFT — dependentes da composição (desempatam dentro do padrão)
  // -------------------------------------------------------------------------

  restricoes.push({
    id: "emparelhamento-preferencial",
    tipo: "soft",
    descricao:
      "Emparelhamentos declarados nas regras (pares de TP, cruzamentos TP/PL) são preferidos enquanto a QUOTA por família declarada na regra não estiver satisfeita.",
    custo({ candidato, ucPorId }) {
      const preferencias = regras.padroesBloco.emparelhamentosPreferenciais;
      if (preferencias.length === 0) return 0;
      if (!candidato.sessoes.some((s) => s.tipo === "TP")) return 0;
      // Só as preferências com quota declarada entram no custo. Uma preferência
      // sem quota, aplicada como custo, seria satisfeita SEMPRE: escolheria
      // sempre a mesma unidade curricular para acompanhar as práticas e as
      // outras ficariam sem par no fim do semestre. Sem quota, a preferência
      // vale como desempate na ordem de tentativa — ver `alocar`.
      let algumaPorSatisfazer = false;
      for (let i = 0; i < preferencias.length; i++) {
        const quota = preferencias[i].quantidadePorFamilia;
        if (quota === null) continue;
        const feitos = ctx.emparelhamentosSatisfeitos.get(`${i}|${candidato.familia}`) ?? 0;
        if (feitos < quota) algumaPorSatisfazer = true;
      }
      if (!algumaPorSatisfazer) return 0;
      const indice = emparelhamentoSatisfeito(regras, candidato, ucPorId);
      if (indice === null) return ESCALAO.emparelhamentoNaoPreferido;
      const quota = preferencias[indice].quantidadePorFamilia;
      if (quota === null) return ESCALAO.emparelhamentoNaoPreferido;
      const feitos = ctx.emparelhamentosSatisfeitos.get(`${indice}|${candidato.familia}`) ?? 0;
      return feitos >= quota ? ESCALAO.emparelhamentoNaoPreferido : 0;
    },
  });

  restricoes.push({
    id: "espelho-familias",
    tipo: "soft",
    descricao:
      "Quando a família oposta já tem esta unidade curricular e tipo nesta semana, prefere-se a mancha espelhada (manhã <-> tarde); nas aulas T, a MESMA mancha.",
    custo({ candidato }) {
      const m = candidato.mancha;
      const oposta: Familia = candidato.familia === "A" ? "B" : "A";
      for (const s of candidato.sessoes) {
        const horasOposta = ctx.horasPorFamilia.get(chaveFamiliaUC(m, oposta, s.ucId, s.tipo));
        if (!horasOposta || horasOposta.size === 0) continue;
        if (s.tipo === "T") {
          if (!horasOposta.has(m.hora)) return ESCALAO.espelhoQuebrado;
          continue;
        }
        const espelho = espelhoDaHora.get(m.hora);
        if (horasOposta.has(m.hora)) continue;
        if (espelho !== undefined && horasOposta.has(espelho)) continue;
        return ESCALAO.espelhoQuebrado;
      }
      return 0;
    },
  });

  return restricoes;
}

/**
 * Quantas TP cada forma exige por grupo de PL que transporta.
 *
 * Dois casos interessam: um grupo de PL que ENCONTRA PAR (outro grupo, de outra
 * unidade curricular, no mesmo bloco) e um grupo que fica SOZINHO. Sozinho é
 * mais caro em TP — é por isso que os grupos que sobram de uma UC com mais
 * carga prática do que as suas parceiras consomem muito mais TP do que parece.
 * Os números saem das FORMAS que os limites permitem, nunca de literais.
 */
function custoTPdasFormas(
  regras: ConfiguracaoMotor,
  formas: FormaBloco[],
): { emPar: number; sozinho: number } {
  const plPorGrupo = regras.estruturaTurmas.plPorTP;
  let emPar = Number.POSITIVE_INFINITY;
  let sozinho = Number.POSITIVE_INFINITY;
  for (const forma of formas) {
    if (forma.pl.length === 0) continue;
    const tp = forma.tp.reduce((s, n) => s + n, 0);
    const grupos = forma.pl.reduce((s, n) => s + n, 0) / plPorGrupo;
    if (grupos <= 0) continue;
    // `pl.length >= 2` = o bloco leva grupos de UCs DIFERENTES: é o caso "em par".
    if (forma.pl.length >= 2) emPar = Math.min(emPar, tp / grupos);
    else if (grupos === 1) sozinho = Math.min(sozinho, tp);
  }
  if (!Number.isFinite(emPar)) emPar = Number.isFinite(sozinho) ? sozinho : 0;
  if (!Number.isFinite(sozinho)) sozinho = emPar;
  return { emPar, sozinho };
}

/**
 * Custo de gastar `nTP` aulas TP num bloco que não leva nenhuma PL, dado o que
 * falta colocar. Vive numa função só para que a restrição e a ordenação de
 * padrões do alocador partilhem exatamente a mesma conta.
 *
 * O cálculo emparelha os grupos de PL que faltam: com contagens por unidade
 * curricular `g1..gn`, o número máximo de pares de UCs DIFERENTES é
 * `min(total/2, total - max(gi))`. Os grupos que sobram desse emparelhamento
 * pertencem todos à mesma UC e só podem ir num padrão de grupo isolado, que
 * gasta mais TP. Ignorar essa sobra era o que deixava o motor sem TP para as
 * últimas práticas da unidade curricular com mais carga.
 *
 */
function custoDaReserva(
  regras: ConfiguracaoMotor,
  formas: FormaBloco[],
  nTP: number,
  restante: { sessoesTP: number; gruposPLporUC: number[] },
): number {
  const grupos = restante.gruposPLporUC;
  const total = grupos.reduce((s, n) => s + n, 0);
  if (total <= 0) return 0;
  const maior = Math.max(...grupos);
  const pares = Math.max(0, Math.min(Math.floor(total / 2), total - maior));
  const sobras = total - 2 * pares;
  const tpPor = custoTPdasFormas(regras, formas);
  const tpNecessarias = Math.ceil(pares * 2 * tpPor.emPar + sobras * tpPor.sozinho);
  return restante.sessoesTP - nTP < tpNecessarias ? ESCALAO.reservaTPparaPL : 0;
}

/**
 * Custo de gastar uma mancha que aceitava PL com um bloco que não leva PL.
 * Partilhada entre a restrição e a ordenação de padrões do alocador.
 *
 * A comparação é SEMANAL e é simplesmente esta: se ainda faltam PL e esta
 * semana ainda tem manchas livres que as PL NÃO podiam usar, então é lá que os
 * blocos sem PL devem ir. Quando já não há alternativa, o custo é igual para
 * todos os candidatos e deixa de influenciar seja o que for — a penalização
 * adia, nunca proíbe.
 */
function custoDaReservaDeMancha(pressao: {
  gruposPL: number;
  manchasLivresSemPL: number;
  manchaAceitaPL: boolean;
}): number {
  if (pressao.gruposPL <= 0 || !pressao.manchaAceitaPL) return 0;
  return pressao.manchasLivresSemPL > 0 ? ESCALAO.reservaManchaParaPL : 0;
}

/** O registo COMPLETO: as restrições da Fase 3A mais as desta fase. */
export function construirRegistoCompleto(regras: ConfiguracaoMotor, ctx: ContextoAlocador): Restricao[] {
  return [...construirRestricoes(regras), ...construirRestricoesAlocador(regras, ctx)];
}

/**
 * Restrições duras que dependem SÓ da mancha, da sessão e das regras — nunca do
 * que já foi colocado. São as que respondem à pergunta "esta aula podia alguma
 * vez estar aqui?", usada para medir a escassez de manchas.
 *
 * Se aparecer uma restrição estática nova e não for listada aqui, a medida fica
 * apenas mais permissiva: é uma heurística de custo, nunca decide legalidade.
 */
const IDS_HARD_ESTATICAS = new Set([
  "janela-tipo-aula",
  "dias-permitidos-pl",
  "restricoes-uc",
  "janela-letiva-uc",
  "janela-calendario",
  "janela-t-conjunta",
]);

/**
 * Ids das restrições soft que dependem da COMPOSIÇÃO do bloco. Todas as outras
 * são iguais para qualquer bloco completo da mesma mancha (cobrem sempre as
 * mesmas folhas-aluno), e é isso que permite escolher a mancha primeiro.
 */
const IDS_SOFT_COMPOSICAO = new Set([
  "forma-bloco",
  "reserva-tp-para-pl",
  "reserva-mancha-para-pl",
  "emparelhamento-preferencial",
  "espelho-familias",
]);

// ---------------------------------------------------------------------------
// 7. Agrupamento de sessões existentes em candidatos (reutilizável)
// ---------------------------------------------------------------------------

/**
 * Reconstrói os blocos (candidatos) a partir de uma lista de sessões já
 * produzidas, por ordem cronológica. Serve para revalidar um horário inteiro
 * contra o registo de restrições sem duplicar a lógica de agrupamento.
 */
export function agruparEmCandidatos(
  sessoes: SessaoHorario[],
  ucPorId: Map<string, UC>,
  regras: ConfiguracaoMotor,
): Candidato[] {
  const mapa = criarMapaTurmas(regras.estruturaTurmas);
  const porSigla = new Map<string, UC>();
  for (const uc of ucPorId.values()) porSigla.set(normalizar(uc.sigla), uc);
  const blocos = new Map<string, Candidato>();
  const ordem: string[] = [];

  for (const s of sessoes) {
    const uc = porSigla.get(normalizar(s.ucSigla));
    if (!uc) continue;
    const turma = mapa.canonico(s.turma);
    const fIdx = mapa.familiaDe(turma);
    if (fIdx === undefined) continue;
    const familia = FAMILIAS_POR_INDICE[fIdx];
    if (!familia) continue;
    const mancha: Mancha = {
      ano: uc.anoCurricular,
      semana: s.semana ?? 0,
      dia: s.diaSemana,
      hora: s.horaInicio,
    };
    const k = `${mancha.ano}|${mancha.semana}|${mancha.dia}|${mancha.hora}|${familia}`;
    let bloco = blocos.get(k);
    if (!bloco) {
      bloco = { sessoes: [], mancha, familia };
      blocos.set(k, bloco);
      ordem.push(k);
    }
    bloco.sessoes.push({ ucId: uc.id, ucSigla: uc.sigla, turma, tipo: s.tipoAula });
  }

  const indiceDia = new Map(regras.grelha.dias.map((d, i) => [d, i]));
  const indiceHora = new Map(regras.grelha.horasInicio.map((h, i) => [h, i]));
  return ordem
    .map((k) => blocos.get(k)!)
    .sort((a, b) => {
      if (a.mancha.semana !== b.mancha.semana) return a.mancha.semana - b.mancha.semana;
      const da = indiceDia.get(a.mancha.dia) ?? 0;
      const db = indiceDia.get(b.mancha.dia) ?? 0;
      if (da !== db) return da - db;
      const ha = indiceHora.get(a.mancha.hora) ?? 0;
      const hb = indiceHora.get(b.mancha.hora) ?? 0;
      if (ha !== hb) return ha - hb;
      return a.familia.localeCompare(b.familia);
    });
}

// ---------------------------------------------------------------------------
// 9. O ciclo de colocação
// ---------------------------------------------------------------------------

export function alocar(entrada: EntradaAlocacao): ResultadoAlocacao {
  const { regras, ucs } = entrada;
  const avisos: string[] = [];
  const mapa = criarMapaTurmas(regras.estruturaTurmas);
  const hierarquia = criarHierarquia(regras.estruturaTurmas);
  const estado = criarEstado(hierarquia);
  const bloco = regras.grelha.duracaoBlocoHoras;
  const fronteira = regras.calendario.fronteiraSemestre;

  const ucPorId = new Map<string, UC>(ucs.map((u) => [u.id, u]));
  const ucPorSigla = new Map<string, UC>(ucs.map((u) => [normalizar(u.sigla), u]));
  const anos = [...new Set(ucs.map((u) => u.anoCurricular))].sort((a, b) => a - b);

  const calendario = construirCalendario(entrada, anos);
  const ctx = criarContextoAlocador(regras, calendario);
  const restricoes = construirRegistoCompleto(regras, ctx);
  const softsContexto = restricoes.filter((r) => r.tipo === "soft" && r.custo && !IDS_SOFT_COMPOSICAO.has(r.id));
  const softsComposicao = restricoes.filter((r) => r.tipo === "soft" && r.custo && IDS_SOFT_COMPOSICAO.has(r.id));
  const equilibrio = restricoes.find((r) => r.id === "equilibrio-semanal");

  // AS FORMAS SÃO CALCULADAS a partir dos limites de composição. A lista de
  // padrões da configuração já não decide o que é legal: entra só como
  // hierarquia de preferência, dentro de `custosDeForma`.
  const custosForma = custosDeForma(regras);
  const formas = formasPossiveis(regras.estruturaTurmas, limitesDaComposicao(regras), custosForma);

  const folhasDaFamilia = mapa.quartosPorFamilia * mapa.plPorQuarto;

  // -------------------------------------------------------------------------
  // 9.1 Construir a procura
  // -------------------------------------------------------------------------

  const { itens: procura, avisos: avisosDaProcura } = construirProcura(entrada, mapa);
  avisos.push(...avisosDaProcura);
  const semanasDe = (ano: number) => calendario.get(ano) ?? [];

  const blocosAlvo = [...procura.values()].reduce((s, p) => s + p.alvo, 0);
  const restante = (ucId: string, tipo: TipoAula, turma: string): number => {
    const p = procura.get(chaveProcura(ucId, tipo, turma));
    return p ? p.alvo - p.colocados : 0;
  };
  const naJanela = (ucId: string, tipo: TipoAula, turma: string, semana: number): boolean => {
    const p = procura.get(chaveProcura(ucId, tipo, turma));
    return !!p && semana >= p.primeira && semana <= p.ultima;
  };

  /**
   * Carga por colocar num (ano, família) cuja janela inclui a semana. É
   * consultada por restrição, por isso fica memoizada e a memória é invalidada
   * a cada colocação — o valor depende do estado e nunca pode ser
   * pré-calculado.
   */
  let versaoDaProcura = 0;
  const memoriaRestante = new Map<
    string,
    { versao: number; sessoesTP: number; gruposPLporUC: number[] }
  >();
  ctx.procuraRestante = (ano, familia, semana) => {
    const k = `${ano}|${familia}|${semana}`;
    const guardado = memoriaRestante.get(k);
    if (guardado && guardado.versao === versaoDaProcura) return guardado;
    let sessoesTP = 0;
    const plPorUC = new Map<string, number>();
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familia !== familia) continue;
      if (semana < p.primeira || semana > p.ultima) continue;
      const falta = p.alvo - p.colocados;
      if (falta <= 0) continue;
      if (p.tipo === "TP") sessoesTP += falta;
      else if (p.tipo === "PL") plPorUC.set(p.ucId, (plPorUC.get(p.ucId) ?? 0) + falta);
    }
    const gruposPLporUC = [...plPorUC.values()]
      .map((n) => Math.ceil(n / regras.estruturaTurmas.plPorTP))
      .filter((n) => n > 0)
      .sort((a, b) => b - a);
    const valor = { versao: versaoDaProcura, sessoesTP, gruposPLporUC };
    memoriaRestante.set(k, valor);
    return valor;
  };

  const formasUsadas: Partial<Record<FormaId, number>> = {};
  const colocados: { candidato: Candidato; forma: FormaId | null; fixo: boolean }[] = [];

  const registarColocacao = (candidato: Candidato, fixo: boolean) => {
    versaoDaProcura++;
    estado.colocar(candidato);
    ctx.registar(candidato, ucPorId);
    for (const s of candidato.sessoes) {
      const p = procura.get(chaveProcura(s.ucId, s.tipo, s.turma));
      if (p) p.colocados += 1;
    }
    const forma = formaDe(candidato.sessoes, ucPorId);
    if (forma) formasUsadas[forma] = (formasUsadas[forma] ?? 0) + 1;
    colocados.push({ candidato, forma, fixo });
  };

  // -------------------------------------------------------------------------
  // 9.2 Sessões fixas (importadas/fixadas): ocupam espaço e descontam carga
  // -------------------------------------------------------------------------

  if (entrada.sessoesFixas && entrada.sessoesFixas.length > 0) {
    for (const candidato of agruparEmCandidatos(entrada.sessoesFixas, ucPorId, regras)) {
      registarColocacao(candidato, true);
    }
  }

  // -------------------------------------------------------------------------
  // 9.3 Layouts fixos: colocados PRIMEIRO, exatamente como as regras os definem
  // -------------------------------------------------------------------------

  for (const layout of regras.layoutsFixos) {
    const semestre = layout.semestre ?? 1;
    const desloc = semestre === 1 ? 0 : fronteira;
    const blocosDoLayout = new Map<string, Candidato>();
    for (const s of layout.sessoes) {
      const uc = ucPorSigla.get(normalizar(s.ucSigla));
      if (!uc) {
        avisos.push(`layout fixo (${layout.origem}): a unidade curricular "${s.ucSigla}" não existe no catálogo.`);
        continue;
      }
      const ano = layout.ano ?? uc.anoCurricular;
      for (const nome of s.turmas) {
        const turma = mapa.canonico(nome);
        const fIdx = mapa.familiaDe(turma);
        if (fIdx === undefined) {
          avisos.push(`layout fixo (${layout.origem}): a turma "${nome}" não pertence à estrutura de turmas.`);
          continue;
        }
        const familia = FAMILIAS_POR_INDICE[fIdx];
        if (!familia) continue;
        const mancha: Mancha = { ano, semana: s.semana + desloc, dia: s.dia, hora: s.hora };
        const k = `${mancha.ano}|${mancha.semana}|${mancha.dia}|${mancha.hora}|${familia}`;
        const existente = blocosDoLayout.get(k) ?? { sessoes: [], mancha, familia };
        existente.sessoes.push({ ucId: uc.id, ucSigla: uc.sigla, turma, tipo: s.tipo });
        blocosDoLayout.set(k, existente);
      }
    }
    for (const candidato of blocosDoLayout.values()) {
      const cobertura = coberturaFolhas(candidato.sessoes, regras.estruturaTurmas);
      if (cobertura !== folhasDaFamilia) {
        avisos.push(
          `layout fixo (${layout.origem}): o bloco da semana ${candidato.mancha.semana}, ${candidato.mancha.dia} às ${candidato.mancha.hora} cobre ${cobertura}/${folhasDaFamilia} folhas-aluno da família ${candidato.familia}.`,
        );
      }
      registarColocacao(candidato, true);
    }
  }

  // -------------------------------------------------------------------------
  // 9.4 Geração de candidatos completos (12/12 folhas) para uma mancha
  // -------------------------------------------------------------------------

  const ctxDe = (candidato: Candidato): ContextoRestricao => ({ estado, candidato, regras, ucPorId });

  const custoDe = (lista: Restricao[], candidato: Candidato): number => {
    const c = ctxDe(candidato);
    let total = 0;
    for (const r of lista) total += Math.max(0, r.custo!(c));
    return total;
  };

  /** UCs com procura por satisfazer neste (ano, família, semana), por tipo. */
  const ucsComProcura = (ano: number, fIdx: number, semana: number) => {
    const t: string[] = [];
    const tp: { ucId: string; quartos: number[] }[] = [];
    const pl: { ucId: string; quartos: number[] }[] = [];
    const teorica = mapa.teorica(fIdx);
    for (const uc of ucs) {
      if (uc.anoCurricular !== ano) continue;
      if (restante(uc.id, "T", teorica) > 0 && naJanela(uc.id, "T", teorica, semana)) t.push(uc.id);
      const quartosTP: number[] = [];
      const quartosPL: number[] = [];
      for (let q = 0; q < mapa.quartosPorFamilia; q++) {
        const nomeTP = mapa.tp(fIdx, q);
        if (restante(uc.id, "TP", nomeTP) > 0 && naJanela(uc.id, "TP", nomeTP, semana)) quartosTP.push(q);
        const nomesPL = mapa.pl(fIdx, q);
        if (nomesPL.every((n) => restante(uc.id, "PL", n) > 0 && naJanela(uc.id, "PL", n, semana))) quartosPL.push(q);
      }
      if (quartosTP.length > 0) tp.push({ ucId: uc.id, quartos: quartosTP });
      if (quartosPL.length > 0) pl.push({ ucId: uc.id, quartos: quartosPL });
    }
    return { t, tp, pl };
  };

  const sessaoDe = (ucId: string, turma: string, tipo: TipoAula): SessaoCandidata => ({
    ucId,
    ucSigla: ucPorId.get(ucId)?.sigla ?? ucId,
    turma,
    tipo,
  });

  // -------------------------------------------------------------------------
  // Pressão sobre as manchas que aceitam PL
  //
  // Saber ONDE uma aula PL ainda podia entrar é o que permite não desperdiçar
  // essas manchas. A pergunta divide-se em três: (a) as regras de calendário,
  // janela e dia permitem PL nesta mancha? — isso não muda com o que já foi
  // colocado, e fica em cache para sempre, avaliado contra um estado VAZIO;
  // (b) a mancha continua livre para esta família?; (c) a capacidade física de
  // laboratórios da escola ainda comporta mais um grupo de práticas nessa
  // mancha? — é aqui que as duas famílias competem, porque o limite é global.
  // (b) e (c) mudam a cada colocação, e por isso são memoizados contra o
  // contador de versão.
  // -------------------------------------------------------------------------

  const estadoVazio = criarEstado(hierarquia);
  const restricoesEstaticas = restricoes.filter((r) => r.tipo === "hard" && IDS_HARD_ESTATICAS.has(r.id));
  const cachePLpossivel = new Map<string, boolean>();
  const plPodeCaber = (ucId: string, fIdx: number, familia: Familia, m: Mancha): boolean => {
    const k = `${ucId}|${fIdx}|${m.ano}|${m.semana}|${m.dia}|${m.hora}`;
    const guardado = cachePLpossivel.get(k);
    if (guardado !== undefined) return guardado;
    const candidato: Candidato = {
      sessoes: [sessaoDe(ucId, mapa.pl(fIdx, 0)[0], "PL")],
      mancha: m,
      familia,
    };
    const v =
      primeiraViolacao(restricoesEstaticas, { estado: estadoVazio, candidato, regras, ucPorId }) === null;
    cachePLpossivel.set(k, v);
    return v;
  };

  /** Ainda cabe mais um grupo de práticas nesta mancha, em toda a escola? */
  const cabeMaisUmGrupoPL = (m: Mancha): boolean =>
    estado.plNaMancha(m) + mapa.plPorQuarto <= regras.capacidade.maxPLporMancha;

  const inerte = { gruposPL: 0, manchasLivresSemPL: 0, manchaAceitaPL: false };
  const memoriaPressao = new Map<
    string,
    { versao: number; gruposPL: number; semPLporSemana: Map<number, number> }
  >();
  ctx.pressaoPL = (m, familia) => {
    const fIdx = mapa.familias.indexOf(familia);
    if (fIdx < 0) return inerte;
    const k = `${m.ano}|${familia}`;
    let base = memoriaPressao.get(k);
    if (!base || base.versao !== versaoDaProcura) {
      const pendentes = new Map<string, { primeira: number; ultima: number; sessoes: number }>();
      for (const p of procura.values()) {
        if (p.ano !== m.ano || p.familia !== familia || p.tipo !== "PL") continue;
        const falta = p.alvo - p.colocados;
        if (falta <= 0) continue;
        const atual = pendentes.get(p.ucId) ?? { primeira: p.primeira, ultima: p.ultima, sessoes: 0 };
        atual.primeira = Math.min(atual.primeira, p.primeira);
        atual.ultima = Math.max(atual.ultima, p.ultima);
        atual.sessoes += falta;
        pendentes.set(p.ucId, atual);
      }
      let gruposPL = 0;
      for (const v of pendentes.values()) gruposPL += Math.ceil(v.sessoes / mapa.plPorQuarto);
      const semPLporSemana = new Map<number, number>();
      if (gruposPL > 0) {
        const teorica = mapa.teorica(fIdx);
        for (const s of semanasDe(m.ano)) {
          const daSemana = [...pendentes.entries()].filter(
            ([, v]) => s.global >= v.primeira && s.global <= v.ultima,
          );
          if (daSemana.length === 0) continue;
          let semPL = 0;
          for (const dia of s.dias) {
            for (const hora of regras.grelha.horasInicio) {
              if (estado.ocupado(m.ano, s.global, teorica, dia, hora)) continue;
              const alvo: Mancha = { ano: m.ano, semana: s.global, dia, hora };
              const aceita =
                cabeMaisUmGrupoPL(alvo) && daSemana.some(([ucId]) => plPodeCaber(ucId, fIdx, familia, alvo));
              if (!aceita) semPL++;
            }
          }
          semPLporSemana.set(s.global, semPL);
        }
      }
      base = { versao: versaoDaProcura, gruposPL, semPLporSemana };
      memoriaPressao.set(k, base);
    }
    if (base.gruposPL === 0) return inerte;
    let manchaAceitaPL = false;
    if (cabeMaisUmGrupoPL(m)) {
      for (const p of procura.values()) {
        if (p.ano !== m.ano || p.familia !== familia || p.tipo !== "PL") continue;
        if (p.alvo - p.colocados <= 0) continue;
        if (m.semana < p.primeira || m.semana > p.ultima) continue;
        if (plPodeCaber(p.ucId, fIdx, familia, m)) {
          manchaAceitaPL = true;
          break;
        }
      }
    }
    return {
      gruposPL: base.gruposPL,
      manchasLivresSemPL: base.semPLporSemana.get(m.semana) ?? 0,
      manchaAceitaPL,
    };
  };

  /**
   * Pré-filtro barato: uma sessão isolada de (UC, tipo) que já viola uma
   * restrição dura nunca pode fazer parte de um bloco viável, porque todas as
   * restrições duras deste motor são monótonas (acrescentar sessões nunca
   * desfaz uma violação).
   */
  const passaSozinha = (ucId: string, turma: string, tipo: TipoAula, mancha: Mancha, familia: Familia): boolean =>
    primeiraViolacao(restricoes, ctxDe({ sessoes: [sessaoDe(ucId, turma, tipo)], mancha, familia })) === null;

  /**
   * Fração de carga por colocar que esta composição serve, contada por GRUPO
   * (UC + tipo) e não por sessão.
   *
   * Por sessão, um grupo de seis práticas esmagaria as duas TP que o acompanham
   * e a escolha do par de TP passaria a ser arbitrária — e é justamente essa
   * escolha que decide se a unidade curricular com o desdobramento mais
   * apertado consegue colocar tudo. Por grupo, cada unidade curricular do bloco
   * pesa o mesmo.
   */
  /**
   * O candidato realiza um emparelhamento declarado SEM quota? Estas
   * preferências não entram no custo (seriam satisfeitas sempre, à custa das
   * unidades curriculares que ficariam sem par); valem como desempate.
   */
  const temPreferenciaSemQuota = regras.padroesBloco.emparelhamentosPreferenciais.some(
    (p) => p.quantidadePorFamilia === null,
  );
  const realizaPreferenciaSemQuota = (candidato: Candidato): boolean => {
    if (!temPreferenciaSemQuota) return false;
    const indice = emparelhamentoSatisfeito(regras, candidato, ucPorId);
    return indice !== null && regras.padroesBloco.emparelhamentosPreferenciais[indice].quantidadePorFamilia === null;
  };

  /**
   * Carga de TP ainda por colocar em cada desdobramento, somando TODAS as
   * unidades curriculares da família.
   *
   * Existe por causa do RITMO das turmas TP. Com o limite de 2 TP da mesma UC
   * por bloco, uma unidade curricular avança sempre metade dos seus
   * desdobramentos de cada vez; e como o ritmo não deixa nenhuma turma ganhar
   * mais do que um bloco de avanço, a metade seguinte fica OBRIGADA. Se duas
   * unidades curriculares começarem pela MESMA metade, ficam presas em fase: as
   * duas precisam a seguir da mesma metade, e um bloco que junta duas TP exige
   * metades DISJUNTAS — nenhuma das duas pode entrar no bloco da outra.
   *
   * Servir primeiro os desdobramentos com mais carga por colocar em toda a
   * família desfaz essa sincronização à nascença: depois de uma UC gastar uma
   * metade, essa metade fica com menos carga pendente e a UC seguinte prefere a
   * outra. É ORDEM DE TENTATIVA, não custo — não altera qual é o mínimo, só a
   * ordem por que se procura.
   */
  const memoriaQuartos = new Map<string, { versao: number; porQuarto: number[] }>();
  const cargaTPporQuarto = (ano: number, fIdx: number): number[] => {
    const k = `${ano}|${fIdx}`;
    const guardado = memoriaQuartos.get(k);
    if (guardado && guardado.versao === versaoDaProcura) return guardado.porQuarto;
    const porQuarto = new Array<number>(mapa.quartosPorFamilia).fill(0);
    const nomes = new Map<string, number>();
    for (let q = 0; q < mapa.quartosPorFamilia; q++) nomes.set(mapa.tp(fIdx, q), q);
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familiaIdx !== fIdx || p.tipo !== "TP") continue;
      const q = nomes.get(p.turma);
      if (q === undefined) continue;
      porQuarto[q] += Math.max(0, p.alvo - p.colocados);
    }
    memoriaQuartos.set(k, { versao: versaoDaProcura, porQuarto });
    return porQuarto;
  };

  /** Carga pendente nos desdobramentos que estas TP servem. Maior = servir antes. */
  const espalhamentoTP = (sessoes: SessaoCandidata[], ano: number, fIdx: number): number => {
    const porQuarto = cargaTPporQuarto(ano, fIdx);
    const nomes = new Map<string, number>();
    for (let q = 0; q < mapa.quartosPorFamilia; q++) nomes.set(mapa.tp(fIdx, q), q);
    let total = 0;
    for (const s of sessoes) {
      if (s.tipo !== "TP") continue;
      const q = nomes.get(s.turma);
      if (q !== undefined) total += porQuarto[q];
    }
    return total;
  };

  ctx.urgencia = (sessoes: SessaoCandidata[]): number => {
    if (sessoes.length === 0) return 0;
    const grupos = new Map<string, { soma: number; n: number }>();
    for (const s of sessoes) {
      const p = procura.get(chaveProcura(s.ucId, s.tipo, s.turma));
      if (!p || p.alvo <= 0) continue;
      const k = `${s.ucId}|${s.tipo}`;
      const atual = grupos.get(k) ?? { soma: 0, n: 0 };
      atual.soma += (p.alvo - p.colocados) / p.alvo;
      atual.n += 1;
      grupos.set(k, atual);
    }
    if (grupos.size === 0) return 0;
    let total = 0;
    for (const g of grupos.values()) total += g.soma / g.n;
    return total / grupos.size;
  };

  /**
   * Custo mínimo que um bloco deste padrão pode ter nesta (ano, família,
   * semana): o custo que as regras dão ao padrão mais a reserva de TP, que
   * depende só da FORMA do bloco e do que falta colocar. Serve para percorrer
   * os padrões pela ordem certa; as restantes preferências soft variam dentro
   * do padrão e são o desempate.
   */
  const custoDaFormaNaMancha = (forma: FormaBloco, familia: Familia, mancha: Mancha): number => {
    let custo = custoDaForma(forma, custosForma);
    if (forma.pl.length > 0) return custo;
    const nTP = forma.tp.reduce((s, n) => s + n, 0);
    if (nTP > 0) {
      custo += custoDaReserva(regras, formas, nTP, ctx.procuraRestante(mancha.ano, familia, mancha.semana));
    }
    return custo + custoDaReservaDeMancha(ctx.pressaoPL(mancha, familia));
  };

  /**
   * Melhor candidato COMPLETO para uma mancha, ou null.
   *
   * Os padrões são percorridos por ordem crescente do seu custo efetivo;
   * dentro de cada padrão, as composições são ordenadas pelas preferências soft
   * de composição. Como todos os restantes termos do custo são iguais para
   * qualquer bloco completo da mesma mancha (cobrem sempre as mesmas folhas), o
   * primeiro candidato viável desta ordem é o mínimo.
   *
   * `exigir` restringe a procura a composições que contenham uma sessão de uma
   * dada (UC, tipo). É o que permite à passagem de desbloqueio de precedências
   * usar exatamente este gerador em vez de ter lógica própria.
   */
  const melhorCandidato = (
    ano: number,
    fIdx: number,
    familia: Familia,
    mancha: Mancha,
    limite: number,
    exigir?: { ucId: string; tipo: TipoAula },
  ): { candidato: Candidato; custo: number } | null => {
    const disponivel = ucsComProcura(ano, fIdx, mancha.semana);
    const teorica = mapa.teorica(fIdx);

    const tPermitidas = disponivel.t.filter((ucId) => passaSozinha(ucId, teorica, "T", mancha, familia));
    const tpPermitidas = disponivel.tp.filter((d) =>
      passaSozinha(d.ucId, mapa.tp(fIdx, d.quartos[0]), "TP", mancha, familia),
    );
    const plPermitidas = disponivel.pl.filter((d) =>
      passaSozinha(d.ucId, mapa.pl(fIdx, d.quartos[0])[0], "PL", mancha, familia),
    );
    if (tPermitidas.length === 0 && tpPermitidas.length === 0 && plPermitidas.length === 0) return null;
    if (exigir) {
      const presente =
        exigir.tipo === "T"
          ? tPermitidas.includes(exigir.ucId)
          : (exigir.tipo === "TP" ? tpPermitidas : plPermitidas).some((d) => d.ucId === exigir.ucId);
      if (!presente) return null;
    }

    const quartosTPdeUC = new Map(tpPermitidas.map((d) => [d.ucId, new Set(d.quartos)]));
    const quartosPLdeUC = new Map(plPermitidas.map((d) => [d.ucId, new Set(d.quartos)]));

    const ordemDasFormas = formas
      .map((forma) => ({ forma, custo: custoDaFormaNaMancha(forma, familia, mancha) }))
      .sort((a, b) => a.custo - b.custo || a.forma.id.localeCompare(b.forma.id));

    for (const entrada of ordemDasFormas) {
      if (entrada.custo >= limite) break;
      const composicoes: SessaoCandidata[][] = [];
      const forma = entrada.forma;

      if (forma.t > 0) {
        // Uma aula teórica cobre a turma teórica inteira: uma só sessão.
        if (forma.t !== 1) continue;
        if (forma.tp.length > 0 || forma.pl.length > 0) continue;
        for (const ucId of tPermitidas) composicoes.push([sessaoDe(ucId, teorica, "T")]);
      } else {
        const grupos: { tipo: "TP" | "PL"; nQuartos: number }[] = [];
        let valido = true;
        for (const n of forma.tp) grupos.push({ tipo: "TP", nQuartos: n });
        for (const n of forma.pl) {
          if (n % mapa.plPorQuarto !== 0) valido = false;
          grupos.push({ tipo: "PL", nQuartos: n / mapa.plPorQuarto });
        }
        if (!valido) continue;
        if (grupos.reduce((s, g) => s + g.nQuartos, 0) !== mapa.quartosPorFamilia) continue;

        const todosQuartos: number[] = [];
        for (let q = 0; q < mapa.quartosPorFamilia; q++) todosQuartos.push(q);

        const atribuir = (
          i: number,
          livres: number[],
          usados: Set<string>,
          acc: SessaoCandidata[],
          minimoAnterior: number,
        ) => {
          if (i === grupos.length) {
            composicoes.push(acc.slice());
            return;
          }
          const g = grupos[i];
          const fonte = g.tipo === "TP" ? tpPermitidas : plPermitidas;
          const disponiveis = g.tipo === "TP" ? quartosTPdeUC : quartosPLdeUC;
          // Dois lugares IGUAIS na mesma forma (ex.: os dois grupos de práticas
          // de `TP2+PL3+PL3`, ou as duas TP soltas de `TP2+TP1+TP1`) são
          // intermutáveis: gerar as duas ordens produzia exatamente os mesmos
          // blocos a dobrar. Exigir que o desdobramento mais baixo cresça de
          // lugar para lugar fixa uma ordem canónica — e é o que torna
          // praticáveis as formas muito fragmentadas que a regra geral abriu.
          const igualAoAnterior =
            i > 0 && grupos[i - 1].tipo === g.tipo && grupos[i - 1].nQuartos === g.nQuartos;
          for (const escolha of combinacoes(livres, g.nQuartos)) {
            if (igualAoAnterior && escolha[0] <= minimoAnterior) continue;
            for (const d of fonte) {
              if (usados.has(d.ucId)) continue;
              const meus = disponiveis.get(d.ucId);
              if (!meus || !escolha.every((q) => meus.has(q))) continue;
              const novas: SessaoCandidata[] = [];
              for (const q of escolha) {
                if (g.tipo === "TP") novas.push(sessaoDe(d.ucId, mapa.tp(fIdx, q), "TP"));
                else for (const nome of mapa.pl(fIdx, q)) novas.push(sessaoDe(d.ucId, nome, "PL"));
              }
              usados.add(d.ucId);
              atribuir(
                i + 1,
                livres.filter((q) => !escolha.includes(q)),
                usados,
                acc.concat(novas),
                escolha[0],
              );
              usados.delete(d.ucId);
            }
          }
        };
        atribuir(0, todosQuartos, new Set<string>(), [], -1);
      }

      if (composicoes.length === 0) continue;

      const filtradas = exigir
        ? composicoes.filter((s) => s.some((x) => x.ucId === exigir.ucId && x.tipo === exigir.tipo))
        : composicoes;
      if (filtradas.length === 0) continue;

      const avaliados = filtradas.map((sessoes, i) => {
        const candidato: Candidato = { sessoes, mancha, familia };
        return {
          candidato,
          ordem: custoDe(softsComposicao, candidato),
          espalhamento: espalhamentoTP(sessoes, mancha.ano, fIdx),
          urgencia: ctx.urgencia(sessoes),
          semQuota: realizaPreferenciaSemQuota(candidato) ? 0 : 1,
          i,
        };
      });
      // Critério principal: as preferências soft de composição, que fazem parte
      // de `custoTotal`. Depois, os desdobramentos com mais carga pendente em
      // toda a família — é o que impede as unidades curriculares de ficarem
      // presas em fase e, com elas, o ritmo das TP de bloquear os blocos que
      // juntam duas TP. A seguir, servir primeiro as turmas mais atrasadas: sem
      // isso o gerador escolheria sempre as mesmas e deixaria as restantes por
      // colocar. Por fim, entre candidatos igualmente urgentes, os
      // emparelhamentos declarados SEM quota. Tudo isto é ORDEM de tentativa,
      // não custo: não altera qual é o mínimo.
      avaliados.sort(
        (a, b) =>
          a.ordem - b.ordem ||
          b.espalhamento - a.espalhamento ||
          b.urgencia - a.urgencia ||
          a.semQuota - b.semQuota ||
          a.i - b.i,
      );

      for (const a of avaliados) {
        // A REGRA GERAL, e só ela: cobrir as folhas-aluno todas e não violar
        // nenhuma restrição dura (onde vivem os limites de 2 TP e 3 PL por UC).
        // Já não se exige que a composição CORRESPONDA a um padrão de uma lista.
        if (coberturaFolhas(a.candidato.sessoes, regras.estruturaTurmas) !== folhasDaFamilia) continue;
        if (primeiraViolacao(restricoes, ctxDe(a.candidato)) !== null) continue;
        // `softsComposicao` já inclui o custo da forma e a reserva de TP.
        const custo = a.ordem;
        if (custo >= limite) break;
        return { candidato: a.candidato, custo };
      }
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // 9.5 Ordem de tentativa das manchas
  // -------------------------------------------------------------------------

  /** Ordem de tentativa dos dias por tipo de aula, quando as regras a definem. */
  const ordemDiasPorTipo = new Map<TipoAula, Map<string, number>>();
  for (const j of regras.janelasPorTipo) {
    if (j.ordemPreferenciaDias.length === 0) continue;
    ordemDiasPorTipo.set(j.tipo, new Map(j.ordemPreferenciaDias.map((d, i) => [d, i])));
  }
  const indiceHora = new Map(regras.grelha.horasInicio.map((h, i) => [h, i]));
  const indiceDia = new Map(regras.grelha.dias.map((d, i) => [d, i]));

  /** Preferência de dia agregada aos tipos que ainda têm procura na semana. */
  const preferenciaDeDia = (ano: number, fIdx: number, semana: number, dia: string): number => {
    if (ordemDiasPorTipo.size === 0) return 0;
    const disponivel = ucsComProcura(ano, fIdx, semana);
    const tipos: TipoAula[] = [];
    if (disponivel.t.length > 0) tipos.push("T");
    if (disponivel.tp.length > 0) tipos.push("TP");
    if (disponivel.pl.length > 0) tipos.push("PL");
    let soma = 0;
    let n = 0;
    for (const tipo of tipos) {
      const ordem = ordemDiasPorTipo.get(tipo);
      if (!ordem) continue;
      soma += ordem.get(dia) ?? ordem.size;
      n++;
    }
    return n === 0 ? 0 : soma / n;
  };

  const probeCusto = (ano: number, fIdx: number, familia: Familia, mancha: Mancha, lista: Restricao[]): number => {
    const candidato: Candidato = {
      sessoes: [{ ucId: "", ucSigla: "", turma: mapa.teorica(fIdx), tipo: "T" }],
      mancha,
      familia,
    };
    return custoDe(lista, candidato);
  };

  const semanasComProcura = (ano: number, fIdx: number): number[] => {
    const semanas = new Set<number>();
    for (const p of procura.values()) {
      if (p.ano !== ano || p.familiaIdx !== fIdx) continue;
      if (p.alvo - p.colocados <= 0) continue;
      for (const s of semanasDe(ano)) {
        if (s.global >= p.primeira && s.global <= p.ultima) semanas.add(s.global);
      }
    }
    return [...semanas].sort((a, b) => a - b);
  };

  const semanaPorGlobal = new Map<string, SemanaAlocacao>();
  for (const [ano, lista] of calendario) for (const s of lista) semanaPorGlobal.set(`${ano}|${s.global}`, s);

  /** Manchas livres de uma semana, pela ordem de tentativa do alocador. */
  const manchasLivresDaSemana = (
    ano: number,
    fIdx: number,
    familia: Familia,
    semana: number,
  ): { mancha: Mancha; contexto: number; preferencia: number }[] => {
    const info = semanaPorGlobal.get(`${ano}|${semana}`);
    if (!info) return [];
    const teorica = mapa.teorica(fIdx);
    const opcoes: { mancha: Mancha; contexto: number; preferencia: number }[] = [];
    for (const dia of info.dias) {
      const preferencia = preferenciaDeDia(ano, fIdx, semana, dia);
      for (const hora of regras.grelha.horasInicio) {
        if (estado.ocupado(ano, semana, teorica, dia, hora)) continue;
        const mancha: Mancha = { ano, semana, dia, hora };
        opcoes.push({ mancha, contexto: probeCusto(ano, fIdx, familia, mancha, softsContexto), preferencia });
      }
    }
    opcoes.sort(
      (a, b) =>
        a.contexto - b.contexto ||
        a.preferencia - b.preferencia ||
        (indiceDia.get(a.mancha.dia) ?? 0) - (indiceDia.get(b.mancha.dia) ?? 0) ||
        (indiceHora.get(a.mancha.hora) ?? 0) - (indiceHora.get(b.mancha.hora) ?? 0),
    );
    return opcoes;
  };

  // -------------------------------------------------------------------------
  // 9.5 Desbloqueio de precedências
  //
  // As precedências (`h_..._ordem_t_tp_pl` e afins) estão certas; o que estava
  // errado era a ORDEM. Se o primeiro bloco de TP de uma UC só aparecer a meio
  // da janela letiva, todas as manchas anteriores ficam fechadas às PL dessa
  // UC — e, pior, os blocos que se colocaram entretanto gastaram as TP que
  // faltariam para emparelhar com essas PL.
  //
  // Esta passagem coloca, o MAIS CEDO POSSÍVEL na janela, o mínimo exigido de
  // cada precedência. Usa o mesmo gerador e o mesmo registo de restrições do
  // ciclo geral (só com a exigência de que o bloco inclua a sessão que
  // desbloqueia): nada é relaxado, nada é colocado a mais.
  //
  // As tabelas de PRECEDÊNCIA ESCALONADA entram aqui pelo mesmo caminho, e é
  // preciso que entrem. Uma tabela que exija 4 aulas T antes da 7.ª PL não pede
  // uma aula T cedo: pede QUATRO, escalonadas ao longo da janela. Se a passagem
  // só olhasse para a precedência simples ("1 T antes da primeira TP"), o motor
  // colocava essa primeira T cedo, deixava as outras três para o fim da janela
  // — onde o custo as leva — e todas as PL a partir da terceira ficavam sem
  // caminho. Foi exatamente o que se mediu: a unidade curricular com tabela
  // acabava com uma T na primeira semana, três na última e mais de metade das
  // suas práticas por colocar.
  // -------------------------------------------------------------------------

  interface Cadeia {
    ucId: string;
    ucSigla: string;
    ano: number;
    familia: Familia;
    fIdx: number;
    tipoAntes: TipoAula;
    tipoDepois: TipoAula;
    minimo: number;
    primeira: number;
    ultima: number;
    profundidade: number;
  }

  /** Sessões de um tipo já colocadas para uma (UC, família). */
  const sessoesColocadas = (ucId: string, fIdx: number, tipo: TipoAula): number => {
    let n = 0;
    for (const p of procura.values()) {
      if (p.ucId === ucId && p.familiaIdx === fIdx && p.tipo === tipo) n += p.colocados;
    }
    return n;
  };
  const procuraDe = (ucId: string, fIdx: number, tipo: TipoAula) => {
    let alvo = 0;
    let primeira = Number.POSITIVE_INFINITY;
    let ultima = 0;
    for (const p of procura.values()) {
      if (p.ucId !== ucId || p.familiaIdx !== fIdx || p.tipo !== tipo) continue;
      alvo += p.alvo;
      primeira = Math.min(primeira, p.primeira);
      ultima = Math.max(ultima, p.ultima);
    }
    return { alvo, primeira, ultima };
  };

  const cadeias = new Map<string, Cadeia>();
  for (const p of regras.precedencias) {
    const minimo = p.unidade === "horas" ? Math.ceil(p.minimoAntes / bloco) : Math.ceil(p.minimoAntes);
    if (minimo <= 0) continue;
    const siglas = new Set(p.siglas.map(normalizar));
    for (const uc of ucs) {
      if (p.anos.length > 0 && !p.anos.includes(uc.anoCurricular)) continue;
      if (siglas.size > 0 && !siglas.has(normalizar(uc.sigla))) continue;
      for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
        const antes = procuraDe(uc.id, fIdx, p.tipoAntes);
        const depois = procuraDe(uc.id, fIdx, p.tipoDepois);
        if (antes.alvo === 0 || depois.alvo === 0) continue;
        const k = `${uc.id}|${fIdx}|${p.tipoAntes}|${p.tipoDepois}`;
        const existente = cadeias.get(k);
        if (existente) {
          existente.minimo = Math.max(existente.minimo, minimo);
          continue;
        }
        cadeias.set(k, {
          ucId: uc.id,
          ucSigla: uc.sigla,
          ano: uc.anoCurricular,
          familia: mapa.familias[fIdx],
          fIdx,
          tipoAntes: p.tipoAntes,
          tipoDepois: p.tipoDepois,
          minimo,
          primeira: Math.min(antes.primeira, depois.primeira),
          ultima: Math.max(antes.ultima, depois.ultima),
          // As cadeias que arrancam nas teóricas têm de ser resolvidas antes das
          // que arrancam nas TP, senão a própria TP fica bloqueada.
          profundidade: p.tipoAntes === "T" ? 0 : 1,
        });
      }
    }
  }

  /**
   * As tabelas escalonadas, traduzidas para o mesmo tipo de cadeia. O mínimo é o
   * MAIOR que a tabela chega a exigir — colocar todas as aulas T (ou TP) que a
   * tabela vai pedir, e colocá-las cedo, satisfaz por maioria de razão todos os
   * degraus intermédios. O mínimo é limitado pela carga que a UC realmente tem:
   * uma tabela pode ser mais ambiciosa do que a unidade curricular a que se
   * aplica, e pedir aulas que não existem só produziria um aviso falso.
   */
  const registarCadeiaEscalonada = (
    uc: UC,
    fIdx: number,
    tipoAntes: TipoAula,
    exigido: number,
    profundidade: number,
  ): void => {
    if (exigido <= 0) return;
    const antes = procuraDe(uc.id, fIdx, tipoAntes);
    const depois = procuraDe(uc.id, fIdx, "PL");
    if (antes.alvo === 0 || depois.alvo === 0) return;
    const minimo = Math.min(exigido, antes.alvo);
    const k = `${uc.id}|${fIdx}|${tipoAntes}|PL`;
    const existente = cadeias.get(k);
    if (existente) {
      existente.minimo = Math.max(existente.minimo, minimo);
      return;
    }
    cadeias.set(k, {
      ucId: uc.id,
      ucSigla: uc.sigla,
      ano: uc.anoCurricular,
      familia: mapa.familias[fIdx],
      fIdx,
      tipoAntes,
      tipoDepois: "PL",
      minimo,
      primeira: Math.min(antes.primeira, depois.primeira),
      ultima: Math.max(antes.ultima, depois.ultima),
      profundidade,
    });
  };

  for (const tabela of regras.precedenciasEscalonadas) {
    const siglas = new Set(tabela.siglas.map(normalizar));
    const maxT = Math.max(0, ...tabela.escaloes.map((e) => e.minimoT));
    const maxTP = Math.max(0, ...tabela.escaloes.map((e) => e.minimoTP));
    for (const uc of ucs) {
      if (tabela.anos.length > 0 && !tabela.anos.includes(uc.anoCurricular)) continue;
      if (siglas.size > 0 && !siglas.has(normalizar(uc.sigla))) continue;
      for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
        // As aulas T são da FAMÍLIA inteira: `maxT` aulas chegam a todos os
        // desdobramentos. As TP são de CADA desdobramento, e a tabela conta-as
        // dentro do desdobramento a que a turma PL pertence — por isso o que a
        // família precisa de ter cedo é `maxTP` vezes o número de desdobramentos.
        registarCadeiaEscalonada(uc, fIdx, "T", maxT, 0);
        registarCadeiaEscalonada(uc, fIdx, "TP", maxTP * regras.estruturaTurmas.tpPorTurmaTeorica, 1);
      }
    }
  }

  const porResolver = [...cadeias.values()].sort(
    (a, b) =>
      a.profundidade - b.profundidade ||
      a.primeira - b.primeira ||
      a.ucSigla.localeCompare(b.ucSigla) ||
      a.fIdx - b.fIdx,
  );

  for (const cadeia of porResolver) {
    let tentativas = cadeia.minimo * 2 + 2;
    while (sessoesColocadas(cadeia.ucId, cadeia.fIdx, cadeia.tipoAntes) < cadeia.minimo && tentativas-- > 0) {
      let colocou = false;
      for (const s of semanasDe(cadeia.ano)) {
        if (s.global < cadeia.primeira || s.global > cadeia.ultima) continue;
        for (const o of manchasLivresDaSemana(cadeia.ano, cadeia.fIdx, cadeia.familia, s.global)) {
          const achado = melhorCandidato(
            cadeia.ano,
            cadeia.fIdx,
            cadeia.familia,
            o.mancha,
            Number.POSITIVE_INFINITY,
            { ucId: cadeia.ucId, tipo: cadeia.tipoAntes },
          );
          if (!achado) continue;
          registarColocacao(achado.candidato, false);
          colocou = true;
          break;
        }
        if (colocou) break;
      }
      if (!colocou) {
        avisos.push(
          `${cadeia.ucSigla} (família ${cadeia.familia}): não foi possível colocar as ${cadeia.minimo} aula(s) de ${cadeia.tipoAntes} que a precedência exige antes da primeira ${cadeia.tipoDepois}.`,
        );
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 9.6 O MENU DA SEMANA (Fase 6A)
  //
  // Antes de se disputarem horários, o planeador decide QUANTAS manchas de cada
  // padrão cada semana recebe e com que unidades curriculares — repartindo a
  // carga pelas semanas na proporção dos seus dias úteis e reservando de
  // antemão a quota de manchas que a estrutura das cargas torna inevitável.
  //
  // Aqui só se arruma esse menu nos dias: para cada mancha planeada procura-se
  // o melhor par (dia, hora) da sua semana, com o MESMO registo de restrições e
  // os MESMOS custos do ciclo guloso. O que não couber volta ao plano
  // (`replanear`) e é tentado noutra semana; o que sobrar do plano é apanhado
  // pelo ciclo guloso a seguir, que continua a ser a rede de segurança.
  // -------------------------------------------------------------------------

  let plano: PlanoSemanal | null = null;
  const planoUsadas: Partial<Record<FormaId, number>> = {};
  if (entrada.planeamentoSemanal !== false) {
    // O INVENTÁRIO PRIMEIRO. Que blocos existem e de que são feitos é uma conta
    // sobre as cargas, não uma descoberta a fazer pelo caminho: é feita aqui,
    // uma vez, sobre a carga que AINDA falta (descontado o que já está no
    // horário), e entregue ao planeador. Por ser o alocador a construí-lo, a
    // dependência entre planeador e inventário continua de sentido único.
    const jaColocadas = materializarSessoes(colocados, ucPorId, mapa, regras, indiceDia, indiceHora);
    const inventario = inventariar(entrada, regras, jaColocadas, restricoes);
    plano = planear(entrada, regras, inventario);

    /** Melhor (dia, hora) da semana para uma composição já decidida. */
    const melhorManchaPara = (
      ano: number,
      fIdx: number,
      familia: Familia,
      sessoes: SessaoCandidata[],
      semana: number,
    ): Mancha | null => {
      let melhor: Mancha | null = null;
      let melhorCusto = Number.POSITIVE_INFINITY;
      for (const o of manchasLivresDaSemana(ano, fIdx, familia, semana)) {
        if (o.contexto >= melhorCusto) break;
        const candidato: Candidato = { sessoes, mancha: o.mancha, familia };
        if (primeiraViolacao(restricoes, ctxDe(candidato)) !== null) continue;
        const total = o.contexto + custoDe(softsComposicao, candidato);
        if (total < melhorCusto) {
          melhorCusto = total;
          melhor = o.mancha;
        }
      }
      return melhor;
    };

    // Rondas: `replanear` pode devolver uma mancha a uma semana já percorrida,
    // e é preciso voltar lá. Cada mancha nunca repete uma semana, por isso o
    // número de rondas é finito; o limite é só uma rede.
    let rondas = plano.manchas.length + 1;
    let progresso = true;
    while (progresso && rondas-- > 0) {
      progresso = false;
      for (const ano of anos) {
        // Semana a semana, e dentro da semana as duas famílias à vez: a
        // capacidade de laboratórios é GLOBAL à escola, e servir uma família
        // inteira antes da outra deixava a segunda sem manchas para as práticas.
        for (const s of semanasDe(ano)) {
          for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
            const familia = mapa.familias[fIdx];
            for (const m of plano.pendentes(ano, familia, s.global)) {
              const alvo = melhorManchaPara(ano, fIdx, familia, m.sessoes, s.global);
              if (alvo === null) {
                plano.replanear(m);
                continue;
              }
              registarColocacao({ sessoes: m.sessoes, mancha: alvo, familia }, false);
              plano.confirmar(m);
              planoUsadas[m.forma] = (planoUsadas[m.forma] ?? 0) + 1;
              progresso = true;
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 9.7 O ciclo: escolher, a cada passo, a colocação de custo mínimo
  //
  // É a rede de segurança do menu: apanha a carga que o plano não orçamentou
  // (formas que não fecham nenhum padrão) e as manchas planeadas que nenhuma
  // semana da sua janela conseguiu arrumar.
  // -------------------------------------------------------------------------

  let seguranca = blocosAlvo + 1000;
  while (seguranca-- > 0) {
    // (a) custo de equilíbrio por (ano, família, semana) — reavaliado sempre,
    //     porque depende do estado. É o limite inferior do custo de qualquer
    //     mancha dessa semana.
    const triplos: { ano: number; fIdx: number; familia: Familia; semana: number; minimo: number }[] = [];
    for (const ano of anos) {
      for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
        const familia = mapa.familias[fIdx];
        for (const semana of semanasComProcura(ano, fIdx)) {
          const info = semanaPorGlobal.get(`${ano}|${semana}`);
          if (!info || info.dias.length === 0) continue;
          const mancha: Mancha = { ano, semana, dia: info.dias[0], hora: regras.grelha.horasInicio[0] };
          const minimo = equilibrio && equilibrio.custo ? Math.max(0, equilibrio.custo(ctxDe({
            sessoes: [{ ucId: "", ucSigla: "", turma: mapa.teorica(fIdx), tipo: "T" }],
            mancha,
            familia,
          }))) : 0;
          triplos.push({ ano, fIdx, familia, semana, minimo });
        }
      }
    }
    triplos.sort((a, b) => a.minimo - b.minimo || a.ano - b.ano || a.semana - b.semana || a.fIdx - b.fIdx);

    let melhor: { candidato: Candidato } | null = null;
    let melhorCusto = Number.POSITIVE_INFINITY;

    for (const t of triplos) {
      if (t.minimo >= melhorCusto) break;
      const opcoes = manchasLivresDaSemana(t.ano, t.fIdx, t.familia, t.semana);

      for (const o of opcoes) {
        if (o.contexto >= melhorCusto) break;
        const achado = melhorCandidato(t.ano, t.fIdx, t.familia, o.mancha, melhorCusto - o.contexto);
        if (!achado) continue;
        const total = o.contexto + achado.custo;
        if (total < melhorCusto) {
          melhorCusto = total;
          melhor = { candidato: achado.candidato };
        }
      }
    }

    if (!melhor) break;
    registarColocacao(melhor.candidato, false);
  }

  // -------------------------------------------------------------------------
  // 9.6 Défice: PORQUE é que o que sobrou não coube
  // -------------------------------------------------------------------------

  /**
   * PORQUÊ: para cada bloco que ficou por colocar, percorrem-se as manchas que
   * AINDA ESTAVAM LIVRES para aquela turma dentro da janela letiva da UC e
   * pergunta-se ao registo de restrições o que as impediu. As manchas já
   * ocupadas não entram na contagem — "o horário estava cheio" não explica
   * nada; se não sobrar nenhuma mancha livre, é isso mesmo que se diz.
   */
  const deficit: DeficitItem[] = [];
  for (const p of procura.values()) {
    const emFalta = p.alvo - p.colocados;
    if (emFalta <= 0) continue;
    const motivos = new Map<string, { n: number; exemplo: string }>();
    let manchasNaJanela = 0;
    let manchasLivres = 0;
    for (const s of semanasDe(p.ano)) {
      if (s.global < p.primeira || s.global > p.ultima) continue;
      for (const dia of s.dias) {
        for (const hora of regras.grelha.horasInicio) {
          manchasNaJanela++;
          if (estado.ocupado(p.ano, s.global, p.turma, dia, hora)) continue;
          manchasLivres++;
          const mancha: Mancha = { ano: p.ano, semana: s.global, dia, hora };
          const candidato: Candidato = {
            sessoes: [sessaoDe(p.ucId, p.turma, p.tipo)],
            mancha,
            familia: p.familia,
          };
          const motivo = primeiraViolacao(restricoes, ctxDe(candidato));
          const chave = motivo === null ? "[composicao-a-100]" : motivo.slice(0, motivo.indexOf("]") + 1);
          const texto =
            motivo ??
            "[composicao-a-100] a mancha estava livre para esta aula, mas não havia procura por colocar nas outras unidades curriculares para fechar o bloco a 100% das folhas-aluno.";
          const atual = motivos.get(chave);
          if (atual) atual.n += 1;
          else motivos.set(chave, { n: 1, exemplo: texto });
        }
      }
    }
    if (manchasLivres === 0) {
      motivos.set("[sem-mancha-livre]", {
        n: manchasNaJanela,
        exemplo: `[sem-mancha-livre] a turma já ocupa todas as ${manchasNaJanela} manchas da janela letiva desta unidade curricular; não sobrou onde pôr mais blocos.`,
      });
    }
    const motivosMaisFrequentes: MotivoContado[] = [...motivos.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 4)
      .map(([, v]) => ({ motivo: v.exemplo, ocorrencias: v.n }));
    deficit.push({
      ucSigla: p.ucSigla,
      turma: mapa.apresentacao(p.turma),
      tipo: p.tipo as DeficitItem["tipo"],
      blocosEmFalta: emFalta,
      motivosMaisFrequentes,
    });
  }
  deficit.sort(
    (a, b) => b.blocosEmFalta - a.blocosEmFalta || a.ucSigla.localeCompare(b.ucSigla) || a.turma.localeCompare(b.turma),
  );

  // -------------------------------------------------------------------------
  // 9.7 Sessões, carga semanal e avisos
  // -------------------------------------------------------------------------

  const sessoes = materializarSessoes(colocados, ucPorId, mapa, regras, indiceDia, indiceHora);

  const cargaPorSemana: RelatorioAlocacao["cargaPorSemana"] = [];
  for (const ano of anos) {
    for (let fIdx = 0; fIdx < mapa.familias.length; fIdx++) {
      const familia = mapa.familias[fIdx];
      for (const s of semanasDe(ano)) {
        cargaPorSemana.push({
          ano,
          familia,
          semana: s.global,
          horas: estado.manchasNaSemana(ano, familia, s.global) * bloco,
        });
      }
    }
  }

  // Emparelhamentos preferenciais sem quota declarada.
  regras.padroesBloco.emparelhamentosPreferenciais.forEach((p, i) => {
    if (p.quantidadePorFamilia !== null) return;
    const feitos = mapa.familias
      .map((f) => ctx.emparelhamentosSatisfeitos.get(`${i}|${f}`) ?? 0)
      .reduce((s, n) => s + n, 0);
    avisos.push(
      `emparelhamento preferencial ${i + 1} (${p.origem}) não declara \`quantidadePorFamilia\`: foi aplicado como desempate e saiu ${feitos} vez(es). ` +
        "Sem quota, uma preferência satisfeita sempre escolhe a mesma unidade curricular para acompanhar as práticas e deixa as outras sem par — declare a quota para o motor a cumprir à letra.",
    );
  });

  // Aulas T conjuntas obrigatórias por dia: verificação de cobertura.
  for (const regra of regras.aulasTConjuntas) {
    if (!regra.obrigatoriaPorDia || regra.dias.length === 0) continue;
    const obrigadas = new Set(regra.siglasObrigatorias.map(normalizar));
    for (const semanaRel of regra.semanas.length > 0 ? regra.semanas : [1]) {
      for (const dia of regra.dias) {
        const tem = colocados.some((c) => {
          const m = c.candidato.mancha;
          const rel = m.semana <= fronteira ? m.semana : m.semana - fronteira;
          if (rel !== semanaRel || m.dia !== dia) return false;
          if (regra.anos.length > 0 && !regra.anos.includes(m.ano)) return false;
          return c.candidato.sessoes.some(
            (s) => s.tipo === "T" && (obrigadas.size === 0 || obrigadas.has(normalizar(s.ucSigla))),
          );
        });
        if (!tem) {
          avisos.push(
            `aula T conjunta obrigatória (${regra.origem}): não ficou nenhum bloco teórico em ${dia} na semana ${semanaRel}.`,
          );
        }
      }
    }
  }

  // O que o menu prometeu e o que dele se cumpriu.
  if (plano) {
    const planeadas: Partial<Record<FormaId, number>> = {};
    for (const m of plano.manchas) planeadas[m.forma] = (planeadas[m.forma] ?? 0) + 1;
    const resumoFormas = (Object.keys(planeadas) as FormaId[])
      .sort()
      .map((id) => `${id} ${planoUsadas[id] ?? 0}/${planeadas[id] ?? 0}`)
      .join(", ");
    const quota = plano.orcamentos.reduce((s, o) => s + o.quotaSemParceiro, 0);
    avisos.push(
      `plano semanal: ${plano.manchas.length} manchas orçamentadas, ` +
        `${Object.values(planoUsadas).reduce((s, n) => s + (n ?? 0), 0)} arrumadas pelo menu ` +
        `(colocadas/planeadas por forma: ${resumoFormas}). ` +
        `Quota estrutural de manchas com um grupo de práticas isolado: ${quota}.`,
    );
    for (const a of plano.avisos) avisos.push(`plano semanal: ${a}`);
    for (const s of plano.sobras) {
      avisos.push(`plano semanal: ${s.ucSigla} ${s.turma} ${s.tipo} (${s.blocos} bloco(s)) — ${s.motivo}`);
    }
  }

  const blocosColocados = colocados.reduce((s, c) => s + c.candidato.sessoes.length, 0);
  const semanasSemDias = new Map<number, number[]>();
  for (const ano of anos) {
    const esperadas = regras.calendario.semanaMaximaGlobal ?? fronteira * 2;
    const presentes = new Set(semanasDe(ano).map((s) => s.global));
    const faltam: number[] = [];
    for (let w = 1; w <= esperadas; w++) if (!presentes.has(w)) faltam.push(w);
    if (faltam.length > 0) semanasSemDias.set(ano, faltam);
  }
  for (const [ano, faltam] of semanasSemDias) {
    avisos.push(`ano ${ano}: as semanas ${faltam.join(", ")} não recebem aulas (pausa letiva ou fora do calendário).`);
  }

  // Semanas que existem no calendário, tinham carga para colocar e mesmo assim
  // ficaram vazias: é quase sempre uma regra a vetar a semana inteira, e o
  // coordenador tem de a ver com o nome da regra.
  for (const ano of anos) {
    for (const s of semanasDe(ano)) {
      const ocupacao = mapa.familias.reduce((t, f) => t + estado.manchasNaSemana(ano, f, s.global), 0);
      if (ocupacao > 0) continue;
      const pendentes = [...procura.values()].filter(
        (p) => p.ano === ano && p.alvo - p.colocados > 0 && s.global >= p.primeira && s.global <= p.ultima,
      );
      if (pendentes.length === 0) continue;
      // Qual é a regra que veta a semana INTEIRA? Cada restrição dura é
      // avaliada por si, não só a primeira que dispara: se uma delas recusa
      // todas as aulas de todos os dias, é essa que o coordenador tem de ver —
      // é ela que está a apagar a semana, e não a que por acaso vem primeiro no
      // registo.
      const duras = restricoes.filter((r) => r.tipo === "hard" && r.verificar);
      const vetos = new Map<string, { n: number; exemplo: string }>();
      let provas = 0;
      for (const p of pendentes) {
        for (const dia of s.dias) {
          for (const hora of regras.grelha.horasInicio) {
            provas++;
            const contexto = ctxDe({
              sessoes: [sessaoDe(p.ucId, p.turma, p.tipo)],
              mancha: { ano, semana: s.global, dia, hora },
              familia: p.familia,
            });
            for (const r of duras) {
              const motivo = r.verificar!(contexto);
              if (!motivo) continue;
              const atual = vetos.get(r.id);
              if (atual) atual.n += 1;
              else vetos.set(r.id, { n: 1, exemplo: `[${r.id}] ${motivo}` });
            }
          }
        }
      }
      const totais = [...vetos.values()].filter((v) => v.n === provas);
      const cabeca = `ano ${ano}: a semana global ${s.global} (semana ${s.relativa} do ${s.semestre}.º semestre) ficou sem nenhuma aula apesar de haver carga por colocar`;
      if (totais.length > 0) {
        avisos.push(
          `${cabeca} — a semana inteira está vetada por ${totais.length} restrição(ões): ` +
            totais.map((v) => v.exemplo).join(" | "),
        );
      } else {
        const dominante = [...vetos.values()].sort((a, b) => b.n - a.n)[0];
        avisos.push(`${cabeca}${dominante ? ` — motivo mais frequente: ${dominante.exemplo}` : "."}`);
      }
    }
  }

  const relatorio: RelatorioAlocacao = {
    blocosAlvo,
    blocosColocados,
    completude: blocosAlvo === 0 ? 100 : Math.min(100, (blocosColocados / blocosAlvo) * 100),
    deficit,
    padroesUsados: formasUsadas,
    cargaPorSemana,
    avisos,
  };

  return { sessoes, relatorio };
}

// ---------------------------------------------------------------------------
// 10. Materialização das sessões
// ---------------------------------------------------------------------------

function materializarSessoes(
  colocados: { candidato: Candidato; forma: FormaId | null; fixo: boolean }[],
  ucPorId: Map<string, UC>,
  mapa: MapaTurmas,
  regras: ConfiguracaoMotor,
  indiceDia: Map<string, number>,
  indiceHora: Map<string, number>,
): SessaoHorario[] {
  const bruto: { sessao: SessaoCandidata; mancha: Mancha; fixo: boolean }[] = [];
  for (const c of colocados) {
    for (const s of c.candidato.sessoes) bruto.push({ sessao: s, mancha: c.candidato.mancha, fixo: c.fixo });
  }
  bruto.sort((a, b) => {
    if (a.mancha.semana !== b.mancha.semana) return a.mancha.semana - b.mancha.semana;
    const da = (indiceDia.get(a.mancha.dia) ?? 0) - (indiceDia.get(b.mancha.dia) ?? 0);
    if (da !== 0) return da;
    const ha = (indiceHora.get(a.mancha.hora) ?? 0) - (indiceHora.get(b.mancha.hora) ?? 0);
    if (ha !== 0) return ha;
    return a.sessao.turma.localeCompare(b.sessao.turma, "pt-PT", { numeric: true });
  });

  const numeros = new Map<string, number>();
  const saida: SessaoHorario[] = [];
  let id = 1;
  for (const b of bruto) {
    const uc = ucPorId.get(b.sessao.ucId);
    const k = `${b.sessao.ucId}|${b.sessao.tipo}|${b.sessao.turma}`;
    const n = (numeros.get(k) ?? 0) + 1;
    numeros.set(k, n);
    saida.push({
      id: id++,
      ucNome: uc?.nome ?? b.sessao.ucSigla,
      ucSigla: b.sessao.ucSigla,
      tipoAula: b.sessao.tipo,
      docente: "",
      sala: "",
      salaTipo: "",
      turma: mapa.apresentacao(b.sessao.turma),
      diaSemana: b.mancha.dia,
      horaInicio: b.mancha.hora,
      horaFim: somarHoras(b.mancha.hora, regras.grelha.duracaoBlocoHoras),
      bloqueado: b.fixo,
      semana: b.mancha.semana,
      numeroAula: n,
    });
  }
  return saida;
}
