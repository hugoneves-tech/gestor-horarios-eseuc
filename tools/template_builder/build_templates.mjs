import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(import.meta.dirname, "..", "..");
const outputDir = path.join(root, "outputs", "eseuc_import_templates");
const publicDir = path.join(root, "public", "templates");
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(publicDir, { recursive: true });

const colors = { teal: "#0F6F78", tealDark: "#063F45", gold: "#D4A32A", pale: "#EAF5F5", ink: "#243234", gray: "#667478" };

function styleSheet(sheet, headerRange, widths) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const header = sheet.getRange(headerRange);
  header.format = {
    fill: colors.tealDark,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    verticalAlignment: "center",
    wrapText: true,
    borders: { bottom: { style: "medium", color: colors.gold } },
  };
  header.format.rowHeight = 42;
  widths.forEach(([range, width]) => { sheet.getRange(range).format.columnWidth = width; });
}

function addInstructions(workbook, title, rows) {
  const s = workbook.worksheets.add("Instruções");
  s.showGridLines = false;
  s.getRange("A1:B1").values = [[title, ""]];
  s.getRange("A1:B1").format = { fill: colors.tealDark, font: { bold: true, color: "#FFFFFF", size: 16 }, verticalAlignment: "center" };
  s.getRange("A1:B1").format.rowHeight = 34;
  s.getRange(`A3:B${rows.length + 2}`).values = rows;
  s.getRange("A3:B3").format = { fill: colors.gold, font: { bold: true, color: colors.tealDark } };
  s.getRange(`A4:B${rows.length + 2}`).format = { fill: "#FFFFFF", font: { color: colors.ink, size: 10 }, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#DCE4E5" } } };
  s.getRange("A:A").format.columnWidth = 28;
  s.getRange("B:B").format.columnWidth = 90;
  s.getRange(`A3:B${rows.length + 2}`).format.autofitRows();
  return s;
}

async function save(workbook, filename, previews) {
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: `${filename} formula error scan` });
  if (errors.ndjson.includes("match")) console.log(errors.ndjson);
  const keySheet = previews[0][0];
  const keyRange = previews[0][1];
  const check = await workbook.inspect({ kind: "table", range: `${keySheet}!${keyRange}`, include: "values,formulas", tableMaxRows: 6, tableMaxCols: 30, maxChars: 5000 });
  console.log(check.ndjson);
  for (const [sheetName, range, suffix] of previews) {
    const render = await workbook.render({ sheetName, range, scale: 1.25, format: "png" });
    await fs.writeFile(path.join(outputDir, `${filename.replace(".xlsx", "")}_${suffix}.png`), new Uint8Array(await render.arrayBuffer()));
  }
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(path.join(outputDir, filename));
  await xlsx.save(path.join(publicDir, filename));
}

