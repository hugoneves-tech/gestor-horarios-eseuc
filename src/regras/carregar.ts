/**
 * CARREGADOR DE REGRAS — do Supabase para a configuração validada do motor.
 *
 * Recebe as linhas da tabela `regras` (e, opcionalmente, `ucs` e
 * `anos_semestres`) e devolve:
 *   - uma `ConfiguracaoMotor` validada;
 *   - um RELATÓRIO explícito: o que faltou, o que estava malformado, o que não
 *     foi reconhecido, o que caiu no default e onde duas regras se atropelam.
 *
 * Regra de ouro: nunca inventar em silêncio. Se o motor usar um valor que não
 * veio da base de dados, isso aparece no relatório.
 *
 * O despacho é feito pelo CONTEÚDO da regra (as chaves presentes em
 * `config.motor`), não pelo `id`. Ver `IDS_REGRA_LEGADOS` mais abaixo.
 */

import {
  configuracaoPadrao,
  derivarHorasInicio,
  ehObjeto,
  registarAviso,
  registarErro,
  validarAulaTConjunta,
  validarBloqueioCalendario,
  validarCargaDiaria,
  validarCoerencia,
  validarEstruturaTurmas,
  validarGrelha,
  validarJanelaTipoAula,
  validarLayoutFixo,
  validarLimitesUC,
  validarMaratonaUC,
  validarPadroesBloco,
  validarPoolSala,
  validarPrecedencia,
  validarPrecedenciaEscalonada,
  validarRestricaoUC,
  validarRitmoTP,
  validarTPPLmesmaUC,
  validarSemanaPersonalizada,
  validarTurnos,
  valBooleano,
  valData,
  valEnum,
  valLista,
  valListaInteiros,
  valListaTexto,
  valNumero,
  valTexto,
  REGRAS_NECESSARIAS,
  FAMILIAS,
} from "./esquema";
import type {
  ConfiguracaoMotor,
  Diagnostico,
  Diagnosticos,
  Familia,
  LimitesPorUC,
  PadraoBloco,
  RegrasCargaDiaria,
} from "./esquema";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/**
 * Uma linha da tabela `regras`. Aceita as duas convenções que circulam no
 * projeto: `ano_curricular` (REST/Postgres) e `anoCurricular` (tipo da app).
 */
export interface LinhaRegra {
  id?: string;
  nome?: string;
  tipo?: string;
  categoria?: string;
  descricao?: string;
  escopo?: string | null;
  ano_curricular?: string | number | null;
  anoCurricular?: string | number | null;
  config?: unknown;
  parametros?: unknown;
  peso?: number;
  ativa?: boolean;
}

