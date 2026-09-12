export const CHAT_MODES = ["auto", "brain", "blitz", "mix", "image"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export type RoutedMode = Exclude<ChatMode, "auto" | "mix">;
export type MixCapability = "brain" | "blitz" | "image";

export type ChatAttachment = {
  name: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

export type MixTask = {
  id: string;
  title: string;
  capability: MixCapability;
  instruction: string;
  dependsOn: string[];
};

export type MixPlan = {
  goal: string;
  tasks: MixTask[];
};

export type MixTaskState = MixTask & {
  status: "pending" | "running" | "completed" | "failed" | "approval_required";
  model?: string;
  output?: string;
  image?: { dataUrl: string; model: string };
  error?: string;
};

export type CustomProviderConfig = {
  baseUrl: string;
  apiKey: string;
  models: {
    brain: string;
    blitz: string;
    image: string;
  };
  fallbackModels?: {
    brain?: string;
    blitz?: string;
    image?: string;
  };
};
export function parseCustomProvider(value: unknown): CustomProviderConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid custom provider configuration");
  const provider = value as Partial<CustomProviderConfig>;
  let url: URL;
  try { url = new URL(provider.baseUrl ?? ""); }
  catch { throw new Error("Custom provider base URL is invalid"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"))) {
    throw new Error("Custom provider must use HTTPS unless it runs locally");
  }
  if (typeof provider.apiKey !== "string" || provider.apiKey.length > 10_000) throw new Error("Custom provider API key is invalid");
  const models = provider.models;
  if (!models || typeof models !== "object" || !validModel(models.brain) || !validModel(models.blitz) || !validModel(models.image)) {
    throw new Error("Custom provider models are invalid");
  }
  const fallbackModels = provider.fallbackModels;
  if (fallbackModels !== undefined && (!fallbackModels || typeof fallbackModels !== "object"
    || !optionalModel(fallbackModels.brain) || !optionalModel(fallbackModels.blitz) || !optionalModel(fallbackModels.image))) {
    throw new Error("Custom provider fallback models are invalid");
  }
  return { baseUrl: url.toString().replace(/\/$/, ""), apiKey: provider.apiKey, models, fallbackModels };
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300;
}

function optionalModel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= 300);
}


export type ChatRequest = {
  mode: ChatMode;
  messages: ChatMessage[];
  webSearch?: boolean;
  mixPlan?: MixPlan;
  approveImageTaskId?: string;
  provider?: CustomProviderConfig;
};

export type ModelAttempt = {
  stage: "router" | "response" | "image";
  model: string;
  status: "succeeded" | "failed";
  durationMs: number;
  fallback: boolean;
  webSearch?: boolean;
  error?: string;
};

export type ChatResponse = {
  mode: RoutedMode;
  model: string;
  routeSource?: "manual" | "rule" | "model";
  rationale: string;
  content: string;
  trace: ModelAttempt[];
  image?: { dataUrl: string; model: string };
};

export const MODELS = {
  router: "mistralai/mistral-nemo",
  blitz: "inclusionai/ling-3.0-flash-fin:free",
  brain: "qwen/qwen3.7-flash",
  vision: "z-ai/glm-5.3-flash",
  image: "sourceful/riverflow-v2.5-fast",
} as const;

export const FALLBACK_MODELS = {
  router: ["openrouter/free"],
  blitz: ["mistralai/mistral-nemo"],
  brain: ["upstage/solar-pro4"],
  vision: [],
} as const;

export type MessageRoute = Pick<ChatResponse, "mode" | "model" | "rationale" | "trace" | "routeSource"> & { fallbackModels?: string[]; webSearch?: boolean };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  route?: MessageRoute;
  image?: ChatResponse["image"];
  attachments?: ChatAttachment[];
  mix?: { plan: MixPlan; tasks: MixTaskState[]; completed: boolean };
};
