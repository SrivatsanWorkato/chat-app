import { synthesizeSpeech } from "@/lib/openrouter";
import { getSession } from "@/lib/session";

// Synthesizes one sentence-sized chunk; the browser requests chunks as the assistant streams and plays them in order.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 2000) return Response.json({ error: "Invalid speech request" }, { status: 400 });
  try {
    const upstream = await synthesizeSpeech(text, request.signal);
    return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to synthesize speech";
    console.error("[voice] speech synthesis failed", { error: detail });
    return Response.json({ error: detail }, { status: detail.includes("not configured") ? 503 : 502 });
  }
}