export interface EntradaCarregamento {
  regras: LinhaRegra[];
  /** Linhas da tabela `ucs`, para os limites de simultaneidade por UC. */
  ucs?: unknown[];
  /** Linhas da tabela `anos_semestres`, para as semanas personalizadas. */
  anosSemestres?: unknown[];
  /** Se indicado, só se carregam as semanas personalizadas deste ano/semestre. */
  anoSemestreId?: string;
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface RegraEmFalta {
  chaveMotor: string;
  critica: boolean;
  porque: string;
}

export interface DefaultAplicado {
  chave: string;
  valor: string;
  porque: string;
}

export interface ChaveDesconhecida {
  regraId: string;
  chave: string;
  onde: string;
}

export interface ConflitoRegras {
  chave: string;
  regras: string[];
  resolucao: string;
}

export interface RelatorioCarregamento {
  regrasLidas: number;
  regrasAplicadas: string[];
  regrasInativas: string[];
  /** Regras válidas mas puramente descritivas (sem `config.motor`). */
  regrasDescritivas: string[];
  emFalta: RegraEmFalta[];
  malformadas: Diagnostico[];
  desconhecidas: ChaveDesconhecida[];
  defaultsAplicados: DefaultAplicado[];
  conflitos: ConflitoRegras[];
  avisos: Diagnostico[];
}

export interface ResultadoCarregamento {
  config: ConfiguracaoMotor;
  relatorio: RelatorioCarregamento;
}

// ---------------------------------------------------------------------------
// Identificadores legados
// ---------------------------------------------------------------------------

/**
 * IDs de regra que o código antigo procurava literalmente para decidir se uma
 * funcionalidade ligava (`App.tsx` fazia `regras.find(r => r.id === "...")`).
 *
 * Este carregador NÃO os usa para despacho — uma regra é reconhecida pelas
 * chaves que traz em `config.motor`, pelo que renomear o `id` no Supabase
 * deixou de partir nada. A constante fica aqui, num único sítio, apenas para:
 *   a) documentar o mapeamento histórico;
 *   b) permitir que o relatório indique nomes reconhecíveis por quem edita as
 *      regras na interface.
 */
export const IDS_REGRA_LEGADOS: Readonly<Record<string, string>> = {
  h_blocos_ocupacao_100: "Ocupação obrigatória de 100% em todos os blocos",
  h_limite_global_6_pl: "Máximo global de PL por bloco",
  h_pl_dias_4a_6a: "Dias permitidos para as aulas práticas",
  h_2ano_semana_1_sem_pl: "Layout fixo de semana",
  h_carga_diaria_estudantes: "Carga diária do estudante",
};

// ---------------------------------------------------------------------------
// Chaves reconhecidas
// ---------------------------------------------------------------------------

/** Chaves de topo em `config` que não são configuração de motor. */
const CHAVES_CONFIG_METADADOS = new Set([
  "motor",
  "traducaoSimples",
  "anos",
  "anosLetivos",
  "cursoIds",
  "validacao",
  "descricao",
  "notas",
]);

/**
 * Chaves em `config.motor` que existem no histórico mas que o motor novo já
 * não interpreta. São reportadas como aviso, não como erro, para que ninguém
 * fique com a ideia de que estão a produzir efeito.
 */
const CHAVES_MOTOR_OBSOLETAS: Readonly<Record<string, string>> = {
  blocosSemanas:
    "o âmbito por intervalo de semanas passou a ser expresso em `restricoesUC.semanasRestritas` ou em exceções de turno.",
  percentagensOcupacaoLegado: "as percentagens de ocupação passaram a derivar de `estruturaTurmas`.",
};

// ---------------------------------------------------------------------------
// Carregador
// ---------------------------------------------------------------------------

export function carregarRegras(entrada: EntradaCarregamento): ResultadoCarregamento {
  const config = configuracaoPadrao();
  const diagnosticos: Diagnosticos = [];

  const relatorio: RelatorioCarregamento = {
    regrasLidas: entrada.regras?.length ?? 0,
    regrasAplicadas: [],
    regrasInativas: [],
    regrasDescritivas: [],
    emFalta: [],
    malformadas: [],
    desconhecidas: [],
    defaultsAplicados: [],
    conflitos: [],
    avisos: [],
  };

  /** Chaves de motor efetivamente vistas, por chave -> regras que a trouxeram. */
  const vistas = new Map<string, string[]>();
  const registarVista = (chave: string, regraId: string) => {
    const lista = vistas.get(chave) ?? [];
    lista.push(regraId);
    vistas.set(chave, lista);
  };

  /** Secções que só podem ser definidas uma vez; a 2.ª gera conflito. */
  const donoDaSecao = new Map<string, string>();
  const reclamarSecao = (secao: string, regraId: string, resolucao: string): boolean => {
    const dono = donoDaSecao.get(secao);
    if (dono && dono !== regraId) {
      relatorio.conflitos.push({ chave: secao, regras: [dono, regraId], resolucao });
      return false;
    }
    donoDaSecao.set(secao, regraId);
    return true;
  };

  // -- Semanas personalizadas vindas de `anos_semestres` ---------------------
  carregarSemanasPersonalizadas(entrada, config, diagnosticos);

  // -- Limites por UC vindos de `ucs` ---------------------------------------
  if (Array.isArray(entrada.ucs)) {
    const limites: LimitesPorUC[] = [];
    entrada.ucs.forEach((uc, i) => {
      const v = validarLimitesUC(uc, `ucs[${i}]`, diagnosticos);
      if (v) limites.push(v);
    });
    config.limitesPorUC = limites;
  }

  // -- Percorrer as regras ---------------------------------------------------
  for (const bruta of entrada.regras ?? []) {
    const regraId = typeof bruta?.id === "string" && bruta.id.trim() !== "" ? bruta.id.trim() : "(regra sem id)";
    const caminhoRegra = `regra:${regraId}`;

    if (bruta?.ativa === false) {
      relatorio.regrasInativas.push(regraId);
      continue;
    }

    const cfgBruta = ehObjeto(bruta?.config) ? bruta.config : ehObjeto(bruta?.parametros) ? bruta.parametros : null;
    if (!cfgBruta) {
      if (bruta?.config !== undefined && bruta?.config !== null && !ehObjeto(bruta.config)) {
        registarErro(diagnosticos, `${caminhoRegra}/config`, "o campo `config` tem de ser um objeto JSON.");
      } else {
        relatorio.regrasDescritivas.push(regraId);
      }
      continue;
    }

    const anos = anosDaRegra(bruta, cfgBruta);
    let aplicouAlgo = false;

    // Chaves de topo do `config` que ainda transportam configuração.
    for (const chave of Object.keys(cfgBruta)) {
      if (CHAVES_CONFIG_METADADOS.has(chave)) continue;
      if (chave === "diasPermitidos") {
        const dias = valListaTexto(
          (cfgBruta as any).diasPermitidos,
          `${caminhoRegra}/config/diasPermitidos`,
          diagnosticos,
        );
        if (dias && dias.length > 0) {
          if (reclamarSecao("preferencias.diasPermitidosPL", regraId, "prevalece a primeira regra lida")) {
            config.preferencias.diasPermitidosPL = dias;
            registarVista("diasPermitidosPL", regraId);
            aplicouAlgo = true;
          }
        }
        continue;
      }
      relatorio.desconhecidas.push({ regraId, chave, onde: "config" });
    }

    const motor = ehObjeto((cfgBruta as any).motor) ? ((cfgBruta as any).motor as Record<string, unknown>) : null;
    if ((cfgBruta as any).motor !== undefined && !motor) {
      registarErro(diagnosticos, `${caminhoRegra}/config/motor`, "o campo `motor` tem de ser um objeto JSON.");
    }

    if (motor) {
      for (const chave of Object.keys(motor)) {
        const caminho = `${caminhoRegra}/config/motor/${chave}`;
        const valor = motor[chave];

        if (CHAVES_MOTOR_OBSOLETAS[chave]) {
          registarAviso(
            diagnosticos,
            caminho,
            `a chave \`${chave}\` já não é interpretada pelo motor: ${CHAVES_MOTOR_OBSOLETAS[chave]}`,
          );
          continue;
        }

        const aplicou = aplicarChaveMotor({
          chave,
          valor,
          caminho,
          regraId,
          anos,
          config,
          diagnosticos,
          relatorio,
          reclamarSecao,
        });

        if (aplicou === "desconhecida") {
          relatorio.desconhecidas.push({ regraId, chave, onde: "config.motor" });
        } else if (aplicou === "aplicada") {
          registarVista(chave, regraId);
          aplicouAlgo = true;
        }
      }
    }

    if (aplicouAlgo) relatorio.regrasAplicadas.push(regraId);
    else if (!relatorio.regrasDescritivas.includes(regraId)) relatorio.regrasDescritivas.push(regraId);
  }

  // -- Consolidação ----------------------------------------------------------
  consolidarPadroesBloco(config, vistas, relatorio);
  consolidarGrelha(config, vistas);

  // -- Regras em falta e defaults aplicados ---------------------------------
  for (const necessaria of REGRAS_NECESSARIAS) {
    if (vistas.has(necessaria.chaveMotor)) continue;
    // `semanasSoTurmaA` cobre também `semanasSoTurmaB`.
    if (necessaria.chaveMotor === "semanasSoTurmaA" && vistas.has("semanasSoTurmaB")) continue;
    relatorio.emFalta.push({
      chaveMotor: necessaria.chaveMotor,
      critica: necessaria.critica,
      porque: necessaria.porque,
    });
    relatorio.defaultsAplicados.push({
      chave: necessaria.chaveMotor,
      valor: descreverDefault(necessaria.chaveMotor, config),
      porque: necessaria.porque,
    });
  }

  // -- Coerência global ------------------------------------------------------
  diagnosticos.push(...validarCoerencia(config));

  relatorio.malformadas = diagnosticos.filter((d) => d.nivel === "erro");
  relatorio.avisos = diagnosticos.filter((d) => d.nivel === "aviso");

  return { config, relatorio };
}

// ---------------------------------------------------------------------------
// Despacho por chave de motor
// ---------------------------------------------------------------------------

interface ContextoChave {
  chave: string;
  valor: unknown;
  caminho: string;
  regraId: string;
  anos: number[];
  config: ConfiguracaoMotor;
  diagnosticos: Diagnosticos;
  relatorio: RelatorioCarregamento;
  reclamarSecao: (secao: string, regraId: string, resolucao: string) => boolean;
}

type ResultadoChave = "aplicada" | "ignorada" | "desconhecida";

function aplicarChaveMotor(ctx: ContextoChave): ResultadoChave {
  const { chave, valor, caminho, regraId, anos, config, diagnosticos, reclamarSecao } = ctx;

  switch (chave) {
    // -- Grelha horária ------------------------------------------------------
    case "grelhaHoraria": {
      const g = validarGrelha(valor, caminho, diagnosticos);
      if (!g) return "ignorada";
      if (!reclamarSecao("grelha", regraId, "prevalece a primeira regra lida")) return "ignorada";
      Object.assign(config.grelha, g);
      return "aplicada";
    }

    // -- Estrutura de turmas -------------------------------------------------
    case "estruturaTurmas": {
      const e = validarEstruturaTurmas(valor, caminho, diagnosticos);
      if (!e) return "ignorada";
      if (!reclamarSecao("estruturaTurmas", regraId, "prevalece a primeira regra lida")) return "ignorada";
      Object.assign(config.estruturaTurmas, e);
      return "aplicada";
    }

    // -- Janelas por tipo de aula -------------------------------------------
    case "janelasPorTipoAula": {
      const janelas = valLista(valor, caminho, diagnosticos, (b, c, d) =>
        validarJanelaTipoAula(b, c, d, regraId),
      );
      if (!janelas || janelas.length === 0) return "ignorada";
      for (const j of janelas) {
        const existente = config.janelasPorTipo.find((x) => x.tipo === j.tipo);
        if (existente) {
          ctx.relatorio.conflitos.push({
            chave: `janelasPorTipoAula/${j.tipo}`,
            regras: [existente.origem, regraId],
            resolucao: `prevalece a janela de ${existente.origem}`,
          });
          continue;
        }
        config.janelasPorTipo.push(j);
      }
      return "aplicada";
    }

    // -- Padrões de bloco a 100% --------------------------------------------
    case "blocos100": {
      const p = validarPadroesBloco(valor, caminho, diagnosticos);
      if (!p) return "ignorada";
      if (!reclamarSecao("blocos100", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (p.exigirCoberturaTotal !== undefined) config.padroesBloco.exigirCoberturaTotal = p.exigirCoberturaTotal;
      if (p.percentagensOcupacao) config.padroesBloco.percentagensOcupacao = p.percentagensOcupacao;
      if (p.emparelhamentosPreferenciais) {
        config.padroesBloco.emparelhamentosPreferenciais = p.emparelhamentosPreferenciais;
      }
      if ((p as any).preferirSextaLivre !== undefined) {
        config.preferencias.preferirSextaLivre = (p as any).preferirSextaLivre;
      }
      // Guardado em bruto; a consolidação aplica ativos/custos/último recurso.
      (config.padroesBloco as any).__pendente = {
        ativos: p.ativos,
        ultimoRecurso: p.ultimoRecurso,
        custos: p.padroes,
        regraId,
      };
      return "aplicada";
    }

    case "exigirCoberturaTotal": {
      const v = valBooleano(valor, caminho, diagnosticos);
      if (v === undefined) return "ignorada";
      config.padroesBloco.exigirCoberturaTotal = v;
      return "aplicada";
    }

    // -- Capacidades ---------------------------------------------------------
    case "maxPLporMancha": {
      const n = valNumero(valor, caminho, diagnosticos, { min: 1, inteiro: true });
      if (n === undefined) return "ignorada";
      if (!reclamarSecao("maxPLporMancha", regraId, "prevalece a primeira regra lida")) return "ignorada";
      config.capacidade.maxPLporMancha = n;
      return "aplicada";
    }

    case "maxTPporMancha": {
      if (valor === null) {
        config.capacidade.maxTPporMancha = null;
        return "aplicada";
      }
      const n = valNumero(valor, caminho, diagnosticos, { min: 1, inteiro: true });
      if (n === undefined) return "ignorada";
      config.capacidade.maxTPporMancha = n;
      return "aplicada";
    }

    case "capacidadeTP": {
      if (!ehObjeto(valor)) {
        registarErro(diagnosticos, caminho, "a capacidade de TP tem de ser um objeto.");
        return "ignorada";
      }
      if (!reclamarSecao("capacidadeTP", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (valor.maxTPporMancha === null) config.capacidade.maxTPporMancha = null;
      else {
        const n = valNumero(valor.maxTPporMancha, `${caminho}/maxTPporMancha`, diagnosticos, { min: 1, inteiro: true });
        if (n !== undefined) config.capacidade.maxTPporMancha = n;
      }
      if (valor.maxTPporUCporMancha === null) config.capacidade.maxTPporUCporMancha = null;
      else {
        const n = valNumero(valor.maxTPporUCporMancha, `${caminho}/maxTPporUCporMancha`, diagnosticos, {
          min: 1,
          inteiro: true,
        });
        if (n !== undefined) config.capacidade.maxTPporUCporMancha = n;
      }
      if (valor.maxPLporUCporMancha === null) config.capacidade.maxPLporUCporMancha = null;
      else {
        const n = valNumero(valor.maxPLporUCporMancha, `${caminho}/maxPLporUCporMancha`, diagnosticos, {
          min: 1,
          inteiro: true,
        });
        if (n !== undefined) config.capacidade.maxPLporUCporMancha = n;
      }
      const ambito = valEnum(valor.ambitoContagem, `${caminho}/ambitoContagem`, diagnosticos, [
        "bloco",
        "turma",
      ] as const);
      if (ambito) config.capacidade.ambitoContagem = ambito;
      return "aplicada";
    }

    /**
     * LIMITES UNIVERSAIS DE COMPOSIÇÃO DE BLOCO.
     *
     * É a chave que substitui a lista de padrões como fonte de verdade: com
     * `maxTPporUCporMancha` e `maxPLporUCporMancha` definidos, as formas de bloco
     * possíveis são uma consequência aritmética destes dois números. Uma UC pode
     * declarar um valor mais baixo no catálogo; o motor fica com o mínimo.
     */
    case "limitesUniversaisPorUC": {
      if (!ehObjeto(valor)) {
        registarErro(diagnosticos, caminho, "os limites universais por UC têm de ser um objeto.");
        return "ignorada";
      }
      if (!reclamarSecao("limitesUniversaisPorUC", regraId, "prevalece a primeira regra lida")) return "ignorada";
      let aplicou = false;
      if (valor.maxTPporUCporMancha === null) {
        config.capacidade.maxTPporUCporMancha = null;
        aplicou = true;
      } else if (valor.maxTPporUCporMancha !== undefined) {
        const n = valNumero(valor.maxTPporUCporMancha, `${caminho}/maxTPporUCporMancha`, diagnosticos, {
          min: 1,
          inteiro: true,
        });
        if (n !== undefined) {
          config.capacidade.maxTPporUCporMancha = n;
          aplicou = true;
        }
      }
      if (valor.maxPLporUCporMancha === null) {
        config.capacidade.maxPLporUCporMancha = null;
        aplicou = true;
      } else if (valor.maxPLporUCporMancha !== undefined) {
        const n = valNumero(valor.maxPLporUCporMancha, `${caminho}/maxPLporUCporMancha`, diagnosticos, {
          min: 1,
          inteiro: true,
        });
        if (n !== undefined) {
          config.capacidade.maxPLporUCporMancha = n;
          aplicou = true;
        }
      }
      const ambito = valEnum(valor.ambitoContagem, `${caminho}/ambitoContagem`, diagnosticos, [
        "bloco",
        "turma",
      ] as const);
      if (ambito) {
        config.capacidade.ambitoContagem = ambito;
        aplicou = true;
      }
      return aplicou ? "aplicada" : "ignorada";
    }

    case "poolsSala": {
      const pools = valLista(valor, caminho, diagnosticos, (b, c, d) => validarPoolSala(b, c, d, regraId));
      if (!pools || pools.length === 0) return "ignorada";
      for (const p of pools) {
        const existente = config.capacidade.poolsSala.find((x) => x.id === p.id);
        if (existente) {
          ctx.relatorio.conflitos.push({
            chave: `poolsSala/${p.id}`,
            regras: [existente.origem, regraId],
            resolucao: `prevalece o conjunto de salas de ${existente.origem}`,
          });
          continue;
        }
        config.capacidade.poolsSala.push(p);
      }
      return "aplicada";
    }

    // -- Carga diária --------------------------------------------------------
    case "cargaDiariaEstudante": {
      const c = validarCargaDiaria(valor, caminho, diagnosticos);
      if (!c) return "ignorada";
      aplicarCargaDiaria(config, c, anos, regraId, ctx.relatorio);
      return "aplicada";
    }

    case "maxHorasDia": {
      // Alias histórico: um número solto equivalia ao teto diário.
      const n = valNumero(valor, caminho, diagnosticos, { min: 1, max: 24 });
      if (n === undefined) return "ignorada";
      registarAviso(
        diagnosticos,
        caminho,
        "`maxHorasDia` é uma forma antiga de exprimir o teto diário; prefira `cargaDiariaEstudante.maxHoras`.",
      );
      aplicarCargaDiaria(config, { maxHoras: n }, anos, regraId, ctx.relatorio);
      return "aplicada";
    }

    // -- Precedências e restrições ------------------------------------------
    case "precedenciasUC": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) => validarPrecedencia(b, c, d, anos, regraId));
      if (!lista || lista.length === 0) return "ignorada";
      config.precedencias.push(...lista);
      return "aplicada";
    }

    case "precedenciasEscalonadasPL": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) =>
        validarPrecedenciaEscalonada(b, c, d, anos, regraId),
      );
      if (!lista) return "ignorada";
      // Uma lista vazia é uma declaração legítima: "esta UC deixa de ter tabela".
      config.precedenciasEscalonadas.push(...lista);
      return "aplicada";
    }

