// Netlify Function que replica o endpoint Express /api/gemini/chat.
// Responde em modo de demonstração se GEMINI_API_KEY não estiver configurada.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const { prompt, chatHistory = [], geminiApiKey = "", geminiModel = "", regras = [], ucs = [], docentes = [], salas = [] } = body;

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
{"id":"temp","nome":"Nome curto","tipo":"hard","descricao":"...","escopo":"ano","anoCurricular":2,"config":{"anos":[2],"cursoIds":[],"traducaoSimples":"...","motor":{}},"peso":5,"ativa":true}
[FIM_REGRA]

ÂMBITO (obrigatório): indica SEMPRE a que anos a regra se aplica em config.anos (lista de
inteiros, ex.: [1,2]); usa [] APENAS se for mesmo transversal a todos os anos. Se o utilizador
NÃO disser claramente o(s) ano(s), NÃO devolvas ainda a regra — PERGUNTA primeiro "a que ano(s)
se aplica?". cursoIds fica [] (todos os cursos) salvo indicação contrária.

O campo config.motor é o que APLICA a regra ao motor de distribuição. Parâmetros suportados
(inclui SÓ os que o pedido implicar; omite os restantes):
- "plDiasPermitidos": ["Quarta","Quinta","Sexta"] — PL apenas nestes dias da semana.
- "ucConflitos": [["SIGLA1","SIGLA2"]] — pares de UCs que NÃO podem estar no mesmo bloco (ex.: docentes partilhados).
- "maxTPporMancha": 2 — máximo de turmas TP da mesma UC em simultâneo no mesmo bloco (n.º de salas).
- "semanasSoTurmaA": [16,17] — semanas globais (1-30) em que só a Turma A tem aulas.
- "semanasSoTurmaB": [8,9] — semanas globais em que só a Turma B tem aulas.
Se o pedido NÃO for traduzível nestes parâmetros, devolve a regra com "motor": {} e explica que ficará apenas documental (o motor ainda não suporta esse tipo de restrição).
`;

  const contents: any[] = [];
  (chatHistory || []).forEach((msg: any) => {
    contents.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] });
  });
  contents.push({ role: "user", parts: [{ text: prompt }] });

  // Chave introduzida na app (corpo do pedido) tem prioridade; senão usa a env var do servidor.
  const apiKey = (typeof geminiApiKey === "string" && geminiApiKey.trim()) || process.env.GEMINI_API_KEY;
  const configurada = apiKey && apiKey !== "MY_GEMINI_API_KEY";

  if (!configurada) {
    const texto = `Estou em modo de demonstração (GEMINI_API_KEY não configurada). Com base no pedido "${prompt}", sugiro:

[REGRA_DETETADA]
{"id":"ai_${Date.now()}","nome":"Regra personalizada","tipo":"soft","descricao":"${String(prompt).replace(/"/g, "'")}","escopo":"transversal","anoCurricular":"todos","config":{"contexto":"${String(prompt).replace(/"/g, "'")}"},"peso":5,"ativa":true}
[FIM_REGRA]

Clica em "Aceitar e Ativar Regra" para a gravar.`;
    return Response.json({ text: texto });
  }

  // Chamada REST direta à Gemini Developer API (chave em ?key=). Evita o SDK @google/genai,
  // que no runtime das functions cai num caminho de auth (Vertex/OAuth) → 401. fetch nativo (Node 22).
  try {
    const model = (typeof geminiModel === "string" && geminiModel.trim()) || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey as string)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.7 },
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return Response.json({ error: `Gemini ${r.status}: ${j?.error?.message || JSON.stringify(j)}` }, { status: 500 });
    }
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
    return Response.json({ text });
  } catch (error: any) {
    return Response.json({ error: "Erro ao comunicar com o Gemini: " + (error?.message || String(error)) }, { status: 500 });
  }
};
