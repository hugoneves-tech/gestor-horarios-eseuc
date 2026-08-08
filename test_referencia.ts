/**
 * O HORÁRIO DE REFERÊNCIA DO COORDENADOR TEM DE PASSAR NAS NOSSAS REGRAS.
 *
 * Todos os outros testes provam que o motor respeita as regras que escrevemos.
 * Este prova o contrário: que as regras que escrevemos aceitam a solução que o
 * coordenador considera boa. É a única asserção da suite que confronta o modelo
 * com a realidade em vez de o confrontar consigo próprio.
 *
 * A entrada é `referencia_sessoes.json` — as semanas 1 a 7 do horário que o
 * coordenador forneceu, 916 sessões, carga completa, conferidas bloco a bloco
 * contra o Supabase. Passa pelo validador independente com a configuração REAL
 * (snapshot do Supabase mais as migrações), e exige ZERO violações de gravidade
 * "erro". Se uma regra nossa for mais apertada do que a prática que o
 * coordenador valida, é aqui que se vê, com o nome da regra e a aula concreta.
 *
 * Nenhuma sigla de unidade curricular aparece neste ficheiro: as UCs vêm do
 * catálogo e da própria referência.
 *
 * Localização do snapshot: `SB_SNAPSHOT_DIR`, ou o primeiro argumento da linha
 * de comandos. Localização da referência: `REF_SESSOES`, ou o ficheiro na raiz
 * do projeto.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { carregarRegras } from "./src/regras/carregar";
import type { LinhaRegra } from "./src/regras/carregar";
import { comMigracaoRegraGeral } from "./test_migracao_regra_geral";
import { rowToUc } from "./src/data/mappers";
import type { SessaoHorario, UC } from "./src/types";
import { validar } from "./src/validacao/validador";
import type { Violacao } from "./src/validacao/validador";

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

const PASTA_SNAPSHOT =
  process.argv[2] ?? process.env.SB_SNAPSHOT_DIR ?? "C:\\Users\\hugon\\AppData\\Local\\Temp\\sb";

const CAMINHO_REFERENCIA =
  process.env.REF_SESSOES ?? join(import.meta.dirname ?? ".", "referencia_sessoes.json");

function lerJson(caminho: string, oQue: string): any {
  if (!existsSync(caminho)) {
    console.error(`\n${oQue} em falta: ${caminho}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(caminho, "utf8"));
}

const linhasRegras = lerJson(join(PASTA_SNAPSHOT, "regras.json"), "Snapshot das regras") as LinhaRegra[];
const linhasUCs = lerJson(join(PASTA_SNAPSHOT, "ucs.json"), "Snapshot das UCs");
const linhasAnosSemestres = lerJson(join(PASTA_SNAPSHOT, "anos_semestres.json"), "Snapshot dos anos/semestres");

const { config } = carregarRegras({
  regras: comMigracaoRegraGeral(linhasRegras),
  ucs: linhasUCs,
  anosSemestres: linhasAnosSemestres,
});
const ucs: UC[] = linhasUCs.map(rowToUc);

interface SessaoReferencia {
  semana: number;
  diaSemana: string;
  horaInicio: string;
  ucSigla: string;
  tipoAula: string;
  turma: string;
}

const bruto = lerJson(CAMINHO_REFERENCIA, "Horário de referência") as SessaoReferencia[];

// ---------------------------------------------------------------------------
// Tradução para o formato do motor
// ---------------------------------------------------------------------------

/**
 * O horário do coordenador numera as turmas teóricas por ordem (a primeira, a
 * segunda); o motor usa os nomes que a estrutura de turmas declara. A tradução
 * é pela POSIÇÃO, nunca por um nome escrito à mão.
 */
const nomesTeoricas = config.estruturaTurmas.nomesTurmasTeoricas;
const prefixoTeorica = config.estruturaTurmas.prefixos.teorica;
const traduzirTurma = (t: string): string => {
  const m = t.match(new RegExp(`^${prefixoTeorica}(\\d+)$`));
  if (!m) return t;
  return nomesTeoricas[Number(m[1]) - 1] ?? t;
};

const bloco = config.grelha.duracaoBlocoHoras;
const fim = (inicio: string): string =>
  `${String(Number(inicio.slice(0, 2)) + bloco).padStart(2, "0")}:${inicio.slice(3)}`;

/**
 * A PRIMEIRA semana do calendário é layout FIXO declarado no Supabase: o
 * coordenador impõe as aulas e uma regra que acompanha o layout veta todas as
 * outras aulas dessa semana. As sessões do próprio layout são, por isso,
 * vetadas pela regra que elas mesmas impõem — a menos que sejam marcadas como
 * bloqueadas, que é o que o motor faz quando as coloca. Sem esta marca, o
 * layout do coordenador aparece como 28 violações de si próprio.
 */
const semanaDoLayoutFixo = Math.min(...bruto.map((s) => s.semana));

const sessoes: SessaoHorario[] = bruto.map((s, i) => ({
  id: i + 1,
  ucNome: s.ucSigla,
  ucSigla: s.ucSigla,
  tipoAula: s.tipoAula as SessaoHorario["tipoAula"],
  docente: "",
  sala: "",
  salaTipo: "",
  turma: traduzirTurma(s.turma),
  diaSemana: s.diaSemana,
  horaInicio: s.horaInicio,
  horaFim: fim(s.horaInicio),
  bloqueado: s.semana === semanaDoLayoutFixo,
  semana: s.semana,
}));

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

