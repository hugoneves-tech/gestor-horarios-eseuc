import { createClient } from "@supabase/supabase-js";

// O supabase-js >= 2.107 exige WebSocket no arranque (realtime), que nao usamos.
// Em runtimes sem WebSocket nativo (Node < 22), um stub minimo satisfaz a verificacao.
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = class { close() {} send() {} } as any;
}


// Netlify Function: cria utilizadores convidados (@ese.uc.pt) — só admins.
// Replica /api/admin/convidar do servidor Express, usando a service role key.
const DOMINIO = "@ese.uc.pt";

export default async (req: Request): Promise<Response> => {
  // try/catch GLOBAL: qualquer exceção devolve JSON com a mensagem real, em vez de a
  // lambda rebentar (502 "error decoding lambda response" sem detalhe).
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !serviceRole) {
      return Response.json({ error: "Servidor sem SUPABASE_SERVICE_ROLE_KEY ou VITE_SUPABASE_URL configuradas (Site settings → Environment variables)." }, { status: 500 });
    }
    if (!/^https:\/\/.+\.supabase\.co$/.test(url)) {
      return Response.json({ error: `VITE_SUPABASE_URL com formato inesperado: "${url}" (esperado https://xxxx.supabase.co, sem aspas nem barra final).` }, { status: 500 });
    }
    const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

    // Autenticar o chamador e verificar que é admin.
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return Response.json({ error: "Não autenticado." }, { status: 401 });
    const { data: perfil } = await admin.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!perfil?.is_admin) return Response.json({ error: "Apenas administradores podem convidar." }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* vazio */ }
    const email = String(body.email || "").trim().toLowerCase();
    const papel = String(body.papel || "coordenador_1");
    const tornarAdmin = !!body.isAdmin;
    if (!email.endsWith(DOMINIO)) return Response.json({ error: `O email tem de terminar em ${DOMINIO}.` }, { status: 400 });

    const tempPassword = "ESEUC-" + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 900 + 100);
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: tempPassword, email_confirm: true });
    if (cErr || !created?.user) return Response.json({ error: cErr?.message || "Falha ao criar utilizador." }, { status: 400 });

    const { error: pErr } = await admin.from("profiles").upsert({ id: created.user.id, email, papel, is_admin: tornarAdmin });
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
    await admin.from("convites").upsert({ email, papel, criado_por: u.user.id, usado: true }, { onConflict: "email" });

    return Response.json({ ok: true, email, passwordTemporaria: tempPassword });
  } catch (e: any) {
    return Response.json({ error: `Exceção na função admin-convidar: ${e?.message || String(e)}` }, { status: 500 });
  }
};
