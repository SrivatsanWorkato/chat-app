import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerProfiles } from "@/db/schema";
import { encryptProviderApiKey } from "@/lib/provider-crypto";
import { getSession } from "@/lib/session";

export async function PUT(request: Request, { params }: RouteContext<"/api/providers/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid provider" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
  const models = body.models as Record<string, unknown> | undefined;
  const fallbacks = body.fallbackModels as Record<string, unknown> | undefined;
  if (!name || name.length > 60 || !baseUrl || !models || [models.brain, models.blitz, models.image].some((model) => typeof model !== "string" || !model.trim() || model.length > 300)) return Response.json({ error: "Invalid provider" }, { status: 400 });
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return Response.json({ error: "Invalid provider URL" }, { status: 400 });
  } catch { return Response.json({ error: "Invalid provider URL" }, { status: 400 }); }
  const values = {
    name,
    baseUrl,
    brainModel: String(models.brain).trim(),
    blitzModel: String(models.blitz).trim(),
    imageModel: String(models.image).trim(),
    fallbackEnabled: body.fallbackEnabled === true,
    brainFallbackModel: typeof fallbacks?.brain === "string" ? fallbacks.brain.trim().slice(0, 300) : "",
    blitzFallbackModel: typeof fallbacks?.blitz === "string" ? fallbacks.blitz.trim().slice(0, 300) : "",
    imageFallbackModel: typeof fallbacks?.image === "string" ? fallbacks.image.trim().slice(0, 300) : "",
    updatedAt: new Date(),
    ...(apiKey !== undefined && apiKey !== "" ? encryptProviderApiKey(apiKey) : {}),
  };
  const [updated] = await db.update(providerProfiles).set(values).where(and(eq(providerProfiles.id, id), eq(providerProfiles.userId, session.user.id))).returning({ id: providerProfiles.id });
  if (!updated) return Response.json({ error: "Provider not found" }, { status: 404 });
  return Response.json({ id: updated.id });
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/providers/[id]">) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [deleted] = await db.delete(providerProfiles).where(and(eq(providerProfiles.id, id), eq(providerProfiles.userId, session.user.id))).returning({ id: providerProfiles.id });
  if (!deleted) return Response.json({ error: "Provider not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