    case "ritmoTP": {
      const r = validarRitmoTP(valor, caminho, diagnosticos);
      if (!r) return "ignorada";
      if (!reclamarSecao("ritmoTP", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (r.ativo !== undefined) config.ritmoTP.ativo = r.ativo;
      if (r.unidade !== undefined) config.ritmoTP.unidade = r.unidade;
      if (r.maxDesvioBlocos !== undefined) config.ritmoTP.maxDesvioBlocos = r.maxDesvioBlocos;
      if (r.maxDesvioSemanas !== undefined) config.ritmoTP.maxDesvioSemanas = r.maxDesvioSemanas;
      if (r.ambito !== undefined) config.ritmoTP.ambito = r.ambito;
      return "aplicada";
    }

    case "maratonaUC": {
      const r = validarMaratonaUC(valor, caminho, diagnosticos);
      if (!r) return "ignorada";
      if (!reclamarSecao("maratonaUC", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (r.ativo !== undefined) config.maratonaUC.ativo = r.ativo;
      if (r.maxBlocosSeguidosMesmaUC !== undefined) {
        config.maratonaUC.maxBlocosSeguidosMesmaUC = r.maxBlocosSeguidosMesmaUC;
      }
      if (r.maxBlocosMesmaUCporDia !== undefined) {
        config.maratonaUC.maxBlocosMesmaUCporDia = r.maxBlocosMesmaUCporDia;
      }
      return "aplicada";
    }

    /**
     * TP E PL DA MESMA UC NA MESMA MANCHA. Desligada por omissão — a referência
     * do coordenador junta-as com docentes diferentes. Uma regra do Supabase
     * pode voltar a ligá-la.
     */
    case "tpPLmesmaUC": {
      const r = validarTPPLmesmaUC(valor, caminho, diagnosticos);
      if (!r) return "ignorada";
      if (!reclamarSecao("tpPLmesmaUC", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (r.ativo !== undefined) config.tpPLmesmaUC.ativo = r.ativo;
      return "aplicada";
    }

    case "restricoesUC": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) => validarRestricaoUC(b, c, d, anos, regraId));
      if (!lista) return "ignorada";
      if (lista.length === 0) return "ignorada";
      config.restricoesUC.push(...lista);
      return "aplicada";
    }

    case "conflitosUC": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) => {
        if (!ehObjeto(b)) {
          registarErro(d, c, "cada conflito entre UCs tem de ser um objeto {siglaA, siglaB}.");
          return undefined;
        }
        const a = valTexto(b.siglaA, `${c}/siglaA`, d, { naoVazio: true });
        const bb = valTexto(b.siglaB, `${c}/siglaB`, d, { naoVazio: true });
        if (!a || !bb) return undefined;
        if (a.toUpperCase() === bb.toUpperCase()) {
          registarErro(d, c, "as duas siglas do conflito são iguais.");
          return undefined;
        }
        return { siglaA: a, siglaB: bb, motivo: valTexto(b.motivo, `${c}/motivo`, d) ?? "", origem: regraId };
      });
      if (!lista || lista.length === 0) return "ignorada";
      config.conflitosUC.push(...lista);
      return "aplicada";
    }

