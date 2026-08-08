// Passa o HORÁRIO DE REFERÊNCIA do coordenador (semanas 1-7) pelo validador
// independente. Responde à pergunta que vale ouro: as regras que codificámos
// aceitam a solução que o coordenador considera correta?
//   npx tsx validar_referencia.ts
import fs from "node:fs";
import path from "node:path";
import { carregarRegras } from "./src/regras/carregar";
import { validar } from "./src/validacao/validador";
import { rowToUc, rowToRegra, rowToAnoSem } from "./src/data/mappers";
import type { SessaoHorario } from "./src/types";

const SB = "C:\\Users\\hugon\\AppData\\Local\\Temp\\sb";
const ler = (n: string) => JSON.parse(fs.readFileSync(path.join(SB, n + ".json"), "utf8"));
const ucs = ler("ucs").map(rowToUc);
const regras = ler("regras").map(rowToRegra);
const anosSemestres = ler("anos_semestres").map(rowToAnoSem);
const cfg = carregarRegras({ regras, ucs, anosSemestres } as any).config;

const REF = path.join("C:\\Users\\hugon\\OneDrive - Universidade de Coimbra\\Claude\\ESEUC Schedule", "referencia_sessoes.json");
const bruto: any[] = JSON.parse(fs.readFileSync(REF, "utf8"));

// O PDF usa T1/T2 para as turmas teóricas; o motor usa os nomes do catálogo.
const nomesT = cfg.estruturaTurmas.nomesTurmasTeoricas;
const traduzirTurma = (t: string): string => {
  const m = t.match(/^T(\d+)$/);
  if (m) return nomesT[Number(m[1]) - 1] ?? t;
  return t;
};

const sessoes: SessaoHorario[] = bruto.map((s, i) => ({
  id: i + 1,
  ucNome: s.ucSigla,
  ucSigla: s.ucSigla,
  tipoAula: s.tipoAula,
  docente: "",
  sala: "",
  salaTipo: "",
  turma: traduzirTurma(s.turma),
  diaSemana: s.diaSemana,
  horaInicio: s.horaInicio,
  horaFim: `${String(Number(s.horaInicio.slice(0, 2)) + 2).padStart(2, "0")}:00`,
  bloqueado: false,
  semana: s.semana,
}));

console.log("=".repeat(72));
console.log(" VALIDAÇÃO DO HORÁRIO DE REFERÊNCIA DO COORDENADOR (semanas 1-7)");
console.log("=".repeat(72));
console.log(`Sessões: ${sessoes.length}`);

const r = validar(sessoes, ucs, cfg);
const erros = r.violacoes.filter(v => v.gravidade === "erro");
const avisos = r.violacoes.filter(v => v.gravidade === "aviso");
console.log(`Violações: ${erros.length} erro(s), ${avisos.length} aviso(s)`);
console.log("");
console.log("Por regra:");
for (const [regra, n] of Object.entries(r.porRegra).sort((a, b) => (b[1] as number) - (a[1] as number))) {
  console.log(`  ${String(regra).padEnd(28)} ${n}`);
}
console.log("");
if (erros.length) {
  // A semana 1 tem layout fixo declarado no Supabase; a regra que o acompanha veta
  // a semana inteira para todas as outras UCs, por isso as sessões do próprio layout
  // aparecem como violação neste arnês (que não as marca como fixas). Separo-as.
  const semana1 = erros.filter(v => v.semana === 1 && v.regra === "restricoes-uc");
  const reais = erros.filter(v => !(v.semana === 1 && v.regra === "restricoes-uc"));
  console.log(`Da semana 1 (layout fixo — falso positivo deste arnês): ${semana1.length}`);
  console.log(`RESTANTES, a analisar: ${reais.length}`);
  console.log("");
  const porRegra = new Map<string, typeof reais>();
  for (const v of reais) {
    const lista = porRegra.get(v.regra) ?? [];
    lista.push(v);
    porRegra.set(v.regra, lista);
  }
  for (const [regra, lista] of [...porRegra.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- ${regra}: ${lista.length} ---`);
    for (const v of lista.slice(0, 4)) {
      console.log(`   sem ${v.semana} ${v.dia} ${v.hora} · ${v.ucSigla} ${v.turma}`);
      console.log(`     ${v.mensagem}`);
    }
    console.log("");
  }
} else {
  console.log("✓ A referência do coordenador passa em TODAS as regras codificadas.");
}
