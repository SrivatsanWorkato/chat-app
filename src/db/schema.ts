import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { ChatAttachment, MessageRoute, MixPlan, MixTaskState } from "@/lib/chat";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export type MessageImage = { dataUrl: string; model: string };

export type MessageMix = { plan: MixPlan; tasks: MixTaskState[]; completed: boolean };

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 80 }).notNull().default("New chat"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: messageRole("role").notNull(),
    content: text("content").notNull().default(""),
    attachments: jsonb("attachments").$type<ChatAttachment[]>(),
    route: jsonb("route").$type<MessageRoute>(),
    image: jsonb("image").$type<MessageImage>(),
    mix: jsonb("mix").$type<MessageMix>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_position_idx").on(table.conversationId, table.position)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