    // -- Layout fixo ---------------------------------------------------------
    case "layoutFixo": {
      const l = validarLayoutFixo(valor, caminho, diagnosticos, regraId);
      if (!l) return "ignorada";
      config.layoutsFixos.push(l);
      return "aplicada";
    }

    // -- Aulas T conjuntas ---------------------------------------------------
    case "aulasTConjuntas": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) => validarAulaTConjunta(b, c, d, regraId));
      if (!lista || lista.length === 0) return "ignorada";
      config.aulasTConjuntas.push(...lista);
      return "aplicada";
    }

    // -- Turnos --------------------------------------------------------------
    case "turnos": {
      const t = validarTurnos(valor, caminho, diagnosticos);
      if (!t) return "ignorada";
      if (!reclamarSecao("turnos", regraId, "prevalece a primeira regra lida")) return "ignorada";
      if (t.familiaDeManhaPorSemestre) config.turnos.familiaDeManhaPorSemestre = t.familiaDeManhaPorSemestre;
      if (t.excecoes) config.turnos.excecoes = t.excecoes;
      return "aplicada";
    }

    case "semanasSoTurmaA":
    case "semanasSoTurmaB": {
      const familia: Familia = chave.endsWith("A") ? FAMILIAS[0] : FAMILIAS[1];
      const semanas = valListaInteiros(valor, caminho, diagnosticos, { min: 1 });
      if (!semanas || semanas.length === 0) return "ignorada";
      config.turnos.semanasTurmaUnica.push({ familia, semanas, anos, origem: regraId });
      return "aplicada";
    }

    // -- Calendário ----------------------------------------------------------
    case "limitesCalendario": {
      if (!ehObjeto(valor)) {
        registarErro(diagnosticos, caminho, "os limites de calendário têm de ser um objeto.");
        return "ignorada";
      }
      if (!reclamarSecao("limitesCalendario", regraId, "prevalece a primeira regra lida")) return "ignorada";
      const dataFim = valData(valor.dataFim, `${caminho}/dataFim`, diagnosticos);
      if (dataFim) config.calendario.dataFim = dataFim;
      const semanaMax = valNumero(valor.semanaMaximaGlobal, `${caminho}/semanaMaximaGlobal`, diagnosticos, {
        min: 1,
        inteiro: true,
      });
      if (semanaMax !== undefined) config.calendario.semanaMaximaGlobal = semanaMax;
      config.calendario.origem = regraId;
      return "aplicada";
    }

    case "bloqueiosCalendario": {
      const lista = valLista(valor, caminho, diagnosticos, validarBloqueioCalendario);
      if (!lista || lista.length === 0) return "ignorada";
      config.calendario.bloqueios.push(...lista);
      config.calendario.origem = regraId;
      return "aplicada";
    }

    case "calendario": {
      if (!ehObjeto(valor)) {
        registarErro(diagnosticos, caminho, "a configuração de calendário tem de ser um objeto.");
        return "ignorada";
      }
      if (!reclamarSecao("calendario", regraId, "prevalece a primeira regra lida")) return "ignorada";
      const fronteira = valNumero(valor.fronteiraSemestre, `${caminho}/fronteiraSemestre`, diagnosticos, {
        min: 1,
        inteiro: true,
      });
      if (fronteira !== undefined) config.calendario.fronteiraSemestre = fronteira;
      const porSemestre = valNumero(valor.semanasPorSemestre, `${caminho}/semanasPorSemestre`, diagnosticos, {
        min: 1,
        inteiro: true,
      });
      if (porSemestre !== undefined) config.calendario.semanasPorSemestre = porSemestre;
      const pausas = valBooleano(valor.pausasNaoContamNaNumeracao, `${caminho}/pausasNaoContamNaNumeracao`, diagnosticos);
      if (pausas !== undefined) config.calendario.pausasNaoContamNaNumeracao = pausas;
      return "aplicada";
    }

    case "semanasPersonalizadas": {
      const lista = valLista(valor, caminho, diagnosticos, validarSemanaPersonalizada);
      if (!lista || lista.length === 0) return "ignorada";
      config.calendario.semanasPersonalizadas = lista;
      return "aplicada";
    }

    // -- Preferências --------------------------------------------------------
    case "preferirSextaLivre": {
      const v = valBooleano(valor, caminho, diagnosticos);
      if (v === undefined) return "ignorada";
      config.preferencias.preferirSextaLivre = v;
      return "aplicada";
    }

    case "diasPrioritarios": {
      const lista = valLista(valor, caminho, diagnosticos, (b, c, d) => {
        if (typeof b === "string") {
          const data = valData(b, c, d);
          return data ? { data, minimoBlocos: 1 } : undefined;
        }
        if (!ehObjeto(b)) {
          registarErro(d, c, "cada dia prioritário tem de ser uma data ou um objeto {data, minimoBlocos}.");
          return undefined;
        }
        const data = valData(b.data, `${c}/data`, d);
        if (!data) return undefined;
        const min = valNumero(b.minimoBlocos, `${c}/minimoBlocos`, d, { min: 1, inteiro: true }) ?? 1;
        return { data, minimoBlocos: min };
      });
      if (!lista || lista.length === 0) return "ignorada";
      config.preferencias.diasPrioritarios.push(...lista);
      return "aplicada";
    }

    case "diasPermitidosPL": {
      const dias = valListaTexto(valor, caminho, diagnosticos);
      if (!dias || dias.length === 0) return "ignorada";
      config.preferencias.diasPermitidosPL = dias;
      return "aplicada";
    }

    default:
      return "desconhecida";
  }
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function anosDaRegra(bruta: LinhaRegra, cfg: Record<string, unknown> | unknown): number[] {
  const anos: number[] = [];
  if (ehObjeto(cfg) && Array.isArray((cfg as any).anos)) {
    for (const a of (cfg as any).anos as unknown[]) {
      const n = typeof a === "number" ? a : Number(a);
      if (Number.isInteger(n) && n > 0) anos.push(n);
    }
  }
  if (anos.length === 0) {
    const bruto = bruta.ano_curricular ?? bruta.anoCurricular;
    if (bruto !== undefined && bruto !== null && bruto !== "todos") {
      const n = typeof bruto === "number" ? bruto : Number(bruto);
      if (Number.isInteger(n) && n > 0) anos.push(n);
    }
  }
  return anos;
}

