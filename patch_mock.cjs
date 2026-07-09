const fs = require('fs');
const file = 'src/mockData.ts';
let code = fs.readFileSync(file, 'utf8');

const target1 = `{ id: "as1", anoLetivo: "2026/2027", semestre: 1, edicao: "Regular", ativo: true,  dataInicioSemestre: "2026-09-08" },`;
const replacement1 = `{ id: "as1", anoLetivo: "2026/2027", semestre: 1, edicao: "Regular", ativo: true,  dataInicioSemestre: "2026-09-08", dataInicioAno1: "2026-09-08", dataInicioAno2: "2026-09-08", dataInicioAno3: "2026-09-08", dataInicioAno4: "2026-09-08" },`;

const target2 = `{ id: "as2", anoLetivo: "2026/2027", semestre: 2, edicao: "Regular", ativo: false, dataInicioSemestre: "2027-02-01" },`;
const replacement2 = `{ id: "as2", anoLetivo: "2026/2027", semestre: 2, edicao: "Regular", ativo: false, dataInicioSemestre: "2027-02-01", dataInicioAno1: "2027-02-01", dataInicioAno2: "2027-02-01", dataInicioAno3: "2027-02-01", dataInicioAno4: "2027-02-01" },`;

if (code.includes(target1) && code.includes(target2)) {
  code = code.replace(target1, replacement1);
  code = code.replace(target2, replacement2);
  fs.writeFileSync(file, code);
  console.log("Mock patched successfully.");
} else {
  console.log("Target not found in mock.");
}
