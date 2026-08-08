/**
 * VALIDADOR INDEPENDENTE — segunda opinião sobre um horário já produzido.
 *
 * Fase 4 da reescrita do motor de horários. Recebe `SessaoHorario[]` (de
 * qualquer origem: geradas pelo alocador, importadas de Excel, fixadas à mão
 * ou lidas do Supabase) e a `ConfiguracaoMotor` validada na Fase 2, e devolve
 * um relatório de violações.
 *
 * PRINCÍPIO INEGOCIÁVEL DESTE FICHEIRO: é escrito de forma independente do
 * alocador. NÃO IMPORTA `src/motor/restricoes.ts` NEM `src/motor/estado.ts`.
 * As doze verificações abaixo foram reimplementadas a partir da definição
 * pedagógica descrita em `src/regras/esquema.ts` (a forma dos seis padrões de
 * bloco, o significado de cada campo de `ConfiguracaoMotor`) — nunca a partir
 * do código do motor. Um alocador com um erro de raciocínio não pode validar-
 * se a si próprio: se este ficheiro importasse a lógica do motor, um erro no
 * motor passaria sempre, porque estaria a verificar-se com a sua própria
 * régua. Foi exactamente isso que levou o agente anterior a dar como correto
 * um horário que estava errado.
 *
 * Onde este ficheiro chega às MESMAS fórmulas do motor (ex.: quantas folhas-
 * aluno uma turma TP cobre, dado `tpPorTurmaTeorica` e `plPorTP`) é porque
 * essa fórmula É a definição da estrutura declarada em `EstruturaTurmas` —
 * não há uma segunda maneira correta de a calcular. O que este ficheiro nunca
 * faz é reutilizar PREDICADOS de decisão do motor (`primeiraViolacao`,
 * `criarEstado`, `criarHierarquia`, `formasPossiveis`, etc.): cada verificação
 * é escrita de raiz, a partir do que as regras dizem.
 *
 * ATUALIZADO para a REGRA GERAL de composição de blocos: já não existe lista de
 * padrões a que um bloco tenha de corresponder. Um bloco é válido quando cobre
 * as folhas-aluno todas e cabe nos limites por UC. Este ficheiro deriva essa
 * conclusão outra vez, a partir da `ConfiguracaoMotor`, sem olhar para
 * `src/motor/padroes.ts`.
 *
 * Regras deste ficheiro, herdadas da Fase 2:
 *  1. ZERO siglas de unidade curricular literais — as siglas são dados.
 *  2. ZERO layouts concretos (nenhum dia/hora/UC específicos de um ano
 *     letivo).
 */

import { FAMILIAS, horaParaMinutos, totalPL, totalTP } from "../regras/esquema";
import type {
  ConfiguracaoMotor,
  EstruturaTurmas,
  Familia,
  Periodo,
  RegrasCargaDiaria,
} from "../regras/esquema";
import type { SessaoHorario, UC } from "../types";

// ---------------------------------------------------------------------------
// 0. Interface pública
// ---------------------------------------------------------------------------

export interface Violacao {
  /** id da verificação ou da regra infringida. */
  regra: string;
  gravidade: "erro" | "aviso";
  semana: number;
  dia: string;
  hora: string;
  /** Sigla da UC envolvida (dado, nunca literal). "(vários)"/"(global)" quando a violação agrega várias UCs. */
  ucSigla: string;
  /** Turma ou folha-aluno envolvida. "(mancha)" quando a violação agrega várias turmas. */
  turma: string;
  /** Mensagem legível em português, com o valor observado vs. o permitido. */
  mensagem: string;
}

export interface EquilibrioItem {
  ano: number;
  familia: "A" | "B";
  /** Bloco de semanas a que este resumo se refere (aqui: o semestre, "1" ou "2"). */
  bloco: string;
  min: number;
  max: number;
  amplitude: number;
  /** Semanas (globais) em que a família já está no seu teto físico de blocos/semana. */
  noTeto: number[];
}

export interface RelatorioValidacao {
  /** `true` quando não há nenhuma violação de gravidade "erro". */
  ok: boolean;
  violacoes: Violacao[];
  /** Contagem de violações (erro + aviso) por id de regra. */
  porRegra: Record<string, number>;
  completude: { alvo: number; colocado: number; pct: number };
  equilibrio: EquilibrioItem[];
}

export function validar(sessoes: SessaoHorario[], ucs: UC[], regras: ConfiguracaoMotor): RelatorioValidacao {
  const violacoes: Violacao[] = [];
  const registar = (v: Violacao) => violacoes.push(v);

  const ucPorSigla = new Map<string, UC>();
  for (const uc of ucs) ucPorSigla.set(normalizar(uc.sigla), uc);

  const hierarquia = construirHierarquia(regras.estruturaTurmas);
  const diaIndex = construirIndiceDias(regras.grelha.dias);
  const bloco = regras.grelha.duracaoBlocoHoras > 0 ? regras.grelha.duracaoBlocoHoras : 1;
  const limiarTardeMin = regras.grelha.limiarTardeHora * 60;
  const periodoDe = (hora: string): Periodo => (horaParaMinutos(hora) >= limiarTardeMin ? "tarde" : "manha");
  const fronteira = regras.calendario.fronteiraSemestre;
  const semestreDaSemana = (semana: number): number => (semana <= fronteira ? 1 : 2);
  const semanaRelativa = (semana: number): number => (semana <= fronteira ? semana : semana - fronteira);

  const indexadas: SessaoIndexada[] = sessoes.map((s) => {
    const uc = ucPorSigla.get(normalizar(s.ucSigla));
    const familia = hierarquia.familiaDe(s.turma);
    const folhas = hierarquia.folhasDe(s.turma);
    return { sessao: s, uc, ano: uc?.anoCurricular, familia, folhas };
  });

  verificarComposicao100(indexadas, regras, hierarquia, registar);
  verificarJanelaPorTipo(indexadas, regras, periodoDe, registar);
  verificarCapacidadeGlobalPL(indexadas, regras, registar);
  verificarMaximosPorUC(indexadas, regras, registar);
  verificarCargaDiaria(indexadas, regras, bloco, registar);
  verificarPausaAlmoco(indexadas, regras, registar);
  verificarPrecedencias(indexadas, regras, diaIndex, bloco, registar);
  verificarPrecedenciasEscalonadas(indexadas, regras, diaIndex, registar);
  verificarRitmoTP(indexadas, regras, diaIndex, registar);
  verificarMaratonaUC(indexadas, regras, bloco, registar);
  verificarTPePLmesmaUC(indexadas, regras, registar);
  verificarSobreposicoes(indexadas, registar);
  verificarJanelaLetiva(indexadas, regras, semestreDaSemana, semanaRelativa, registar);
  verificarRestricoesUC(indexadas, regras, periodoDe, semestreDaSemana, semanaRelativa, registar);
  const equilibrio = calcularEquilibrio(indexadas, regras, registar);

  const completude = calcularCompletude(ucs, regras.estruturaTurmas, bloco, indexadas);

  const porRegra: Record<string, number> = {};
  for (const v of violacoes) porRegra[v.regra] = (porRegra[v.regra] ?? 0) + 1;

  violacoes.sort((a, b) => {
    if (a.semana !== b.semana) return a.semana - b.semana;
    const da = diaIndex.get(a.dia) ?? 999;
    const db = diaIndex.get(b.dia) ?? 999;
    if (da !== db) return da - db;
    if (a.hora !== b.hora) return a.hora.localeCompare(b.hora);
    return a.regra.localeCompare(b.regra);
  });

  const ok = violacoes.every((v) => v.gravidade !== "erro");

  return { ok, violacoes, porRegra, completude, equilibrio };
}

// ---------------------------------------------------------------------------
// 1. Utilitários puros
// ---------------------------------------------------------------------------

const normalizar = (s: string): string => (s ?? "").trim().toLocaleUpperCase("pt-PT");

function construirIndiceDias(dias: string[]): Map<string, number> {
  const m = new Map<string, number>();
  dias.forEach((d, i) => m.set(d, i));
  return m;
}

