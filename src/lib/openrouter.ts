import { ChatMessage, ModelAttempt } from "@/lib/chat";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

type OpenRouterError = {
  code?: number;
  message?: string;
  metadata?: Record<string, unknown>;
};

type CompletionResult = {
  id?: string;
  model?: string;
  provider?: string;
  choices?: Array<{ finish_reason?: string; native_finish_reason?: string; message?: { content?: string; reasoning?: string } }>;
  error?: OpenRouterError;
};

type ImageResult = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: OpenRouterError;
};

type OpenRouterPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

type OpenRouterMessage = { role: ChatMessage["role"]; content: string | OpenRouterPart[] };

export class ModelExecutionError extends Error {
  constructor(message: string, readonly trace: ModelAttempt[]) {
    super(message);
    this.name = "ModelExecutionError";
  }
}

function headers() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "Chat UI",
    "X-OpenRouter-Experimental-Metadata": "enabled",
  };
}

function openRouterMessages(messages: ChatMessage[]): OpenRouterMessage[] {
  return messages.map((message) => {
    if (!message.attachments?.length) return { role: message.role, content: message.content };
    const content: OpenRouterPart[] = [{ type: "text", text: message.content || "Analyze the attached files." }];
    for (const attachment of message.attachments) {
      content.push(attachment.mediaType === "application/pdf"
        ? { type: "file", file: { filename: attachment.name, file_data: attachment.dataUrl } }
        : { type: "image_url", image_url: { url: attachment.dataUrl } });
    }
    return { role: message.role, content };
  });
}

function sanitize(value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized.replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]").replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "[attachment]").slice(0, 800);
}

function errorDetail(error: OpenRouterError | undefined, status: number) {
  if (!error) return `OpenRouter HTTP ${status}`;
  const provider = typeof error.metadata?.provider_name === "string" ? error.metadata.provider_name : undefined;
  const raw = error.metadata?.raw ?? error.metadata?.error ?? error.metadata;
  return [error.message ?? `OpenRouter HTTP ${status}`, error.code ? `code=${error.code}` : "", provider ? `provider=${provider}` : "", raw ? `details=${sanitize(raw)}` : ""].filter(Boolean).join(" | ");
}

function safeError(error: unknown) {
  return sanitize(error instanceof Error ? error.message : "Unknown provider error");
}

