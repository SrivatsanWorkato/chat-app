import type { ChatMode } from "@/lib/chat";

export type ThemePreference = "system" | "light" | "dark";

export type AppPreferences = {
  theme: ThemePreference;
  enterToSend: boolean;
  defaultMode: ChatMode;
  defaultWebSearch: boolean;
  diagnostics: boolean;
};

export type ProviderProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { brain: string; blitz: string; image: string };
  fallbackEnabled: boolean;
  fallbackModels: { brain: string; blitz: string; image: string };
};

export type ProviderStore = {
  providers: ProviderProfile[];
  activeId: string | null;
};

export const emptyProviderStore: ProviderStore = { providers: [], activeId: null };

export const defaultPreferences: AppPreferences = {
  theme: "system",
  enterToSend: true,
  defaultMode: "auto",
  defaultWebSearch: false,
  diagnostics: false,
};


export function loadPreferences(): AppPreferences {
  try {
    const stored = window.localStorage.getItem("chat-ui-preferences");
    if (!stored) return defaultPreferences;
    const value = JSON.parse(stored);
    return value && typeof value === "object" ? { ...defaultPreferences, ...value } : defaultPreferences;
  } catch {
    window.localStorage.removeItem("chat-ui-preferences");
    return defaultPreferences;
  }
}

export function loadProviderStore(): ProviderStore {
  try {
    const stored = window.localStorage.getItem("chat-ui-providers");
    if (stored) {
      const value = JSON.parse(stored) as { providers?: unknown; activeId?: unknown };
      if (value && typeof value === "object" && Array.isArray(value.providers)) {
        const providers = value.providers.filter((entry): entry is ProviderProfile => {
          if (!entry || typeof entry !== "object") return false;
          const item = entry as Partial<ProviderProfile>;
          return typeof item.id === "string" && item.id.length > 0
            && typeof item.name === "string" && item.name.trim().length > 0
            && typeof item.baseUrl === "string" && typeof item.apiKey === "string"
            && !!item.models && typeof item.models === "object"
            && typeof item.models.brain === "string" && typeof item.models.blitz === "string" && typeof item.models.image === "string"
            && typeof item.fallbackEnabled === "boolean"
            && !!item.fallbackModels && typeof item.fallbackModels === "object"
            && typeof item.fallbackModels.brain === "string" && typeof item.fallbackModels.blitz === "string" && typeof item.fallbackModels.image === "string";
        });
        const activeId = typeof value.activeId === "string" && providers.some((provider) => provider.id === value.activeId) ? value.activeId : null;
        return { providers, activeId };
      }
    }
  } catch {
    window.localStorage.removeItem("chat-ui-providers");
  }
  // Legacy single-provider migration: import the old entry under a hostname-derived name.
  try {
    const legacy = JSON.parse(window.localStorage.getItem("chat-ui-provider") ?? "null") as { enabled?: unknown; baseUrl?: unknown; apiKey?: unknown; models?: Partial<ProviderProfile["models"]>; fallbackEnabled?: unknown; fallbackModels?: Partial<ProviderProfile["fallbackModels"]> } | null;
    if (legacy && typeof legacy === "object") {
      const models = { brain: typeof legacy.models?.brain === "string" ? legacy.models.brain : "", blitz: typeof legacy.models?.blitz === "string" ? legacy.models.blitz : "", image: typeof legacy.models?.image === "string" ? legacy.models.image : "" };
      const hasAny = (typeof legacy.baseUrl === "string" && legacy.baseUrl) || (typeof legacy.apiKey === "string" && legacy.apiKey) || models.brain || models.blitz || models.image;
      if (hasAny) {
        let name = "Custom provider";
        try { name = new URL(typeof legacy.baseUrl === "string" ? legacy.baseUrl : "https://invalid.invalid").hostname || name; } catch {}
        const profile: ProviderProfile = {
          id: crypto.randomUUID(),
          name,
          baseUrl: typeof legacy.baseUrl === "string" ? legacy.baseUrl : "",
          apiKey: typeof legacy.apiKey === "string" ? legacy.apiKey : "",
          models,
          fallbackEnabled: legacy.fallbackEnabled === true,
          fallbackModels: { brain: typeof legacy.fallbackModels?.brain === "string" ? legacy.fallbackModels.brain : "", blitz: typeof legacy.fallbackModels?.blitz === "string" ? legacy.fallbackModels.blitz : "", image: typeof legacy.fallbackModels?.image === "string" ? legacy.fallbackModels.image : "" },
        };
        return { providers: [profile], activeId: legacy.enabled === true ? profile.id : null };
      }
    }
  } catch {}
  return emptyProviderStore;
}

export function savePreferences(preferences: AppPreferences) {
  window.localStorage.setItem("chat-ui-preferences", JSON.stringify(preferences));
  window.localStorage.setItem("chat-ui-theme", preferences.theme);
  const theme = preferences.theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preferences.theme;
  document.documentElement.dataset.theme = theme;
}

export function saveProviderStore(store: ProviderStore) {
  window.localStorage.setItem("chat-ui-providers", JSON.stringify(store));
  window.localStorage.removeItem("chat-ui-provider");
}

export type PresetMode = Exclude<ChatMode, "mix">;

export type ModelPreset = {
  id: string;
  name: string;
  provider: string;
  mode: PresetMode;
  systemPrompt: string;
};

export function loadPresets(): ModelPreset[] {
  try {
    const stored = window.localStorage.getItem("chat-ui-presets");
    if (!stored) return [];
    const value = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    const valid = value.filter((preset): preset is ModelPreset => {
      const item = preset as Partial<ModelPreset>;
      return typeof item.id === "string" && item.id.length > 0
        && typeof item.name === "string" && item.name.trim().length > 0
        && typeof item.provider === "string" && item.provider.length > 0
        && (item.mode === "auto" || item.mode === "brain" || item.mode === "blitz" || item.mode === "image")
        && typeof item.systemPrompt === "string";
    });
    // Legacy presets carried the generic "custom" flag; rebind them to the built-in provider.
    const migrated = valid.map((preset) => preset.provider === "custom" ? { ...preset, provider: "builtin" } : preset);
    if (migrated.some((preset, index) => preset !== valid[index])) savePresets(migrated);
    return migrated;
  } catch {
    window.localStorage.removeItem("chat-ui-presets");
    return [];
  }
}

export function savePresets(presets: ModelPreset[]) {
  window.localStorage.setItem("chat-ui-presets", JSON.stringify(presets));
}

export function loadActivePresetId(): string | null {
  try {
    const stored = window.localStorage.getItem("chat-ui-active-preset");
    return typeof stored === "string" && stored ? stored : null;
  } catch {
    return null;
  }
}

export function saveActivePresetId(id: string | null) {
  if (id) window.localStorage.setItem("chat-ui-active-preset", id);
  else window.localStorage.removeItem("chat-ui-active-preset");
}
