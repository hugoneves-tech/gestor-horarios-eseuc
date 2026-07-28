import { strict as assert } from "node:assert";
import { criarHtmlHorarioPdf } from "./src/utils/exportarPdf";
import type { SessaoHorario } from "./src/types";

const sessao: SessaoHorario = {
  id: 1,
  ucNome: "Psicologia & Saúde",
  ucSigla: "PSIS",
  tipoAula: "T",
  docente: "",
  sala: "",
  salaTipo: "",
  turma: "Turma A",
  diaSemana: "Quarta",
  horaInicio: "08:00",
  horaFim: "10:00",
  bloqueado: false,
  semana: 1,
};
const html = criarHtmlHorarioPdf({
  sessoes: [sessao],
  semanas: Array.from({ length: 30 }, (_, i) => ({
    numero: i + 1,
    semestre: i < 15 ? 1 : 2,
    intervalo: i === 21 ? "22 Mar a 26 Mar (Pausa: Férias da Páscoa)" : `${i + 1} Set a ${i + 5} Set`,
  })),
  anoLetivo: "2026/2027",
  anoCurricular: "2.º Ano",
  proposta: "Teste <seguro>",
});

assert.equal((html.match(/<section class="pagina">/g) || []).length, 30);
assert.ok(html.includes("Página 30 de 30"));
assert.ok(html.includes("ESEUC - Horário do 2.º Ano"));
assert.ok(html.includes("<strong>PSIS</strong> (T) T1"));
assert.ok(html.includes("Teste &lt;seguro&gt;"));
assert.ok(html.includes("Férias da Páscoa"));
assert.ok(html.includes("@page { size: A4 landscape; margin: 0; }"));
console.log("PDF: 30 páginas, grelha semanal, cores e escape HTML validados.");