let falhas = 0;
const ok = (descricao: string) => console.log(`  OK   ${descricao}`);
const falhar = (descricao: string) => {
  falhas++;
  console.log(`  FALHA ${descricao}`);
};

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(`Referência: ${CAMINHO_REFERENCIA}`);
console.log(
  `Sessões: ${sessoes.length} | semanas ${Math.min(...bruto.map((s) => s.semana))}-` +
    `${Math.max(...bruto.map((s) => s.semana))} | layout fixo na semana ${semanaDoLayoutFixo} ` +
    `(${sessoes.filter((s) => s.bloqueado).length} sessões)\n`,
);

console.log("Regras em vigor nesta validação");
console.log("-------------------------------");
console.log(
  `  ritmo das TP        ${
    config.ritmoTP.ativo
      ? config.ritmoTP.unidade === "semanas"
        ? `${config.ritmoTP.maxDesvioSemanas} semana(s) de atraso, âmbito ${config.ritmoTP.ambito}`
        : `${config.ritmoTP.maxDesvioBlocos} bloco(s) de avanço, âmbito ${config.ritmoTP.ambito}`
      : "desligado"
  }`,
);
console.log(
  `  maratonas           ${
    config.maratonaUC.ativo
      ? `${config.maratonaUC.maxBlocosSeguidosMesmaUC} bloco(s) seguidos, ` +
        `${config.maratonaUC.maxBlocosMesmaUCporDia} bloco(s) por dia`
      : "desligado"
  }`,
);
console.log(`  TP e PL na mancha   ${config.tpPLmesmaUC.ativo ? "proibido" : "permitido"}`);
console.log(
  `  limites por UC      ${config.capacidade.maxTPporUCporMancha ?? "sem limite"} TP, ` +
    `${config.capacidade.maxPLporUCporMancha ?? "sem limite"} PL por bloco`,
);
console.log("");

const relatorio = validar(sessoes, ucs, config);
const erros = relatorio.violacoes.filter((v) => v.gravidade === "erro");
const avisos = relatorio.violacoes.filter((v) => v.gravidade === "aviso");

console.log("Violações por regra");
console.log("-------------------");
const entradas = Object.entries(relatorio.porRegra).sort((a, b) => (b[1] as number) - (a[1] as number));
if (entradas.length === 0) console.log("  (nenhuma)");
for (const [regra, n] of entradas) console.log(`  ${String(regra).padEnd(28)} ${n}`);
console.log(`\n  ${erros.length} erro(s), ${avisos.length} aviso(s)\n`);

console.log("ASSERCOES");
console.log("=========");

// A asserção que vale esta suite inteira.
if (erros.length === 0) {
  ok("o horário de referência do coordenador não viola NENHUMA regra hard do motor");
} else {
  falhar(`o horário de referência viola ${erros.length} regra(s) hard do motor:`);
  const porRegra = new Map<string, Violacao[]>();
  for (const v of erros) {
    const lista = porRegra.get(v.regra) ?? [];
    lista.push(v);
    porRegra.set(v.regra, lista);
  }
  for (const [regra, lista] of [...porRegra.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`         --- ${regra}: ${lista.length} ---`);
    for (const v of lista.slice(0, 5)) {
      console.log(`         semana ${v.semana} ${v.dia} ${v.hora} · ${v.ucSigla} ${v.turma}`);
      console.log(`           ${v.mensagem}`);
    }
  }
}

// Guardas que impedem o teste de passar por vazio ou por engano.
if (sessoes.length > 0) ok(`a referência tem sessões para validar (${sessoes.length})`);
else falhar("a referência está vazia — o teste não provaria nada.");

const siglasDaReferencia = new Set(bruto.map((s) => s.ucSigla));
const siglasDoCatalogo = new Set(ucs.map((u) => u.sigla));
const desconhecidas = [...siglasDaReferencia].filter((s) => !siglasDoCatalogo.has(s));
if (desconhecidas.length === 0) {
  ok(`todas as ${siglasDaReferencia.size} unidades curriculares da referência existem no catálogo`);
} else {
  falhar(
    `${desconhecidas.length} unidade(s) curricular(es) da referência não existem no catálogo: ` +
      `${desconhecidas.join(", ")} — o validador não as teria avaliado.`,
  );
}

const tiposDaReferencia = new Set(bruto.map((s) => s.tipoAula));
if (tiposDaReferencia.size >= 3) {
  ok(`a referência traz os três tipos de aula (${[...tiposDaReferencia].sort().join(", ")})`);
} else {
  falhar(`a referência só traz ${[...tiposDaReferencia].join(", ")}: não exercita todas as regras.`);
}

// As regras que esta migração afrouxou têm de estar de facto afrouxadas — se
// alguém voltar a apertá-las, o teste diz porque é que passou a falhar.
if (config.ritmoTP.ativo) ok("o ritmo das TP continua a ser uma regra ativa (não foi desligada para passar)");
else falhar("o ritmo das TP está desligado: o teste passaria sem provar nada sobre desfasamento.");
if (config.maratonaUC.ativo) ok("o limite de blocos da mesma UC por dia continua ativo");
else falhar("o limite de blocos da mesma UC está desligado: as 8h/dia deixariam de ser proibidas.");

console.log("");
if (falhas > 0) {
  console.error(`FALHA: ${falhas} problema(s) na validação do horário de referência.`);
  process.exit(1);
}
console.log(
  `Horário de referência: ${sessoes.length} sessões das semanas ` +
    `${Math.min(...bruto.map((s) => s.semana))}-${Math.max(...bruto.map((s) => s.semana))}, ` +
    `zero violações hard com as regras reais do Supabase.`,
);
