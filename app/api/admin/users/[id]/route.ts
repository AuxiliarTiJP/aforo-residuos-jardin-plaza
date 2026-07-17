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
  return { admin, requesterId: data.user.id };
}

function authError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, requesterId } = await assertAdmin(request);
    const { id } = await context.params;
    const body = await request.json();
    if (id === requesterId && body.active === false) {
      return NextResponse.json({ error: "No puedes desactivar tu propia cuenta" }, { status: 400 });
    }
    const profilePatch: Record<string, unknown> = {};
    if (typeof body.fullName === "string") profilePatch.full_name = body.fullName.trim();
    if (body.role === "admin" || body.role === "operator") profilePatch.role = body.role;
    if (typeof body.active === "boolean") profilePatch.is_active = body.active;
    if (Object.keys(profilePatch).length) {
      const { error } = await admin.from("profiles").update(profilePatch).eq("id", id);
      if (error) throw error;
    }
    if (typeof body.password === "string") {
      if (body.password.length < 8) return NextResponse.json({ error: "La contraseña debe tener mínimo 8 caracteres" }, { status: 400 });
      const { error } = await admin.auth.admin.updateUserById(id, { password: body.password });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return authError(cause) ?? NextResponse.json({ error: "No fue posible actualizar el trabajador" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, requesterId } = await assertAdmin(request);
    const { id } = await context.params;
    if (id === requesterId) return NextResponse.json({ error: "No puedes eliminar tu propia cuenta" }, { status: 400 });
    const { count, error: countError } = await admin
      .from("visit_records")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", id);
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Este trabajador tiene registros históricos. Desactívalo en lugar de eliminarlo." },
        { status: 409 },
      );
    }
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return authError(cause) ?? NextResponse.json({ error: "No fue posible eliminar el trabajador" }, { status: 500 });
  }
}
