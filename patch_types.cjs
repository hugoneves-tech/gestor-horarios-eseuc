const fs = require('fs');
const file = 'src/types.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `  ativo: boolean;
  dataInicioSemestre?: string; // YYYY-MM-DD — Monday of academic week 1`;

const replacement = `  ativo: boolean;
  dataInicioSemestre?: string; // YYYY-MM-DD — Monday of academic week 1
  dataInicioAno1?: string;
  dataInicioAno2?: string;
  dataInicioAno3?: string;
  dataInicioAno4?: string;`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Types patched successfully.");
} else {
  console.log("Target not found.");
}
