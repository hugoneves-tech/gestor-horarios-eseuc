const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try { return localStorage.getItem("eseuc_gemini_key") || ""; } catch { return ""; }
  });`;

const replacement = `  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try { return localStorage.getItem("eseuc_gemini_api_key") || ""; } catch { return ""; }
  });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched back successfully.");
}
