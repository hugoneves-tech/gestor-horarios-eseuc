const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `                <div className="p-4 border-b border-stone-100 bg-amber-50/40 space-y-2">
                  <label className="text-[10px] font-bold text-stone-700 block">Chave da API Google (Gemini)</label>
                  <p className="text-[9px] text-stone-500 leading-snug">
                    Cola a tua chave do Google AI Studio. Fica guardada apenas neste browser e é usada para o assistente responder com IA real. Sem chave, o assistente fica em modo de demonstração.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      value={geminiKeyDraft}
                      onChange={(e) => setGeminiKeyDraft(e.target.value)}
                      placeholder="AIza…"
                      className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-stone-300 rounded-lg text-[11px] font-mono"
                    />
                    <button
                      onClick={() => { guardarGeminiKey(geminiKeyDraft); setShowGeminiKeyPanel(false); showToast("Chave Gemini guardada neste browser."); }}
                      className="px-3 py-1.5 bg-stone-900 text-white hover:bg-stone-800 font-bold rounded-lg text-[10px]"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => { guardarGeminiKey(""); setGeminiKeyDraft(""); showToast("Chave Gemini removida."); }}
                      className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg text-[10px]"
                    >
                      Limpar
                    </button>
                  </div>`;

const replacement = `                <div className="p-4 border-b border-stone-100 bg-amber-50/40 space-y-2">
                  <label className="text-[10px] font-bold text-stone-700 block">Chave da API Google (Gemini)</label>
                  <p className="text-[9px] text-stone-500 leading-snug">
                    Para obteres uma chave, visita <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline font-medium hover:text-blue-800">Google AI Studio</a>, clica em "Get API key" e cria uma nova chave (é gratuito). Cola-a abaixo.
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="password"
                        value={geminiKeyDraft}
                        onChange={(e) => setGeminiKeyDraft(e.target.value)}
                        placeholder="AIza..."
                        className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-stone-300 rounded-lg text-[11px] font-mono"
                      />
                      <button
                        onClick={testarEGuardarGeminiKey}
                        disabled={testingGeminiKey}
                        className="px-3 py-1.5 bg-stone-900 text-white hover:bg-stone-800 font-bold rounded-lg text-[10px] disabled:opacity-50"
                      >
                        {testingGeminiKey ? "A testar..." : "Testar e Guardar"}
                      </button>
                      <button
                        onClick={() => { guardarGeminiKey(""); setGeminiKeyDraft(""); showToast("Chave Gemini removida."); setTestGeminiError(null); }}
                        className="px-3 py-1.5 bg-white border border-stone-300 text-stone-600 hover:bg-stone-100 font-bold rounded-lg text-[10px]"
                      >
                        Remover
                      </button>
                    </div>
                    {testGeminiError && (
                      <p className="text-[10px] font-bold text-red-600 mt-1">{testGeminiError}</p>
                    )}
                  </div>`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched successfully.");
} else {
  console.log("Target not found.");
}
