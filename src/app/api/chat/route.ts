import { ChatMessage, ChatRequest, CHAT_MODES, FALLBACK_MODELS, MODELS, ModelAttempt, RoutedMode } from "@/lib/chat";
import { completeWithFallback, generateImage, logStreamResult, ModelExecutionError, streamCompletion, StreamingCompletion } from "@/lib/openrouter";

const ROUTER_PROMPT = `Return exactly one JSON object: {"mode":"blitz|brain|image","rationale":"short reason"}. Use blitz for short answers and rewrites, brain for plans and complex work, and image only for explicit image generation.`;
const SYSTEM_PROMPTS = {
  blitz: "You are Blitz, a fast concise assistant. Answer directly and briefly.",
  brain: "You are Brain, a strategic assistant. Give an actionable, concise response. State essential assumptions only.",
} satisfies Record<Exclude<RoutedMode, "image">, string>;

function validMessages(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 30 && value.every((message) => {
    if (!message || typeof message !== "object") return false;
    const item = message as Partial<ChatMessage>;
    const contentLength = typeof item.content === "string" ? item.content.length : -1;
    const validAttachments = item.attachments === undefined || (Array.isArray(item.attachments) && item.attachments.length <= 4 && item.attachments.every((attachment) => typeof attachment.name === "string" && ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(attachment.mediaType) && typeof attachment.dataUrl === "string" && attachment.dataUrl.startsWith(`data:${attachment.mediaType};base64,`) && attachment.dataUrl.length <= 14_000_000));
    return (item.role === "user" || item.role === "assistant") && contentLength >= 0 && contentLength <= 20_000 && validAttachments && (contentLength > 0 || Boolean(item.attachments?.length));
  });
}

function deterministicRoute(message: ChatMessage): { mode: RoutedMode; rationale: string } | null {
  if (message.attachments?.length) return { mode: "brain", rationale: "Attachments require multimodal analysis." };
  const request = message.content.toLowerCase();
  if (/\b(create|generate|draw|design|render|make)\b.{0,35}\b(image|picture|photo|visual|logo|poster)\b/.test(request)) return { mode: "image", rationale: "The request explicitly asks for an image." };
  if (/\b(plan|strategy|strategize|compare|trade-?offs?|research|analy[sz]e|architecture|investigate)\b/.test(request)) return { mode: "brain", rationale: "The request requires planning or analysis." };
  if (/\b(rewrite|summari[sz]e|shorten|translate|headline|caption|hello|hi|hey)\b/.test(request) || request.length < 80) return { mode: "blitz", rationale: "This is a short or direct request." };
  return null;
}

async function decideRoute(messages: ChatMessage[]): Promise<{ mode: RoutedMode; rationale: string; trace: ModelAttempt[]; routeSource: "rule" | "model" }> {
  const latest = messages.at(-1)!;
  const deterministic = deterministicRoute(latest);
  if (deterministic) return { ...deterministic, trace: [], routeSource: "rule" };
  const result = await completeWithFallback("router", [MODELS.router, ...FALLBACK_MODELS.router], [{ role: "user", content: `${ROUTER_PROMPT}\n\n${latest.content}` }]);
  try {
    const parsed = JSON.parse(result.content) as { mode?: unknown; rationale?: unknown };
    if ((parsed.mode === "blitz" || parsed.mode === "brain" || parsed.mode === "image") && typeof parsed.rationale === "string") return { mode: parsed.mode, rationale: parsed.rationale, trace: result.trace, routeSource: "model" };
  } catch {}
  return { mode: "brain", rationale: "Brain safely handled an uncertain route.", trace: result.trace, routeSource: "model" };
}

