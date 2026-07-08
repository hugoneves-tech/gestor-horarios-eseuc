import { GoogleGenAI } from "@google/genai";

// Netlify Function que replica o endpoint Express /api/gemini/chat.
// Responde em modo de demonstração se GEMINI_API_KEY não estiver configurada.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const { prompt, chatHistory = [], regras = [], ucs = [], docentes = [], salas = [], geminiApiKey, geminiModel } = body;

  if (!prompt || String(prompt).trim() === "") {
    return Response.json({ error: "O campo de prompt é obrigatório." }, { status: 400 });
  }

  const systemInstruction = `
Você é o assistente do "Gestor de Horários ESEUC". Ajuda em português a:
1. Interpretar pedidos em texto livre e propor regras estruturadas (hard = inviolável, soft = preferência/peso).
2. Explicar conflitos e sugerir correções, de forma sucinta e profissional (sem auto-elogios).
3. Quando o pedido for claramente para criar uma regra, devolve um bloco JSON entre [REGRA_DETETADA] e [FIM_REGRA].

Contexto atual:
- Regras: ${JSON.stringify(regras)}
- UCs: ${JSON.stringify(ucs)}
- Docentes: ${JSON.stringify(docentes)}
- Salas: ${JSON.stringify(salas)}

Formato da regra (só quando aplicável):
[REGRA_DETETADA]
{"id":"temp","nome":"Nome curto","tipo":"hard","descricao":"...","escopo":"transversal","anoCurricular":"todos","config":{"motor":{"plDiasPermitidos":["Quarta","Quinta","Sexta"],"ucConflitos":[["SIGLA1","SIGLA2"]],"maxTPporMancha":2,"semanasSoTurmaA":[8,9,10],"semanasSoTurmaB":[16,17,18],"restricoesUC":[{"siglas":["SIGLA1", "SIGLA2"],"diasProibidos":["Quinta", "Sexta"],"periodosProibidos":["tarde"],"tipos":["PL"],"semanasRestritas":[8,9,10,11,12]}]}},"peso":5,"ativa":true}
[FIM_REGRA]
Inclua no objeto 'motor' apenas as propriedades que fazem sentido para o pedido do utilizador. Se o pedido afetar várias UCs (ex: "do 2º ano"), DEVE mapear e incluir as 'siglas' de TODAS as UCs correspondentes na array 'siglas', baseando-se na lista de UCs fornecida.
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
    const finalApiKey = geminiApiKey || apiKey;
    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const response = await ai.models.generateContent({
      model: geminiModel || "gemini-2.0-flash",
      contents,
      config: { systemInstruction, temperature: 0.7 },
    });
    return Response.json({ text: response.text });
  } catch (error: any) {
    let errorMsg = "Erro ao comunicar com o Gemini: " + error.message;
    if (error.message && (error.message.includes("429") || error.message.includes("quota") || error.message.includes("RESOURCE_EXHAUSTED"))) {
       errorMsg = "A sua chave da API Gemini excedeu o limite gratuito (Quota Exceeded). Por favor verifique os limites ou atualize o plano de faturação. Poderá também aguardar uns minutos e tentar novamente.";
    }
    return Response.json({ error: errorMsg }, { status: 500 });
  }
};
