import { GoogleGenAI } from "@google/genai";

// Netlify Function que replica o endpoint Express /api/gemini/chat.
// Responde em modo de demonstração se GEMINI_API_KEY não estiver configurada.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const { prompt, chatHistory = [], regras = [], ucs = [], docentes = [], salas = [] } = body;

  if (!prompt || String(prompt).trim() === "") {
    return Response.json({ error: "O campo de prompt é obrigatório." }, { status: 400 });
  }

  const systemInstruction = `
Você é o assistente do "Gestor de Horários ESEUC". Ajuda em português a:
1. Interpretar pedidos em texto livre e propor regras estruturadas (hard = inviolável, soft = preferência/peso).
2. Explicar conflitos e sugerir correções, de forma sucinta e profissional (sem auto-elogios).
3. Quando o pedido for claramente para criar uma regra, devolve um bloco JSON entre [REGRA_DETETADA] e [FIM_REGRA].

Contexto atual:
- Regras: ${JSON.stringify((regras || []).slice(0, 10))}
- UCs: ${JSON.stringify((ucs || []).slice(0, 10))}
- Docentes: ${JSON.stringify((docentes || []).slice(0, 10))}
- Salas: ${JSON.stringify((salas || []).slice(0, 10))}

Formato da regra (só quando aplicável):
[REGRA_DETETADA]
{"id":"temp","nome":"Nome curto","tipo":"hard","descricao":"...","escopo":"transversal","anoCurricular":"todos","config":{},"peso":5,"ativa":true}
[FIM_REGRA]
`;

  const contents: any[] = [];
  (chatHistory || []).forEach((msg: any) => {
    contents.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] });
  });
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const apiKey = process.env.GEMINI_API_KEY;
  const configurada = apiKey && apiKey !== "MY_GEMINI_API_KEY";

  if (!configurada) {
    const texto = `Estou em modo de demonstração (GEMINI_API_KEY não configurada). Com base no pedido "${prompt}", sugiro:

[REGRA_DETETADA]
{"id":"ai_${Date.now()}","nome":"Regra personalizada","tipo":"soft","descricao":"${String(prompt).replace(/"/g, "'")}","escopo":"transversal","anoCurricular":"todos","config":{"contexto":"${String(prompt).replace(/"/g, "'")}"},"peso":5,"ativa":true}
[FIM_REGRA]

Clica em "Aceitar e Ativar Regra" para a gravar.`;
    return Response.json({ text: texto });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents,
      config: { systemInstruction, temperature: 0.7 },
    });
    return Response.json({ text: response.text });
  } catch (error: any) {
    return Response.json({ error: "Erro ao comunicar com o Gemini: " + error.message }, { status: 500 });
  }
};
