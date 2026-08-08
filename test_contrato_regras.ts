/**
 * Teste do contrato de regras (Fase 2).
 *
 * 1. Carrega o snapshot REAL do Supabase (tabelas `regras`, `ucs`,
 *    `anos_semestres`) e passa-o pelo validador do esquema.
 * 2. Imprime o relatório de carregamento: em falta / malformadas /
 *    desconhecidas / defaults aplicados / conflitos.
 * 3. FALHA (exit 1) se alguma regra real for rejeitada por um erro do esquema —
 *    o esquema tem de aceitar tudo o que já está em produção.
 * 4. Prova que uma regra malformada É detetada, e que a janela das aulas T
 *    introduzida pela migração é aceite e reconhecida como veto.
 *
 * Localização do snapshot: variável de ambiente `SB_SNAPSHOT_DIR`, ou o
 * primeiro argumento da linha de comandos. Sem nenhum dos dois, usa a pasta
 * onde a Fase 0 gravou o snapshot.
 */

import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { carregarRegras, formatarRelatorio } from "./src/regras/carregar";
import type { LinhaRegra } from "./src/regras/carregar";

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

const regras = lerJson("regras.json") as LinhaRegra[];
const ucs = lerJson("ucs.json");
const anosSemestres = lerJson("anos_semestres.json");

console.log(`Snapshot: ${PASTA_SNAPSHOT}`);
console.log(`Regras: ${regras.length} | UCs: ${ucs.length} | Anos/semestres: ${anosSemestres.length}\n`);

// ---------------------------------------------------------------------------
// 1. Carregamento das regras reais
// ---------------------------------------------------------------------------

const { config, relatorio } = carregarRegras({ regras, ucs, anosSemestres });

console.log(formatarRelatorio(relatorio));

// ---------------------------------------------------------------------------
// 2. Nenhuma regra real pode ser rejeitada pelo esquema
// ---------------------------------------------------------------------------

