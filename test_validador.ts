/**
 * SUITE DE CONFORMIDADE DO VALIDADOR INDEPENDENTE (Fase 4).
 *
 * Duas metades, ambas obrigatórias:
 *
 *  METADE A — deteta o que está errado. Para cada uma das 12 verificações,
 *  constrói um horário sintético, mínimo e controlado (a partir de
 *  `configuracaoPadrao()`, nunca do snapshot real) que a viola de propósito, e
 *  prova que `validar(...)` a apanha. Um validador que não falha nada é
 *  inútil — esta metade é a única garantia de que ele morde.
 *
 *  METADE B — aceita o que está certo. Corre `validar(...)` sobre o output
 *  REAL do alocador da Fase 3B, com as regras e as UCs reais do snapshot do
 *  Supabase, e exige zero violações de gravidade "erro". É o teste cruzado:
 *  o alocador e o validador foram escritos de forma independente um do
 *  outro, e se concordarem a confiança é real.
 *
 * Nenhuma sigla real de unidade curricular aparece neste ficheiro: a Metade A
 * usa UCs sintéticas com siglas de teste (`UC1`, `UC2`, ...) e a Metade B
 * identifica as UCs do snapshot pelas suas PROPRIEDADES, nunca por sigla.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { configuracaoPadrao, horaParaMinutos } from "./src/regras/esquema";
import type { ConfiguracaoMotor } from "./src/regras/esquema";
import { carregarRegras } from "./src/regras/carregar";
import { comMigracaoRegraGeral } from "./test_migracao_regra_geral";
import type { LinhaRegra } from "./src/regras/carregar";
import { rowToAnoSem, rowToFeriado, rowToUc } from "./src/data/mappers";
import { alocar } from "./src/motor/alocador";
import type { AnoLetivoSemestre, FeriadoInterrupcao, SessaoHorario, UC } from "./src/types";
import { validar } from "./src/validacao/validador";
import type { RelatorioValidacao, Violacao } from "./src/validacao/validador";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let falhas = 0;

function falhar(mensagem: string): void {
  falhas++;
  console.log(`  FALHA  ${mensagem}`);
}

function ok(mensagem: string): void {
  console.log(`  ok     ${mensagem}`);
}

function seccao(titulo: string): void {
  console.log(`\n${titulo}`);
  console.log("-".repeat(titulo.length));
}

/** Prova que `validar` apanha a violação da regra `regraId` no cenário dado. */
function esperarViolacao(
  relatorio: RelatorioValidacao,
  regraId: string,
  descricao: string,
  gravidade: "erro" | "aviso" = "erro",
): void {
  const achadas = relatorio.violacoes.filter((v) => v.regra === regraId && v.gravidade === gravidade);
  if (achadas.length === 0) {
    falhar(`${regraId}: devia apanhar "${descricao}" e não apanhou.`);
    return;
  }
  ok(`${regraId}: apanhou "${descricao}" (${achadas.length} violação(ões)) -> ${achadas[0].mensagem}`);
}

/** Prova que `validar` NÃO acusa a regra `regraId` no cenário dado (para provar a exceção do layout fixo). */
function esperarSemViolacao(relatorio: RelatorioValidacao, regraId: string, descricao: string): void {
  const achadas = relatorio.violacoes.filter((v) => v.regra === regraId && v.gravidade === "erro");
  if (achadas.length > 0) {
    falhar(`${regraId}: não devia acusar "${descricao}" e acusou -> ${achadas[0].mensagem}`);
    return;
  }
  ok(`${regraId}: não acusou "${descricao}", como esperado`);
}

// ---------------------------------------------------------------------------
// Construtores sintéticos (Metade A) — UCs e sessões de teste, sem siglas reais
// ---------------------------------------------------------------------------

let ucSeq = 0;
function novaUC(over: Partial<UC> = {}): UC {
  ucSeq++;
  return {
    id: `uc-teste-${ucSeq}`,
    nome: `UC de teste ${ucSeq}`,
    sigla: `UC${ucSeq}`,
    cursoId: "curso-teste",
    anoCurricular: 2,
    cargaHorariaTeorica: 2,
    cargaHorariaPratica: 6,
    cargaHorariaTP: 8,
    cargaHorariaE: 0,
    ects: 6,
    semestre: 1,
    numSemanas: 15,
    ...over,
  };
}

