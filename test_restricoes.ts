/**
 * SUITE DE CONFORMIDADE DAS RESTRIÇÕES (Fase 3A).
 *
 * Uma restrição, um teste que prova que ela VETA o que deve vetar e ACEITA o
 * caso legítimo. Nada de cenários grandes: cada caso monta o estado mínimo,
 * chama o predicado daquela restrição em concreto e verifica o resultado. Se
 * uma restrição deixar de vetar (ou passar a vetar de mais), falha aqui e só
 * aqui — não é preciso gerar um horário inteiro para descobrir.
 *
 * As regras são as REAIS do snapshot do Supabase. Duas restrições (o máximo de
 * TP por mancha e os conflitos entre UCs) não estão parametrizadas nas regras
 * de produção; para essas, o teste acrescenta uma regra explícita ao snapshot e
 * diz que o fez.
 *
 * Nenhuma sigla de unidade curricular aparece neste ficheiro: as UCs são
 * escolhidas pelas suas propriedades (limites, semestre, janela letiva) e os
 * dias/horas saem da grelha e das próprias regras.
 *
 * Localização do snapshot: `SB_SNAPSHOT_DIR`, ou o primeiro argumento da linha
 * de comandos.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { carregarRegras } from "./src/regras/carregar";
import { comMigracaoRegraGeral } from "./test_migracao_regra_geral";
import type { LinhaRegra } from "./src/regras/carregar";
import type { ConfiguracaoMotor } from "./src/regras/esquema";
import { rowToUc } from "./src/data/mappers";
import type { UC } from "./src/types";
import { criarEstado, criarHierarquia } from "./src/motor/estado";
import type { Candidato, EstadoHorario, Mancha, SessaoCandidata } from "./src/motor/estado";
import { construirRestricoes, custoTotal, primeiraViolacao } from "./src/motor/restricoes";
import type { ContextoRestricao, Restricao } from "./src/motor/restricoes";
import {
  coberturaFolhas,
  custosDeForma,
  formaDe,
  formasPossiveis,
  limitesDaComposicao,
  podeCompletarBloco,
} from "./src/motor/padroes";
import type { FormaBloco } from "./src/motor/padroes";

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

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
// O snapshot é anterior à migração da regra geral (ainda traz 4 TP da mesma UC
// por mancha); aplica-se-lhe por cima o que a migração escreve.
const linhasComMigracao = comMigracaoRegraGeral(linhasRegras);
const linhasUCs = lerJson("ucs.json");
const linhasAnosSemestres = lerJson("anos_semestres.json");

const { config } = carregarRegras({
  regras: linhasComMigracao,
  ucs: linhasUCs,
  anosSemestres: linhasAnosSemestres,
});

const ucs: UC[] = linhasUCs.map(rowToUc);
const ucPorId = new Map<string, UC>(ucs.map((u) => [u.id, u]));
const restricoes = construirRestricoes(config);

const estrutura = config.estruturaTurmas;
const hierarquia = criarHierarquia(estrutura);
const DIAS = config.grelha.dias;
const HORAS = config.grelha.horasInicio;
const BLOCO = config.grelha.duracaoBlocoHoras;
const ANO = 2; // o ano curricular que as regras reais parametrizam

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(
  `Regras: ${linhasRegras.length} | UCs: ${ucs.length} | Restrições construídas: ${restricoes.length} ` +
    `(${restricoes.filter((r) => r.tipo === "hard").length} hard, ${restricoes.filter((r) => r.tipo === "soft").length} soft)\n`,
);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Ledger {
  vetos: number;
  aceites: number;
  discriminacoes: number;
}

const ledger = new Map<string, Ledger>();
for (const r of restricoes) ledger.set(r.id, { vetos: 0, aceites: 0, discriminacoes: 0 });

let falhas = 0;

function registar(id: string): Ledger {
  let l = ledger.get(id);
  if (!l) {
    l = { vetos: 0, aceites: 0, discriminacoes: 0 };
    ledger.set(id, l);
  }
  return l;
}

function achar(lista: Restricao[], id: string): Restricao {
  const r = lista.find((x) => x.id === id);
  if (!r) throw new Error(`restrição desconhecida: ${id}`);
  return r;
}

function falhar(mensagem: string): void {
  falhas++;
  console.log(`  FALHA  ${mensagem}`);
}

/** Prova que a restrição `id` veta este candidato. */
function provaVeto(lista: Restricao[], id: string, ctx: ContextoRestricao, descricao: string): void {
  const r = achar(lista, id);
  const motivo = r.verificar ? r.verificar(ctx) : null;
  if (motivo === null) {
    falhar(`${id}: devia vetar "${descricao}" e aceitou.`);
    return;
  }
  registar(id).vetos++;
  console.log(`  veta    ${descricao}\n            -> ${motivo}`);
}

/** Prova que a restrição `id` aceita este candidato legítimo. */
function provaAceite(lista: Restricao[], id: string, ctx: ContextoRestricao, descricao: string): void {
  const r = achar(lista, id);
  const motivo = r.verificar ? r.verificar(ctx) : null;
  if (motivo !== null) {
    falhar(`${id}: devia aceitar "${descricao}" e vetou: ${motivo}`);
    return;
  }
  registar(id).aceites++;
  console.log(`  aceita  ${descricao}`);
}

/** Prova que uma restrição soft distingue o caso caro do caso barato. */
function provaCusto(
  lista: Restricao[],
  id: string,
  caro: ContextoRestricao,
  barato: ContextoRestricao,
  descricao: string,
): void {
  const r = achar(lista, id);
  if (!r.custo) {
    falhar(`${id}: restrição soft sem função de custo.`);
    return;
  }
  const cCaro = r.custo(caro);
  const cBarato = r.custo(barato);
  if (!(cCaro > cBarato)) {
    falhar(`${id}: ${descricao} — esperava custo maior, obteve ${cCaro} vs ${cBarato}.`);
    return;
  }
  registar(id).discriminacoes++;
  console.log(`  custo   ${descricao} (${cCaro} > ${cBarato})`);
}

function verdade(condicao: boolean, descricao: string): void {
  if (condicao) console.log(`  ok      ${descricao}`);
  else falhar(descricao);
}

function seccao(titulo: string): void {
  console.log(`\n${titulo}`);
  console.log("-".repeat(titulo.length));
}

// ---------------------------------------------------------------------------
// Construtores
// ---------------------------------------------------------------------------

const normalizarSigla = (s: string) => (s ?? "").trim().toLocaleUpperCase("pt-PT");

const nomeTP = (n: number) => `${estrutura.prefixos.tp}${n}`;
const nomePL = (n: number) => `${estrutura.prefixos.pl}${n}`;
const nomeTeorica = (i: number) =>
  estrutura.nomesTurmasTeoricas[i] ?? `${estrutura.prefixos.teorica}${i + 1}`;

const ses = (uc: UC, tipo: SessaoCandidata["tipo"], turma: string): SessaoCandidata => ({
  ucId: uc.id,
  ucSigla: uc.sigla,
  turma,
  tipo,
});

const manchaEm = (semana: number, dia: string, hora: string, ano = ANO): Mancha => ({
  ano,
  semana,
  dia,
  hora,
});

const cand = (
  sessoes: SessaoCandidata[],
  mancha: Mancha,
  familia: "A" | "B" = "A",
): Candidato => ({ sessoes, mancha, familia });

const ctxDe = (estado: EstadoHorario, candidato: Candidato, regras: ConfiguracaoMotor = config): ContextoRestricao => ({
  estado,
  candidato,
  regras,
  ucPorId,
});

const novoEstado = (): EstadoHorario => criarEstado(hierarquia);

// ---------------------------------------------------------------------------
// Escolha de UCs pelas suas PROPRIEDADES (nunca por sigla)
// ---------------------------------------------------------------------------

function exigir<T>(v: T | undefined, o_que: string): T {
  if (v === undefined) {
    console.error(`\nO snapshot não tem ${o_que}; o teste não pode correr.`);
    process.exit(1);
  }
  return v;
}

const ucsDoSemestre1 = ucs.filter((u) => u.anoCurricular === ANO && u.semestre === 1);
/** UC que declara um limite de TP em simultâneo (o caso do bloco de 4 TP). */
const ucComLimiteTP = exigir(
  ucsDoSemestre1.find((u) => typeof u.maxSimultaneoTP === "number" && u.maxSimultaneoTP > 0),
  "nenhuma UC com `max_simultaneo_tp` definido",
);
const LIMITE_TP = ucComLimiteTP.maxSimultaneoTP!;
/** UCs que declaram um limite de PL em simultâneo. */
const ucsComLimitePL = ucsDoSemestre1.filter(
  (u) => typeof u.maxSimultaneoPL === "number" && u.maxSimultaneoPL > 0,
);
const ucComLimitePL = exigir(ucsComLimitePL[0], "nenhuma UC com `max_simultaneo_pl` definido");
const LIMITE_PL = ucComLimitePL.maxSimultaneoPL!;

