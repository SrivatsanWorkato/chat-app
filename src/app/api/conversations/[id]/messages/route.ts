import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { serializeMessage } from "@/db/serialize";
import type { StoredMessage } from "@/lib/chat";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES: Record<string, true> = { "application/pdf": true, "image/jpeg": true, "image/png": true, "image/webp": true };
const TASK_STATUSES: Record<string, true> = { pending: true, running: true, completed: true, failed: true, approval_required: true };

type Context = { params: Promise<{ id: string }> };

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: StoredMessage["attachments"];
  route?: StoredMessage["route"];
  image?: StoredMessage["image"];
  mix?: StoredMessage["mix"];
};

function validAttachments(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value) || value.length > 4) return false;
  return value.every((attachment) => {
    if (!attachment || typeof attachment !== "object") return false;
    const item = attachment as { name?: unknown; mediaType?: unknown; dataUrl?: unknown };
    return typeof item.name === "string" && item.name.length <= 200
      && typeof item.mediaType === "string" && MEDIA_TYPES[item.mediaType]
      && typeof item.dataUrl === "string" && item.dataUrl.startsWith(`data:${item.mediaType};base64,`)
      && item.dataUrl.length <= 14_000_000;
  });
}

function validRoute(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as { mode?: unknown; model?: unknown; rationale?: unknown; trace?: unknown; fallbackModels?: unknown };
  if (typeof route.mode !== "string" || typeof route.model !== "string" || route.model.length > 200 || typeof route.rationale !== "string" || route.rationale.length > 2_000) return false;
  if (!Array.isArray(route.trace) || route.trace.length > 50) return false;
  if (route.fallbackModels !== undefined && (!Array.isArray(route.fallbackModels) || route.fallbackModels.some((model) => typeof model !== "string" || (model as string).length > 200))) return false;
  return true;
}

function validImage(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as { dataUrl?: unknown; model?: unknown };
  return typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/") && image.dataUrl.length <= 14_000_000
    && typeof image.model === "string" && image.model.length <= 200;
}

function validMix(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mix = value as { plan?: unknown; tasks?: unknown; completed?: unknown };
  if (!mix.plan || typeof mix.plan !== "object" || Array.isArray(mix.plan)) return false;
  const plan = mix.plan as { goal?: unknown; tasks?: unknown };
  if (typeof plan.goal !== "string" || plan.goal.length > 500 || !Array.isArray(plan.tasks) || plan.tasks.length > 20) return false;
  if (!Array.isArray(mix.tasks) || mix.tasks.length > 20 || typeof mix.completed !== "boolean") return false;
  return mix.tasks.every((task) => {
    if (!task || typeof task !== "object") return false;
    const item = task as { status?: unknown };
    return typeof item.status === "string" && TASK_STATUSES[item.status];
  });
}

function validIncoming(value: unknown): value is IncomingMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<IncomingMessage> & { id?: unknown };
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (typeof message.content !== "string" || message.content.length > 20_000) return false;
  return validAttachments(message.attachments) && validRoute(message.route) && validImage(message.image) && validMix(message.mix);
}

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  const body = await request.json().catch(() => null) as { messages?: unknown } | null;
  const incoming = body?.messages;
  if (!Array.isArray(incoming) || incoming.length > 500 || !incoming.every(validIncoming)) {
    return Response.json({ error: "Invalid messages payload" }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, id));
      if (!conversation) return null;
      await tx.delete(messages).where(eq(messages.conversationId, id));
      if (incoming.length > 0) {
        await tx.insert(messages).values(incoming.map((message, index) => ({
          conversationId: id,
          position: index,
          role: message.role,
          content: message.content,
          attachments: message.attachments ?? null,
          route: message.route ?? null,
          image: message.image ?? null,
          mix: message.mix ?? null,
        })));
      }
      const firstUser = incoming.find((message) => message.role === "user");
      const title = conversation.title === "New chat" && firstUser ? firstUser.content.slice(0, 44) || conversation.title : conversation.title;
      const [updated] = await tx.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
      const rows = await tx.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.position));
      return { conversation: updated, rows };
    });
    if (!result) return Response.json({ error: "Conversation not found" }, { status: 404 });
    return Response.json({
      title: result.conversation.title,
      updatedAt: result.conversation.updatedAt.toISOString(),
      messages: result.rows.map(serializeMessage),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to save messages";
    if (detail.includes("violates foreign key")) return Response.json({ error: "Conversation not found" }, { status: 404 });
    return Response.json({ error: detail }, { status: 500 });
  }
}