let sessaoSeq = 0;
function somarHoras(hora: string, horas: number): string {
  const minutos = horaParaMinutos(hora) + Math.round(horas * 60);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function novaSessao(
  uc: UC,
  tipo: SessaoHorario["tipoAula"],
  turma: string,
  semana: number,
  dia: string,
  hora: string,
  over: Partial<SessaoHorario> = {},
): SessaoHorario {
  sessaoSeq++;
  return {
    id: sessaoSeq,
    ucNome: uc.nome,
    ucSigla: uc.sigla,
    tipoAula: tipo,
    docente: "",
    sala: "",
    salaTipo: "",
    turma,
    diaSemana: dia,
    horaInicio: hora,
    horaFim: somarHoras(hora, 2),
    bloqueado: false,
    semana,
    ...over,
  };
}

// ===========================================================================
// METADE A — cada uma das 12 verificações, violada de propósito
// ===========================================================================

seccao("METADE A — deteta o que está errado (12 verificações)");

// 1. Composição a 100% -------------------------------------------------------
{
  const regras = configuracaoPadrao();
  const uc = novaUC();
  // Só uma TP (3/12 folhas): bloco parcial, não fecha nenhum padrão.
  const sessoes = [novaSessao(uc, "TP", "TP1", 3, "Segunda", "08:00")];
  const rel = validar(sessoes, [uc], regras);
  esperarViolacao(rel, "composicao-100", "um bloco com só 1 TP (3/12 folhas)");

  // Controlo: um bloco T sozinho fecha o padrão T1 a 100% e não deve acusar nada.
  const ucT = novaUC();
  const relOk = validar([novaSessao(ucT, "T", "T1", 3, "Segunda", "08:00")], [ucT], regras);
  if (relOk.ok) ok("composicao-100: um bloco T isolado (padrão T1, 12/12 folhas) não acusa nada");
  else falhar(`composicao-100: um bloco T1 legítimo foi acusado -> ${JSON.stringify(relOk.violacoes)}`);
}

// 2. Janela por tipo de aula --------------------------------------------------
{
  const regras = configuracaoPadrao();
  regras.janelasPorTipo = [
    {
      tipo: "T",
      modo: "veto",
      janelas: [{ dia: "Segunda", periodos: [], horas: [] }],
      ordemPreferenciaDias: ["Segunda"],
      origem: "teste",
    },
  ];
  const uc = novaUC();
  const foraDaJanela = validar([novaSessao(uc, "T", "T1", 3, "Terça", "08:00")], [uc], regras);
  esperarViolacao(foraDaJanela, "janela-tipo-aula", "uma T à Terça quando só Segunda é permitida");

  const dentroDaJanela = validar([novaSessao(uc, "T", "T1", 3, "Segunda", "08:00")], [uc], regras);
  esperarSemViolacao(dentroDaJanela, "janela-tipo-aula", "uma T à Segunda, dentro da janela");

  // Exceção: sessão imposta por layout fixo (bloqueado) fica fora da janela.
  const doLayout = validar(
    [novaSessao(uc, "T", "T1", 3, "Terça", "08:00", { bloqueado: true })],
    [uc],
    regras,
  );
  esperarSemViolacao(doLayout, "janela-tipo-aula", "uma T à Terça IMPOSTA POR LAYOUT FIXO (bloqueado: true)");
}

// 3. Capacidade global de PL ---------------------------------------------------
{
  const regras = configuracaoPadrao(); // maxPLporMancha = 6 (default genérico)
  const uc = novaUC();
  const sessoes = [1, 2, 3, 4, 5, 6, 7].map((n) => novaSessao(uc, "PL", `PL${n}`, 3, "Segunda", "08:00"));
  const rel = validar(sessoes, [uc], regras);
  esperarViolacao(rel, "capacidade-pl-global", `7 PL em simultâneo quando o máximo é ${regras.capacidade.maxPLporMancha}`);

  const semExcesso = validar(sessoes.slice(0, 6), [uc], regras);
  esperarSemViolacao(semExcesso, "capacidade-pl-global", "6 PL em simultâneo, dentro do máximo");
}

// 4. Máximos por UC (maxSimultaneoTP/PL) --------------------------------------
{
  const regras = configuracaoPadrao();
  const uc = novaUC({ maxSimultaneoTP: 2 });
  const sessoes = [1, 2, 3].map((n) => novaSessao(uc, "TP", `TP${n}`, 3, "Segunda", "08:00"));
  const rel = validar(sessoes, [uc], regras);
  esperarViolacao(rel, "maximos-por-uc", "3 TP da mesma UC na mesma mancha quando o máximo declarado é 2");

  const semExcesso = validar(sessoes.slice(0, 2), [uc], regras);
  esperarSemViolacao(semExcesso, "maximos-por-uc", "2 TP da mesma UC na mesma mancha, dentro do máximo");
}

// 5. Carga diária --------------------------------------------------------------
{
  // 5a. Teto diário (maxHoras / duração do bloco).
  const regrasA = configuracaoPadrao(); // maxHoras=8h, bloco=2h -> 4 blocos/dia
  const ucA = novaUC();
  const cincoBlocos = ["08:00", "10:00", "12:00", "14:00", "16:00"].map((h) =>
    novaSessao(ucA, "PL", "PL1", 3, "Segunda", h),
  );
  const relA = validar(cincoBlocos, [ucA], regrasA);
  esperarViolacao(relA, "carga-diaria", "5 blocos (10h) num dia com teto de 8h");

  // 5b. Número máximo de dias no teto por semana.
  const regrasB = configuracaoPadrao();
  regrasB.cargaDiaria.transversal.maxDiasNoMaximoPorSemana = 1;
  const ucB = novaUC();
  const horasSemAlmoco = ["08:00", "10:00", "16:00", "18:00"]; // 4 blocos, sem tocar na pausa
  const doisDiasNoTeto = [
    ...horasSemAlmoco.map((h) => novaSessao(ucB, "PL", "PL1", 3, "Segunda", h)),
    ...horasSemAlmoco.map((h) => novaSessao(ucB, "PL", "PL1", 3, "Terça", h)),
  ];
  const relB = validar(doisDiasNoTeto, [ucB], regrasB);
  esperarViolacao(relB, "carga-diaria-dias-no-teto", "2 dias a 8h na semana quando o máximo é 1 dia");
}

// 6. Pausa de almoço -------------------------------------------------------------
{
  const regras = configuracaoPadrao(); // pausaAlmoco 12:00/14:00 por omissão
  const uc = novaUC();
  const sessoes = [novaSessao(uc, "PL", "PL1", 3, "Segunda", "12:00"), novaSessao(uc, "PL", "PL1", 3, "Segunda", "14:00")];
  const rel = validar(sessoes, [uc], regras);
  esperarViolacao(rel, "pausa-almoco", "o mesmo grupo com aula às 12:00 e às 14:00 no mesmo dia");

  const semQuebra = validar(
    [novaSessao(uc, "PL", "PL1", 3, "Segunda", "12:00"), novaSessao(uc, "PL", "PL1", 3, "Segunda", "16:00")],
    [uc],
    regras,
  );
  esperarSemViolacao(semQuebra, "pausa-almoco", "aulas às 12:00 e às 16:00 — a pausa não é quebrada");
}

// 7. Precedências ------------------------------------------------------------
{
  const regras = configuracaoPadrao();
  regras.precedencias = [
    { siglas: [], tipoAntes: "T", tipoDepois: "TP", minimoAntes: 1, unidade: "blocos", contagem: "porTurma", anos: [], origem: "teste" },
  ];
  const uc = novaUC();
  const semT = validar([novaSessao(uc, "TP", "TP1", 3, "Segunda", "08:00")], [uc], regras);
  esperarViolacao(semT, "precedencias", "uma TP sem nenhuma T antes, quando a regra exige 1");

  const comT = validar(
    [novaSessao(uc, "T", "T1", 3, "Segunda", "08:00"), novaSessao(uc, "TP", "TP1", 4, "Segunda", "08:00")],
    [uc],
    regras,
  );
  esperarSemViolacao(comT, "precedencias", "uma TP na semana seguinte à T da mesma UC/família");
}

// 7b. Precedência escalonada das PL ------------------------------------------
//
// Tabela por UC: para a n-ésima PL de um desdobramento, quantas T e quantas TP
// têm de estar dadas antes. As T contam-se na família; as TP no desdobramento a
// que a turma PL pertence.
{
  const regras = configuracaoPadrao();
  const uc = novaUC();
  regras.precedenciasEscalonadas = [
    {
      siglas: [],
      anos: [],
      escaloes: [
        { ateNesimaPL: 1, minimoT: 1, minimoTP: 1 },
        { ateNesimaPL: 2, minimoT: 2, minimoTP: 2 },
      ],
      origem: "teste",
    },
  ];

  esperarViolacao(
    validar([novaSessao(uc, "PL", "PL1", 3, "Segunda", "08:00")], [uc], regras),
    "precedencia-escalonada-pl",
    "a 1.ª PL de um desdobramento sem nenhuma T nem TP antes",
  );

  const comPrimeiroEscalao = [
    novaSessao(uc, "T", "T1", 1, "Segunda", "08:00"),
    novaSessao(uc, "TP", "TP1", 1, "Segunda", "10:00"),
    novaSessao(uc, "PL", "PL1", 3, "Segunda", "08:00"),
  ];
  esperarSemViolacao(
    validar(comPrimeiroEscalao, [uc], regras),
    "precedencia-escalonada-pl",
    "a 1.ª PL com a T e a TP que o 1.º escalão exige",
  );

  // A 2.ª PL sobe de escalão e passa a exigir 2 T e 2 TP; só há uma de cada.
  esperarViolacao(
    validar([...comPrimeiroEscalao, novaSessao(uc, "PL", "PL1", 4, "Segunda", "08:00")], [uc], regras),
    "precedencia-escalonada-pl",
    "a 2.ª PL do mesmo desdobramento, que exige o 2.º escalão e só tem o 1.º",
  );
}

// 7c. Ritmo das turmas TP -----------------------------------------------------
//
// Em SEMANAS de atraso entre aulas homólogas (a n-ésima de cada turma), que é a
// unidade que a configuração real usa; e em BLOCOS de avanço, a alternativa.
{
  const emSemanas = configuracaoPadrao();
  emSemanas.ritmoTP = { ativo: true, unidade: "semanas", maxDesvioBlocos: 2, maxDesvioSemanas: 2, ambito: "familia" };
  const uc = novaUC();

  esperarViolacao(
    validar(
      [
        novaSessao(uc, "TP", "TP1", 2, "Segunda", "08:00"),
        novaSessao(uc, "TP", "TP2", 5, "Segunda", "08:00"),
      ],
      [uc],
      emSemanas,
    ),
    "ritmo-tp",
    "a 1.ª TP de uma turma 3 semanas depois da 1.ª da outra, com o máximo em 2",
  );

  esperarSemViolacao(
    validar(
      [
        novaSessao(uc, "TP", "TP1", 2, "Segunda", "08:00"),
        novaSessao(uc, "TP", "TP2", 4, "Segunda", "08:00"),
        novaSessao(uc, "TP", "TP1", 2, "Terça", "08:00"),
        novaSessao(uc, "TP", "TP1", 2, "Quarta", "08:00"),
      ],
      [uc],
      emSemanas,
    ),
    "ritmo-tp",
    "uma turma com 3 blocos na mesma semana e a outra 2 semanas atrás — em semanas, não é desfasamento",
  );

  const emBlocos = configuracaoPadrao();
  emBlocos.ritmoTP = { ativo: true, unidade: "blocos", maxDesvioBlocos: 1, maxDesvioSemanas: 2, ambito: "familia" };
  esperarViolacao(
    validar(
      [
        novaSessao(uc, "TP", "TP1", 2, "Segunda", "08:00"),
        novaSessao(uc, "TP", "TP1", 2, "Terça", "08:00"),
        novaSessao(uc, "TP", "TP1", 2, "Quarta", "08:00"),
      ],
      [uc],
      emBlocos,
    ),
    "ritmo-tp",
    "3 blocos numa turma e nenhum nas outras, com o máximo de 1 bloco de avanço",
  );
}

// 7d. Maratonas da mesma UC ---------------------------------------------------
//
// Dois tetos: a corrida contígua e o total do dia. O segundo é o que proíbe as
// 8h da mesma unidade curricular no mesmo dia.
{
  const regras = configuracaoPadrao();
  regras.maratonaUC = { ativo: true, maxBlocosSeguidosMesmaUC: 3, maxBlocosMesmaUCporDia: 3 };
  const uc = novaUC();
  const naSegunda = (horas: string[]) => horas.map((h) => novaSessao(uc, "TP", "TP1", 3, "Segunda", h));

  esperarSemViolacao(
    validar(naSegunda(["08:00", "10:00", "12:00"]), [uc], regras),
    "maratona-uc",
    "3 blocos seguidos da mesma UC no mesmo dia (o limite, aceite)",
  );
  esperarViolacao(
    validar(naSegunda(["08:00", "10:00", "12:00", "14:00"]), [uc], regras),
    "maratona-uc",
    "4 blocos seguidos da mesma UC no mesmo dia",
  );
  // Com um intervalo pelo meio a corrida nunca passa de 3, mas o dia tem 4.
  esperarViolacao(
    validar(naSegunda(["08:00", "10:00", "12:00", "18:00"]), [uc], regras),
    "maratona-uc",
    "8h da mesma UC no mesmo dia (6h seguidas de manhã mais 2h à tarde)",
  );
}

// 8. TP e PL da mesma UC na mesma mancha -----------------------------------
//
// A regra está DESLIGADA por omissão: o horário de referência do coordenador
// junta as duas na mesma mancha, com docentes diferentes. Provam-se as duas
// metades — desligada não acusa, ligada continua a acusar.
{
  const desligada = configuracaoPadrao();
  const uc = novaUC();
  const juntas = [
    novaSessao(uc, "TP", "TP1", 3, "Segunda", "08:00"),
    novaSessao(uc, "PL", "PL7", 3, "Segunda", "08:00"),
  ];
  esperarSemViolacao(
    validar(juntas, [uc], desligada),
    "tp-pl-mesma-uc",
    "TP e PL da mesma UC na mesma mancha, com a regra desligada (docentes diferentes)",
  );

  const ligada = configuracaoPadrao();
  ligada.tpPLmesmaUC = { ativo: true };
  esperarViolacao(
    validar(juntas, [uc], ligada),
    "tp-pl-mesma-uc",
    "TP e PL da mesma UC na mesma mancha, com a regra ligada (docente partilhado)",
  );

  const outraUC = novaUC();
  const semConflito = validar(
    [novaSessao(uc, "TP", "TP1", 3, "Segunda", "08:00"), novaSessao(outraUC, "PL", "PL7", 3, "Segunda", "08:00")],
    [uc, outraUC],
    ligada,
  );
  esperarSemViolacao(semConflito, "tp-pl-mesma-uc", "TP de uma UC e PL de outra na mesma mancha");
}

// 9. Sobreposições -------------------------------------------------------------
{
  const regras = configuracaoPadrao();
  const uc1 = novaUC();
  const uc2 = novaUC();
  // T1 cobre as folhas de TP1 (mesma família): sobreposição de folha-aluno.
  const porFolha = validar(
    [novaSessao(uc1, "T", "T1", 3, "Segunda", "08:00"), novaSessao(uc2, "TP", "TP1", 3, "Segunda", "08:00")],
    [uc1, uc2],
    regras,
  );
  esperarViolacao(porFolha, "sobreposicao", "uma T e uma TP da mesma família na mesma mancha (a T cobre a TP)");

  // A mesma turma, duas UCs diferentes, na mesma mancha.
  const mesmaTurma = validar(
    [novaSessao(uc1, "TP", "TP2", 3, "Segunda", "08:00"), novaSessao(uc2, "TP", "TP2", 3, "Segunda", "08:00")],
    [uc1, uc2],
    regras,
  );
  esperarViolacao(mesmaTurma, "sobreposicao", "a mesma turma (TP2) com duas aulas na mesma mancha");
}

// 10. Janela letiva --------------------------------------------------------------
{
  const regras = configuracaoPadrao();
  regras.calendario.semanaMaximaGlobal = 20;
  regras.calendario.semanasPersonalizadas = [
    { numero: 5, dataSegunda: "2026-01-05", dataSexta: "2026-01-09", isPausa: true, motivoPausa: "teste" },
  ];
  const ucFim = novaUC({ semanaInicio: 1, semanaFim: 10, semestre: 1 });
  const foraDoFim = validar([novaSessao(ucFim, "T", "T1", 15, "Segunda", "08:00")], [ucFim], regras);
  esperarViolacao(foraDoFim, "janela-letiva", "uma aula na semana 15 de uma UC que termina na semana 10");

  const ucGenerica = novaUC({ semanaInicio: 1, semanaFim: 15, semestre: 1 });
  const alemDoGlobal = validar([novaSessao(ucGenerica, "T", "T1", 25, "Segunda", "08:00")], [ucGenerica], regras);
  esperarViolacao(alemDoGlobal, "janela-letiva", "a semana 25, além da última semana letiva global (20)");

  const naPausa = validar([novaSessao(ucGenerica, "T", "T1", 5, "Segunda", "08:00")], [ucGenerica], regras);
  esperarViolacao(naPausa, "janela-letiva", "a semana 5, marcada como pausa letiva");

  const dentro = validar([novaSessao(ucGenerica, "T", "T1", 3, "Segunda", "08:00")], [ucGenerica], regras);
  esperarSemViolacao(dentro, "janela-letiva", "a semana 3, dentro da janela letiva da UC e do calendário");
}

// 11. Restrições por UC ----------------------------------------------------------
{
  const regras = configuracaoPadrao();
  regras.restricoesUC = [
    { siglas: [], tipos: [], diasProibidos: ["Quarta"], periodosProibidos: [], semanasRestritas: [], semestre: null, anos: [], origem: "teste" },
  ];
  const uc = novaUC();
  const proibido = validar([novaSessao(uc, "T", "T1", 3, "Quarta", "08:00")], [uc], regras);
  esperarViolacao(proibido, "restricoes-uc", "uma aula à Quarta, dia proibido pela regra");

  const permitido = validar([novaSessao(uc, "T", "T1", 3, "Segunda", "08:00")], [uc], regras);
  esperarSemViolacao(permitido, "restricoes-uc", "uma aula à Segunda, fora do dia proibido");

  // Exceção: sessão imposta por layout fixo não é acusada pela restrição.
  const doLayout = validar(
    [novaSessao(uc, "T", "T1", 3, "Quarta", "08:00", { bloqueado: true })],
    [uc],
    regras,
  );
  esperarSemViolacao(doLayout, "restricoes-uc", "uma aula à Quarta IMPOSTA POR LAYOUT FIXO (bloqueado: true)");
}

// 12. Equilíbrio semanal -----------------------------------------------------
{
  const regras = configuracaoPadrao();
  const uc = novaUC();
  const sessoes: SessaoHorario[] = [];
  // Semanas 1 e 2: uma única mancha. Semana 3: cinco manchas (desequilíbrio).
  sessoes.push(novaSessao(uc, "T", "T1", 1, "Segunda", "08:00"));
  sessoes.push(novaSessao(uc, "T", "T1", 2, "Segunda", "08:00"));
  for (const [dia, hora] of [
    ["Segunda", "08:00"],
    ["Terça", "08:00"],
    ["Quarta", "08:00"],
    ["Quinta", "08:00"],
    ["Sexta", "08:00"],
  ] as const) {
    sessoes.push(novaSessao(uc, "T", "T1", 3, dia, hora));
  }
  // Semana 4: a família ao seu TETO FÍSICO (5 dias x 4 blocos/dia = 20 manchas),
  // usando horas que não tocam a pausa de almoço.
  for (const dia of ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]) {
    for (const hora of ["08:00", "10:00", "16:00", "18:00"]) {
      sessoes.push(novaSessao(uc, "T", "T1", 4, dia, hora));
    }
  }
  const rel = validar(sessoes, [uc], regras);
  const item = rel.equilibrio.find((e) => e.ano === uc.anoCurricular && e.familia === "A" && e.bloco === "1");
  if (!item) {
    falhar("equilibrio-semanal: não produziu nenhum item para ano 2 / família A / semestre 1.");
  } else {
    if (item.min === 1 && item.max === 5 && item.amplitude === 4) {
      ok(`equilibrio-semanal: amplitude ${item.amplitude} (min ${item.min}, máx ${item.max}) detetada corretamente`);
    } else {
      falhar(`equilibrio-semanal: esperava min=1/max=5/amplitude=4 e obteve min=${item.min}/max=${item.max}/amplitude=${item.amplitude}.`);
    }
    if (item.noTeto.includes(4)) ok("equilibrio-semanal: a semana 4 (teto físico de 20 manchas) foi marcada em noTeto e excluída da amplitude");
    else falhar(`equilibrio-semanal: a semana 4 devia estar em noTeto e não está (noTeto=${item.noTeto.join(",")}).`);
  }
  esperarViolacao(rel, "equilibrio-semanal", "amplitude de 4 manchas/semana entre as semanas 1-3", "aviso");
}

