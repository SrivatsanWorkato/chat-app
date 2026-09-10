import { desc } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { serializeConversation } from "@/db/serialize";

export async function GET() {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  return Response.json(rows.map(serializeConversation));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { title?: unknown };
  const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim().slice(0, 80) : "New chat";
  const [row] = await db.insert(conversations).values({ title }).returning();
  return Response.json(serializeConversation(row), { status: 201 });
}