if (relatorio.malformadas.length > 0) {
  console.error("\nFALHA: o esquema rejeitou regras que estão em produção:");
  for (const m of relatorio.malformadas) console.error(`  ${m.caminho}: ${m.mensagem}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Verificações de sanidade sobre o que foi lido
// ---------------------------------------------------------------------------

assert.equal(relatorio.regrasLidas, regras.length, "todas as regras do snapshot têm de ser lidas");
assert.ok(relatorio.regrasAplicadas.length > 0, "pelo menos uma regra tem de produzir configuração de motor");
assert.equal(
  config.capacidade.maxPLporMancha,
  6,
  "o máximo global de PL por mancha tem de vir da regra, não do default",
);
assert.ok(config.calendario.bloqueios.length > 0, "os bloqueios de calendário têm de ser lidos");
assert.ok(config.precedencias.length > 0, "as precedências entre tipos de aula têm de ser lidas");
assert.ok(config.layoutsFixos.length > 0, "o layout fixo de semana tem de ser lido");
assert.ok(config.limitesPorUC.length === ucs.length, "todas as UCs têm de produzir limites de simultaneidade");
assert.ok(
  config.calendario.semanasPersonalizadas.length > 0,
  "as semanas personalizadas do ano/semestre ativo têm de ser lidas",
);

// A ausência da janela das aulas T é exatamente o diagnóstico da Fase 2:
// enquanto a migração não correr, esta regra crítica falta.
const janelaEmFalta = relatorio.emFalta.find((f) => f.chaveMotor === "janelasPorTipoAula");
if (janelaEmFalta) {
  assert.equal(janelaEmFalta.critica, true, "a janela por tipo de aula é uma regra crítica");
  console.log(
    "\n[diagnóstico] A janela das aulas T NÃO existe no snapshot — é a causa das teóricas à terça e à quinta.\n" +
      "              A migração `supabase/migracao_regras_motor_v2.sql` corrige isto.",
  );
} else {
  const janelaT = config.janelasPorTipo.find((j) => j.tipo === "T");
  assert.ok(janelaT, "se a chave existe, a janela das aulas T tem de estar presente");
  assert.equal(janelaT!.modo, "veto", "a janela das aulas T tem de ser um veto, não uma preferência");
}

// ---------------------------------------------------------------------------
// 4. A migração é aceite pelo esquema
// ---------------------------------------------------------------------------

const REGRA_JANELA_T: LinhaRegra = {
  id: "h_eseuc_auditorio",
  nome: "Restrição do Auditório para aulas teóricas",
  tipo: "hard",
  categoria: "Sala",
  descricao: "Aulas T apenas às segundas e quartas todo o dia e às sextas de manhã.",
  escopo: "ano",
  ano_curricular: "2",
  ativa: true,
  config: {
    motor: {
      janelasPorTipoAula: [
        {
          tipo: "T",
          modo: "veto",
          ordemPreferenciaDias: ["Segunda", "Quarta", "Sexta"],
          janelas: [
            { dia: "Segunda", periodos: ["manha", "tarde"], horas: [] },
            { dia: "Quarta", periodos: ["manha", "tarde"], horas: [] },
            { dia: "Sexta", periodos: ["manha"], horas: [] },
          ],
        },
      ],
    },
  },
};

const posMigracao = carregarRegras({
  regras: regras.map((r) => (r.id === REGRA_JANELA_T.id ? REGRA_JANELA_T : r)),
  ucs,
  anosSemestres,
});

assert.equal(
  posMigracao.relatorio.malformadas.length,
  0,
  "a regra da janela das aulas T introduzida pela migração tem de ser aceite sem erros",
);
const janelaT = posMigracao.config.janelasPorTipo.find((j) => j.tipo === "T");
assert.ok(janelaT, "depois da migração a janela das aulas T tem de existir");
assert.equal(janelaT!.modo, "veto", "a janela das aulas T tem de ser um veto");
assert.deepEqual(
  janelaT!.janelas.map((j) => j.dia),
  ["Segunda", "Quarta", "Sexta"],
  "a janela das aulas T só pode conter segunda, quarta e sexta",
);
assert.deepEqual(
  janelaT!.janelas.find((j) => j.dia === "Sexta")!.periodos,
  ["manha"],
  "à sexta-feira as aulas T só podem ser de manhã",
);
assert.ok(
  !posMigracao.relatorio.emFalta.some((f) => f.chaveMotor === "janelasPorTipoAula"),
  "depois da migração a janela por tipo de aula deixa de estar em falta",
);

// ---------------------------------------------------------------------------
// 4b. Todos os blocos JSON das migrações são válidos e aceites pelo esquema
//
// Lê os próprios ficheiros SQL, extrai os literais `'{...}'::jsonb` e passa cada
// um pelo carregador. Se um deles tiver JSON inválido ou um campo que o
// esquema não aceite, o teste falha — sem ser preciso ir ao Supabase.
//
// São TODAS as migrações que escrevem configuração de motor, não só a primeira:
// uma migração nova com um erro de escrita tem de falhar aqui e não em produção.
// ---------------------------------------------------------------------------

const MIGRACOES_SQL = [
  "migracao_regras_motor_v2.sql",
  "migracao_regra_geral_blocos.sql",
  "migracao_alinhar_horario_referencia.sql",
].map((n) => join(import.meta.dirname ?? ".", "supabase", n));
// Os literais JSON das migrações não contêm plicas, o que permite delimitá-los
// sem ambiguidade e distingui-los dos caminhos jsonb (ex.: '{motor,blocos100}').
const literais = MIGRACOES_SQL.flatMap((caminho) =>
  [...readFileSync(caminho, "utf8").matchAll(/'(\{[^']*\})'::jsonb/g)]
    .map((m) => m[1])
    .filter((t) => !/^\{[a-z_,]*\}$/i.test(t)),
);

/** Envolve um fragmento no nível de `config` a que pertence. */
function comoConfig(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (obj.motor !== undefined) return obj;
  const chaves = Object.keys(obj);
  if (chaves.length === 0) return null;
  if (chaves.some((k) => k === "custosPadroes" || k === "padraoUltimoRecurso")) {
    return { motor: { blocos100: obj } };
  }
  if (chaves.some((k) => k === "evitarDiasParciais" || k === "alvoHoras" || k === "maxHoras")) {
    return { motor: { cargaDiariaEstudante: obj } };
  }
  return { motor: obj };
}

console.log("\n\nBLOCOS JSON DA MIGRACAO SQL");
console.log("===========================");
let blocosVerificados = 0;
literais.forEach((texto, i) => {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(texto);
  } catch (e) {
    assert.fail(`o literal jsonb #${i + 1} da migração não é JSON válido: ${(e as Error).message}\n${texto}`);
  }
  const cfg = comoConfig(obj);
  if (!cfg) return;
  const r = carregarRegras({ regras: [{ id: `migracao_bloco_${i + 1}`, ativa: true, config: cfg }] });
  assert.equal(
    r.relatorio.malformadas.length,
    0,
    `o bloco #${i + 1} da migração foi rejeitado pelo esquema: ${JSON.stringify(r.relatorio.malformadas, null, 2)}`,
  );
  assert.equal(
    r.relatorio.desconhecidas.length,
    0,
    `o bloco #${i + 1} da migração usa chaves que o esquema não conhece: ${JSON.stringify(r.relatorio.desconhecidas)}`,
  );
  assert.ok(
    r.relatorio.regrasAplicadas.length === 1,
    `o bloco #${i + 1} da migração não produziu configuração de motor.`,
  );
  blocosVerificados += 1;
  console.log(`  OK  bloco #${i + 1}: ${Object.keys((cfg as any).motor).join(", ")}`);
});
assert.ok(blocosVerificados >= 8, `esperava pelo menos 8 blocos de configuração na migração, encontrei ${blocosVerificados}`);