// ===========================================================================
// METADE B — aceita o output REAL do alocador (Fase 3B) sobre o snapshot real
// ===========================================================================

seccao("METADE B — aceita o que está certo (snapshot real + alocador real)");

const PASTA_SNAPSHOT =
  process.argv[2] ?? process.env.SB_SNAPSHOT_DIR ?? "C:\\Users\\hugon\\AppData\\Local\\Temp\\sb";

function lerJson(nome: string): any[] {
  const caminho = join(PASTA_SNAPSHOT, nome);
  if (!existsSync(caminho)) {
    console.error(`\nSnapshot em falta: ${caminho}`);
    console.error("Indique a pasta com SB_SNAPSHOT_DIR=... ou como primeiro argumento.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(caminho, "utf8"));
}

const linhasRegras = lerJson("regras.json") as LinhaRegra[];
const linhasUcs = lerJson("ucs.json");
const linhasAnos = lerJson("anos_semestres.json");
const linhasFeriados = lerJson("feriados.json");

const ucs: UC[] = linhasUcs.map(rowToUc);
const anosSemestres: AnoLetivoSemestre[] = linhasAnos.map(rowToAnoSem);
const feriados: FeriadoInterrupcao[] = linhasFeriados.map(rowToFeriado);
const anoLetivo = anosSemestres[0]?.anoLetivo ?? "";

const { config: regrasReais, relatorio: relCarregamento } = carregarRegras({
  regras: comMigracaoRegraGeral(linhasRegras),
  ucs: linhasUcs,
  anosSemestres: linhasAnos,
});

if (relCarregamento.malformadas.length > 0) {
  console.error("FALHA: o snapshot tem regras malformadas; corrija-as antes de correr a suite.");
  process.exit(1);
}

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(`Regras: ${linhasRegras.length} | UCs: ${ucs.length} | Ano letivo: ${anoLetivo}`);

const { sessoes, relatorio: relAlocacao } = alocar({ ucs, regras: regrasReais, feriados, anosSemestres, anoLetivo });
console.log(`Alocador: ${sessoes.length} sessões, completude ${relAlocacao.completude.toFixed(1)}% (segundo o próprio alocador).`);

const relValidacao = validar(sessoes, ucs, regrasReais);

console.log(
  `\nValidador independente: ${relValidacao.violacoes.length} violação(ões) totais ` +
    `(${relValidacao.violacoes.filter((v) => v.gravidade === "erro").length} erro, ` +
    `${relValidacao.violacoes.filter((v) => v.gravidade === "aviso").length} aviso).`,
);
console.log(`Completude (segundo o validador): ${relValidacao.completude.colocado}/${relValidacao.completude.alvo} (${relValidacao.completude.pct.toFixed(1)}%).`);

console.log("\nViolações por regra:");
for (const [regra, n] of Object.entries(relValidacao.porRegra).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${regra.padEnd(28)} ${n}`);
}

console.log("\nEquilíbrio semanal (por ano/família/semestre):");
for (const e of relValidacao.equilibrio) {
  console.log(
    `  ano ${e.ano} familia ${e.familia} S${e.bloco}: min=${e.min} max=${e.max} amplitude=${e.amplitude} noTeto=[${e.noTeto.join(",")}]`,
  );
}

const errosGraves = relValidacao.violacoes.filter((v) => v.gravidade === "erro");
if (errosGraves.length > 0) {
  console.log(`\nPrimeiras ${Math.min(30, errosGraves.length)} violações de gravidade "erro":`);
  for (const v of errosGraves.slice(0, 30)) {
    console.log(`  [${v.regra}] semana ${v.semana} ${v.dia} ${v.hora} ${v.ucSigla}/${v.turma}: ${v.mensagem}`);
  }
}

if (errosGraves.length === 0) {
  ok(`zero violações de gravidade "erro" sobre ${sessoes.length} sessões reais — alocador e validador concordam.`);
} else {
  falhar(`${errosGraves.length} violação(ões) de gravidade "erro" no output real do alocador (ver acima).`);
}

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

console.log("");
if (falhas > 0) {
  console.error(`FALHA: ${falhas} problema(s) na suite de conformidade do validador.`);
  process.exit(1);
}
console.log("Suite do validador: Metade A (deteção) e Metade B (aceitação com dados reais) passaram.");
