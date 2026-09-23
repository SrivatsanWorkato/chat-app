import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerProfiles } from "@/db/schema";
import type { CustomProviderConfig } from "@/lib/chat";
import { decryptProviderApiKey } from "@/lib/provider-crypto";

export async function resolveProvider(userId: string, providerId: string): Promise<CustomProviderConfig | undefined> {
  const [profile] = await db.select().from(providerProfiles).where(and(eq(providerProfiles.id, providerId), eq(providerProfiles.userId, userId)));
  if (!profile) return undefined;
  return {
    baseUrl: profile.baseUrl,
    apiKey: decryptProviderApiKey(profile.encryptedApiKey, profile.apiKeyIv, profile.apiKeyTag),
    models: { brain: profile.brainModel, blitz: profile.blitzModel, image: profile.imageModel },
    ...(profile.fallbackEnabled ? { fallbackModels: {
      brain: profile.brainFallbackModel,
      blitz: profile.blitzFallbackModel,
      image: profile.imageFallbackModel,
    } } : {}),
  };
}