function aplicarCargaDiaria(
  config: ConfiguracaoMotor,
  parcial: Partial<RegrasCargaDiaria>,
  anos: number[],
  regraId: string,
  relatorio: RelatorioCarregamento,
): void {
  if (anos.length === 0) {
    Object.assign(config.cargaDiaria.transversal, parcial);
    return;
  }
  for (const ano of anos) {
    const base = config.cargaDiaria.porAno[ano] ?? { ...config.cargaDiaria.transversal };
    const antes = { ...base };
    Object.assign(base, parcial);
    config.cargaDiaria.porAno[ano] = base;
    if (
      antes.maxDiasNoMaximoPorSemana !== base.maxDiasNoMaximoPorSemana &&
      config.cargaDiaria.transversal.maxDiasNoMaximoPorSemana !== base.maxDiasNoMaximoPorSemana
    ) {
      relatorio.conflitos.push({
        chave: `cargaDiariaEstudante/ano ${ano}`,
        regras: ["(transversal)", regraId],
        resolucao: `no ano ${ano} prevalece a regra do ano (${base.maxDiasNoMaximoPorSemana} dia(s) no máximo), não a transversal (${config.cargaDiaria.transversal.maxDiasNoMaximoPorSemana}).`,
      });
    }
  }
}

/**
 * Aplica ao conjunto de padrões o que a regra `blocos100` trouxe: lista de
 * ativos, custos e qual é o padrão de último recurso.
 */