/** Três UCs distintas do mesmo semestre, para compor blocos de padrão. */
const [ucA, ucB, ucC] = [ucsDoSemestre1[0], ucsDoSemestre1[1], ucsDoSemestre1[2]];
exigir(ucC, "três UCs distintas no 1.º semestre");

/** Semana útil onde nenhuma regra de calendário interfere. */
const SEMANA = 3;
const SEG = DIAS[0];
const H08 = HORAS[0];
const H10 = HORAS[1];
const H12 = HORAS[2];
const TER = DIAS[1];

// UC cuja janela letiva cobre a semana usada nos casos gerais.
const ucNaSemana = exigir(
  ucsDoSemestre1.find(
    (u) => (u.semanaInicio ?? 1) <= SEMANA && (u.semanaFim ?? 99) >= SEMANA && !u.semanasPL?.length,
  ),
  "nenhuma UC do 1.º semestre ativa na semana de teste",
);

// ---------------------------------------------------------------------------
// 1. Sobreposição
// ---------------------------------------------------------------------------

seccao("sobreposicao — a mesma folha-aluno em dois sítios");
{
  const estado = novoEstado();
  const m = manchaEm(SEMANA, SEG, H08);
  estado.colocar(cand([ses(ucA, "TP", nomeTP(1))], m));
  provaVeto(
    restricoes,
    "sobreposicao",
    ctxDe(estado, cand([ses(ucB, "T", nomeTeorica(0))], m)),
    `uma T da turma teórica sobre uma ${nomeTP(1)} já colocada na mesma mancha`,
  );
  provaVeto(
    restricoes,
    "sobreposicao",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1)), ses(ucB, "PL", nomePL(1))], m)),
    `o próprio candidato junta ${nomeTP(1)} e ${nomePL(1)}, que partilham grupos`,
  );
  provaAceite(
    restricoes,
    "sobreposicao",
    ctxDe(estado, cand([ses(ucB, "TP", nomeTP(5))], m, "B")),
    `uma TP de outra família (${nomeTP(5)}) na mesma mancha`,
  );
}

// ---------------------------------------------------------------------------
// 2. Janela por tipo de aula (o veto que impede as T à terça e à quinta)
// ---------------------------------------------------------------------------

seccao("janela-tipo-aula — dias e períodos autorizados por tipo");
{
  const janelaT = exigir(
    config.janelasPorTipo.find((j) => j.tipo === "T" && j.modo === "veto"),
    "janela de veto para as aulas T",
  );
  const diasComT = janelaT.janelas.map((j) => j.dia);
  const diasSemT = DIAS.filter((d) => !diasComT.includes(d));
  verdade(diasSemT.length > 0, `a janela das T exclui ${diasSemT.join(" e ")}`);

  for (const dia of diasSemT) {
    provaVeto(
      restricoes,
      "janela-tipo-aula",
      ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(SEMANA, dia, H08))),
      `aula T à ${dia}`,
    );
  }

  const diaDiaInteiro = exigir(
    janelaT.janelas.find((j) => j.periodos.length === 0 || j.periodos.length > 1),
    "dia da janela das T aberto de manhã e de tarde",
  );
  provaAceite(
    restricoes,
    "janela-tipo-aula",
    ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(SEMANA, diaDiaInteiro.dia, H08))),
    `aula T à ${diaDiaInteiro.dia} de manhã`,
  );

  const diaSoManha = janelaT.janelas.find((j) => j.periodos.length === 1 && j.periodos[0] === "manha");
  if (diaSoManha) {
    const horaManha = exigir(
      HORAS.find((h) => Number(h.slice(0, 2)) < config.grelha.limiarTardeHora),
      "hora de manhã na grelha",
    );
    const horaTarde = exigir(
      HORAS.find((h) => Number(h.slice(0, 2)) >= config.grelha.limiarTardeHora),
      "hora de tarde na grelha",
    );
    provaAceite(
      restricoes,
      "janela-tipo-aula",
      ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(SEMANA, diaSoManha.dia, horaManha))),
      `aula T à ${diaSoManha.dia} às ${horaManha} (só de manhã é permitido)`,
    );
    provaVeto(
      restricoes,
      "janela-tipo-aula",
      ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(SEMANA, diaSoManha.dia, horaTarde))),
      `aula T à ${diaSoManha.dia} às ${horaTarde}`,
    );
  } else {
    falhar("a janela das T não tem nenhum dia limitado à manhã; o caso da tarde não foi provado.");
  }
}

// ---------------------------------------------------------------------------
// 3. Capacidade global de PL por mancha
// ---------------------------------------------------------------------------

seccao(`capacidade-pl-mancha — máximo global de ${config.capacidade.maxPLporMancha} PL em toda a escola`);
{
  const MAX = config.capacidade.maxPLporMancha;
  const m = manchaEm(SEMANA, SEG, H08);
  const encherPL = (quantas: number, ano: number): EstadoHorario => {
    const estado = novoEstado();
    for (let i = 1; i <= quantas; i++) {
      estado.colocar(cand([ses(ucA, "PL", nomePL(i))], { ...m, ano }));
    }
    return estado;
  };

  // As PL já colocadas são de OUTRO ano curricular: o limite é da escola inteira.
  provaVeto(
    restricoes,
    "capacidade-pl-mancha",
    ctxDe(encherPL(MAX, ANO - 1), cand([ses(ucB, "PL", nomePL(13))], m)),
    `a ${MAX + 1}.ª PL da mancha, somando os anos curriculares`,
  );
  provaAceite(
    restricoes,
    "capacidade-pl-mancha",
    ctxDe(encherPL(MAX - 1, ANO - 1), cand([ses(ucB, "PL", nomePL(13))], m)),
    `a ${MAX}.ª PL da mancha`,
  );
}

// ---------------------------------------------------------------------------
// 3b. Conjuntos de salas com capacidade própria (regra acrescentada)
// ---------------------------------------------------------------------------

seccao("capacidade-pool-sala — conjuntos de salas com capacidade própria");
{
  const CAPACIDADE_POOL = 2;
  const regraExtra: LinhaRegra = {
    id: "teste_pool_salas",
    ativa: true,
    config: {
      motor: {
        poolsSala: [
          {
            id: "conjunto_paralelo",
            descricao: "Conjunto de salas com capacidade própria (teste)",
            maxSimultaneo: CAPACIDADE_POOL,
            contaParaMaximoGlobalPL: false,
            siglas: [ucA.sigla],
          },
        ],
      },
    },
  };
  const variante = carregarRegras({
    regras: [...linhasComMigracao, regraExtra],
    ucs: linhasUCs,
    anosSemestres: linhasAnosSemestres,
  }).config;
  verdade(variante.capacidade.poolsSala.length === 1, "a regra acrescentada declara um conjunto de salas");
  const listaVariante = construirRestricoes(variante);
  const m = manchaEm(SEMANA, SEG, H08);

  const comPLdoPool = (quantas: number): EstadoHorario => {
    const estado = novoEstado();
    for (let i = 1; i <= quantas; i++) estado.colocar(cand([ses(ucA, "PL", nomePL(i))], m));
    return estado;
  };
  provaVeto(
    listaVariante,
    "capacidade-pool-sala",
    ctxDe(comPLdoPool(CAPACIDADE_POOL), cand([ses(ucA, "PL", nomePL(CAPACIDADE_POOL + 1))], m), variante),
    `a ${CAPACIDADE_POOL + 1}.ª aula do conjunto, com capacidade ${CAPACIDADE_POOL}`,
  );
  provaAceite(
    listaVariante,
    "capacidade-pool-sala",
    ctxDe(comPLdoPool(CAPACIDADE_POOL - 1), cand([ses(ucA, "PL", nomePL(CAPACIDADE_POOL))], m), variante),
    `a ${CAPACIDADE_POOL}.ª aula do conjunto`,
  );
  provaAceite(
    restricoes,
    "capacidade-pool-sala",
    ctxDe(comPLdoPool(CAPACIDADE_POOL + 2), cand([ses(ucA, "PL", nomePL(1))], m)),
    "nas regras reais não há conjuntos de salas declarados, por isso nada é vetado",
  );

  // As aulas de um conjunto declarado fora do limite global não gastam a
  // capacidade global de PL — é o mecanismo genérico que substitui a isenção
  // que o motor antigo tinha amarrada a uma sigla literal.
  const MAX_GLOBAL = variante.capacidade.maxPLporMancha;
  const cheioComPoolIsento = novoEstado();
  for (let i = 1; i <= MAX_GLOBAL; i++) cheioComPoolIsento.colocar(cand([ses(ucA, "PL", nomePL(i))], m));
  provaAceite(
    listaVariante,
    "capacidade-pl-mancha",
    ctxDe(cheioComPoolIsento, cand([ses(ucB, "PL", nomePL(MAX_GLOBAL + 1))], m), variante),
    `mais uma PL quando as ${MAX_GLOBAL} já colocadas são de um conjunto isento do limite global`,
  );
}

