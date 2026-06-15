import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// ---------------------------------------------------------------------------
// Cliente Supabase ADMIN (service role) — SÓ no servidor, NUNCA exposto ao cliente.
// Usado para criar utilizadores convidados e gerir perfis (registo é fechado).
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMINIO = "@ese.uc.pt";

const supabaseAdmin = (SUPABASE_URL && SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function getCaller(req: express.Request) {
  if (!supabaseAdmin) return null;
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error ? null : data.user;
}
async function callerIsAdmin(uid: string) {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
  return !!data?.is_admin;
}

// Convidar um utilizador (apenas admins). Cria a conta @ese.uc.pt com uma
// password temporária (devolvida ao admin) + o perfil com o papel indicado.
app.post("/api/admin/convidar", async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: "Servidor sem SUPABASE_SERVICE_ROLE_KEY configurada." });
  const caller = await getCaller(req);
  if (!caller) return res.status(401).json({ error: "Não autenticado." });
  if (!(await callerIsAdmin(caller.id))) return res.status(403).json({ error: "Apenas administradores podem convidar." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const papel = String(req.body?.papel || "coordenador_1");
  const tornarAdmin = !!req.body?.isAdmin;
  if (!email.endsWith(DOMINIO)) return res.status(400).json({ error: `O email tem de terminar em ${DOMINIO}.` });

  const tempPassword = "ESEUC-" + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 900 + 100);
  const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true,
  });
  if (cErr || !created?.user) return res.status(400).json({ error: cErr?.message || "Falha ao criar utilizador." });

  const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
    id: created.user.id, email, papel, is_admin: tornarAdmin,
  });
  if (pErr) return res.status(500).json({ error: pErr.message });

  await supabaseAdmin.from("convites").upsert(
    { email, papel, criado_por: caller.id, usado: true },
    { onConflict: "email" }
  );

  res.json({ ok: true, email, passwordTemporaria: tempPassword });
});

// Listar utilizadores/perfis (apenas admins).
app.get("/api/admin/utilizadores", async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: "Servidor sem service role." });
  const caller = await getCaller(req);
  if (!caller || !(await callerIsAdmin(caller.id))) return res.status(403).json({ error: "Apenas administradores." });
  const { data, error } = await supabaseAdmin
    .from("profiles").select("id, email, papel, is_admin, created_at")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ utilizadores: data ?? [] });
});