function consolidarPadroesBloco(
  config: ConfiguracaoMotor,
  vistas: Map<string, string[]>,
  relatorio: RelatorioCarregamento,
): void {
  const pendente = (config.padroesBloco as any).__pendente as
    | { ativos?: string[]; ultimoRecurso?: string; custos?: PadraoBloco[]; regraId: string }
    | undefined;
  delete (config.padroesBloco as any).__pendente;
  if (!pendente) return;

  if (pendente.ativos) {
    const ativos = new Set(pendente.ativos);
    for (const p of config.padroesBloco.padroes) p.ativo = ativos.has(p.id);
  }
  if (pendente.custos) {
    for (const c of pendente.custos) {
      const alvo = config.padroesBloco.padroes.find((p) => p.id === c.id);
      if (alvo) alvo.custo = c.custo;
    }
  } else if (vistas.has("blocos100")) {
    relatorio.defaultsAplicados.push({
      chave: "blocos100.custosPadroes",
      valor: config.padroesBloco.padroes.map((p) => `${p.id}=${p.custo}`).join(", "),
      porque:
        "a regra define quais os padrões ativos mas não a hierarquia de custos; foi usada a hierarquia genérica do esquema.",
    });
  }
  if (pendente.ultimoRecurso) {
    for (const p of config.padroesBloco.padroes) p.ultimoRecurso = p.id === pendente.ultimoRecurso;
    const alvo = config.padroesBloco.padroes.find((p) => p.id === pendente.ultimoRecurso);
    // O último recurso nunca é um veto: se ficasse desativado, a cobertura a
    // 100% poderia tornar-se impossível.
    if (alvo && !alvo.ativo) {
      alvo.ativo = true;
      relatorio.conflitos.push({
        chave: "blocos100/padraoUltimoRecurso",
        regras: [pendente.regraId],
        resolucao: `o padrão ${alvo.id} foi reativado: como último recurso é custo alto, nunca proibição.`,
      });
    }
  }
  config.padroesBloco.padroes.sort((a, b) => a.custo - b.custo);
}

