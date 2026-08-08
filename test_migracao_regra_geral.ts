/**
 * A MIGRAÇÃO DA REGRA GERAL, LIDA DO PRÓPRIO FICHEIRO SQL.
 *
 * O snapshot do Supabase em `SB_SNAPSHOT_DIR` é anterior à migração: ainda traz
 * `maxTPporUCporMancha = 4` (o valor que autorizava o bloco de quatro TP da
 * mesma UC) e não traz nem o ritmo das TP, nem o limite de blocos seguidos, nem
 * a tabela de precedências escalonadas.
 *
 * Para que os testes exercitem o motor COM a regra nova sem duplicar a
 * configuração em código, este módulo lê `supabase/migracao_regra_geral_blocos.sql`
 * e devolve as regras que ela escreve, no formato da tabela `regras`. Uma só
 * fonte de verdade: se o SQL mudar, os testes mudam com ele.
 *
 * Nada aqui inventa configuração — se o SQL não contiver um bloco, ele não
 * aparece, e o teste que dele dependa falha em vez de passar por engano.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LinhaRegra } from "./src/regras/carregar";

const PASTA_SQL = join(import.meta.dirname ?? ".", "supabase");
const CAMINHO_SQL = join(PASTA_SQL, "migracao_regra_geral_blocos.sql");

/**
 * As migrações que o motor tem de ter aplicadas, DA MAIS RECENTE PARA A MAIS
 * ANTIGA. A ordem é a da precedência, não a da cronologia: o carregador, nas
 * secções em que só uma regra pode mandar, dá a vitória à primeira que lê.
 *
 * `migracao_alinhar_horario_referencia.sql` reescreve o ritmo das TP e a regra
 * das maratonas que a migração da regra geral tinha escrito, e acrescenta a
 * regra que deixa TP e PL da mesma UC partilhar a mancha.
 */
const MIGRACOES = [
  join(PASTA_SQL, "migracao_alinhar_horario_referencia.sql"),
  CAMINHO_SQL,
];

/**
 * Extrai de um ficheiro SQL os literais `'{...}'::jsonb` que contêm um bloco
 * `motor`. Os literais da migração não têm plicas por dentro, o que permite
 * delimitá-los sem ambiguidade — é a mesma técnica que `test_contrato_regras.ts`
 * usa para validar a migração do motor v2.
 */
export function blocosMotorDaMigracao(caminho = CAMINHO_SQL): Record<string, unknown>[] {
  const sql = readFileSync(caminho, "utf8");
  const literais = [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map((m) => m[1]);
  const saida: Record<string, unknown>[] = [];
  for (const texto of literais) {
    let obj: unknown;
    try {
      obj = JSON.parse(texto);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj) && "motor" in obj) {
      saida.push((obj as { motor: Record<string, unknown> }).motor);
    }
  }
  return saida;
}

/**
 * As regras que a migração escreve, prontas a juntar às do snapshot. O `id` é
 * derivado da posição para não colidir com nenhuma regra real.
 */
export function regrasDaMigracaoRegraGeral(caminho = CAMINHO_SQL): LinhaRegra[] {
  // O id leva o nome do ficheiro para que duas migrações diferentes nunca
  // colidam — e para que a mensagem de uma violação diga de que migração veio a
  // regra que a produziu.
  const ficheiro = (caminho.split(/[\\/]/).pop() ?? caminho).replace(/\.sql$/i, "");
  return blocosMotorDaMigracao(caminho).map((motor, i) => ({
    id: `${ficheiro}_${i + 1}`,
    nome: `migração ${ficheiro}`,
    ativa: true,
    config: { motor },
  }));
}

/**
 * O snapshot com as migrações aplicadas por cima.
 *
 * As regras das migrações vêm PRIMEIRO porque o carregador, nas secções em que
 * só uma regra pode mandar, dá a vitória à primeira que lê — e a intenção é que
 * a migração prevaleça sobre a configuração antiga que ainda está no snapshot.
 * Entre migrações vale a mesma ordem: `MIGRACOES` está da mais recente para a
 * mais antiga. A regra de capacidade antiga (que autorizava 4 TP da mesma UC) é
 * retirada, tal como as migrações a desativam no Supabase.
 */
export function comMigracaoRegraGeral(regras: LinhaRegra[], caminhos: string[] = MIGRACOES): LinhaRegra[] {
  const desativadas = new Set(caminhos.flatMap((c) => idsDesativadosPelaMigracao(c)));
  return [
    ...caminhos.flatMap((c) => regrasDaMigracaoRegraGeral(c)),
    ...regras.filter((r) => !(r.id !== undefined && desativadas.has(r.id))),
  ];
}

/** Ids que a migração marca como `ativa = false`. */
export function idsDesativadosPelaMigracao(caminho = CAMINHO_SQL): string[] {
  const sql = readFileSync(caminho, "utf8");
  const ids: string[] = [];
  for (const m of sql.matchAll(/update\s+public\.regras\s+set\b([\s\S]*?);/gi)) {
    const corpo = m[1];
    if (!/\bativa\s*=\s*false\b/i.test(corpo)) continue;
    for (const alvo of corpo.matchAll(/where\s+id\s*=\s*'([^']+)'/gi)) ids.push(alvo[1]);
  }
  return ids;
}