// Endpoint do assistente IA (Gemini). O motor de horários corre 100% no cliente
// (src/utils/distribuicao.ts) — não há solver nem SQL no servidor.
app.post("/api/gemini/chat", async (req, res) => {
  const { prompt, chatHistory = [], geminiApiKey = "", regras = [], ucs = [], docentes = [], salas = [] } = req.body;
  // Chave introduzida na app (corpo do pedido) tem prioridade; senão usa a env var do servidor.
  const reqKey = (typeof geminiApiKey === "string" && geminiApiKey.trim()) || process.env.GEMINI_API_KEY;

  if (!prompt || prompt.trim() === "") {
    return res.status(400).json({ error: "O campo de prompt é obrigatório." });
  }

  try {
    // Construct system instructions
    const systemInstruction = `
Voc? ? o assistente inteligente altamente especializado da plataforma "Gestor de Horários Académicos".
O utilizador está a planear horários e regras académicas complexas baseadas em PostgreSQL e OR-Tools de forma reutilizável.

Voc? ajuda em portuguàs a:
1. Interpretar pedidos em texto livre e propor regras estruturadas que dividem-se em "Hard constraints" (invioláveis) ou "Soft constraints" (preferências / pesos).
2. Fornecer respostas claras e profissionais, explicando conflitos se existirem, sugerindo corre?es e respondendo a d?vidas.
3. Se o texto incluir um pedido claro para criar uma regra (ex: "Adiciona uma regra para as sextas à tarde sem aulas"), responda educadamente e preencha uma estrutura JSON de regra opcional na resposta para o frontend.
4. NUNCA use auto-elogios como "espetacular" ou termos como "sou uma IA generativa". Seja focado na engenharia do horário académico, respeitoso e sucinto.

Contexto atual da aplicação:
- Regras Ativas: ${JSON.stringify(regras.slice(0, 10))}
- Unidades Curriculares (UCs): ${JSON.stringify(ucs.slice(0, 10))}
- Corpo de Docentes: ${JSON.stringify(docentes.slice(0, 10))}
- Salas e Caracter?sticas: ${JSON.stringify(salas.slice(0, 10))}

IMPORTANTE: Se o utilizador desejar traduzir regras em JSON estruturado, voc? pode fornecer isso de forma clara na resposta no formato:
[REGRA_DETETADA]
{
  "id": "temp_rule_id",
  "nome": "Nome Curto da Regra",
  "tipo": "hard" ou "soft",
  "descricao": "Descrição clara em portugu?s",
  "config": { ... },
  "ativa": true
}
[FIM_REGRA]
Se não for relevante detetar uma regra nova, não coloque estes blocos especiais.

O campo config.motor é o que APLICA a regra ao motor de distribuição. Parâmetros suportados
(inclui SÓ os que o pedido implicar, dentro de "config": {"traducaoSimples":"...","motor":{...}}):
- "plDiasPermitidos": ["Quarta","Quinta","Sexta"] — PL apenas nestes dias da semana.
- "ucConflitos": [["SIGLA1","SIGLA2"]] — pares de UCs que NÃO podem estar no mesmo bloco.
- "maxTPporMancha": 2 — máximo de TPs da mesma UC em simultâneo no mesmo bloco.
- "semanasSoTurmaA": [16,17] — semanas globais (1-30) em que só a Turma A tem aulas.
- "semanasSoTurmaB": [8,9] — semanas globais em que só a Turma B tem aulas.
Se o pedido NÃO for traduzível nestes parâmetros, devolve "motor": {} e explica que a regra fica documental.
`;

    // Map conversation pattern compatible with GoogleGenAI TS SDK chat pattern
    // Convert generic chat history to content parts array
    const contents: any[] = [];
    
    // Add past history chunks if available
    chatHistory.forEach((msg: any) => {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    });

    // Add latest user input
    contents.push({
      role: "user",
      parts: [{ text: prompt }]
    });

    const isApiKeyConfigured = reqKey && reqKey !== "MY_GEMINI_API_KEY";

    if (!isApiKeyConfigured) {
      // Graceful fallback description when key is not added
      const mockResultText = `Como o seu GEMINI_API_KEY ainda não foi configurado de forma personalizada nas suas variáveis secrets do Google AI Studio, estou a responder no modo de Demonstração Interativa! 

Com base no seu pedido: "${prompt}", eu sugero criar a seguinte regra estruturada:

[REGRA_DETETADA]
{
  "id": "ai_${Date.now()}",
  "nome": "Restri?o customizada de IA",
  "tipo": "soft",
  "descricao": "Proibir reuni?es/aulas de acordo com o pedido livre: ${prompt}",
  "config": { "contexto": "${prompt}" },
  "ativa": true
}
[FIM_REGRA]

Pode clicar em "Adicionar Regra" no assistente acima para ativ?-la no motor de otimização académica e testar instantaneamente!`;
      
      return res.json({ text: mockResultText });
    }

    // Chamada REST direta (chave em ?key=), igual à Netlify Function — evita o caminho de
    // auth do SDK que dava 401. fetch nativo (Node 18+).
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(reqKey as string)}`;
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
      return res.status(500).json({ error: `Gemini ${r.status}: ${j?.error?.message || JSON.stringify(j)}` });
    }
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
    res.json({ text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Erro ao comunicar com o Assistente Gemini: " + (error?.message || String(error)) });
  }
});

// Production client bundle and SPA serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Gestor Académico Cloud server] running on http://localhost:${PORT}`);
  });
}

startServer();


