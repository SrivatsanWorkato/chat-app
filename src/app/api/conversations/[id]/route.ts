import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { serializeConversation, serializeMessage } from "@/db/serialize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.position));
  return Response.json({ ...serializeConversation(conversation), messages: rows.map(serializeMessage) });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { title?: unknown; pinned?: unknown };
  const values: { title?: string; pinned?: boolean } = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) return Response.json({ error: "Invalid title" }, { status: 400 });
    values.title = body.title.trim().slice(0, 80);
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") return Response.json({ error: "Invalid pinned flag" }, { status: 400 });
    values.pinned = body.pinned;
  }
  if (Object.keys(values).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });
  const [row] = await db.update(conversations).set(values).where(eq(conversations.id, id)).returning();
  if (!row) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json(serializeConversation(row));
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  const [row] = await db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
  if (!row) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
