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

export type ChatRequest = {
  mode: ChatMode;
  messages: ChatMessage[];
  webSearch?: boolean;
  mixPlan?: MixPlan;
  approveImageTaskId?: string;
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
