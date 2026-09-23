import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerPreferences, providerProfiles } from "@/db/schema";
import { encryptProviderApiKey } from "@/lib/provider-crypto";
import { getSession } from "@/lib/session";

function serializeProvider(profile: typeof providerProfiles.$inferSelect) {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    hasApiKey: profile.encryptedApiKey.length > 0,
    models: { brain: profile.brainModel, blitz: profile.blitzModel, image: profile.imageModel },
    fallbackEnabled: profile.fallbackEnabled,
    fallbackModels: { brain: profile.brainFallbackModel, blitz: profile.blitzFallbackModel, image: profile.imageFallbackModel },
  };
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300;
}

function parseProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
  const models = body.models as Record<string, unknown> | undefined;
  const fallbacks = body.fallbackModels as Record<string, unknown> | undefined;
  if (!name || name.length > 60 || !baseUrl || apiKey.length > 20_000 || !models || !validModel(models.brain) || !validModel(models.blitz) || !validModel(models.image)) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
  } catch { return null; }
  const fallbackEnabled = body.fallbackEnabled === true;
  const fallbackModels = {
    brain: typeof fallbacks?.brain === "string" ? fallbacks.brain.trim().slice(0, 300) : "",
    blitz: typeof fallbacks?.blitz === "string" ? fallbacks.blitz.trim().slice(0, 300) : "",
    image: typeof fallbacks?.image === "string" ? fallbacks.image.trim().slice(0, 300) : "",
  };
  return { name, baseUrl, apiKey, models: { brain: models.brain.trim(), blitz: models.blitz.trim(), image: models.image.trim() }, fallbackEnabled, fallbackModels };
}

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [profiles, preference] = await Promise.all([
    db.select().from(providerProfiles).where(eq(providerProfiles.userId, session.user.id)).orderBy(asc(providerProfiles.createdAt)),
    db.select().from(providerPreferences).where(eq(providerPreferences.userId, session.user.id)),
  ]);
  return Response.json({ providers: profiles.map(serializeProvider), activeId: preference[0]?.activeProviderId ?? null });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const profile = parseProfile(await request.json().catch(() => null));
  if (!profile) return Response.json({ error: "Invalid provider" }, { status: 400 });
  const encrypted = encryptProviderApiKey(profile.apiKey);
  const [created] = await db.insert(providerProfiles).values({
    userId: session.user.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    ...encrypted,
    brainModel: profile.models.brain,
    blitzModel: profile.models.blitz,
    imageModel: profile.models.image,
    fallbackEnabled: profile.fallbackEnabled,
    brainFallbackModel: profile.fallbackModels.brain,
    blitzFallbackModel: profile.fallbackModels.blitz,
    imageFallbackModel: profile.fallbackModels.image,
  }).returning();
  return Response.json(serializeProvider(created), { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { activeId?: unknown } | null;
  const activeId = body?.activeId === null ? null : typeof body?.activeId === "string" ? body.activeId : undefined;
  if (activeId === undefined) return Response.json({ error: "Invalid active provider" }, { status: 400 });
  if (activeId) {
    const [owned] = await db.select({ id: providerProfiles.id }).from(providerProfiles).where(and(eq(providerProfiles.id, activeId), eq(providerProfiles.userId, session.user.id)));
    if (!owned) return Response.json({ error: "Provider not found" }, { status: 404 });
  }
  await db.insert(providerPreferences).values({ userId: session.user.id, activeProviderId: activeId }).onConflictDoUpdate({ target: providerPreferences.userId, set: { activeProviderId: activeId } });
  return Response.json({ activeId });
}