/** Se a grelha veio sem horas explícitas, deriva-as da abertura/fecho/bloco. */
function consolidarGrelha(config: ConfiguracaoMotor, vistas: Map<string, string[]>): void {
  if (!vistas.has("grelhaHoraria")) return;
  const derivadas = derivarHorasInicio(
    config.grelha.horaAbertura,
    config.grelha.horaFecho,
    config.grelha.duracaoBlocoHoras,
  );
  const explicitas = config.grelha.horasInicio;
  const veioExplicita = explicitas.length > 0 && explicitas.join(",") !== derivadas.join(",");
  if (!veioExplicita) config.grelha.horasInicio = derivadas;
}

function carregarSemanasPersonalizadas(
  entrada: EntradaCarregamento,
  config: ConfiguracaoMotor,
  diagnosticos: Diagnosticos,
): void {
  if (!Array.isArray(entrada.anosSemestres) || entrada.anosSemestres.length === 0) return;
  const linhas = entrada.anosSemestres.filter(ehObjeto) as Record<string, unknown>[];
  const alvos = entrada.anoSemestreId
    ? linhas.filter((l) => l.id === entrada.anoSemestreId)
    : linhas.filter((l) => l.ativo === true || l.ativo === undefined);
  const semanas: ConfiguracaoMotor["calendario"]["semanasPersonalizadas"] = [];
  alvos.forEach((linha, i) => {
    const bruto = (linha as any).semanas_personalizadas ?? (linha as any).semanasPersonalizadas;
    if (bruto === undefined || bruto === null) return;
    const lista = valLista(bruto, `anos_semestres[${i}]/semanas_personalizadas`, diagnosticos, validarSemanaPersonalizada);
    if (lista) semanas.push(...lista);
  });
  if (semanas.length > 0) config.calendario.semanasPersonalizadas = semanas;
}