// UCs ---------------------------------------------------------------------
{
  const wb = Workbook.create();
  const s = wb.worksheets.add("UCs");
  const headers = [
    "Designação da UC", "Sigla", "Ano Curricular", "Semestre", "Semana de Início", "Total de Semanas", "Créditos ECTS",
    "Horas T por turma", "N.º turmas T", "Nomes turmas T",
    "Horas TP por turma", "N.º turmas TP", "Nomes turmas TP",
    "Horas PL por turma", "N.º turmas PL", "Nomes turmas PL",
    "Horas S por turma", "N.º turmas S", "Nomes turmas S", "Ensino Clínico E total (h)",
    "Tipologia sala T", "Tipologia sala TP", "Tipologia sala PL", "Tipologia sala S", "Observações",
    "Total horas UC (calculado)"
  ];
  s.getRange("A1:Z1").values = [headers];
  styleSheet(s, "A1:Z1", [["A:A", 34], ["B:B", 11], ["C:G", 13], ["H:I", 14], ["J:J", 24], ["K:L", 14], ["M:M", 24], ["N:O", 14], ["P:P", 26], ["Q:R", 14], ["S:S", 18], ["T:T", 18], ["U:X", 24], ["Y:Y", 34], ["Z:Z", 20]]);
  s.getRange("A2:Y2").values = [["Fundamentos de Enfermagem", "FE", 2, 1, 1, 15, 6, 30, 1, "Turma T", 16, 4, "TP1; TP2; TP3; TP4", 12, 12, "PL1; PL2; PL3; PL4; PL5; PL6; PL7; PL8; PL9; PL10; PL11; PL12", 0, 0, "", 0, "Anfiteatro (Teórica T)", "Sala Comum TP", "Laboratório de Simulação PL", "", "Linha de exemplo — substituir ou apagar"]];
  s.getRange("Z2").formulas = [["=H2*I2+K2*L2+N2*O2+Q2*R2+T2"]];
  s.getRange("A2:Z25").format = { font: { color: colors.ink, size: 10 }, verticalAlignment: "top", wrapText: true, borders: { insideHorizontal: { style: "thin", color: "#E2E8E9" } } };
  s.getRange("C2:G200").format.numberFormat = "0";
  s.getRange("H2:I200").format.numberFormat = "0"; s.getRange("K2:L200").format.numberFormat = "0"; s.getRange("N2:O200").format.numberFormat = "0"; s.getRange("Q2:R200").format.numberFormat = "0"; s.getRange("T2:T200").format.numberFormat = "0";
  s.getRange("C2:C200").dataValidation = { rule: { type: "list", values: [1, 2, 3, 4] } };
  s.getRange("D2:D200").dataValidation = { rule: { type: "list", values: [1, 2] } };
  s.getRange("E2:E200").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 30 } };
  s.getRange("A2:Z2").format.fill = colors.pale;
  addInstructions(wb, "Template de importação · Unidades Curriculares", [
    ["Regra", "Como preencher"],
    ["Uma linha por UC", "A sigla identifica a UC. Se já existir no Supabase, a importação atualiza essa UC em vez de criar uma duplicada."],
    ["Horas", "Indique as horas totais por turma no período letivo, sempre em múltiplos de 2h. O total calculado soma horas × número de turmas, mais Ensino Clínico."],
    ["Turmas", "Preencha o número e, de preferência, os nomes separados por ponto e vírgula. O número de nomes deve coincidir com N.º turmas."],
    ["Flexibilidade anual", "Semanas, horas, semestre e estrutura de turmas são importados para o Supabase e invalidam horários antigos da UC quando mudam."],
    ["Linha de exemplo", "Substitua ou apague a linha 2 antes da importação dos dados definitivos."],
  ]);
  await save(wb, "modelo_ucs_eseuc.xlsx", [["UCs", "A1:Z5", "ucs"], ["Instruções", "A1:B9", "instrucoes"]]);
}

