import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { serializeConversation } from "@/db/serialize";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(conversations).where(eq(conversations.userId, session.user.id)).orderBy(desc(conversations.updatedAt));
  return Response.json(rows.map(serializeConversation));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { title?: unknown };
  const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim().slice(0, 80) : "New chat";
  const [row] = await db.insert(conversations).values({ title, userId: session.user.id }).returning();
  return Response.json(serializeConversation(row), { status: 201 });
}
