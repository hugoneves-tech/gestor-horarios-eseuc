const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `  // Helper to generate a reliable week label based on the academic calendar (ignoring holidays for display purpose simply)
  const getWeekLabel = (week: number) => {
    const start = new Date(2025, 8, 8); // Sep 8, 2025 (Monday)
    start.setDate(start.getDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 4); // Friday
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return \`\${start.getDate()} a \${end.getDate()} de \${months[end.getMonth()]}\`;
  };`;

const replacement = `  // Helper to generate a reliable week label based on the academic calendar (ignoring holidays for display purpose simply)
  const getWeekLabel = (week: number) => {
    const isSem2 = week >= 16;
    const s = isSem2 ? 2 : 1;
    const weekNumberInSem = isSem2 ? week - 15 : week;
    
    const matchS = anosSemestres.find(item => item.anoLetivo === selectedAnoLetivo && item.semestre === s);
    let startDateStr = matchS?.dataInicioSemestre;
    if (matchS && selectedYearFilter !== "todos") {
       const prop = \`dataInicioAno\${selectedYearFilter}\` as keyof typeof matchS;
       const yearDate = (matchS as any)?.[prop];
       if (yearDate) startDateStr = yearDate;
    }
    
    if (!startDateStr) startDateStr = isSem2 ? "2026-02-09" : "2025-09-08";
    
    const start = new Date(startDateStr);
    const dow = start.getDay();
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    start.setDate(start.getDate() - daysFromMonday);
    
    start.setDate(start.getDate() + (weekNumberInSem - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return \`\${start.getDate()} \${months[start.getMonth()]} a \${end.getDate()} \${months[end.getMonth()]}\`;
  };`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched getWeekLabel.");
} else {
  console.log("Regex failed.");
}