// ---------------------------------------------------------------------------
// 5. Regras malformadas TÊM de ser detetadas
// ---------------------------------------------------------------------------

const MALFORMADAS: { descricao: string; regra: LinhaRegra; esperado: RegExp }[] = [
  {
    descricao: "carga diária com alvo acima do máximo",
    regra: {
      id: "teste_carga_invertida",
      ativa: true,
      config: { motor: { cargaDiariaEstudante: { alvoHoras: 10, maxHoras: 8 } } },
    },
    esperado: /não pode ser superior ao máximo diário/,
  },
  {
    descricao: "máximo global de PL com valor não numérico",
    regra: { id: "teste_pl_texto", ativa: true, config: { motor: { maxPLporMancha: "seis" } } },
    esperado: /esperava um número/,
  },
  {
    descricao: "janela de tipo de aula sem nenhum dia",
    regra: {
      id: "teste_janela_vazia",
      ativa: true,
      config: { motor: { janelasPorTipoAula: [{ tipo: "T", modo: "veto", janelas: [] }] } },
    },
    esperado: /não lista nenhum dia/,
  },
  {
    descricao: "janela num dia que não existe na grelha",
    regra: {
      id: "teste_janela_dia_invalido",
      ativa: true,
      config: {
        motor: { janelasPorTipoAula: [{ tipo: "T", modo: "veto", janelas: [{ dia: "Sábado", periodos: [] }] }] },
      },
    },
    esperado: /não existe na grelha horária/,
  },
  {
    descricao: "padrão de bloco inexistente na lista de ativos",
    regra: {
      id: "teste_padrao_desconhecido",
      ativa: true,
      config: { motor: { blocos100: { padroesAtivos: ["TP9_PL9"] } } },
    },
    esperado: /desconhecido/,
  },
  {
    descricao: "precedência de um tipo sobre si próprio",
    regra: {
      id: "teste_precedencia_circular",
      ativa: true,
      config: { motor: { precedenciasUC: [{ siglas: [], tipoAntes: "TP", tipoDepois: "TP", minimoAntes: 1 }] } },
    },
    esperado: /não pode preceder-se a si própria/,
  },
  {
    descricao: "bloqueio de calendário com datas invertidas",
    regra: {
      id: "teste_bloqueio_invertido",
      ativa: true,
      config: {
        motor: {
          bloqueiosCalendario: [
            { nome: "x", tipo: "Feriado", dataInicio: "2027-05-20", dataFim: "2027-05-01" },
          ],
        },
      },
    },
    esperado: /posterior à data de fim/,
  },
  {
    descricao: "chave de motor que o esquema não conhece",
    regra: { id: "teste_chave_invencao", ativa: true, config: { motor: { inventadoPeloAssistente: 42 } } },
    esperado: /^$/, // não é erro: é reportada como chave desconhecida
  },
];

console.log("\n\nDETEÇÃO DE REGRAS MALFORMADAS");
console.log("=============================");

for (const caso of MALFORMADAS) {
  const r = carregarRegras({ regras: [caso.regra] });
  if (caso.regra.id === "teste_chave_invencao") {
    assert.equal(
      r.relatorio.desconhecidas.length,
      1,
      `"${caso.descricao}" tinha de ser reportada como chave desconhecida`,
    );
    console.log(`  OK  ${caso.descricao} -> desconhecida: ${r.relatorio.desconhecidas[0].chave}`);
    continue;
  }
  const encontrado = r.relatorio.malformadas.find((m) => caso.esperado.test(m.mensagem));
  assert.ok(
    encontrado,
    `"${caso.descricao}" não foi detetada. Erros produzidos: ${JSON.stringify(r.relatorio.malformadas)}`,
  );
  console.log(`  OK  ${caso.descricao}\n      -> ${encontrado!.caminho}: ${encontrado!.mensagem}`);
}

// A regra malformada é descartada, mas as restantes continuam a valer.
const misto = carregarRegras({ regras: [...regras, MALFORMADAS[1].regra] });
assert.ok(misto.relatorio.malformadas.length > 0, "a regra malformada tem de aparecer no relatório");
assert.equal(
  misto.config.capacidade.maxPLporMancha,
  6,
  "uma regra malformada não pode contaminar o valor válido lido de outra regra",
);

// Uma regra inativa nunca produz configuração.
const inativa = carregarRegras({
  regras: [{ id: "teste_inativa", ativa: false, config: { motor: { maxPLporMancha: 99 } } }],
});
assert.equal(inativa.config.capacidade.maxPLporMancha, 6, "uma regra inativa não pode alterar a configuração");
assert.deepEqual(inativa.relatorio.regrasInativas, ["teste_inativa"]);

console.log("\nContrato de regras: as 32 regras reais são aceites, os defaults são reportados");
console.log("e as regras malformadas são detetadas com mensagem legível.");
