import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monthlyUsage, userPlans } from "@/db/schema";

export const PLAN_NAMES = ["free", "pro", "max"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];
export const QUOTA_RESOURCES = ["tokens", "images", "videos", "webSearches"] as const;
export type QuotaResource = (typeof QUOTA_RESOURCES)[number];
export type QuotaValues = Record<QuotaResource, number>;

export const PLAN_LIMITS: Record<PlanName, QuotaValues> = {
  free: { tokens: 100_000, images: 5, videos: 0, webSearches: 50 },
  pro: { tokens: 2_000_000, images: 100, videos: 10, webSearches: 1_000 },
  max: { tokens: 10_000_000, images: 500, videos: 50, webSearches: 5_000 },
};

export type UsageSnapshot = {
  plan: PlanName;
  /** Plan on record; differs from `plan` once an expiry has lapsed. */
  grantedPlan: PlanName;
  planExpiresAt: string | null;
  limits: QuotaValues;
  usage: QuotaValues;
  remaining: QuotaValues;
  resetAt: string;
};

export class QuotaExceededError extends Error {
  constructor(
    readonly resource: QuotaResource,
    readonly usage: number,
    readonly limit: number,
    readonly resetAt: string,
  ) {
    super(`${resource} quota exceeded`);
    this.name = "QuotaExceededError";
  }
}

const ZERO_USAGE: QuotaValues = { tokens: 0, images: 0, videos: 0, webSearches: 0 };

function period(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, resetAt };
}

export type EffectivePlan = { plan: PlanName; grantedPlan: PlanName; expiresAt: Date | null };

/** A lapsed paid grant behaves as free; a null expiry never lapses. */
export async function getUserPlan(userId: string): Promise<EffectivePlan> {
  await db.insert(userPlans).values({ userId }).onConflictDoNothing();
  const row = await db.query.userPlans.findFirst({ where: eq(userPlans.userId, userId) });
  const grantedPlan = row?.plan ?? "free";
  const expiresAt = row?.expiresAt ?? null;
  const lapsed = expiresAt !== null && expiresAt.getTime() <= Date.now();
  return { plan: lapsed ? "free" : grantedPlan, grantedPlan, expiresAt };
}

export async function getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
  const { plan, grantedPlan, expiresAt } = await getUserPlan(userId);
  const { periodStart, resetAt } = period();
  const row = await db.query.monthlyUsage.findFirst({ where: and(eq(monthlyUsage.userId, userId), eq(monthlyUsage.periodStart, periodStart)) });
  const usage: QuotaValues = row ? {
    tokens: row.tokens,
    images: row.images,
    videos: row.videos,
    webSearches: row.webSearches,
  } : { ...ZERO_USAGE };
  const limits = PLAN_LIMITS[plan];
  return {
    plan,
    grantedPlan,
    planExpiresAt: expiresAt?.toISOString() ?? null,
    limits,
    usage,
    remaining: Object.fromEntries(QUOTA_RESOURCES.map((resource) => [resource, Math.max(0, limits[resource] - usage[resource])])) as QuotaValues,
    resetAt: resetAt.toISOString(),
  };
}

export async function consumeQuota(userId: string, resource: QuotaResource, amount = 1) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Quota amount must be a positive integer");
  const { plan } = await getUserPlan(userId);
  const limit = PLAN_LIMITS[plan][resource];
  const { periodStart, resetAt } = period();
  await db.insert(monthlyUsage).values({ userId, periodStart }).onConflictDoNothing();
  const rows = await db.update(monthlyUsage)
    .set({ [resource]: sql`${monthlyUsage[resource]} + ${amount}`, updatedAt: new Date() })
    .where(and(
      eq(monthlyUsage.userId, userId),
      eq(monthlyUsage.periodStart, periodStart),
      sql`${monthlyUsage[resource]} + ${amount} <= ${limit}`,
    ))
    .returning({ usage: monthlyUsage[resource] });
  if (!rows[0]) {
    const snapshot = await getUsageSnapshot(userId);
    throw new QuotaExceededError(resource, snapshot.usage[resource], limit, resetAt.toISOString());
  }
  return { usage: rows[0].usage, limit, resetAt: resetAt.toISOString() };
}

export async function refundQuota(userId: string, resource: QuotaResource, amount = 1) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Quota amount must be a positive integer");
  const { periodStart } = period();
  await db.update(monthlyUsage)
    .set({ [resource]: sql`greatest(0, ${monthlyUsage[resource]} - ${amount})`, updatedAt: new Date() })
    .where(and(eq(monthlyUsage.userId, userId), eq(monthlyUsage.periodStart, periodStart)));
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function quotaErrorResponse(error: QuotaExceededError) {
  return Response.json({
    error: "Quota exceeded",
    code: "quota_exceeded",
    resource: error.resource,
    usage: error.usage,
    limit: error.limit,
    resetAt: error.resetAt,
  }, { status: 429 });
}
