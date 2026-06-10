import { createClient } from "@supabase/supabase-js";

// Netlify Function: lista os utilizadores/perfis — só admins.
// Replica GET /api/admin/utilizadores do servidor Express.
export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !serviceRole) {
      return Response.json({ error: "Servidor sem SUPABASE_SERVICE_ROLE_KEY ou VITE_SUPABASE_URL configuradas." }, { status: 500 });
    }
    const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return Response.json({ error: "Não autenticado." }, { status: 401 });
    const { data: perfil } = await admin.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!perfil?.is_admin) return Response.json({ error: "Apenas administradores." }, { status: 403 });

    const { data, error } = await admin
      .from("profiles").select("id, email, papel, is_admin, created_at")
      .order("created_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ utilizadores: data ?? [] });
  } catch (e: any) {
    return Response.json({ error: `Exceção na função admin-utilizadores: ${e?.message || String(e)}` }, { status: 500 });
  }
};