function ndjson(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export async function POST(request: Request) {
  const trace: ModelAttempt[] = [];
  try {
    const body = (await request.json()) as Partial<ChatRequest>;
    if (!CHAT_MODES.includes(body.mode as ChatRequest["mode"]) || body.mode === "mix" || typeof body.webSearch !== "boolean" || !validMessages(body.messages)) return Response.json({ error: "Invalid chat request", trace }, { status: 400 });
    const messages = body.messages;
    const webSearch = body.webSearch;
    const selected: { mode: RoutedMode; rationale: string; trace: ModelAttempt[]; routeSource: "manual" | "rule" | "model" } = body.mode === "auto" ? await decideRoute(messages) : { mode: body.mode as RoutedMode, rationale: `You selected ${body.mode} mode.`, trace: [], routeSource: "manual" };
    trace.push(...selected.trace);
    const hasAttachments = messages.some((message) => message.attachments?.length);
    if (hasAttachments && selected.mode === "image") selected.mode = "brain";
    if (selected.mode === "image") {
      const image = await generateImage(MODELS.image, messages.at(-1)?.content ?? "");
      return Response.json({ mode: "image", model: MODELS.image, routeSource: selected.routeSource, rationale: selected.rationale, content: "I generated an image from your prompt.", image: { dataUrl: image.dataUrl, model: MODELS.image }, trace: [...trace, ...image.trace] });
    }

    const textMode: Exclude<RoutedMode, "image"> = selected.mode;
    const primary = hasAttachments ? MODELS.vision : MODELS[textMode];
    const fallbacks = hasAttachments ? FALLBACK_MODELS.vision : FALLBACK_MODELS[textMode];
    const models = [primary, ...fallbacks];
    const promptMessages = [{ role: "user" as const, content: SYSTEM_PROMPTS[textMode] }, ...messages];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(ndjson({ type: "meta", mode: textMode, model: primary, fallbackModels: fallbacks, routeSource: selected.routeSource, rationale: selected.rationale, webSearch, trace })));
        let visibleContent = false;
        for (const [index, model] of models.entries()) {
          const attemptController = new AbortController();
          const totalTimer = setTimeout(() => attemptController.abort(new Error("20-second total timeout")), 20_000);
          let upstream: StreamingCompletion | undefined;
          let eventCount = 0;
          let reasoningSeen = false;
          let finishReason: string | undefined;
          try {
            upstream = await streamCompletion(model, promptMessages, attemptController.signal, index > 0, webSearch);
            if (index > 0) controller.enqueue(encoder.encode(ndjson({ type: "fallback", model, routeSource: selected.routeSource, trace })));
            const reader = upstream.response.body!.getReader();
            let buffer = "";
            while (true) {
              const firstTokenTimer = !visibleContent ? setTimeout(() => attemptController.abort(new Error("10-second first-token timeout")), 10_000) : undefined;
              const { done, value } = await reader.read();
              clearTimeout(firstTokenTimer);
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
                eventCount += 1;
                const chunk = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string; reasoning?: string }; finish_reason?: string }>; error?: { code?: number; message?: string; metadata?: Record<string, unknown> } };
                if (chunk.error) {
                  const metadata = chunk.error.metadata ? JSON.stringify(chunk.error.metadata).replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "[attachment]").slice(0, 800) : "";
                  throw new Error([chunk.error.message ?? "Provider stream failed", chunk.error.code ? `code=${chunk.error.code}` : "", metadata ? `details=${metadata}` : ""].filter(Boolean).join(" | "));
                }
                const choice = chunk.choices?.[0];
                if (choice?.delta?.reasoning) reasoningSeen = true;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
                if (choice?.delta?.content) {
                  visibleContent = true;
                  controller.enqueue(encoder.encode(ndjson({ type: "delta", content: choice.delta.content })));
                }
              }
            }
            if (!visibleContent) throw new Error("Model returned no visible content");
            const completed = { ...logStreamResult(model, upstream.startedAt, "succeeded", index > 0), webSearch };
            trace.push(completed);
            console.info("[model] stream diagnostics", { model, generationId: upstream.generationId, eventCount, reasoningSeen, finishReason, webSearch });
            controller.enqueue(encoder.encode(ndjson({ type: "done", trace })));
            controller.close();
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Provider stream failed";
            const failed = { ...logStreamResult(model, upstream?.startedAt ?? performance.now(), "failed", index > 0, message), webSearch };
            trace.push(failed);
            console.error("[model] stream diagnostics", { model, generationId: upstream?.generationId, eventCount, reasoningSeen, finishReason, visibleContent, webSearch, error: message });
            if (visibleContent) {
              controller.enqueue(encoder.encode(ndjson({ type: "error", error: "The response was interrupted after partial output.", trace })));
              controller.close();
              return;
            }
          } finally {
            clearTimeout(totalTimer);
          }
        }
        controller.enqueue(encoder.encode(ndjson({ type: "status", status: webSearch ? "Searching the web" : "Choosing the best model" })));
        controller.enqueue(encoder.encode(ndjson({ type: "error", error: "All response models failed before producing output.", trace })));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelExecutionError) trace.push(...error.trace);
    const rawMessage = error instanceof Error ? error.message : "Unknown model error";
    console.error("[chat] request failure", { error: rawMessage });
    return Response.json({ error: rawMessage, trace }, { status: rawMessage.includes("not configured") ? 503 : 502 });
  }
}
