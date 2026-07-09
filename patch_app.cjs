const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `        // Use UC-specific start date if set (e.g. year 2 starts on Thursday Sept 10).
        const anoDataInicio = motorAI[\`ano\${uc.anoCurricular}_dataInicioSem\${uc.semestre}\`];
        const dataInicio = uc.dataInicio || anoDataInicio || anoSem.dataInicioSemestre;`;

const replacement = `        // Use UC-specific start date if set (e.g. year 2 starts on Thursday Sept 10).
        const prop = \`dataInicioAno\${uc.anoCurricular}\` as keyof typeof anoSem;
        const anoDataInicio = (anoSem as any)?.[prop] || motorAI[\`ano\${uc.anoCurricular}_dataInicioSem\${uc.semestre}\`];
        const dataInicio = uc.dataInicio || anoDataInicio || anoSem.dataInicioSemestre;`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("App patched successfully.");
} else {
  console.log("Target not found in app.");
}