// Docentes ----------------------------------------------------------------
{
  const wb = Workbook.create();
  const d = wb.worksheets.add("Docentes");
  d.getRange("A1:J1").values = [["Nome completo", "Email institucional", "Departamento", "Limite de horas semanais", "Pós-graduação", "Segunda", "Terça", "Quarta", "Quinta", "Sexta"]];
  styleSheet(d, "A1:J1", [["A:A", 30], ["B:B", 30], ["C:C", 32], ["D:E", 18], ["F:J", 30]]);
  d.getRange("A2:J2").values = [["Prof.ª Exemplo", "exemplo@eseuc.pt", "Enfermagem", 12, "Não", "08:00-12:00; 14:00-18:00", "08:00-12:00; 14:00-18:00", "08:00-12:00", "14:00-18:00", "08:00-13:00"]];
  d.getRange("A2:J30").format = { font: { color: colors.ink, size: 10 }, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#E2E8E9" } } };
  d.getRange("A2:J2").format.fill = colors.pale;
  d.getRange("D2:D200").format.numberFormat = "0";
  d.getRange("E2:E200").dataValidation = { rule: { type: "list", values: ["Não", "Sim"] } };

  const c = wb.worksheets.add("Cargas Docentes");
  c.getRange("A1:G1").values = [["Email docente", "Sigla UC", "Tipologia", "Número de turmas", "Horas por turma", "Modo de atribuição", "Turmas preferidas"]];
  styleSheet(c, "A1:G1", [["A:A", 30], ["B:B", 14], ["C:C", 14], ["D:E", 18], ["F:F", 22], ["G:G", 38]]);
  c.getRange("A2:G2").values = [["exemplo@eseuc.pt", "FE", "TP", 2, 8, "Automático", ""]];
  c.getRange("A2:G30").format = { font: { color: colors.ink, size: 10 }, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#E2E8E9" } } };
  c.getRange("A2:G2").format.fill = colors.pale;
  c.getRange("C2:C300").dataValidation = { rule: { type: "list", values: ["T", "TP", "PL", "S"] } };
  c.getRange("D2:D300").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 24 } };
  c.getRange("F2:F300").dataValidation = { rule: { type: "list", values: ["Automático", "Manual", "Misto"] } };
  addInstructions(wb, "Template de importação · Docentes e cargas provisórias", [
    ["Regra", "Como preencher"],
    ["Folha Docentes", "Uma linha por docente. O email é a chave para atualizar registos existentes. Separe vários períodos de disponibilidade por ponto e vírgula."],
    ["Folha Cargas Docentes", "Uma linha por combinação docente + UC + tipologia. Pode repetir o mesmo docente em várias UCs e tipologias."],
    ["Horas e turmas", "Número de turmas × horas por turma é a carga declarada. A soma deve preencher exatamente as horas disponíveis de cada UC/tipologia."],
    ["Automático", "Não indique turma: a aplicação só a calcula quando todas as entradas do 2.º ano estiverem completas."],
    ["Manual / Misto", "Indique turmas preferidas separadas por ponto e vírgula. Manual exige exatamente o número pedido; Misto permite completar automaticamente."],
    ["Linhas de exemplo", "Substitua ou apague as linhas 2 das duas folhas antes da importação definitiva."],
  ]);
  await save(wb, "modelo_docentes_eseuc.xlsx", [["Docentes", "A1:J5", "docentes"], ["Cargas Docentes", "A1:G5", "cargas"], ["Instruções", "A1:B10", "instrucoes"]]);
}

// Salas -------------------------------------------------------------------
{
  const wb = Workbook.create();
  const s = wb.worksheets.add("Salas");
  s.getRange("A1:E1").values = [["Nome da sala", "Tipo principal", "Capacidade", "Tipologias compatíveis", "Equipamentos"]];
  styleSheet(s, "A1:E1", [["A:A", 40], ["B:B", 26], ["C:C", 14], ["D:D", 50], ["E:E", 60]]);
  s.getRange("A2:E2").values = [["Laboratório de Práticas Simuladas 1", "Laboratório", 24, "Laboratório; Sala de Computadores", "Projetor; Camas clínicas; Oxigenoterapia"]];
  s.getRange("A2:E30").format = { font: { color: colors.ink, size: 10 }, wrapText: true, verticalAlignment: "top", borders: { insideHorizontal: { style: "thin", color: "#E2E8E9" } } };
  s.getRange("A2:E2").format.fill = colors.pale;
  s.getRange("B2:B200").dataValidation = { rule: { type: "list", values: ["Teórica", "Teórico-prática", "Laboratório", "Sala de Computadores"] } };
  s.getRange("C2:C200").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 500 } };
  addInstructions(wb, "Template de importação · Salas", [
    ["Regra", "Como preencher"],
    ["Uma linha por sala", "O nome identifica a sala. Se já existir, a importação atualiza capacidade, tipologias e equipamentos."],
    ["Tipo principal", "Use uma das opções da lista: Teórica, Teórico-prática, Laboratório ou Sala de Computadores."],
    ["Compatibilidades", "Separe várias tipologias por ponto e vírgula. O tipo principal é incluído automaticamente."],
    ["Equipamentos", "Separe os equipamentos por ponto e vírgula."],
    ["Linha de exemplo", "Substitua ou apague a linha 2 antes da importação definitiva."],
  ]);
  await save(wb, "modelo_salas_eseuc.xlsx", [["Salas", "A1:E5", "salas"], ["Instruções", "A1:B9", "instrucoes"]]);
}

console.log(JSON.stringify({ outputDir, files: ["modelo_ucs_eseuc.xlsx", "modelo_docentes_eseuc.xlsx", "modelo_salas_eseuc.xlsx"] }));
