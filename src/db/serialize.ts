import type { StoredMessage } from "@/lib/chat";
import type { ConversationRow, MessageRow } from "./schema";

export function serializeConversation(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: row.attachments ?? undefined,
    route: row.route ?? undefined,
    image: row.image ?? undefined,
    mix: row.mix ?? undefined,
  };
}
