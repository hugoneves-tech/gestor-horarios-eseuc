const fs = require('fs');
const file = 'src/components/ModalConfigCalendario.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `    const s1Date = draftMotor[\`ano\${ano}_dataInicioSem1\`] || sem1?.dataInicioSemestre || "";
    const s2Date = draftMotor[\`ano\${ano}_dataInicioSem2\`] || sem2?.dataInicioSemestre || "";
    const wksA = formatWeeks(draftMotor[\`ano\${ano}_semanasSoTurmaA\`] ?? draftMotor.semanasSoTurmaA ?? (ano === 2 ? Array.from({length:8},(_,i)=>8+i) : []));
    const wksB = formatWeeks(draftMotor[\`ano\${ano}_semanasSoTurmaB\`] ?? draftMotor.semanasSoTurmaB ?? (ano === 2 ? Array.from({length:8},(_,i)=>16+i) : []));

    return (
      <div className="border border-stone-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-4">
        <h3 className="font-bold text-sm text-stone-700 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
          <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-md">{ano}º Ano Curricular</span>
        </h3>
        
        <div className="grid grid-cols-2 gap-4">
          {/* SEMESTER 1 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">1º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s1Date} onChange={e => updateMotor(\`ano\${ano}_dataInicioSem1\`, e.target.value)}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>`;

const replacement = `    const prop = \`dataInicioAno\${ano}\` as keyof typeof sem1;
    const s1Date = (sem1 as any)?.[prop] || sem1?.dataInicioSemestre || "";
    const s2Date = (sem2 as any)?.[prop] || sem2?.dataInicioSemestre || "";
    const wksA = formatWeeks(draftMotor[\`ano\${ano}_semanasSoTurmaA\`] ?? draftMotor.semanasSoTurmaA ?? (ano === 2 ? Array.from({length:8},(_,i)=>8+i) : []));
    const wksB = formatWeeks(draftMotor[\`ano\${ano}_semanasSoTurmaB\`] ?? draftMotor.semanasSoTurmaB ?? (ano === 2 ? Array.from({length:8},(_,i)=>16+i) : []));

    return (
      <div className="border border-stone-200 rounded-xl p-4 bg-white shadow-sm flex flex-col gap-4">
        <h3 className="font-bold text-sm text-stone-700 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
          <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded-md">{ano}º Ano Curricular</span>
        </h3>
        
        <div className="grid grid-cols-2 gap-4">
          {/* SEMESTER 1 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">1º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s1Date} onChange={e => {
                  if (sem1) setDraftAnoSem(prev => prev.map(a => a.id === sem1.id ? { ...a, [prop]: e.target.value } : a));
                }}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>`;

const target2 = `          {/* SEMESTER 2 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">2º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s2Date} onChange={e => updateMotor(\`ano\${ano}_dataInicioSem2\`, e.target.value)}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>`;

const replacement2 = `          {/* SEMESTER 2 */}
          <div className="space-y-3 bg-stone-50/50 p-3 rounded-lg border border-stone-100">
            <h4 className="text-xs font-bold text-stone-800">2º Semestre</h4>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Data de Início Específica</label>
              <input type="date" value={s2Date} onChange={e => {
                  if (sem2) setDraftAnoSem(prev => prev.map(a => a.id === sem2.id ? { ...a, [prop]: e.target.value } : a));
                }}
                className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-xs focus:ring-1 focus:ring-teal-500 outline-none" />
            </div>`;

if (code.includes(target) && code.includes(target2)) {
  code = code.replace(target, replacement);
  code = code.replace(target2, replacement2);
  fs.writeFileSync(file, code);
  console.log("Modal patched successfully.");
} else {
  console.log("Target not found in modal.");
}