// ---------------------------------------------------------------------------
// 3c. Dias permitidos para as aulas PL (regra que existe no snapshot, inativa)
// ---------------------------------------------------------------------------

seccao("dias-permitidos-pl — lista de dias em que as PL podem ocorrer");
{
  const linhaInativa = exigir(
    linhasRegras.find((r) => r.ativa === false && Array.isArray((r.config as any)?.diasPermitidos)),
    "regra de dias permitidos para PL no snapshot",
  );
  const reativada: LinhaRegra = { ...linhaInativa, ativa: true };
  const variante = carregarRegras({
    regras: linhasComMigracao.map((r) => (r.id === linhaInativa.id ? reativada : r)),
    ucs: linhasUCs,
    anosSemestres: linhasAnosSemestres,
  }).config;
  const permitidos = variante.preferencias.diasPermitidosPL;
  verdade(permitidos.length > 0, `a regra reativada permite PL em ${permitidos.join(", ")}`);
  const listaVariante = construirRestricoes(variante);
  const diaProibido = exigir(
    DIAS.find((d) => !permitidos.includes(d)),
    "dia fora dos dias permitidos para PL",
  );
  provaVeto(
    listaVariante,
    "dias-permitidos-pl",
    ctxDe(novoEstado(), cand([ses(ucA, "PL", nomePL(1))], manchaEm(SEMANA, diaProibido, H08)), variante),
    `uma PL à ${diaProibido}`,
  );
  provaAceite(
    listaVariante,
    "dias-permitidos-pl",
    ctxDe(novoEstado(), cand([ses(ucA, "PL", nomePL(1))], manchaEm(SEMANA, permitidos[0], H08)), variante),
    `uma PL à ${permitidos[0]}`,
  );
  provaAceite(
    listaVariante,
    "dias-permitidos-pl",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, diaProibido, H08)), variante),
    `uma TP à ${diaProibido} — a regra só limita as PL`,
  );
}

// ---------------------------------------------------------------------------
// 4. Máximo de TP/PL da mesma UC por mancha (bloco inteiro: A + B + outros anos)
// ---------------------------------------------------------------------------

seccao(`max-simultaneo-uc — limites por UC (TP=${LIMITE_TP}, PL=${LIMITE_PL})`);
{
  const m = manchaEm(SEMANA, SEG, H08);

  // TP: metade do bloco na família A, metade na B — o limite conta o bloco todo.
  const comTPdaFamiliaA = novoEstado();
  const tpA: SessaoCandidata[] = [];
  for (let i = 1; i <= LIMITE_TP; i++) tpA.push(ses(ucComLimiteTP, "TP", nomeTP(i)));
  comTPdaFamiliaA.colocar(cand(tpA, m, "A"));

  const tpB: SessaoCandidata[] = [];
  for (let i = 1; i <= LIMITE_TP; i++) {
    tpB.push(ses(ucComLimiteTP, "TP", nomeTP(estrutura.tpPorTurmaTeorica + i)));
  }
  provaVeto(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(comTPdaFamiliaA, cand(tpB, m, "B")),
    `${LIMITE_TP * 2} TP da mesma UC na mancha (${LIMITE_TP} na Turma A + ${LIMITE_TP} na Turma B), com o máximo em ${LIMITE_TP}`,
  );
  provaAceite(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(novoEstado(), cand(tpB, m, "B")),
    `${LIMITE_TP} TP da mesma UC na mancha`,
  );

  // PL: a (limite + 1).ª PL da mesma UC na mesma mancha.
  const comPL = novoEstado();
  for (let i = 1; i <= LIMITE_PL; i++) comPL.colocar(cand([ses(ucComLimitePL, "PL", nomePL(i))], m));
  provaVeto(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(comPL, cand([ses(ucComLimitePL, "PL", nomePL(LIMITE_PL + 1))], m)),
    `a ${LIMITE_PL + 1}.ª PL da mesma UC na mancha`,
  );

  const comPLquaseCheio = novoEstado();
  for (let i = 1; i < LIMITE_PL; i++) comPLquaseCheio.colocar(cand([ses(ucComLimitePL, "PL", nomePL(i))], m));
  provaAceite(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(comPLquaseCheio, cand([ses(ucComLimitePL, "PL", nomePL(LIMITE_PL))], m)),
    `a ${LIMITE_PL}.ª PL da mesma UC na mancha`,
  );
}

// ---------------------------------------------------------------------------
// 5. Máximo de TP por mancha (regra acrescentada: as reais não a definem)
// ---------------------------------------------------------------------------

seccao("capacidade-tp-mancha — máximo global de TP por mancha");
{
  const MAX_TP = 4;
  const regraExtra: LinhaRegra = {
    id: "teste_max_tp_por_mancha",
    ativa: true,
    config: { motor: { maxTPporMancha: MAX_TP } },
  };
  const variante = carregarRegras({
    regras: [...linhasComMigracao, regraExtra],
    ucs: linhasUCs,
    anosSemestres: linhasAnosSemestres,
  }).config;
  verdade(
    variante.capacidade.maxTPporMancha === MAX_TP,
    `a regra acrescentada fixa o máximo de TP por mancha em ${MAX_TP}`,
  );
  const listaVariante = construirRestricoes(variante);
  const m = manchaEm(SEMANA, SEG, H08);

  const encherTP = (quantas: number): EstadoHorario => {
    const estado = novoEstado();
    for (let i = 1; i <= quantas; i++) {
      const uc = ucsDoSemestre1[i % ucsDoSemestre1.length];
      estado.colocar(cand([ses(uc, "TP", nomeTP(i))], m));
    }
    return estado;
  };
  provaVeto(
    listaVariante,
    "capacidade-tp-mancha",
    ctxDe(encherTP(MAX_TP), cand([ses(ucA, "TP", nomeTP(estrutura.tpPorTurmaTeorica + 1))], m, "B"), variante),
    `a ${MAX_TP + 1}.ª TP da mancha`,
  );
  provaAceite(
    listaVariante,
    "capacidade-tp-mancha",
    ctxDe(encherTP(MAX_TP - 1), cand([ses(ucA, "TP", nomeTP(estrutura.tpPorTurmaTeorica + 1))], m, "B"), variante),
    `a ${MAX_TP}.ª TP da mancha`,
  );
  provaAceite(
    restricoes,
    "capacidade-tp-mancha",
    ctxDe(encherTP(MAX_TP + 3), cand([ses(ucA, "TP", nomeTP(estrutura.tpPorTurmaTeorica + 1))], m, "B")),
    "nas regras reais não há máximo de TP por mancha, por isso nada é vetado",
  );
}

// ---------------------------------------------------------------------------
// 6. TP e PL da mesma UC na mesma mancha
// ---------------------------------------------------------------------------

seccao("tp-pl-mesma-uc — docente partilhado entre TP e PL");
{
  // A regra está DESLIGADA na configuração real: o horário de referência do
  // coordenador junta a TP e a PL da mesma UC na mesma mancha, com docentes
  // diferentes. Prova-se as duas metades — que desligada não veta, e que ligada
  // continua a vetar exatamente o que dizia vetar.
  verdade(
    config.tpPLmesmaUC.ativo === false,
    "a configuração real deixa TP e PL da mesma UC partilhar a mancha (docentes diferentes)",
  );

  const m = manchaEm(SEMANA, SEG, H08);
  const comTP = novoEstado();
  comTP.colocar(cand([ses(ucA, "TP", nomeTP(1))], m));

  provaAceite(
    restricoes,
    "tp-pl-mesma-uc",
    ctxDe(comTP, cand([ses(ucA, "PL", nomePL(7))], m)),
    "uma PL de uma UC que já tem TP nesta mancha, com a regra desligada",
  );
  provaAceite(
    restricoes,
    "tp-pl-mesma-uc",
    ctxDe(comTP, cand([ses(ucB, "PL", nomePL(7))], m)),
    "uma PL de outra UC na mesma mancha",
  );

  const ligada: ConfiguracaoMotor = { ...config, tpPLmesmaUC: { ativo: true } };
  const listaLigada = construirRestricoes(ligada);
  provaVeto(
    listaLigada,
    "tp-pl-mesma-uc",
    ctxDe(comTP, cand([ses(ucA, "PL", nomePL(7))], m), ligada),
    "a mesma PL, com a regra ligada",
  );
  provaVeto(
    listaLigada,
    "tp-pl-mesma-uc",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1)), ses(ucA, "PL", nomePL(7))], m), ligada),
    "o próprio candidato junta TP e PL da mesma UC, com a regra ligada",
  );
}

// ---------------------------------------------------------------------------
// 7. Carga diária
// ---------------------------------------------------------------------------

const cargaDoAno = config.cargaDiaria.porAno[ANO] ?? config.cargaDiaria.transversal;
const MAX_BLOCOS = Math.floor(cargaDoAno.maxHoras / BLOCO);
const MAX_DIAS = cargaDoAno.maxDiasNoMaximoPorSemana;

