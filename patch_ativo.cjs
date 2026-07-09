const fs = require('fs');
const file = 'src/components/ConfiguracaoCalendario.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `                    <span className={\`px-1.5 py-0.5 rounded text-[8.5px] font-bold border \${
                      anoSem.ativo
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-stone-50 text-stone-400 border-stone-200"
                    }\`}>
                      {anoSem.ativo ? "Ativo" : "Inativo"}
                    </span>`;

const replacement = `                    <button 
                      onClick={() => setAnosSemestres(anosSemestres.map(a => a.id === anoSem.id ? { ...a, ativo: !a.ativo } : a))}
                      className={\`cursor-pointer px-1.5 py-0.5 rounded text-[8.5px] font-bold border transition-all \${
                      anoSem.ativo
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-stone-50 text-stone-400 border-stone-200 hover:bg-stone-100"
                    }\`}>
                      {anoSem.ativo ? "Ativo" : "Inativo"}
                    </button>`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched config ativo.");
} else {
  console.log("Regex failed.");
}