function requestBody(model: string, messages: ChatMessage[], maxTokens: number, stream: boolean, webSearch = false, responseFormat?: unknown) {
  const hasPdf = messages.some((message) => message.attachments?.some((attachment) => attachment.mediaType === "application/pdf"));
  const disableReasoning = model === "qwen/qwen3.7-flash" || model === "inclusionai/ling-3.0-flash-fin:free";
  const plugins = [
    ...(hasPdf ? [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] : []),
    ...(webSearch ? [{ id: "web", max_results: 5 }] : []),
  ];
  return JSON.stringify({
    model,
    messages: openRouterMessages(messages),
    temperature: 0.4,
    max_tokens: maxTokens,
    stream,
    provider: { allow_fallbacks: true, sort: "latency", require_parameters: true },
    ...(disableReasoning ? { reasoning: { enabled: false, exclude: true } } : {}),
    ...(plugins.length ? { plugins } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
}

export async function completeWithFallback(
  stage: ModelAttempt["stage"],
  models: readonly string[],
  messages: ChatMessage[],
  options?: { maxTokens?: number; responseFormat?: unknown; timeoutMs?: number },
) {
  const trace: ModelAttempt[] = [];
  for (const [index, model] of models.entries()) {
    const startedAt = performance.now();
    console.info("[model] attempt", { stage, model, fallback: index > 0 });
    try {
      const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(options?.timeoutMs ?? 8_000),
        body: requestBody(model, messages, options?.maxTokens ?? 40, false, false, options?.responseFormat),
      });
      const result = (await response.json()) as CompletionResult;
      const choice = result.choices?.[0];
      const content = choice?.message?.content;
      if (!response.ok) throw new Error(errorDetail(result.error, response.status));
      if (!content) {
        const detail = [
          "Model returned no visible content",
          `HTTP ${response.status}`,
          result.model ? `resolved=${result.model}` : "",
          result.provider ? `provider=${result.provider}` : "",
          choice?.finish_reason ? `finish=${choice.finish_reason}` : "",
          choice?.native_finish_reason ? `nativeFinish=${choice.native_finish_reason}` : "",
          `reasoning=${Boolean(choice?.message?.reasoning)}`,
          `choices=${result.choices?.length ?? 0}`,
          result.id ? `generation=${result.id}` : "",
        ].filter(Boolean).join(" | ");
        console.error("[model] empty completion", { stage, requestedModel: model, detail });
        throw new Error(detail);
      }
      const durationMs = Math.round(performance.now() - startedAt);
      trace.push({ stage, model, status: "succeeded", durationMs, fallback: index > 0 });
      console.info("[model] success", { stage, requestedModel: model, resolvedModel: result.model, provider: result.provider, durationMs, fallback: index > 0 });
      return { content, model: result.model ?? model, trace };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = safeError(error);
      trace.push({ stage, model, status: "failed", durationMs, fallback: index > 0, error: message });
      console.error("[model] failure", { stage, model, durationMs, fallback: index > 0, error: message });
    }
  }
  throw new ModelExecutionError(`All ${stage} models failed`, trace);
}

export type StreamingCompletion = {
  response: Response;
  startedAt: number;
  generationId: string | null;
};

export async function streamCompletion(model: string, messages: ChatMessage[], signal: AbortSignal, fallback: boolean, webSearch: boolean): Promise<StreamingCompletion> {
  const startedAt = performance.now();
  console.info("[model] attempt", { stage: "response", model, fallback, stream: true, webSearch });
  const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal,
    body: requestBody(model, messages, 800, true, webSearch),
  });
  if (!response.ok || !response.body) {
    const result = await response.json().catch(() => ({})) as CompletionResult;
    const detail = errorDetail(result.error, response.status);
    console.error("[openrouter] request rejected", {
      model,
      status: response.status,
      statusText: response.statusText,
      generationId: response.headers.get("x-generation-id"),
      requestId: response.headers.get("x-request-id"),
      retryAfter: response.headers.get("retry-after"),
      detail,
    });
    throw new Error(detail);
  }
  return { response, startedAt, generationId: response.headers.get("x-generation-id") };
}

export function logStreamResult(model: string, startedAt: number, status: "succeeded" | "failed", fallback: boolean, error?: string) {
  const durationMs = Math.round(performance.now() - startedAt);
  const entry: ModelAttempt = { stage: "response", model, status, durationMs, fallback, ...(error ? { error } : {}) };
  console[status === "succeeded" ? "info" : "error"](`[model] ${status === "succeeded" ? "success" : "failure"}`, entry);
  return entry;
}

export async function generateImage(model: string, prompt: string) {
  const startedAt = performance.now();
  console.info("[model] attempt", { stage: "image", model, fallback: false });
  try {
    const response = await fetch(`${OPENROUTER_URL}/images`, {
      method: "POST", headers: headers(), body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: "1:1" }),
    });
    const result = (await response.json()) as ImageResult;
    const image = result.data?.[0];
    if (!response.ok || !image?.b64_json) throw new Error(result.error?.message ?? `Image generation HTTP ${response.status}`);
    const durationMs = Math.round(performance.now() - startedAt);
    console.info("[model] success", { stage: "image", model, durationMs, fallback: false });
    return { dataUrl: `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`, trace: [{ stage: "image", model, status: "succeeded", durationMs, fallback: false }] satisfies ModelAttempt[] };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message = safeError(error);
    const trace = [{ stage: "image", model, status: "failed", durationMs, fallback: false, error: message }] satisfies ModelAttempt[];
    console.error("[model] failure", trace[0]);
    throw new ModelExecutionError("Image generation failed", trace);
  }
}