seccao(`carga-diaria — teto de ${cargaDoAno.maxHoras}h/dia e ${MAX_DIAS} dia(s) no teto por semana`);
{
  const folha = nomePL(1);
  /** Horas que enchem um dia sem quebrar a pausa de almoço. */
  const horasDoDia = HORAS.filter(
    (h) => h !== (config.grelha.pausaAlmoco?.horaAntes ?? ""),
  ).slice(0, MAX_BLOCOS);

  const encherDias = (quantosDias: number, blocosNoUltimoDia: number): EstadoHorario => {
    const estado = novoEstado();
    for (let d = 0; d < quantosDias; d++) {
      for (const h of horasDoDia) {
        estado.colocar(cand([ses(ucA, "PL", folha)], manchaEm(SEMANA, DIAS[d], h)));
      }
    }
    for (let i = 0; i < blocosNoUltimoDia; i++) {
      estado.colocar(cand([ses(ucA, "PL", folha)], manchaEm(SEMANA, DIAS[quantosDias], horasDoDia[i])));
    }
    return estado;
  };

  // Teto diário.
  provaVeto(
    restricoes,
    "carga-diaria",
    ctxDe(
      encherDias(1, 0),
      cand([ses(ucB, "PL", folha)], manchaEm(SEMANA, DIAS[0], HORAS[HORAS.length - 1])),
    ),
    `o bloco ${MAX_BLOCOS + 1} do dia, com o teto em ${MAX_BLOCOS} (${cargaDoAno.maxHoras}h)`,
  );
  provaAceite(
    restricoes,
    "carga-diaria",
    ctxDe(
      encherDias(0, MAX_BLOCOS - 1),
      cand([ses(ucB, "PL", folha)], manchaEm(SEMANA, DIAS[0], horasDoDia[MAX_BLOCOS - 1])),
    ),
    `o bloco ${MAX_BLOCOS} do dia`,
  );

  // Número de dias no teto por semana.
  provaVeto(
    restricoes,
    "carga-diaria",
    ctxDe(
      encherDias(MAX_DIAS, MAX_BLOCOS - 1),
      cand([ses(ucB, "PL", folha)], manchaEm(SEMANA, DIAS[MAX_DIAS], horasDoDia[MAX_BLOCOS - 1])),
    ),
    `o dia ${MAX_DIAS + 1} a ${cargaDoAno.maxHoras}h na semana, com o máximo em ${MAX_DIAS}`,
  );
  provaAceite(
    restricoes,
    "carga-diaria",
    ctxDe(
      encherDias(MAX_DIAS - 1, MAX_BLOCOS - 1),
      cand([ses(ucB, "PL", folha)], manchaEm(SEMANA, DIAS[MAX_DIAS - 1], horasDoDia[MAX_BLOCOS - 1])),
    ),
    `o dia ${MAX_DIAS} a ${cargaDoAno.maxHoras}h na semana`,
  );
}

// ---------------------------------------------------------------------------
// 8. Pausa de almoço
// ---------------------------------------------------------------------------

