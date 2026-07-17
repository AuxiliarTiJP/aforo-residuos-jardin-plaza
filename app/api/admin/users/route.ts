import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseVerifierClient } from "@/lib/supabase/admin";

async function assertAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const verifier = createSupabaseVerifierClient();
  const admin = createSupabaseAdminClient();
  if (!token || !verifier || !admin) throw new Error("UNAUTHORIZED");
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", data.user.id).single();
  if (!profile?.is_active || profile.role !== "admin") throw new Error("FORBIDDEN");
  return admin;
}

function authError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  try {
    const admin = await assertAdmin(request);
    const [{ data: profiles, error }, { data: authPage }] = await Promise.all([
      admin.from("profiles").select("id, username, full_name, role, is_active, last_access").order("created_at", { ascending: false }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error) throw error;
    const authMap = new Map(authPage.users.map((item) => [item.id, item.last_sign_in_at]));
    const users = (profiles ?? []).map((item) => ({
      id: item.id,
      username: item.username,
      fullName: item.full_name,
      role: item.role,
      active: item.is_active,
      lastAccess: authMap.get(item.id) ?? item.last_access,
    }));
    return NextResponse.json({ users });
  } catch (cause) {
    return authError(cause) ?? NextResponse.json({ error: "No fue posible cargar los trabajadores" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await assertAdmin(request);
    const body = await request.json();
    const username = String(body.username ?? "").trim().toLowerCase();
    const fullName = String(body.fullName ?? "").trim();
    const password = String(body.password ?? "");
    const role = body.role === "admin" ? "admin" : "operator";
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      return NextResponse.json({ error: "El usuario debe tener entre 3 y 40 caracteres válidos" }, { status: 400 });
    }
    if (fullName.length < 3 || password.length < 8) {
      return NextResponse.json({ error: "Revisa el nombre y usa una contraseña de mínimo 8 caracteres" }, { status: 400 });
    }
    const email = `${username}@aforo.jardinplaza.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, full_name: fullName } });
    if (error) return NextResponse.json({ error: error.message.includes("registered") ? "Ese usuario ya existe" : error.message }, { status: 400 });
    const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, full_name: fullName, role, is_active: true });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (cause) {
    return authError(cause) ?? NextResponse.json({ error: "No fue posible crear el trabajador" }, { status: 500 });
  }
}
