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
  hasApiKey: boolean;
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

export async function fetchProviderStore(): Promise<ProviderStore> {
  // Provider keys used to live in localStorage as plaintext; remove any leftovers.
  window.localStorage.removeItem("chat-ui-providers");
  window.localStorage.removeItem("chat-ui-provider");
  const response = await fetch("/api/providers");
  if (!response.ok) return emptyProviderStore;
  const data = await response.json() as { providers: Omit<ProviderProfile, "apiKey">[]; activeId: string | null };
  return { providers: data.providers.map((provider) => ({ ...provider, apiKey: "" })), activeId: data.activeId };
}

export function savePreferences(preferences: AppPreferences) {
  window.localStorage.setItem("chat-ui-preferences", JSON.stringify(preferences));
  window.localStorage.setItem("chat-ui-theme", preferences.theme);
  const theme = preferences.theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preferences.theme;
  document.documentElement.dataset.theme = theme;
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