const pausa = config.grelha.pausaAlmoco;
seccao(
  pausa
    ? `pausa-almoco — ${pausa.horaAntes} e ${pausa.horaDepois} são mutuamente exclusivas`
    : "pausa-almoco — sem proteção configurada",
);
if (pausa) {
  const comAntes = novoEstado();
  comAntes.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, pausa.horaAntes)));
  provaVeto(
    restricoes,
    "pausa-almoco",
    ctxDe(comAntes, cand([ses(ucB, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, pausa.horaDepois))),
    `${pausa.horaDepois} para uma turma que já tem aula às ${pausa.horaAntes}`,
  );
  const outraHora = exigir(
    HORAS.find((h) => h !== pausa.horaAntes && h !== pausa.horaDepois),
    "hora fora do par de almoço",
  );
  provaAceite(
    restricoes,
    "pausa-almoco",
    ctxDe(comAntes, cand([ses(ucB, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, outraHora))),
    `${outraHora} para a mesma turma`,
  );
} else {
  falhar("as regras reais não configuram pausa de almoço; o caso não foi provado.");
}

// ---------------------------------------------------------------------------
// 9. Precedências por UC
// ---------------------------------------------------------------------------

seccao("precedencias-uc — cronologia entre tipos de aula da mesma UC");
{
  const precTP = exigir(
    config.precedencias.find((p) => p.tipoAntes === "T" && p.tipoDepois === "TP" && p.siglas.length === 0),
    "precedência transversal T -> TP",
  );
  const m = manchaEm(SEMANA, SEG, H10);
  provaVeto(
    restricoes,
    "precedencias-uc",
    ctxDe(novoEstado(), cand([ses(ucNaSemana, "TP", nomeTP(1))], m)),
    `uma TP sem nenhuma T antes (regra ${precTP.origem})`,
  );
  const comT = novoEstado();
  comT.colocar(cand([ses(ucNaSemana, "T", nomeTeorica(0))], manchaEm(SEMANA, SEG, H08)));
  provaAceite(
    restricoes,
    "precedencias-uc",
    ctxDe(comT, cand([ses(ucNaSemana, "TP", nomeTP(1))], m)),
    "uma TP depois da primeira T da mesma UC e família",
  );

  // Precedência com mínimo maior do que um bloco.
  const precMulti = config.precedencias.find(
    (p) => p.siglas.length > 0 && Math.ceil(p.minimoAntes / (p.unidade === "horas" ? BLOCO : 1)) > 1,
  );
  if (precMulti) {
    const exigidos = Math.ceil(precMulti.minimoAntes / (precMulti.unidade === "horas" ? BLOCO : 1));
    const ucExigente = ucs.find(
      (u) => precMulti.siglas.some((s) => s.trim().toUpperCase() === u.sigla.trim().toUpperCase()),
    );
    if (ucExigente) {
      const comUmaT = novoEstado();
      comUmaT.colocar(cand([ses(ucExigente, precMulti.tipoAntes, nomeTeorica(0))], manchaEm(SEMANA, SEG, H08)));
      provaVeto(
        restricoes,
        "precedencias-uc",
        ctxDe(comUmaT, cand([ses(ucExigente, precMulti.tipoDepois, nomeTP(1))], m)),
        `1 bloco de ${precMulti.tipoAntes} quando a regra ${precMulti.origem} exige ${exigidos}`,
      );
      const comTodas = novoEstado();
      for (let i = 0; i < exigidos; i++) {
        comTodas.colocar(
          cand([ses(ucExigente, precMulti.tipoAntes, nomeTeorica(0))], manchaEm(SEMANA, DIAS[i], H08)),
        );
      }
      provaAceite(
        restricoes,
        "precedencias-uc",
        ctxDe(comTodas, cand([ses(ucExigente, precMulti.tipoDepois, nomeTP(1))], manchaEm(SEMANA, DIAS[exigidos], H10))),
        `${exigidos} blocos de ${precMulti.tipoAntes} antes da ${precMulti.tipoDepois}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 9b. Rácio proporcional TP -> PL (Fase 6B)
// ---------------------------------------------------------------------------

seccao("racio-tp-pl — rácio proporcional TP -> PL, contínuo ao longo do semestre");
{
  const ucComRacio = exigir(
    ucsDoSemestre1.find((u) => (u.cargaHorariaTP ?? 0) > 0 && (u.cargaHorariaPratica ?? 0) > 0),
    "UC do 1.º semestre com TP e PL",
  );
  const ucSemPL = ucsDoSemestre1.find((u) => (u.cargaHorariaPratica ?? 0) === 0 && (u.cargaHorariaTP ?? 0) > 0);
  const ucSemTP = ucsDoSemestre1.find((u) => (u.cargaHorariaTP ?? 0) === 0 && (u.cargaHorariaPratica ?? 0) > 0);

  const nTPporFamilia = estrutura.tpPorTurmaTeorica;
  const nPLporFamilia = nTPporFamilia * estrutura.plPorTP;
  const blocosTPporTurma = Math.floor(ucComRacio.cargaHorariaTP! / BLOCO);
  const blocosPLporTurma = Math.floor(ucComRacio.cargaHorariaPratica! / BLOCO);
  const TP_TOTAL = nTPporFamilia * blocosTPporTurma;
  const PL_TOTAL = nPLporFamilia * blocosPLporTurma;
  verdade(
    TP_TOTAL > 0 && PL_TOTAL > 0,
    `a UC escolhida tem TP e PL totais por família > 0 (TP=${TP_TOTAL}, PL=${PL_TOTAL} blocos)`,
  );

  // O default do esquema tem o rácio DESLIGADO enquanto o alocador não planear as
  // semanas por ordem cronológica (ver nota em `configuracaoPadrao`). Estes casos
  // provam a restrição em si, por isso ligam-na explicitamente em vez de dependerem
  // do default — um teste que depende de um default deixa de provar o que diz provar.
  const configRacioAtivo: ConfiguracaoMotor = { ...config, racioTPPL: { ativo: true, tolerancia: 0 } };
  const restricoesRacio = construirRestricoes(configRacioAtivo);

  /**
   * Coloca `quantos` blocos soltos de um tipo, para uma UC/família, todos
   * NUMA SEMANA ANTERIOR à semana de teste (`SEMANA`) — o rácio conta pela
   * ordem cronológica do calendário, não pela ordem em que os blocos são
   * colocados aqui, por isso têm de ficar comprovadamente "antes".
   */
  const colocarBlocos = (
    estado: EstadoHorario,
    uc: UC,
    tipo: "TP" | "PL",
    quantos: number,
    familia: "A" | "B" = "A",
  ): void => {
    const turma = tipo === "TP" ? nomeTP(1) : nomePL(1);
    for (let i = 0; i < quantos; i++) {
      estado.colocar(
        cand([ses(uc, tipo, turma)], manchaEm(SEMANA - 1, DIAS[i % DIAS.length], HORAS[i % HORAS.length]), familia),
      );
    }
  };

  // 1) Sem nenhuma TP colocada, a primeira PL é vetada — 0% de TP não sustenta PL nenhuma.
  const semTP = novoEstado();
  const candPL = cand([ses(ucComRacio, "PL", nomePL(1))], manchaEm(SEMANA, SEG, H08));
  provaVeto(
    restricoesRacio,
    "racio-tp-pl",
    ctxDe(semTP, candPL, configRacioAtivo),
    "a primeira PL de uma UC com TP e PL, sem nenhuma TP colocada",
  );
  const motivoSemTP = achar(restricoesRacio, "racio-tp-pl").verificar!(ctxDe(semTP, candPL, configRacioAtivo));
  verdade(
    !!motivoSemTP && /\d+% das TP dadas/.test(motivoSemTP) && /PL a \d+%/.test(motivoSemTP),
    `a mensagem de veto indica as percentagens concretas (${motivoSemTP})`,
  );

  // 2) A mesma PL, depois de colocadas TP suficientes (100% das TP da família), é aceite.
  const comTodasAsTP = novoEstado();
  colocarBlocos(comTodasAsTP, ucComRacio, "TP", TP_TOTAL);
  provaAceite(
    restricoesRacio,
    "racio-tp-pl",
    ctxDe(comTodasAsTP, candPL, configRacioAtivo),
    `a mesma PL depois de colocadas as ${TP_TOTAL} TP da família (100%)`,
  );

  // 3) UC sem PL declarada: isenta, mesmo sem nenhuma TP colocada.
  if (ucSemPL) {
    provaAceite(
      restricoesRacio,
      "racio-tp-pl",
      ctxDe(novoEstado(), cand([ses(ucSemPL, "PL", nomePL(1))], manchaEm(SEMANA, SEG, H08)), configRacioAtivo),
      "uma PL de uma UC sem PL declarada (carga de PL = 0h) — isenta, não há rácio a verificar",
    );
  } else {
    falhar("nenhuma UC do 1.º semestre sem PL para provar a isenção; o caso não foi provado.");
  }

  // 3b) UC sem TP declarada: a mesma guarda isenta também este lado.
  if (ucSemTP) {
    provaAceite(
      restricoesRacio,
      "racio-tp-pl",
      ctxDe(novoEstado(), cand([ses(ucSemTP, "PL", nomePL(1))], manchaEm(SEMANA, SEG, H08)), configRacioAtivo),
      "uma PL de uma UC sem TP declarada (carga de TP = 0h) — isenta, não há rácio a verificar",
    );
  }

  // 4) `ativo: false` não veta nada, nem no caso mais extremo (0% de TP).
  const inativo: ConfiguracaoMotor = { ...config, racioTPPL: { ativo: false, tolerancia: 0 } };
  const listaInativa = construirRestricoes(inativo);
  provaAceite(
    listaInativa,
    "racio-tp-pl",
    ctxDe(semTP, candPL, inativo),
    "a mesma PL sem nenhuma TP colocada, com a restrição desativada (`ativo: false`)",
  );

  // 5) `tolerancia: 0.1` aceita um desvio de até 10% entre as percentagens.
  const DESVIO_DENTRO_DA_TOLERANCIA = Math.max(1, Math.floor(PL_TOTAL * 0.05)); // ~5% de desvio, dentro dos 10%
  const comQuasePLdentroDaTolerancia = novoEstado();
  colocarBlocos(comQuasePLdentroDaTolerancia, ucComRacio, "PL", DESVIO_DENTRO_DA_TOLERANCIA - 1);
  const candUltimaPL = cand([ses(ucComRacio, "PL", nomePL(2))], manchaEm(SEMANA, SEG, H10));
  const pctDesvio = Math.round((DESVIO_DENTRO_DA_TOLERANCIA / PL_TOTAL) * 100);

  provaVeto(
    restricoesRacio,
    "racio-tp-pl",
    ctxDe(comQuasePLdentroDaTolerancia, candUltimaPL, configRacioAtivo),
    `${DESVIO_DENTRO_DA_TOLERANCIA} PL (${pctDesvio}% de ${PL_TOTAL}) sem nenhuma TP, com rácio estrito (tolerância 0)`,
  );

  const tolerante: ConfiguracaoMotor = { ...config, racioTPPL: { ativo: true, tolerancia: 0.1 } };
  const listaTolerante = construirRestricoes(tolerante);
  provaAceite(
    listaTolerante,
    "racio-tp-pl",
    ctxDe(comQuasePLdentroDaTolerancia, candUltimaPL, tolerante),
    `o mesmo desvio de ${pctDesvio}%, dentro da tolerância de 10%`,
  );
}

// ---------------------------------------------------------------------------
// 10. Restrições genéricas por UC
// ---------------------------------------------------------------------------

seccao("restricoes-uc — dias, períodos, tipos e semanas proibidos");
{
  const regra = exigir(
    config.restricoesUC.find(
      (r) => r.siglas.length > 0 && r.diasProibidos.length > 0 && r.semanasRestritas.length > 0,
    ),
    "restrição por UC com siglas, dias e semanas",
  );
  const semanaProibida = regra.semanasRestritas[0];
  const diaProibido = regra.diasProibidos[0];
  const diaLivre = exigir(
    DIAS.find((d) => !regra.diasProibidos.includes(d)),
    "dia fora dos dias proibidos",
  );
  const tipo = (regra.tipos[0] ?? "PL") as SessaoCandidata["tipo"];
  const ucAbrangida = exigir(
    ucs.find(
      (u) =>
        regra.siglas.some((s) => s.trim().toUpperCase() === u.sigla.trim().toUpperCase()) &&
        u.semestre === 1 &&
        (u.semanaInicio ?? 1) <= semanaProibida &&
        (u.semanaFim ?? 99) >= semanaProibida,
    ),
    "UC abrangida pela restrição e ativa na semana restrita",
  );
  const turma = tipo === "PL" ? nomePL(1) : tipo === "TP" ? nomeTP(1) : nomeTeorica(0);
  provaVeto(
    restricoes,
    "restricoes-uc",
    ctxDe(novoEstado(), cand([ses(ucAbrangida, tipo, turma)], manchaEm(semanaProibida, diaProibido, H08))),
    `${tipo} à ${diaProibido} na semana ${semanaProibida} (regra ${regra.origem})`,
  );
  provaAceite(
    restricoes,
    "restricoes-uc",
    ctxDe(novoEstado(), cand([ses(ucAbrangida, tipo, turma)], manchaEm(semanaProibida, diaLivre, H08))),
    `${tipo} à ${diaLivre} na mesma semana`,
  );

  // Quando a regra indica dia E período, a proibição é a INTERSEÇÃO dos dois —
  // a interpretação preservada do motor antigo. As regras reais só cruzam dia e
  // período numa semana que outra regra bloqueia por inteiro, pelo que a prova
  // usa uma regra acrescentada, numa semana livre.
  const diaCruzado = DIAS[2];
  const regraCruzada: LinhaRegra = {
    id: "teste_dia_e_periodo",
    ativa: true,
    config: {
      anos: [ANO],
      motor: {
        restricoesUC: [
          {
            siglas: [ucA.sigla],
            tipos: ["TP"],
            diasProibidos: [diaCruzado],
            periodosProibidos: ["tarde"],
            semanasRestritas: [SEMANA],
          },
        ],
      },
    },
  };
  const variante = carregarRegras({
    regras: [...linhasComMigracao, regraCruzada],
    ucs: linhasUCs,
    anosSemestres: linhasAnosSemestres,
  }).config;
  const listaVariante = construirRestricoes(variante);
  const horaTarde = exigir(
    HORAS.find((h) => Number(h.slice(0, 2)) >= config.grelha.limiarTardeHora),
    "hora de tarde",
  );
  const horaManha = exigir(
    HORAS.find((h) => Number(h.slice(0, 2)) < config.grelha.limiarTardeHora),
    "hora de manhã",
  );
  provaVeto(
    listaVariante,
    "restricoes-uc",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, diaCruzado, horaTarde)), variante),
    `${diaCruzado} de tarde, na interseção de dia e período proibidos`,
  );
  provaAceite(
    listaVariante,
    "restricoes-uc",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, diaCruzado, horaManha)), variante),
    `${diaCruzado} de manhã — o dia está na regra mas o período não`,
  );
  provaAceite(
    listaVariante,
    "restricoes-uc",
    ctxDe(novoEstado(), cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, DIAS[0], horaTarde)), variante),
    `${DIAS[0]} de tarde — o período está na regra mas o dia não`,
  );
}

// ---------------------------------------------------------------------------
// 11. Conflitos entre UCs (regra acrescentada: as reais não definem nenhum)
// ---------------------------------------------------------------------------

seccao("conflitos-uc — pares de UCs que não partilham mancha");
{
  const regraExtra: LinhaRegra = {
    id: "teste_conflito_ucs",
    ativa: true,
    config: { motor: { conflitosUC: [{ siglaA: ucA.sigla, siglaB: ucB.sigla, motivo: "docente comum (teste)" }] } },
  };
  const variante = carregarRegras({
    regras: [...linhasComMigracao, regraExtra],
    ucs: linhasUCs,
    anosSemestres: linhasAnosSemestres,
  }).config;
  verdade(variante.conflitosUC.length === 1, "a regra acrescentada declara um par de UCs em conflito");
  const listaVariante = construirRestricoes(variante);
  const m = manchaEm(SEMANA, SEG, H08);
  const comA = novoEstado();
  comA.colocar(cand([ses(ucA, "TP", nomeTP(1))], m));

  provaVeto(
    listaVariante,
    "conflitos-uc",
    ctxDe(comA, cand([ses(ucB, "TP", nomeTP(2))], m), variante),
    "duas UCs declaradas em conflito na mesma mancha",
  );
  provaAceite(
    listaVariante,
    "conflitos-uc",
    ctxDe(comA, cand([ses(ucC, "TP", nomeTP(2))], m), variante),
    "uma terceira UC, fora do conflito, na mesma mancha",
  );
  provaAceite(
    restricoes,
    "conflitos-uc",
    ctxDe(comA, cand([ses(ucB, "TP", nomeTP(2))], m)),
    "o mesmo par com as regras reais, que não declaram conflitos",
  );
}

// ---------------------------------------------------------------------------
// 12. Janela letiva da UC
// ---------------------------------------------------------------------------

seccao("janela-letiva-uc — semestre, semanas da UC e semanas de PL");
{
  const ucComFim = exigir(
    ucsDoSemestre1.find((u) => typeof u.semanaFim === "number" && u.semanaFim < config.calendario.semanasPorSemestre),
    "UC do 1.º semestre que termina antes do fim do semestre",
  );
  provaVeto(
    restricoes,
    "janela-letiva-uc",
    ctxDe(novoEstado(), cand([ses(ucComFim, "T", nomeTeorica(0))], manchaEm(ucComFim.semanaFim! + 1, SEG, H08))),
    `uma aula na semana ${ucComFim.semanaFim! + 1} de uma UC que termina na ${ucComFim.semanaFim}`,
  );
  provaAceite(
    restricoes,
    "janela-letiva-uc",
    ctxDe(novoEstado(), cand([ses(ucComFim, "T", nomeTeorica(0))], manchaEm(ucComFim.semanaFim!, SEG, H08))),
    `uma aula na última semana (${ucComFim.semanaFim}) dessa UC`,
  );

  const ucComSemanasPL = ucs.find((u) => u.semanasPL && u.semanasPL.length > 0);
  if (ucComSemanasPL) {
    const fronteira = config.calendario.fronteiraSemestre;
    const paraGlobal = (rel: number) => (ucComSemanasPL.semestre === 1 ? rel : fronteira + rel);
    const permitida = ucComSemanasPL.semanasPL!.find(
      (w) => w >= (ucComSemanasPL.semanaInicio ?? 1) && w <= (ucComSemanasPL.semanaFim ?? 99),
    );
    const proibida = [...Array(config.calendario.semanasPorSemestre).keys()]
      .map((i) => i + 1)
      .find(
        (w) =>
          !ucComSemanasPL.semanasPL!.includes(w) &&
          w >= (ucComSemanasPL.semanaInicio ?? 1) &&
          w <= (ucComSemanasPL.semanaFim ?? 99),
      );
    if (permitida !== undefined && proibida !== undefined) {
      provaVeto(
        restricoes,
        "janela-letiva-uc",
        ctxDe(novoEstado(), cand([ses(ucComSemanasPL, "PL", nomePL(1))], manchaEm(paraGlobal(proibida), SEG, H08))),
        `uma PL na semana ${proibida}, fora das semanas de PL da UC`,
      );
      provaAceite(
        restricoes,
        "janela-letiva-uc",
        ctxDe(novoEstado(), cand([ses(ucComSemanasPL, "PL", nomePL(1))], manchaEm(paraGlobal(permitida), SEG, H08))),
        `uma PL na semana ${permitida}, dentro das semanas de PL da UC`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 13. Janela do calendário
// ---------------------------------------------------------------------------

seccao("janela-calendario — última semana letiva e semanas de pausa");
{
  const max = config.calendario.semanaMaximaGlobal;
  if (max !== null) {
    provaVeto(
      restricoes,
      "janela-calendario",
      ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(max + 1, SEG, H08))),
      `a semana ${max + 1}, além da última semana letiva (${max})`,
    );
  }
  provaAceite(
    restricoes,
    "janela-calendario",
    ctxDe(novoEstado(), cand([ses(ucA, "T", nomeTeorica(0))], manchaEm(SEMANA, SEG, H08))),
    `a semana ${SEMANA}, dentro do calendário`,
  );
}

// ---------------------------------------------------------------------------
// 14. A REGRA GERAL de composição de blocos
// ---------------------------------------------------------------------------

seccao("formas — as composições que os limites permitem, e as que eliminam");

const limitesComposicao = limitesDaComposicao(config);
const custosForma = custosDeForma(config);
const formasDoMotor = formasPossiveis(estrutura, limitesComposicao, custosForma);

/** Materializa uma forma com UCs concretas, uma por grupo. */
function sessoesDaForma(f: FormaBloco): SessaoCandidata[] {
  const saida: SessaoCandidata[] = [];
  let ucIdx = 0;
  let tpIdx = 1;
  let plIdx = 1;
  for (let i = 0; i < f.t; i++) saida.push(ses(ucsDoSemestre1[ucIdx++], "T", nomeTeorica(i)));
  for (const quantas of f.tp) {
    const uc = ucsDoSemestre1[ucIdx++];
    for (let i = 0; i < quantas; i++) saida.push(ses(uc, "TP", nomeTP(tpIdx++)));
  }
  for (const quantas of f.pl) {
    const uc = ucsDoSemestre1[ucIdx++];
    for (let i = 0; i < quantas; i++) saida.push(ses(uc, "PL", nomePL(plIdx++)));
  }
  return saida;
}

const FOLHAS_100 = estrutura.tpPorTurmaTeorica * estrutura.plPorTP;

verdade(
  limitesComposicao.maxTPporUC === 2 && limitesComposicao.maxPLporUC === 3,
  `os limites universais em vigor são 2 TP e 3 PL por UC (obteve ${limitesComposicao.maxTPporUC} e ${limitesComposicao.maxPLporUC})`,
);

console.log(`  formas derivadas dos limites: ${formasDoMotor.map((f) => f.id).join(", ")}`);

// Toda a forma derivada fecha o bloco a 100% e cabe nos limites.
for (const f of formasDoMotor) {
  const sessoes = sessoesDaForma(f);
  const cobertura = coberturaFolhas(sessoes, estrutura);
  verdade(cobertura === FOLHAS_100, `a forma ${f.id} cobre ${cobertura} folhas-aluno (100% = ${FOLHAS_100})`);
  verdade(
    f.tp.every((n) => n <= limitesComposicao.maxTPporUC) &&
      f.pl.every((n) => n <= limitesComposicao.maxPLporUC),
    `a forma ${f.id} cabe nos limites de ${limitesComposicao.maxTPporUC} TP e ${limitesComposicao.maxPLporUC} PL por UC`,
  );
  verdade(formaDe(sessoes, ucPorId) === f.id, `formaDe reconhece ${f.id}`);
}

// O que a regra geral ELIMINA por aritmética.
for (const proibida of ["TP4", "TP2+PL6", "TP3+PL3"]) {
  verdade(
    !formasDoMotor.some((f) => f.id === proibida),
    `a forma ${proibida} deixou de existir: os limites tornam-na impossível`,
  );
}

// O que a regra geral PASSA A PERMITIR e a lista antiga não enumerava.
for (const nova of ["TP2+TP1+TP1", "TP1+TP1+TP1+TP1", "TP2+TP1+PL3"]) {
  verdade(
    formasDoMotor.some((f) => f.id === nova),
    `a forma ${nova} passa a existir: fecha as folhas dentro dos limites`,
  );
}

{
  // As restrições duras são quem PROÍBE — não uma lista de padrões.
  const tresTP = [1, 2, 3].map((n) => ses(ucA, "TP", nomeTP(n)));
  provaVeto(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(novoEstado(), cand(tresTP, manchaEm(SEMANA, SEG, H08))),
    "3 TP da mesma UC no mesmo bloco",
  );
  const quatroPL = [1, 2, 3, 4].map((n) => ses(ucA, "PL", nomePL(n)));
  provaVeto(
    restricoes,
    "max-simultaneo-uc",
    ctxDe(novoEstado(), cand(quatroPL, manchaEm(SEMANA, SEG, H08))),
    "4 PL da mesma UC no mesmo bloco",
  );

  verdade(formaDe([ses(ucA, "TP", nomeTP(1)), ses(ucA, "PL", nomePL(7))], ucPorId) === null,
    "formaDe devolve null para TP e PL da mesma UC");
  verdade(formaDe([ses(ucA, "S", nomeTP(1))], ucPorId) === null, "formaDe devolve null para um seminário");

  // O corte antecipado de composições parciais (o que era `prefixoValido`).
  verdade(
    podeCompletarBloco([ses(ucA, "TP", nomeTP(1)), ses(ucA, "TP", nomeTP(2))], ucPorId, formasDoMotor),
    "podeCompletarBloco aceita 2 TP da mesma UC como princípio de um bloco",
  );
  verdade(
    !podeCompletarBloco(
      [1, 2, 3].map((n) => ses(ucA, "TP", nomeTP(n))),
      ucPorId,
      formasDoMotor,
    ),
    "podeCompletarBloco recusa 3 TP da mesma UC — nenhuma forma as comporta",
  );
  verdade(
    podeCompletarBloco([ses(ucA, "TP", nomeTP(1)), ses(ucB, "TP", nomeTP(2))], ucPorId, formasDoMotor),
    "podeCompletarBloco aceita 1 TP de cada uma de duas UCs",
  );
}

// ---------------------------------------------------------------------------
// 14b. Ritmo das TP, maratonas e precedência escalonada
// ---------------------------------------------------------------------------

seccao("ritmo-tp / maratona-uc / precedencia-escalonada-pl — as regras novas");
{
  // -------------------------------------------------------------------------
  // Ritmo: o desvio mede-se em SEMANAS de atraso entre aulas HOMÓLOGAS — a
  // n-ésima aula de uma turma face à n-ésima da outra.
  // -------------------------------------------------------------------------
  verdade(
    config.ritmoTP.unidade === "semanas",
    `o ritmo das TP mede-se em ${config.ritmoTP.unidade} (máximo ${config.ritmoTP.maxDesvioSemanas})`,
  );
  const atrasoMax = config.ritmoTP.maxDesvioSemanas;

  const primeiraTPdada = novoEstado();
  primeiraTPdada.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, H08)));

  provaAceite(
    restricoes,
    "ritmo-tp",
    ctxDe(primeiraTPdada, cand([ses(ucA, "TP", nomeTP(2))], manchaEm(SEMANA + atrasoMax, SEG, H08))),
    `a 1.ª TP da segunda turma ${atrasoMax} semana(s) depois da 1.ª da primeira`,
  );
  provaVeto(
    restricoes,
    "ritmo-tp",
    ctxDe(primeiraTPdada, cand([ses(ucA, "TP", nomeTP(2))], manchaEm(SEMANA + atrasoMax + 1, SEG, H08))),
    `a 1.ª TP da segunda turma ${atrasoMax + 1} semanas depois da 1.ª da primeira`,
  );
  provaAceite(
    restricoes,
    "ritmo-tp",
    ctxDe(primeiraTPdada, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, TER, H08))),
    "a 2.ª TP da mesma turma na mesma semana — em semanas, não é desfasamento",
  );

  // -------------------------------------------------------------------------
  // Maratona: dois tetos — a corrida contígua e o total do dia.
  // -------------------------------------------------------------------------
  const maxSeguidos = config.maratonaUC.maxBlocosSeguidosMesmaUC;
  const maxPorDia = config.maratonaUC.maxBlocosMesmaUCporDia;
  verdade(
    HORAS.length > maxSeguidos && HORAS.length > maxPorDia,
    `a grelha tem ${HORAS.length} horas, suficientes para exercitar os tetos de ${maxSeguidos} seguidos e ${maxPorDia} por dia`,
  );

  // A corrida no limite: `maxSeguidos - 1` já colocados, o candidato fecha-a.
  const noLimiteDaCorrida = novoEstado();
  for (let i = 0; i < maxSeguidos - 1; i++) {
    noLimiteDaCorrida.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[i])));
  }
  provaAceite(
    restricoes,
    "maratona-uc",
    ctxDe(noLimiteDaCorrida, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[maxSeguidos - 1]))),
    `o ${maxSeguidos}.º bloco seguido da mesma UC no mesmo dia (o limite, ainda permitido)`,
  );

  // Um bloco acima da corrida.
  const acimaDaCorrida = novoEstado();
  for (let i = 0; i < maxSeguidos; i++) {
    acimaDaCorrida.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[i])));
  }
  provaVeto(
    restricoes,
    "maratona-uc",
    ctxDe(acimaDaCorrida, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[maxSeguidos]))),
    `o ${maxSeguidos + 1}.º bloco seguido da mesma UC no mesmo dia`,
  );
  provaAceite(
    restricoes,
    "maratona-uc",
    ctxDe(acimaDaCorrida, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, TER, H08))),
    "o mesmo bloco, mas noutro dia",
  );

  // O teto do DIA, com um intervalo pelo meio para que a corrida não dispare:
  // é o caso das 8h da mesma UC (seguidas de manhã, mais uma à tarde).
  if (HORAS.length > maxPorDia + 1) {
    const comIntervalo = novoEstado();
    for (let i = 0; i < maxPorDia; i++) {
      comIntervalo.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[i])));
    }
    provaVeto(
      restricoes,
      "maratona-uc",
      ctxDe(comIntervalo, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, HORAS[HORAS.length - 1]))),
      `o ${maxPorDia + 1}.º bloco da mesma UC no mesmo dia, depois de um intervalo`,
    );
  } else {
    falhar("a grelha não tem horas suficientes para separar o teto do dia do teto da corrida.");
  }

  // -------------------------------------------------------------------------
  // Precedência escalonada: a tabela por UC. A UC é escolhida por PROPRIEDADE —
  // é a que tem tabela declarada nas regras reais — nunca por sigla.
  // -------------------------------------------------------------------------
  const siglasComTabela = new Set(config.precedenciasEscalonadas.flatMap((p) => p.siglas.map(normalizarSigla)));
  const ucComTabela = ucs.find((u) => siglasComTabela.has(normalizarSigla(u.sigla)));
  if (!ucComTabela) {
    falhar("nenhuma UC do snapshot tem tabela de precedência escalonada; a regra ficou sem prova.");
  } else {
    const tabela = config.precedenciasEscalonadas.find((p) =>
      p.siglas.map(normalizarSigla).includes(normalizarSigla(ucComTabela.sigla)),
    )!;
    const primeiroEscalao = tabela.escaloes[0];
    verdade(
      primeiroEscalao.minimoT > 0 || primeiroEscalao.minimoTP > 0,
      `o 1.º escalão da tabela exige ${primeiroEscalao.minimoT} T e ${primeiroEscalao.minimoTP} TP antes da ` +
        `${primeiroEscalao.ateNesimaPL}.ª PL`,
    );

    // A 1.ª PL do desdobramento sem nada dado antes.
    provaVeto(
      restricoes,
      "precedencia-escalonada-pl",
      ctxDe(novoEstado(), cand([ses(ucComTabela, "PL", nomePL(1))], manchaEm(SEMANA, TER, H12))),
      "a 1.ª PL de um desdobramento sem nenhuma T nem TP dadas antes",
    );

    // O mesmo, com a tabela satisfeita: as T da família e as TP do desdobramento
    // colocadas em semanas anteriores.
    const comPreRequisitos = novoEstado();
    for (let i = 0; i < primeiroEscalao.minimoT; i++) {
      comPreRequisitos.colocar(
        cand([ses(ucComTabela, "T", nomeTeorica(0))], manchaEm(SEMANA - 1, DIAS[i % DIAS.length], H08)),
      );
    }
    for (let i = 0; i < primeiroEscalao.minimoTP; i++) {
      comPreRequisitos.colocar(
        cand([ses(ucComTabela, "TP", nomeTP(1))], manchaEm(SEMANA - 1, DIAS[i % DIAS.length], H10)),
      );
    }
    provaAceite(
      restricoes,
      "precedencia-escalonada-pl",
      ctxDe(comPreRequisitos, cand([ses(ucComTabela, "PL", nomePL(1))], manchaEm(SEMANA, TER, H12))),
      `a 1.ª PL do mesmo desdobramento com ${primeiroEscalao.minimoT} T e ${primeiroEscalao.minimoTP} TP dadas antes`,
    );

    // A verificação é sobre a SEQUÊNCIA INTEIRA: uma PL colocada numa semana
    // ANTERIOR às que já lá estão empurra a ordem de todas elas um degrau acima,
    // e é isso que tem de ser apanhado no momento da decisão.
    const segundoEscalao = tabela.escaloes[1];
    if (segundoEscalao && segundoEscalao.minimoT > primeiroEscalao.minimoT) {
      const comSequencia = novoEstado();
      for (let i = 0; i < primeiroEscalao.minimoT; i++) {
        comSequencia.colocar(
          cand([ses(ucComTabela, "T", nomeTeorica(0))], manchaEm(SEMANA - 2, DIAS[i % DIAS.length], H08)),
        );
      }
      for (let i = 0; i < Math.max(primeiroEscalao.minimoTP, segundoEscalao.minimoTP); i++) {
        comSequencia.colocar(
          cand([ses(ucComTabela, "TP", nomeTP(1))], manchaEm(SEMANA - 2, DIAS[i % DIAS.length], H10)),
        );
      }
      // Tantas PL quantas o 1.º escalão cobre, todas em semanas POSTERIORES.
      for (let i = 0; i < primeiroEscalao.ateNesimaPL; i++) {
        comSequencia.colocar(
          cand([ses(ucComTabela, "PL", nomePL(1))], manchaEm(SEMANA + 2, DIAS[i % DIAS.length], H12)),
        );
      }
      provaVeto(
        restricoes,
        "precedencia-escalonada-pl",
        ctxDe(comSequencia, cand([ses(ucComTabela, "PL", nomePL(1))], manchaEm(SEMANA, TER, H12))),
        `uma PL numa semana anterior, que empurra as ${primeiroEscalao.ateNesimaPL} seguintes para o escalão de ` +
          `${segundoEscalao.minimoT} T`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 15. Custos soft
// ---------------------------------------------------------------------------

seccao("custos soft — a ordem entre as preferências");
{
  const m = manchaEm(SEMANA, SEG, H08);
  const estadoVazio = novoEstado();

  // Hierarquia de FORMAS: a mais fragmentada custa mais do que a preferida, e a
  // que não leva práticas custa mais do que a que leva duas.
  const formaPreferida = formasDoMotor.find((f) => f.id === "TP2+PL3+PL3")!;
  const formaFragmentada = formasDoMotor.find((f) => f.id === "TP1+TP1+TP1+TP1")!;
  const formaSoTP = formasDoMotor.find((f) => f.id === "TP2+TP2")!;
  const ctxFragmentada = ctxDe(estadoVazio, cand(sessoesDaForma(formaFragmentada), m));
  const ctxPreferida = ctxDe(estadoVazio, cand(sessoesDaForma(formaPreferida), m));
  const ctxSoTP = ctxDe(estadoVazio, cand(sessoesDaForma(formaSoTP), m));
  provaCusto(restricoes, "forma-bloco", ctxFragmentada, ctxPreferida, "TP1+TP1+TP1+TP1 face a TP2+PL3+PL3");
  provaCusto(restricoes, "forma-bloco", ctxFragmentada, ctxSoTP, "TP1+TP1+TP1+TP1 face a TP2+TP2");
  verdade(
    custoTotal(restricoes, ctxFragmentada) > custoTotal(restricoes, ctxPreferida),
    "o custo TOTAL da forma mais fragmentada é maior do que o da forma preferida",
  );

  // Equilíbrio semanal: a semana já carregada custa mais do que a vazia.
  const desequilibrado = novoEstado();
  for (let i = 0; i < 4; i++) {
    desequilibrado.colocar(cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, DIAS[i], H08)));
  }
  provaCusto(
    restricoes,
    "equilibrio-semanal",
    ctxDe(desequilibrado, cand([ses(ucB, "TP", nomeTP(2))], manchaEm(SEMANA, DIAS[4], H10))),
    ctxDe(desequilibrado, cand([ses(ucB, "TP", nomeTP(2))], manchaEm(SEMANA + 1, DIAS[4], H10))),
    "acrescentar à semana carregada face a uma semana vazia",
  );
  verdade(
    achar(restricoes, "equilibrio-semanal").custo!(
      ctxDe(desequilibrado, cand([ses(ucB, "TP", nomeTP(2))], manchaEm(SEMANA, DIAS[4], H10))),
    ) >
      custoTotal(restricoes, ctxFragmentada),
    "o equilíbrio semanal domina o custo de qualquer padrão",
  );

  // Turno da família.
  const familiaManha = config.turnos.familiaDeManhaPorSemestre[1];
  if (familiaManha) {
    const horaManha = exigir(
      HORAS.find((h) => Number(h.slice(0, 2)) < config.grelha.limiarTardeHora),
      "hora de manhã",
    );
    const horaTarde = exigir(
      HORAS.find((h) => Number(h.slice(0, 2)) >= config.grelha.limiarTardeHora),
      "hora de tarde",
    );
    provaCusto(
      restricoes,
      "turno-familia",
      ctxDe(estadoVazio, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, horaTarde), familiaManha)),
      ctxDe(estadoVazio, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, horaManha), familiaManha)),
      `a família ${familiaManha} de tarde face a de manhã, no 1.º semestre`,
    );
  }

  // Último dia útil livre.
  provaCusto(
    restricoes,
    "ultimo-dia-livre",
    ctxDe(estadoVazio, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, DIAS[DIAS.length - 1], H08))),
    ctxDe(estadoVazio, cand([ses(ucA, "TP", nomeTP(1))], manchaEm(SEMANA, DIAS[0], H08))),
    `um bloco à ${DIAS[DIAS.length - 1]} face ao mesmo bloco à ${DIAS[0]}`,
  );

  // Dias longos.
  const alvoBlocos = Math.floor(cargaDoAno.alvoHoras / BLOCO);
  const diaComprido = novoEstado();
  for (let i = 0; i < alvoBlocos; i++) {
    diaComprido.colocar(cand([ses(ucA, "PL", nomePL(1))], manchaEm(SEMANA, SEG, HORAS[i])));
  }
  const diaCurto = novoEstado();
  for (let i = 0; i < alvoBlocos - 1; i++) {
    diaCurto.colocar(cand([ses(ucA, "PL", nomePL(1))], manchaEm(SEMANA, SEG, HORAS[i])));
  }
  provaCusto(
    restricoes,
    "dia-acima-do-alvo",
    ctxDe(diaComprido, cand([ses(ucB, "PL", nomePL(1))], manchaEm(SEMANA, SEG, HORAS[HORAS.length - 1]))),
    ctxDe(diaCurto, cand([ses(ucB, "PL", nomePL(1))], manchaEm(SEMANA, SEG, HORAS[HORAS.length - 1]))),
    `passar dos ${cargaDoAno.alvoHoras}h-alvo face a ficar neles`,
  );
}

// ---------------------------------------------------------------------------
// 16. Avaliação conjunta
// ---------------------------------------------------------------------------

seccao("primeiraViolacao — avaliação conjunta de todas as restrições hard");
{
  const legitimo = ctxDe(
    novoEstado(),
    cand([ses(ucNaSemana, "T", nomeTeorica(0))], manchaEm(SEMANA, SEG, H08)),
  );
  const motivoLegitimo = primeiraViolacao(restricoes, legitimo);
  verdade(motivoLegitimo === null, `um bloco T legítimo passa todas as restrições (${motivoLegitimo ?? "sem violações"})`);

  const semT = ctxDe(novoEstado(), cand([ses(ucNaSemana, "TP", nomeTP(1))], manchaEm(SEMANA, SEG, H08)));
  const motivoSemT = primeiraViolacao(restricoes, semT);
  verdade(
    motivoSemT !== null && motivoSemT.includes("precedencias-uc"),
    `uma TP sem T antes é recusada pela precedência (${motivoSemT ?? "não foi recusada"})`,
  );
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

seccao("RESUMO POR RESTRIÇÃO");
for (const r of restricoes) {
  const l = ledger.get(r.id)!;
  const prova =
    r.tipo === "hard"
      ? `${l.vetos} veto(s) / ${l.aceites} aceitação(ões)`
      : `${l.discriminacoes} comparação(ões) de custo`;
  const coberta = r.tipo === "hard" ? l.vetos > 0 && l.aceites > 0 : l.discriminacoes > 0;
  if (!coberta) falhas++;
  console.log(`  ${coberta ? "OK  " : "SEM PROVA"} ${r.tipo.padEnd(4)} ${r.id.padEnd(22)} ${prova}`);
  if (!coberta) console.log(`       ${r.descricao}`);
}

console.log("");
if (falhas > 0) {
  console.error(`FALHA: ${falhas} problema(s) na suite de conformidade das restrições.`);
  process.exit(1);
}
console.log(
  `Conformidade das restrições: ${restricoes.length} restrições, todas provadas com as regras reais do snapshot.`,
);
