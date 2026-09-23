import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const secret = process.env.PROVIDER_ENCRYPTION_KEY;
  if (!secret) throw new Error("PROVIDER_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptProviderApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    encryptedApiKey: encrypted.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptProviderApiKey(encryptedApiKey: string, apiKeyIv: string, apiKeyTag: string) {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(apiKeyIv, "base64"));
  decipher.setAuthTag(Buffer.from(apiKeyTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedApiKey, "base64")), decipher.final()]).toString("utf8");
}