function descreverDefault(chave: string, config: ConfiguracaoMotor): string {
  switch (chave) {
    case "janelasPorTipoAula":
      return "nenhuma janela — todos os dias e períodos ficam permitidos para todos os tipos de aula";
    case "estruturaTurmas":
      return `${config.estruturaTurmas.turmasTeoricas} turmas teóricas x ${config.estruturaTurmas.tpPorTurmaTeorica} TP x ${config.estruturaTurmas.plPorTP} PL`;
    case "grelhaHoraria":
      return `${config.grelha.dias.length} dias uteis, blocos de ${config.grelha.duracaoBlocoHoras}h entre ${config.grelha.horaAbertura} e ${config.grelha.horaFecho}`;
    case "blocos100":
      return config.padroesBloco.padroes.map((p) => `${p.id}=${p.custo}`).join(", ");
    case "maxPLporMancha":
      return String(config.capacidade.maxPLporMancha);
    case "capacidadeTP":
      return `maxTPporMancha=${config.capacidade.maxTPporMancha ?? "sem limite"}, maxTPporUCporMancha=${config.capacidade.maxTPporUCporMancha ?? "sem limite"}`;
    case "limitesUniversaisPorUC":
      return (
        `maxTPporUCporMancha=${config.capacidade.maxTPporUCporMancha ?? "sem limite"}, ` +
        `maxPLporUCporMancha=${config.capacidade.maxPLporUCporMancha ?? "sem limite"} (ambito ${config.capacidade.ambitoContagem})`
      );
    case "precedenciasEscalonadasPL":
      return "sem tabela de precedência escalonada — vale o rácio proporcional TP->PL";
    case "ritmoTP":
      if (!config.ritmoTP.ativo) return "desligado";
      return config.ritmoTP.unidade === "semanas"
        ? `desvio máximo de ${config.ritmoTP.maxDesvioSemanas} semana(s) entre turmas TP, âmbito ${config.ritmoTP.ambito}`
        : `desvio máximo de ${config.ritmoTP.maxDesvioBlocos} bloco(s) entre turmas TP, âmbito ${config.ritmoTP.ambito}`;
    case "maratonaUC":
      return config.maratonaUC.ativo
        ? `máximo de ${config.maratonaUC.maxBlocosSeguidosMesmaUC} blocos seguidos e de ` +
            `${config.maratonaUC.maxBlocosMesmaUCporDia} blocos por dia da mesma UC`
        : "desligado";
    case "tpPLmesmaUC":
      return config.tpPLmesmaUC.ativo
        ? "TP e PL da mesma UC nunca partilham a mesma mancha"
        : "desligado — TP e PL da mesma UC podem partilhar a mancha (docentes diferentes)";
    case "cargaDiariaEstudante":
      return `alvo ${config.cargaDiaria.transversal.alvoHoras}h, maximo ${config.cargaDiaria.transversal.maxHoras}h`;
    case "turnos":
      return "sem rotação de turnos definida — qualquer família pode usar qualquer período";
    case "limitesCalendario":
      return `dataFim=${config.calendario.dataFim ?? "sem limite"}, semanaMaximaGlobal=${config.calendario.semanaMaximaGlobal ?? "sem limite"}`;
    case "bloqueiosCalendario":
      return `${config.calendario.bloqueios.length} bloqueio(s)`;
    case "poolsSala":
      return "sem conjuntos de salas paralelos — todas as PL competem pelo mesmo limite global";
    default:
      return "(vazio)";
  }
}

// ---------------------------------------------------------------------------
// Impressão do relatório
// ---------------------------------------------------------------------------

export function formatarRelatorio(rel: RelatorioCarregamento): string {
  const l: string[] = [];
  const secao = (titulo: string) => {
    l.push("");
    l.push(titulo);
    l.push("-".repeat(titulo.length));
  };

  l.push("RELATORIO DE CARREGAMENTO DE REGRAS");
  l.push("===================================");
  l.push(`Regras lidas:        ${rel.regrasLidas}`);
  l.push(`Regras aplicadas:    ${rel.regrasAplicadas.length}`);
  l.push(`Regras inativas:     ${rel.regrasInativas.length}`);
  l.push(`Regras descritivas:  ${rel.regrasDescritivas.length} (sem configuração de motor)`);

  secao(`Regras em falta (${rel.emFalta.length})`);
  if (rel.emFalta.length === 0) l.push("  nenhuma.");
  for (const f of rel.emFalta) {
    l.push(`  [${f.critica ? "CRITICA" : "opcional"}] ${f.chaveMotor}: ${f.porque}`);
  }

  secao(`Regras malformadas (${rel.malformadas.length})`);
  if (rel.malformadas.length === 0) l.push("  nenhuma.");
  for (const m of rel.malformadas) l.push(`  ${m.caminho}: ${m.mensagem}`);

  secao(`Chaves desconhecidas (${rel.desconhecidas.length})`);
  if (rel.desconhecidas.length === 0) l.push("  nenhuma.");
  for (const d of rel.desconhecidas) l.push(`  ${d.regraId}: ${d.onde}.${d.chave}`);

  secao(`Defaults aplicados (${rel.defaultsAplicados.length})`);
  if (rel.defaultsAplicados.length === 0) l.push("  nenhum.");
  for (const d of rel.defaultsAplicados) l.push(`  ${d.chave} = ${d.valor}\n      porque: ${d.porque}`);

  secao(`Conflitos entre regras (${rel.conflitos.length})`);
  if (rel.conflitos.length === 0) l.push("  nenhum.");
  for (const c of rel.conflitos) l.push(`  ${c.chave} [${c.regras.join(" vs ")}] -> ${c.resolucao}`);

  secao(`Avisos (${rel.avisos.length})`);
  if (rel.avisos.length === 0) l.push("  nenhum.");
  for (const a of rel.avisos) l.push(`  ${a.caminho}: ${a.mensagem}`);

  secao("Regras descritivas (sem efeito no motor)");
  l.push(rel.regrasDescritivas.length === 0 ? "  nenhuma." : `  ${rel.regrasDescritivas.join(", ")}`);

  secao("Regras inativas (ignoradas)");
  l.push(rel.regrasInativas.length === 0 ? "  nenhuma." : `  ${rel.regrasInativas.join(", ")}`);

  return l.join("\n");
}