/** Posição de um momento numa ordem cronológica total (dias desconhecidos vão para o fim, de forma estável). */
function ordemMomento(diaIndex: Map<string, number>, semana: number, dia: string, hora: string): number {
  const idxDia = diaIndex.get(dia) ?? diaIndex.size;
  const minutos = horaParaMinutos(hora);
  return semana * 100000 + idxDia * 1440 + (Number.isFinite(minutos) ? minutos : 0);
}

function arraysIguais(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

interface SessaoIndexada {
  sessao: SessaoHorario;
  uc: UC | undefined;
  ano: number | undefined;
  familia: Familia | undefined;
  /** Folhas-aluno (grupos indivisíveis) cobertas pela turma desta sessão. */
  folhas: string[];
}

// ---------------------------------------------------------------------------
// 2. Hierarquia de turmas -> folhas-aluno, derivada de `EstruturaTurmas`
// ---------------------------------------------------------------------------
//
// Uma FOLHA é o subgrupo-aluno mais fino em que uma turma teórica se
// desdobra. Uma T ocupa todas as folhas da família; uma TP ocupa as folhas do
// seu desdobramento (`plPorTP` folhas); uma PL ocupa uma única folha. Isto é
// a definição da própria estrutura declarada nas regras (Fase 2), não uma
// decisão do motor — daí ser seguro derivá-la aqui de novo, sem importar
// `src/motor/estado.ts`.

interface Hierarquia {
  folhasDe(turma: string): string[];
  familiaDe(turma: string): Familia | undefined;
  /** Folhas-aluno que uma turma teórica cobre a 100% (12, na estrutura real 4 TP x 3 PL). */
  folhasPorFamiliaCount: number;
}

function construirHierarquia(estrutura: EstruturaTurmas): Hierarquia {
  const folhas = new Map<string, string[]>();
  const familias = new Map<string, Familia>();
  const nTP = totalTP(estrutura);
  const nPL = totalPL(estrutura);

  const nomePL = (m: number) => `${estrutura.prefixos.pl}${m}`;
  for (let m = 1; m <= nPL; m++) {
    const tpPai = Math.ceil(m / estrutura.plPorTP);
    const fam = FAMILIAS[Math.floor((tpPai - 1) / estrutura.tpPorTurmaTeorica)];
    folhas.set(nomePL(m), [nomePL(m)]);
    if (fam) familias.set(nomePL(m), fam);
  }

  for (let n = 1; n <= nTP; n++) {
    const nome = `${estrutura.prefixos.tp}${n}`;
    const primeiraPL = (n - 1) * estrutura.plPorTP + 1;
    const suas: string[] = [];
    for (let k = 0; k < estrutura.plPorTP; k++) suas.push(nomePL(primeiraPL + k));
    folhas.set(nome, suas);
    const fam = FAMILIAS[Math.floor((n - 1) / estrutura.tpPorTurmaTeorica)];
    if (fam) familias.set(nome, fam);
  }

  for (let i = 0; i < estrutura.turmasTeoricas; i++) {
    const fam = FAMILIAS[i];
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

  // Índices normalizados (maiúsculas/sem espaços), para tolerar variações de
  // apresentação sem depender de nenhuma sigla ou nome literal.
  const folhasNorm = new Map<string, string[]>();
  const familiasNorm = new Map<string, Familia>();
  for (const [k, v] of folhas) folhasNorm.set(normalizar(k), v);
  for (const [k, v] of familias) familiasNorm.set(normalizar(k), v);

  return {
    folhasDe: (turma) => folhas.get(turma) ?? folhasNorm.get(normalizar(turma)) ?? [turma],
    familiaDe: (turma) => familias.get(turma) ?? familiasNorm.get(normalizar(turma)),
    folhasPorFamiliaCount: estrutura.tpPorTurmaTeorica * estrutura.plPorTP,
  };
}

// ---------------------------------------------------------------------------
// 3. A REGRA GERAL de composição de um bloco a 100%
// ---------------------------------------------------------------------------
//
// Escrita a partir da DEFINIÇÃO pedagógica, não do código do motor. Um bloco é
// válido quando, e só quando:
//
//   1. cobre exatamente as folhas-aluno de uma turma teórica;
//   2. traz no máximo `maxTPporUCporMancha` aulas TP da mesma UC (verificação 4);
//   3. traz no máximo `maxPLporUCporMancha` aulas PL da mesma UC (verificação 4);
//   4. nunca junta TP e PL da mesma UC (verificação 8);
//   5. não mistura uma aula teórica com desdobramentos da mesma UC, nem inclui
//      seminários — um seminário não ocupa folhas-aluno.
//
// Deixou de existir qualquer lista de padrões: as formas são a CONSEQUÊNCIA dos
// limites. Esta verificação trata do ponto 1 e do ponto 5, e dá NOME à forma que
// emergiu; os pontos 2, 3 e 4 têm as suas próprias verificações independentes.

interface AssinaturaBloco {
  t: number;
  tp: number[];
  pl: number[];
  /** Composição que não desenha forma nenhuma (seminário, UC desconhecida, T misturada). */
  invalida: boolean;
  motivo: string;
}

/** Reduz as sessões de um bloco à sua forma: contagens por UC e por tipo. */
function assinarBloco(
  sessoes: { ucId: string | undefined; ucSigla: string; tipo: SessaoHorario["tipoAula"] }[],
): AssinaturaBloco {
  const a: AssinaturaBloco = { t: 0, tp: [], pl: [], invalida: false, motivo: "" };
  const porUC = new Map<string, { T: number; TP: number; PL: number }>();
  for (const s of sessoes) {
    if (s.tipo === "S") {
      a.invalida = true;
      a.motivo = `um seminário (${s.ucSigla}) não ocupa folhas-aluno e não pode fazer parte de um bloco a 100%`;
      continue;
    }
    if (!s.ucId) {
      a.invalida = true;
      a.motivo = `a unidade curricular ${s.ucSigla} não existe no catálogo`;
      continue;
    }
    const c = porUC.get(s.ucId) ?? { T: 0, TP: 0, PL: 0 };
    c[s.tipo] += 1;
    porUC.set(s.ucId, c);
  }
  for (const [, c] of porUC) {
    if (c.T > 0 && (c.TP > 0 || c.PL > 0)) {
      a.invalida = true;
      a.motivo = "a mesma unidade curricular tem aula teórica e desdobramentos no mesmo bloco";
    }
    a.t += c.T;
    if (c.TP > 0) a.tp.push(c.TP);
    if (c.PL > 0) a.pl.push(c.PL);
  }
  a.tp.sort((x, y) => y - x);
  a.pl.sort((x, y) => y - x);
  return a;
}

/** Nome canónico da forma que um bloco desenha (ex.: `TP2+PL3+PL3`). */
function nomeDaForma(a: AssinaturaBloco): string {
  if (a.t > 0 && a.tp.length === 0 && a.pl.length === 0) return `T${a.t}`;
  const termos = [
    ...(a.t > 0 ? [`T${a.t}`] : []),
    ...a.tp.map((n) => `TP${n}`),
    ...a.pl.map((n) => `PL${n}`),
  ];
  return termos.length === 0 ? "(vazio)" : termos.join("+");
}

/** Agrupa as sessões em blocos: mesma família, mesmo ano, mesma mancha. */
function agruparEmBlocos(indexadas: SessaoIndexada[]): Map<string, SessaoIndexada[]> {
  const blocos = new Map<string, SessaoIndexada[]>();
  for (const si of indexadas) {
    if (!si.familia || si.ano === undefined) continue;
    const chave = `${si.ano}|${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}|${si.familia}`;
    const lista = blocos.get(chave) ?? [];
    lista.push(si);
    blocos.set(chave, lista);
  }
  return blocos;
}

// ---------------------------------------------------------------------------
// 4. Verificação 1 — Composição a 100%
// ---------------------------------------------------------------------------

function verificarComposicao100(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  hierarquia: Hierarquia,
  registar: (v: Violacao) => void,
): void {
  const estrutura = regras.estruturaTurmas;

  for (const lista of agruparEmBlocos(indexadas).values()) {
    let cobertura = 0;
    for (const si of lista) {
      if (si.sessao.tipoAula === "T") cobertura += hierarquia.folhasPorFamiliaCount;
      else if (si.sessao.tipoAula === "TP") cobertura += estrutura.plPorTP;
      else if (si.sessao.tipoAula === "PL") cobertura += 1;
    }
    const a = assinarBloco(
      lista.map((si) => ({ ucId: si.uc?.id, ucSigla: si.sessao.ucSigla, tipo: si.sessao.tipoAula })),
    );
    if (cobertura === hierarquia.folhasPorFamiliaCount && !a.invalida) continue;

    const rep = lista[0].sessao;
    const composicao = lista
      .map((si) => `${si.sessao.ucSigla}/${si.sessao.tipoAula}/${si.sessao.turma}`)
      .join(" ");
    const porque =
      cobertura !== hierarquia.folhasPorFamiliaCount
        ? `cobre ${cobertura}/${hierarquia.folhasPorFamiliaCount} folhas-aluno`
        : a.motivo;
    registar({
      regra: "composicao-100",
      gravidade: "erro",
      semana: rep.semana ?? 0,
      dia: rep.diaSemana,
      hora: rep.horaInicio,
      ucSigla: lista.length === 1 ? rep.ucSigla : "(vários)",
      turma: "(bloco)",
      mensagem: `bloco ${nomeDaForma(a)}: ${porque} [${composicao}].`,
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Verificação 2 — Janela por tipo de aula
// ---------------------------------------------------------------------------
//
// Nenhuma aula ocorre fora dos dias/períodos/horas da sua janela quando essa
// janela está em modo `veto`. As sessões impostas por layout fixo
// (`bloqueado: true`) ficam de fora: a regra que as acompanha veta
// deliberadamente todas as OUTRAS aulas da semana do layout, e é essa regra
// que mantém o resto do horário fora dela — a sessão imposta pelo
// coordenador não é, ela própria, produto dessa janela.

function verificarJanelaPorTipo(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  periodoDe: (hora: string) => Periodo,
  registar: (v: Violacao) => void,
): void {
  const janelasVeto = new Map<string, (typeof regras.janelasPorTipo)[number]>();
  for (const j of regras.janelasPorTipo) if (j.modo === "veto") janelasVeto.set(j.tipo, j);
  if (janelasVeto.size === 0) return;

  for (const si of indexadas) {
    if (si.sessao.bloqueado) continue;
    const janela = janelasVeto.get(si.sessao.tipoAula);
    if (!janela) continue;
    const doDia = janela.janelas.find((j) => j.dia === si.sessao.diaSemana);
    const s = si.sessao;
    if (!doDia) {
      registar({
        regra: "janela-tipo-aula",
        gravidade: "erro",
        semana: s.semana ?? 0,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `aula ${s.tipoAula} à ${s.diaSemana}, fora da janela (dias permitidos: ${janela.janelas.map((j) => j.dia).join(", ")}).`,
      });
      continue;
    }
    if (doDia.horas.length > 0 && !doDia.horas.includes(s.horaInicio)) {
      registar({
        regra: "janela-tipo-aula",
        gravidade: "erro",
        semana: s.semana ?? 0,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `aula ${s.tipoAula} à ${s.diaSemana} às ${s.horaInicio}; só é permitida às ${doDia.horas.join(", ")}.`,
      });
      continue;
    }
    if (doDia.periodos.length > 0 && !doDia.periodos.includes(periodoDe(s.horaInicio))) {
      registar({
        regra: "janela-tipo-aula",
        gravidade: "erro",
        semana: s.semana ?? 0,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `aula ${s.tipoAula} à ${s.diaSemana} de ${periodoDe(s.horaInicio)}; só é permitida de ${doDia.periodos.join("/")}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Verificação 3 — Capacidade global de PL
// ---------------------------------------------------------------------------
//
// Nunca mais de `maxPLporMancha` aulas PL em simultâneo, somando toda a
// escola (todos os anos curriculares, todas as famílias).

function verificarCapacidadeGlobalPL(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  registar: (v: Violacao) => void,
): void {
  const max = regras.capacidade.maxPLporMancha;
  const porMancha = new Map<string, SessaoIndexada[]>();
  for (const si of indexadas) {
    if (si.sessao.tipoAula !== "PL") continue;
    const chave = `${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}`;
    const lista = porMancha.get(chave) ?? [];
    lista.push(si);
    porMancha.set(chave, lista);
  }
  for (const lista of porMancha.values()) {
    if (lista.length <= max) continue;
    const rep = lista[0].sessao;
    registar({
      regra: "capacidade-pl-global",
      gravidade: "erro",
      semana: rep.semana ?? 0,
      dia: rep.diaSemana,
      hora: rep.horaInicio,
      ucSigla: "(global)",
      turma: "(mancha)",
      mensagem: `${lista.length} aulas PL em simultâneo em toda a escola, acima da capacidade de ${max}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// 7. Verificação 4 — Máximos por UC (maxSimultaneoTP/PL)
// ---------------------------------------------------------------------------
//
// `maxSimultaneoTP`/`maxSimultaneoPL` contados no BLOCO INTEIRO (Turma A +
// Turma B + outros anos curriculares) quando `ambitoContagem === "bloco"`
// (a omissão), ou só dentro da mesma família quando é `"turma"`.

function limiteSimultaneoUC(
  uc: UC | undefined,
  tipo: "TP" | "PL",
  regras: ConfiguracaoMotor,
): number | null {
  const candidatos: number[] = [];
  const doCatalogo = tipo === "TP" ? uc?.maxSimultaneoTP : uc?.maxSimultaneoPL;
  if (typeof doCatalogo === "number" && doCatalogo > 0) candidatos.push(doCatalogo);

  const daRegra = uc
    ? regras.limitesPorUC.find((l) => l.ucId === uc.id || normalizar(l.sigla) === normalizar(uc.sigla))
    : undefined;
  const valor = tipo === "TP" ? daRegra?.maxSimultaneoTP : daRegra?.maxSimultaneoPL;
  if (typeof valor === "number" && valor > 0) candidatos.push(valor);

  // LIMITE UNIVERSAL da escola. Uma UC pode declarar um valor mais baixo, nunca
  // mais alto: por isso o que vale é o MÍNIMO de tudo o que foi declarado.
  const universal =
    tipo === "TP" ? regras.capacidade.maxTPporUCporMancha : regras.capacidade.maxPLporUCporMancha;
  if (typeof universal === "number") candidatos.push(universal);

  return candidatos.length === 0 ? null : Math.min(...candidatos);
}

function verificarMaximosPorUC(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  registar: (v: Violacao) => void,
): void {
  const porBloco = regras.capacidade.ambitoContagem !== "turma";
  const grupos = new Map<string, SessaoIndexada[]>();
  for (const si of indexadas) {
    if (!si.uc) continue;
    if (si.sessao.tipoAula !== "TP" && si.sessao.tipoAula !== "PL") continue;
    const chave = porBloco
      ? `${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}|${si.uc.id}|${si.sessao.tipoAula}`
      : `${si.ano}|${si.familia}|${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}|${si.uc.id}|${si.sessao.tipoAula}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(si);
    grupos.set(chave, lista);
  }
  for (const lista of grupos.values()) {
    const uc = lista[0].uc;
    const tipo = lista[0].sessao.tipoAula as "TP" | "PL";
    const limite = limiteSimultaneoUC(uc, tipo, regras);
    if (limite === null || lista.length <= limite) continue;
    const rep = lista[0].sessao;
    registar({
      regra: "maximos-por-uc",
      gravidade: "erro",
      semana: rep.semana ?? 0,
      dia: rep.diaSemana,
      hora: rep.horaInicio,
      ucSigla: rep.ucSigla,
      turma: "(bloco)",
      mensagem: `${lista.length} aulas ${tipo} de ${rep.ucSigla} na mesma mancha, acima do máximo de ${limite}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// 8. Verificação 5 — Carga diária do estudante
// ---------------------------------------------------------------------------
//
// Teto de blocos por dia por folha-aluno, e número máximo de dias no teto
// por semana.

function verificarCargaDiaria(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  bloco: number,
  registar: (v: Violacao) => void,
): void {
  // ano|semana|dia|folha -> horas ocupadas (com uma sessão representativa por hora)
  const ocupacao = new Map<string, Map<string, SessaoHorario>>();
  for (const si of indexadas) {
    if (si.ano === undefined) continue;
    for (const folha of si.folhas) {
      const chave = `${si.ano}|${si.sessao.semana}|${si.sessao.diaSemana}|${folha}`;
      const horas = ocupacao.get(chave) ?? new Map<string, SessaoHorario>();
      if (!horas.has(si.sessao.horaInicio)) horas.set(si.sessao.horaInicio, si.sessao);
      ocupacao.set(chave, horas);
    }
  }

  const cargaDe = (ano: number): RegrasCargaDiaria => regras.cargaDiaria.porAno[ano] ?? regras.cargaDiaria.transversal;

  // Teto diário.
  for (const [chave, horas] of ocupacao) {
    const [anoStr, , dia, folha] = chave.split("|");
    const ano = Number(anoStr);
    const carga = cargaDe(ano);
    const maxBlocos = Math.floor(carga.maxHoras / bloco);
    if (maxBlocos <= 0 || horas.size <= maxBlocos) continue;
    const rep = [...horas.values()][horas.size - 1];
    registar({
      regra: "carga-diaria",
      gravidade: "erro",
      semana: rep.semana ?? 0,
      dia,
      hora: rep.horaInicio,
      ucSigla: "(vários)",
      turma: folha,
      mensagem: `o grupo ${folha} tem ${horas.size * bloco}h em ${dia}, acima do teto de ${carga.maxHoras}h.`,
    });
  }

  // Dias abertos abaixo da carga-alvo. É um AVISO, nunca um erro: a última
  // semana de uma UC, ou uma semana cuja procura não é múltipla do alvo, deixa
  // sempre um resto que nenhuma distribuição elimina. Só se reporta quando as
  // regras pedem explicitamente para completar os dias (`evitarDiasParciais`),
  // porque é essa a intenção que o coordenador declarou.
  for (const [chave, horas] of ocupacao) {
    const [anoStr, semanaStr, dia, folha] = chave.split("|");
    const carga = cargaDe(Number(anoStr));
    if (!carga.evitarDiasParciais) continue;
    const alvoBlocos = Math.floor(carga.alvoHoras / bloco);
    if (alvoBlocos <= 0 || horas.size >= alvoBlocos) continue;
    const rep = [...horas.values()][0];
    registar({
      regra: "dia-abaixo-do-alvo",
      gravidade: "aviso",
      semana: Number(semanaStr),
      dia,
      hora: rep.horaInicio,
      ucSigla: "(vários)",
      turma: folha,
      mensagem: `o grupo ${folha} tem apenas ${horas.size * bloco}h em ${dia}, abaixo da carga-alvo de ${carga.alvoHoras}h.`,
    });
  }

  // Número máximo de dias no teto por semana.
  const porFolhaSemana = new Map<string, { dia: string; blocos: number; rep: SessaoHorario }[]>();
  for (const [chave, horas] of ocupacao) {
    const [anoStr, semanaStr, dia, folha] = chave.split("|");
    const kf = `${anoStr}|${semanaStr}|${folha}`;
    const lista = porFolhaSemana.get(kf) ?? [];
    lista.push({ dia, blocos: horas.size, rep: [...horas.values()][horas.size - 1] });
    porFolhaSemana.set(kf, lista);
  }
  for (const [kf, lista] of porFolhaSemana) {
    const [anoStr, semanaStr, folha] = kf.split("|");
    const ano = Number(anoStr);
    const carga = cargaDe(ano);
    const maxBlocos = Math.floor(carga.maxHoras / bloco);
    if (maxBlocos <= 0) continue;
    const noTeto = lista.filter((x) => x.blocos >= maxBlocos);
    if (noTeto.length <= carga.maxDiasNoMaximoPorSemana) continue;
    const excesso = noTeto.slice(carga.maxDiasNoMaximoPorSemana);
    for (const x of excesso) {
      registar({
        regra: "carga-diaria-dias-no-teto",
        gravidade: "erro",
        semana: Number(semanaStr),
        dia: x.dia,
        hora: x.rep.horaInicio,
        ucSigla: "(vários)",
        turma: folha,
        mensagem: `o grupo ${folha} tem ${noTeto.length} dias a ${carga.maxHoras}h na semana ${semanaStr}, acima do máximo de ${carga.maxDiasNoMaximoPorSemana}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Verificação 6 — Pausa de almoço
// ---------------------------------------------------------------------------
//
// Nenhuma folha-aluno com as duas horas que protegem o almoço ocupadas no
// mesmo dia.

function verificarPausaAlmoco(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  registar: (v: Violacao) => void,
): void {
  const pausa = regras.grelha.pausaAlmoco;
  if (!pausa) return;

  const ocupacao = new Map<string, Map<string, SessaoHorario>>();
  for (const si of indexadas) {
    if (si.ano === undefined) continue;
    for (const folha of si.folhas) {
      const chave = `${si.ano}|${si.sessao.semana}|${si.sessao.diaSemana}|${folha}`;
      const horas = ocupacao.get(chave) ?? new Map<string, SessaoHorario>();
      if (!horas.has(si.sessao.horaInicio)) horas.set(si.sessao.horaInicio, si.sessao);
      ocupacao.set(chave, horas);
    }
  }

  for (const [chave, horas] of ocupacao) {
    if (!horas.has(pausa.horaAntes) || !horas.has(pausa.horaDepois)) continue;
    const [, semanaStr, dia, folha] = chave.split("|");
    const rep = horas.get(pausa.horaDepois)!;
    registar({
      regra: "pausa-almoco",
      gravidade: "erro",
      semana: Number(semanaStr),
      dia,
      hora: pausa.horaDepois,
      ucSigla: "(vários)",
      turma: folha,
      mensagem: `o grupo ${folha} tem aula às ${pausa.horaAntes} e às ${pausa.horaDepois} em ${dia}, eliminando a pausa de almoço.`,
    });
  }
}

// ---------------------------------------------------------------------------
// 10. Verificação 7 — Precedências
// ---------------------------------------------------------------------------
//
// T antes de TP, TP antes de PL (ou o que as regras declararem), com os
// mínimos por UC. As sessões impostas por layout fixo não são exigidas a
// respeitar a precedência (o layout é verbatim do coordenador), mas contam
// como cumprimento dela para as sessões que vierem a seguir.

function verificarPrecedencias(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  diaIndex: Map<string, number>,
  bloco: number,
  registar: (v: Violacao) => void,
): void {
  if (regras.precedencias.length === 0) return;

  for (const p of regras.precedencias) {
    const minimo = p.unidade === "horas" ? Math.ceil(p.minimoAntes / bloco) : Math.ceil(p.minimoAntes);
    if (minimo <= 0) continue;
    const siglas = new Set(p.siglas.map(normalizar));

    const anteriores = indexadas.filter(
      (si) => si.sessao.tipoAula === p.tipoAntes && si.uc && (p.anos.length === 0 || (si.ano !== undefined && p.anos.includes(si.ano))),
    );
    const depois = indexadas.filter(
      (si) =>
        si.sessao.tipoAula === p.tipoDepois &&
        si.uc &&
        !si.sessao.bloqueado &&
        (p.anos.length === 0 || (si.ano !== undefined && p.anos.includes(si.ano))) &&
        (siglas.size === 0 || siglas.has(normalizar(si.uc.sigla))),
    );

    for (const alvo of depois) {
      const ordemAlvo = ordemMomento(diaIndex, alvo.sessao.semana ?? 0, alvo.sessao.diaSemana, alvo.sessao.horaInicio);
      let contagem = 0;
      for (const ant of anteriores) {
        if (ant.uc!.id !== alvo.uc!.id) continue;
        if (p.contagem === "porTurma" && ant.familia !== alvo.familia) continue;
        const ordemAnt = ordemMomento(diaIndex, ant.sessao.semana ?? 0, ant.sessao.diaSemana, ant.sessao.horaInicio);
        if (ordemAnt < ordemAlvo) contagem++;
      }
      if (contagem < minimo) {
        registar({
          regra: "precedencias",
          gravidade: "erro",
          semana: alvo.sessao.semana ?? 0,
          dia: alvo.sessao.diaSemana,
          hora: alvo.sessao.horaInicio,
          ucSigla: alvo.sessao.ucSigla,
          turma: alvo.sessao.turma,
          mensagem: `${alvo.sessao.ucSigla} precisa de ${minimo} bloco(s) de ${p.tipoAntes} antes da primeira ${p.tipoDepois} e só tem ${contagem} (regra ${p.origem}).`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 10b. Verificação 7b — Ritmo das turmas TP
// ---------------------------------------------------------------------------
//
// As turmas TP da mesma unidade curricular não podem divergir entre si mais do
// que o desvio permitido, em nenhum momento da ordem de calendário. A UNIDADE do
// desvio decide o que se compara:
//
//   `blocos`  — percorrem-se as aulas TP por ordem cronológica e, a cada passo,
//               compara-se o contador da turma mais adiantada com o da mais
//               atrasada;
//   `semanas` — comparam-se aulas HOMÓLOGAS: a n-ésima aula de cada turma. Duas
//               turmas estão desfasadas quando a n-ésima aula de uma cai mais do
//               que `maxDesvioSemanas` semanas depois da n-ésima da outra. É a
//               medida que se adapta ao ritmo próprio de cada UC.
//
// O universo de turmas de cada UC é o que a própria UC declara.

function verificarRitmoTP(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  diaIndex: Map<string, number>,
  registar: (v: Violacao) => void,
): void {
  if (!regras.ritmoTP.ativo) return;
  const maxDesvio = regras.ritmoTP.maxDesvioBlocos;
  const maxDesvioSemanas = regras.ritmoTP.maxDesvioSemanas;
  const estrutura = regras.estruturaTurmas;
  const totalTPs = estrutura.turmasTeoricas * estrutura.tpPorTurmaTeorica;
  const todasAsTP: string[] = [];
  for (let n = 1; n <= totalTPs; n++) todasAsTP.push(`${estrutura.prefixos.tp}${n}`);
  const familiaDaTP = (nome: string): Familia | undefined => {
    const n = Number(nome.slice(estrutura.prefixos.tp.length));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return FAMILIAS[Math.floor((n - 1) / estrutura.tpPorTurmaTeorica)];
  };

  /** Turmas TP que a UC declara servir; sem declaração, todas as da estrutura. */
  const universoDe = (uc: UC): string[] => {
    const declaradas = new Set(
      (uc.turmasConfig ?? []).filter((t) => t.tipo === "TeoricoPratica").map((t) => normalizar(t.nome)),
    );
    if (declaradas.size === 0) return todasAsTP;
    const lista = todasAsTP.filter((n) => declaradas.has(normalizar(n)));
    return lista.length === 0 ? todasAsTP : lista;
  };

  // Aulas TP por UC, em ordem cronológica.
  const porUC = new Map<string, { uc: UC; sessoes: SessaoIndexada[] }>();
  for (const si of indexadas) {
    if (si.sessao.tipoAula !== "TP" || !si.uc) continue;
    const atual = porUC.get(si.uc.id) ?? { uc: si.uc, sessoes: [] };
    atual.sessoes.push(si);
    porUC.set(si.uc.id, atual);
  }

  for (const { uc, sessoes } of porUC.values()) {
    const ordenadas = [...sessoes].sort(
      (a, b) =>
        ordemMomento(diaIndex, a.sessao.semana ?? 0, a.sessao.diaSemana, a.sessao.horaInicio) -
        ordemMomento(diaIndex, b.sessao.semana ?? 0, b.sessao.diaSemana, b.sessao.horaInicio),
    );
    const universo = universoDe(uc);
    const ambitos: (Familia | "uc")[] =
      regras.ritmoTP.ambito === "uc" ? ["uc"] : [...FAMILIAS];

    for (const ambito of ambitos) {
      const turmas = ambito === "uc" ? universo : universo.filter((t) => familiaDaTP(t) === ambito);
      if (turmas.length <= 1) continue;

      if (regras.ritmoTP.unidade === "semanas") {
        // Aulas homólogas: a n-ésima de cada turma, comparada em SEMANAS.
        const porTurma = new Map<string, SessaoIndexada[]>(turmas.map((t) => [t, []]));
        for (const si of ordenadas) {
          const turma = normalizarTurmaTP(si.sessao.turma, todasAsTP);
          if (turma === null) continue;
          porTurma.get(turma)?.push(si);
        }
        let registada = false;
        for (const adiantada of turmas) {
          if (registada) break;
          for (const atrasada of turmas) {
            if (adiantada === atrasada || registada) continue;
            const a = porTurma.get(adiantada)!;
            const b = porTurma.get(atrasada)!;
            const comuns = Math.min(a.length, b.length);
            for (let n = 0; n < comuns; n++) {
              const semanaA = a[n].sessao.semana ?? 0;
              const semanaB = b[n].sessao.semana ?? 0;
              if (semanaB - semanaA <= maxDesvioSemanas) continue;
              registar({
                regra: "ritmo-tp",
                gravidade: "erro",
                semana: semanaB,
                dia: b[n].sessao.diaSemana,
                hora: b[n].sessao.horaInicio,
                ucSigla: b[n].sessao.ucSigla,
                turma: b[n].sessao.turma,
                mensagem:
                  `${b[n].sessao.ucSigla} tem a ${n + 1}.ª TP de ${adiantada} na semana ${semanaA} e a ${n + 1}.ª ` +
                  `de ${atrasada} só na semana ${semanaB}: ${semanaB - semanaA} semanas de atraso entre turmas ` +
                  `TP, acima do máximo de ${maxDesvioSemanas}.`,
              });
              // Uma só violação por UC e âmbito: as seguintes descrevem o mesmo
              // desfasamento noutra aula e não acrescentam informação.
              registada = true;
              break;
            }
          }
        }
        continue;
      }

      const contador = new Map<string, number>(turmas.map((t) => [t, 0]));
      for (const si of ordenadas) {
        const turma = normalizarTurmaTP(si.sessao.turma, todasAsTP);
        if (turma === null || !contador.has(turma)) continue;
        contador.set(turma, (contador.get(turma) ?? 0) + 1);
        let maximo = Number.NEGATIVE_INFINITY;
        let minimo = Number.POSITIVE_INFINITY;
        let turmaMax = "";
        let turmaMin = "";
        for (const [t, n] of contador) {
          if (n > maximo) {
            maximo = n;
            turmaMax = t;
          }
          if (n < minimo) {
            minimo = n;
            turmaMin = t;
          }
        }
        if (maximo - minimo > maxDesvio) {
          registar({
            regra: "ritmo-tp",
            gravidade: "erro",
            semana: si.sessao.semana ?? 0,
            dia: si.sessao.diaSemana,
            hora: si.sessao.horaInicio,
            ucSigla: si.sessao.ucSigla,
            turma: si.sessao.turma,
            mensagem:
              `${si.sessao.ucSigla} tem ${maximo} bloco(s) de TP em ${turmaMax} e ${minimo} em ${turmaMin}: ` +
              `desvio de ${maximo - minimo} blocos entre turmas TP, acima do máximo de ${maxDesvio}.`,
          });
          // Uma só violação por UC e âmbito: a partir daqui o desvio só cresce e
          // repetir a mensagem em cada aula seguinte não acrescenta informação.
          break;
        }
      }
    }
  }
}

/** Nome canónico de uma turma TP, ou `null` se não for uma turma TP conhecida. */
function normalizarTurmaTP(turma: string, todasAsTP: string[]): string | null {
  const alvo = normalizar(turma);
  return todasAsTP.find((t) => normalizar(t) === alvo) ?? null;
}

// ---------------------------------------------------------------------------
// 10c. Verificação 7c — Sem maratonas da mesma UC
// ---------------------------------------------------------------------------
//
// Dois tetos independentes sobre a mesma unidade curricular no mesmo dia:
//   - `maratonaUC.maxBlocosSeguidosMesmaUC` limita a corrida CONTÍGUA na grelha
//     de horas do dia (horas seguidas em que o grupo tem a mesma UC);
//   - `maratonaUC.maxBlocosMesmaUCporDia` limita o TOTAL do dia, seguidos ou
//     não — é este que proíbe o dia de 8h da mesma UC.

function verificarMaratonaUC(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  bloco: number,
  registar: (v: Violacao) => void,
): void {
  if (!regras.maratonaUC.ativo) return;
  const max = regras.maratonaUC.maxBlocosSeguidosMesmaUC;
  const maxPorDia = regras.maratonaUC.maxBlocosMesmaUCporDia;
  const horas = regras.grelha.horasInicio;
  const indiceHora = new Map(horas.map((h, i) => [h, i]));

  // ano|semana|dia|folha|ucSigla -> índice de hora -> sessão representativa
  const ocupacao = new Map<string, Map<number, SessaoHorario>>();
  for (const si of indexadas) {
    if (si.ano === undefined || si.sessao.tipoAula === "S") continue;
    const i = indiceHora.get(si.sessao.horaInicio);
    if (i === undefined) continue;
    for (const folha of si.folhas) {
      const chave = `${si.ano}|${si.sessao.semana}|${si.sessao.diaSemana}|${folha}|${normalizar(si.sessao.ucSigla)}`;
      const mapa = ocupacao.get(chave) ?? new Map<number, SessaoHorario>();
      if (!mapa.has(i)) mapa.set(i, si.sessao);
      ocupacao.set(chave, mapa);
    }
  }

  for (const [chave, mapa] of ocupacao) {
    const [, semanaStr, dia, folha] = chave.split("|");
    const indices = [...mapa.keys()].sort((a, b) => a - b);
    let corrida = 0;
    let anterior = Number.NEGATIVE_INFINITY;
    let excedeu = false;
    for (const i of indices) {
      corrida = i === anterior + 1 ? corrida + 1 : 1;
      anterior = i;
      if (corrida > max) {
        const rep = mapa.get(i)!;
        registar({
          regra: "maratona-uc",
          gravidade: "erro",
          semana: Number(semanaStr),
          dia,
          hora: rep.horaInicio,
          ucSigla: rep.ucSigla,
          turma: folha,
          mensagem:
            `o grupo ${folha} tem ${corrida} blocos seguidos de ${rep.ucSigla} em ${dia} ` +
            `(${corrida * bloco}h de enfiada), acima do máximo de ${max} blocos.`,
        });
        excedeu = true;
        break;
      }
    }
    // Teto do TOTAL do dia, seguidos ou não: é o que proíbe as 8h da mesma UC
    // no mesmo dia (6h de manhã mais 2h à tarde). Uma só violação por dia/grupo.
    if (!excedeu && indices.length > maxPorDia) {
      const rep = mapa.get(indices[indices.length - 1])!;
      registar({
        regra: "maratona-uc",
        gravidade: "erro",
        semana: Number(semanaStr),
        dia,
        hora: rep.horaInicio,
        ucSigla: rep.ucSigla,
        turma: folha,
        mensagem:
          `o grupo ${folha} tem ${indices.length} blocos de ${rep.ucSigla} em ${dia} ` +
          `(${indices.length * bloco}h no mesmo dia), acima do máximo de ${maxPorDia} blocos por dia.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 10d. Verificação 7d — Precedência escalonada das PL
// ---------------------------------------------------------------------------
//
// Tabela por UC: para a n-ésima PL de um desdobramento, quantas T e quantas TP
// têm de estar dadas antes. A ordem da PL conta-se dentro da sua própria turma;
// as T contam-se na família; as TP contam-se no desdobramento a que a turma PL
// pertence (é o desdobramento que tem a TP correspondente).

function verificarPrecedenciasEscalonadas(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  diaIndex: Map<string, number>,
  registar: (v: Violacao) => void,
): void {
  if (regras.precedenciasEscalonadas.length === 0) return;
  const estrutura = regras.estruturaTurmas;

  const tabelaDe = (sigla: string, ano: number | undefined) => {
    const alvo = normalizar(sigla);
    const propria = regras.precedenciasEscalonadas.find(
      (p) =>
        p.siglas.some((s) => normalizar(s) === alvo) &&
        (p.anos.length === 0 || (ano !== undefined && p.anos.includes(ano))),
    );
    if (propria) return propria;
    return regras.precedenciasEscalonadas.find(
      (p) => p.siglas.length === 0 && (p.anos.length === 0 || (ano !== undefined && p.anos.includes(ano))),
    );
  };

  /** Desdobramento (turma TP) a que uma turma PL pertence, pela estrutura. */
  const tpDaPL = (turmaPL: string): string | null => {
    const alvo = normalizar(turmaPL);
    const prefixo = normalizar(estrutura.prefixos.pl);
    if (!alvo.startsWith(prefixo)) return null;
    const m = Number(alvo.slice(prefixo.length));
    if (!Number.isFinite(m) || m <= 0) return null;
    return `${estrutura.prefixos.tp}${Math.ceil(m / estrutura.plPorTP)}`;
  };

  const momento = (s: SessaoHorario) => ordemMomento(diaIndex, s.semana ?? 0, s.diaSemana, s.horaInicio);

  for (const si of indexadas) {
    if (si.sessao.tipoAula !== "PL" || !si.uc || si.sessao.bloqueado) continue;
    const tabela = tabelaDe(si.uc.sigla, si.ano);
    if (!tabela) continue;
    const agora = momento(si.sessao);

    const ordemDaPL =
      indexadas.filter(
        (o) =>
          o.uc?.id === si.uc!.id &&
          o.sessao.tipoAula === "PL" &&
          normalizar(o.sessao.turma) === normalizar(si.sessao.turma) &&
          momento(o.sessao) < agora,
      ).length + 1;
    const escalao =
      tabela.escaloes.find((e) => ordemDaPL <= e.ateNesimaPL) ?? tabela.escaloes[tabela.escaloes.length - 1];
    if (!escalao) continue;

    if (escalao.minimoT > 0) {
      const dadas = indexadas.filter(
        (o) =>
          o.uc?.id === si.uc!.id &&
          o.sessao.tipoAula === "T" &&
          o.familia === si.familia &&
          momento(o.sessao) < agora,
      ).length;
      if (dadas < escalao.minimoT) {
        registar({
          regra: "precedencia-escalonada-pl",
          gravidade: "erro",
          semana: si.sessao.semana ?? 0,
          dia: si.sessao.diaSemana,
          hora: si.sessao.horaInicio,
          ucSigla: si.sessao.ucSigla,
          turma: si.sessao.turma,
          mensagem:
            `${si.sessao.ucSigla}: a ${ordemDaPL}.ª PL de ${si.sessao.turma} exige ${escalao.minimoT} aula(s) T ` +
            `dadas antes e só há ${dadas} (tabela ${tabela.origem}).`,
        });
      }
    }

    if (escalao.minimoTP > 0) {
      const turmaTP = tpDaPL(si.sessao.turma);
      const dadas = indexadas.filter(
        (o) =>
          o.uc?.id === si.uc!.id &&
          o.sessao.tipoAula === "TP" &&
          (turmaTP === null
            ? o.familia === si.familia
            : normalizar(o.sessao.turma) === normalizar(turmaTP)) &&
          momento(o.sessao) < agora,
      ).length;
      if (dadas < escalao.minimoTP) {
        registar({
          regra: "precedencia-escalonada-pl",
          gravidade: "erro",
          semana: si.sessao.semana ?? 0,
          dia: si.sessao.diaSemana,
          hora: si.sessao.horaInicio,
          ucSigla: si.sessao.ucSigla,
          turma: si.sessao.turma,
          mensagem:
            `${si.sessao.ucSigla}: a ${ordemDaPL}.ª PL de ${si.sessao.turma} exige ${escalao.minimoTP} aula(s) TP ` +
            `de ${turmaTP ?? "do desdobramento"} dadas antes e só há ${dadas} (tabela ${tabela.origem}).`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Verificação 8 — TP e PL da mesma UC nunca na mesma mancha
// ---------------------------------------------------------------------------

function verificarTPePLmesmaUC(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  registar: (v: Violacao) => void,
): void {
  // Desligada por omissão: no horário de referência do coordenador a TP e a PL
  // da mesma UC coexistem numa mancha, com docentes diferentes.
  if (!regras.tpPLmesmaUC.ativo) return;
  const porMancha = new Map<string, { tp?: SessaoHorario; pl?: SessaoHorario; ucSigla: string }>();
  for (const si of indexadas) {
    if (!si.uc) continue;
    if (si.sessao.tipoAula !== "TP" && si.sessao.tipoAula !== "PL") continue;
    const chave = `${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}|${si.uc.id}`;
    const atual = porMancha.get(chave) ?? { ucSigla: si.uc.sigla };
    if (si.sessao.tipoAula === "TP") atual.tp = si.sessao;
    else atual.pl = si.sessao;
    porMancha.set(chave, atual);
  }
  for (const { tp, pl, ucSigla } of porMancha.values()) {
    if (!tp || !pl) continue;
    registar({
      regra: "tp-pl-mesma-uc",
      gravidade: "erro",
      semana: pl.semana ?? 0,
      dia: pl.diaSemana,
      hora: pl.horaInicio,
      ucSigla,
      turma: "(mancha)",
      mensagem: `${ucSigla} tem TP (${tp.turma}) e PL (${pl.turma}) na mesma mancha — docente partilhado.`,
    });
  }
}

// ---------------------------------------------------------------------------
// 12. Verificação 9 — Sobreposições
// ---------------------------------------------------------------------------
//
// Nenhuma turma nem folha-aluno em dois sítios na mesma mancha.

function verificarSobreposicoes(indexadas: SessaoIndexada[], registar: (v: Violacao) => void): void {
  // 9a. A mesma folha-aluno, ocupada por turmas DIFERENTES na mesma mancha.
  const porFolha = new Map<string, Map<string, SessaoHorario>>();
  for (const si of indexadas) {
    if (si.ano === undefined) continue;
    const chaveMancha = `${si.ano}|${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}`;
    for (const folha of si.folhas) {
      const chave = `${chaveMancha}|${folha}`;
      const turmas = porFolha.get(chave) ?? new Map<string, SessaoHorario>();
      if (!turmas.has(si.sessao.turma)) turmas.set(si.sessao.turma, si.sessao);
      porFolha.set(chave, turmas);
    }
  }
  for (const [chave, turmas] of porFolha) {
    if (turmas.size <= 1) continue;
    const [, semanaStr, dia, hora, folha] = chave.split("|");
    const nomes = [...turmas.keys()];
    const rep = turmas.get(nomes[nomes.length - 1])!;
    registar({
      regra: "sobreposicao",
      gravidade: "erro",
      semana: Number(semanaStr),
      dia,
      hora,
      ucSigla: rep.ucSigla,
      turma: nomes.join(" + "),
      mensagem: `o grupo ${folha} ficaria em ${turmas.size} aulas ao mesmo tempo (${nomes.join(", ")}).`,
    });
  }

  // 9b. A mesma turma, com duas sessões na mesma mancha (mesmo sem partilhar
  //     folha na análise acima, porque é literalmente a mesma turma).
  const porTurma = new Map<string, SessaoHorario[]>();
  for (const si of indexadas) {
    const chave = `${si.ano ?? "?"}|${si.sessao.semana}|${si.sessao.diaSemana}|${si.sessao.horaInicio}|${si.sessao.turma}`;
    const lista = porTurma.get(chave) ?? [];
    lista.push(si.sessao);
    porTurma.set(chave, lista);
  }
  for (const lista of porTurma.values()) {
    if (lista.length <= 1) continue;
    const rep = lista[lista.length - 1];
    registar({
      regra: "sobreposicao",
      gravidade: "erro",
      semana: rep.semana ?? 0,
      dia: rep.diaSemana,
      hora: rep.horaInicio,
      ucSigla: rep.ucSigla,
      turma: rep.turma,
      mensagem: `a turma ${rep.turma} tem ${lista.length} aulas na mesma mancha (${lista.map((s) => s.ucSigla).join(", ")}).`,
    });
  }
}

// ---------------------------------------------------------------------------
// 13. Verificação 10 — Janela letiva
// ---------------------------------------------------------------------------
//
// Nenhuma sessão fora do intervalo de semanas da UC nem em semana de pausa;
// nenhuma sessão acima da semana máxima global.

function semanasDePausaSet(regras: ConfiguracaoMotor): Set<number> {
  const total = new Map<number, number>();
  const pausas = new Map<number, number>();
  for (const sp of regras.calendario.semanasPersonalizadas) {
    total.set(sp.numero, (total.get(sp.numero) ?? 0) + 1);
    if (sp.isPausa) pausas.set(sp.numero, (pausas.get(sp.numero) ?? 0) + 1);
  }
  const saida = new Set<number>();
  for (const [numero, n] of total) if (pausas.get(numero) === n) saida.add(numero);
  return saida;
}

function verificarJanelaLetiva(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  semestreDaSemana: (semana: number) => number,
  semanaRelativa: (semana: number) => number,
  registar: (v: Violacao) => void,
): void {
  const semanasPausa = semanasDePausaSet(regras);
  const maxGlobal = regras.calendario.semanaMaximaGlobal;

  for (const si of indexadas) {
    const s = si.sessao;
    const semana = s.semana ?? 0;
    const rel = semanaRelativa(semana);

    if (maxGlobal !== null && semana > maxGlobal) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `semana ${semana} além da última semana letiva global (${maxGlobal}).`,
      });
    }
    if (semanasPausa.has(rel)) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `semana ${semana} é uma semana de pausa letiva e não devia ter aulas.`,
      });
    }

    if (!si.uc) continue;
    const uc = si.uc;
    const semestre = semestreDaSemana(semana);
    if (uc.semestre !== semestre) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `${uc.sigla} é do ${uc.semestre}.º semestre e a semana ${semana} é do ${semestre}.º.`,
      });
    }
    if (uc.semanaInicio !== undefined && rel < uc.semanaInicio) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `${uc.sigla} só começa na semana ${uc.semanaInicio} do semestre e esta é a ${rel}.`,
      });
    }
    if (uc.semanaFim !== undefined && rel > uc.semanaFim) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `${uc.sigla} termina na semana ${uc.semanaFim} do semestre e esta é a ${rel}.`,
      });
    }
    if (s.tipoAula === "PL" && uc.semanasPL && uc.semanasPL.length > 0 && !uc.semanasPL.includes(rel)) {
      registar({
        regra: "janela-letiva",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `${uc.sigla} só tem PL nas semanas ${uc.semanasPL.join(", ")} do semestre, não na ${rel}.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 14. Verificação 11 — Restrições por UC
// ---------------------------------------------------------------------------
//
// Dias/períodos proibidos por UC, respeitando o âmbito de semestre. Quando
// `diasProibidos` E `periodosProibidos` estão ambos preenchidos, a proibição
// é a INTERSEÇÃO (ex.: "quarta à tarde"); se só um estiver preenchido, vale
// isoladamente — é a interpretação que a própria regra documenta em
// `src/regras/esquema.ts` (`RestricaoUC`). As sessões impostas por layout
// fixo ficam de fora: a regra que as acompanha costuma ser precisamente a
// que veta a semana para todas as outras UCs.

function verificarRestricoesUC(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  periodoDe: (hora: string) => Periodo,
  semestreDaSemana: (semana: number) => number,
  semanaRelativa: (semana: number) => number,
  registar: (v: Violacao) => void,
): void {
  if (regras.restricoesUC.length === 0) return;

  for (const si of indexadas) {
    if (si.sessao.bloqueado) continue;
    const s = si.sessao;
    const semana = s.semana ?? 0;
    const rel = semanaRelativa(semana);
    const periodo = periodoDe(s.horaInicio);
    const semestre = semestreDaSemana(semana);

    for (const r of regras.restricoesUC) {
      if (si.ano === undefined) continue;
      if (r.anos.length > 0 && !r.anos.includes(si.ano)) continue;
      if (r.semestre != null && r.semestre !== semestre) continue;
      if (r.semanasRestritas.length > 0 && !r.semanasRestritas.includes(rel)) continue;
      if (r.tipos.length > 0 && !r.tipos.includes(s.tipoAula)) continue;
      const siglas = new Set(r.siglas.map(normalizar));
      if (siglas.size > 0 && !siglas.has(normalizar(s.ucSigla))) continue;

      const restringeDias = r.diasProibidos.length > 0;
      const restringePeriodos = r.periodosProibidos.length > 0;
      const diaCoincide = r.diasProibidos.includes(s.diaSemana);
      const periodoCoincide = r.periodosProibidos.includes(periodo);
      const proibido = restringeDias && restringePeriodos ? diaCoincide && periodoCoincide : diaCoincide || periodoCoincide;
      if (!proibido) continue;

      registar({
        regra: "restricoes-uc",
        gravidade: "erro",
        semana,
        dia: s.diaSemana,
        hora: s.horaInicio,
        ucSigla: s.ucSigla,
        turma: s.turma,
        mensagem: `${s.ucSigla} não pode ter ${s.tipoAula} na semana ${rel}, ${s.diaSemana} de ${periodo} (regra ${r.origem}).`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 15. Verificação 12 — Equilíbrio semanal
// ---------------------------------------------------------------------------
//
// Amplitude (máximo - mínimo) de manchas ocupadas por semana, por bloco de
// semanas (aqui: o semestre) e por família. As semanas em que a família já
// está no seu TETO FÍSICO (todos os dias úteis a horas máximas) não entram
// no cálculo da amplitude nem contam como desequilíbrio — não há para onde
// mais colocar essas aulas.

function calcularEquilibrio(
  indexadas: SessaoIndexada[],
  regras: ConfiguracaoMotor,
  registar: (v: Violacao) => void,
): EquilibrioItem[] {
  const fronteira = regras.calendario.fronteiraSemestre;
  const bloco = regras.grelha.duracaoBlocoHoras > 0 ? regras.grelha.duracaoBlocoHoras : 1;
  const nDias = Math.max(1, regras.grelha.dias.length);

  // (ano|familia) -> semana -> Set("dia|hora")
  const porAnoFamilia = new Map<string, Map<number, Set<string>>>();
  for (const si of indexadas) {
    if (!si.familia || si.ano === undefined) continue;
    const kAF = `${si.ano}|${si.familia}`;
    const semanas = porAnoFamilia.get(kAF) ?? new Map<number, Set<string>>();
    const semana = si.sessao.semana ?? 0;
    const manchas = semanas.get(semana) ?? new Set<string>();
    manchas.add(`${si.sessao.diaSemana}|${si.sessao.horaInicio}`);
    semanas.set(semana, manchas);
    porAnoFamilia.set(kAF, semanas);
  }

  const resultado: EquilibrioItem[] = [];
  for (const [kAF, semanas] of porAnoFamilia) {
    const [anoStr, familia] = kAF.split("|") as [string, "A" | "B"];
    const ano = Number(anoStr);
    const cargaDoAno = regras.cargaDiaria.porAno[ano] ?? regras.cargaDiaria.transversal;
    const maxBlocosDia = Math.floor(cargaDoAno.maxHoras / bloco);
    const tetoFisico = nDias * maxBlocosDia;

    for (const semestre of [1, 2]) {
      const doSemestre = [...semanas.entries()].filter(([sem]) =>
        semestre === 1 ? sem <= fronteira && sem >= 1 : sem > fronteira,
      );
      if (doSemestre.length === 0) continue;
      const contagens = doSemestre.map(([sem, manchas]) => ({ semana: sem, n: manchas.size }));
      const noTeto = contagens.filter((c) => tetoFisico > 0 && c.n >= tetoFisico).map((c) => c.semana);
      const semTeto = contagens.filter((c) => !noTeto.includes(c.semana));
      const base = semTeto.length > 0 ? semTeto : contagens;
      const min = Math.min(...base.map((c) => c.n));
      const max = Math.max(...base.map((c) => c.n));
      const amplitude = max - min;

      resultado.push({ ano, familia, bloco: String(semestre), min, max, amplitude, noTeto: noTeto.sort((a, b) => a - b) });

      // Aviso (não erro): amplitude grande é um sinal de distribuição
      // desequilibrada, mas não é, por si só, uma violação estrutural.
      if (amplitude > 2 && base.length >= 3) {
        const pior = base.reduce((a, b) => (b.n > a.n ? b : a));
        registar({
          regra: "equilibrio-semanal",
          gravidade: "aviso",
          semana: pior.semana,
          dia: "(semana)",
          hora: "(semana)",
          ucSigla: "(vários)",
          turma: "(vários)",
          mensagem: `ano ${ano}, família ${familia}, semestre ${semestre}: amplitude de ${amplitude} manchas/semana (mín ${min}, máx ${max}), fora das semanas no teto físico (${noTeto.join(", ") || "nenhuma"}).`,
        });
      }
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// 16. Completude — estatística de contexto (não é uma das 12 verificações)
// ---------------------------------------------------------------------------

/** Tradução do campo `tipo` de `UC.turmasConfig` para o tipo de aula. É a mesma
 *  correspondência textual documentada em `src/types.ts` (`turmasConfig[].tipo`),
 *  não uma decisão do motor. */
const TIPO_DE_TURMA_CONFIG: Readonly<Record<string, SessaoHorario["tipoAula"]>> = {
  "Teórica": "T",
  "TeoricoPratica": "TP",
  "Prática": "PL",
  "Seminário": "S",
};

function calcularCompletude(
  ucs: UC[],
  estrutura: EstruturaTurmas,
  bloco: number,
  indexadas: SessaoIndexada[],
): { alvo: number; colocado: number; pct: number } {
  const nT = estrutura.turmasTeoricas;
  const nTP = totalTP(estrutura);
  const nPL = totalPL(estrutura);

  const colocadosPorChave = new Map<string, number>();
  for (const si of indexadas) {
    if (!si.uc) continue;
    const chave = `${si.uc.id}|${si.sessao.tipoAula}`;
    colocadosPorChave.set(chave, (colocadosPorChave.get(chave) ?? 0) + 1);
  }

  let alvo = 0;
  let colocado = 0;
  const TIPOS: SessaoHorario["tipoAula"][] = ["T", "TP", "PL", "S"];
  for (const uc of ucs) {
    // Quantas turmas de cada tipo a própria UC declara (`turmasConfig`).
    // Quando a UC não declara nenhuma para um tipo, assume-se a estrutura
    // genérica inteira — é exatamente o que o alocador faz quando não há
    // turmas declaradas (com aviso), e é preciso replicar aqui para não
    // inflacionar o alvo de UCs que só lecionam a UMA família.
    const declaradasPorTipo = new Map<SessaoHorario["tipoAula"], number>();
    for (const t of uc.turmasConfig ?? []) {
      const tipo = TIPO_DE_TURMA_CONFIG[t.tipo];
      if (!tipo) continue;
      declaradasPorTipo.set(tipo, (declaradasPorTipo.get(tipo) ?? 0) + 1);
    }
    for (const tipo of TIPOS) {
      const horas =
        tipo === "T" ? uc.cargaHorariaTeorica :
        tipo === "TP" ? uc.cargaHorariaTP :
        tipo === "PL" ? uc.cargaHorariaPratica :
        uc.cargaHorariaS ?? 0;
      const blocosPorTurma = Math.floor((horas || 0) / bloco);
      if (blocosPorTurma <= 0) continue;
      const nGenerico = tipo === "TP" ? nTP : tipo === "PL" ? nPL : nT;
      const nTurmas = declaradasPorTipo.get(tipo) ?? nGenerico;
      const alvoUC = blocosPorTurma * nTurmas;
      alvo += alvoUC;
      colocado += Math.min(colocadosPorChave.get(`${uc.id}|${tipo}`) ?? 0, alvoUC);
    }
  }
  const pct = alvo > 0 ? (colocado / alvo) * 100 : 0;
  return { alvo, colocado, pct };
}
