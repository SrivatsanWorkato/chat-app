import type { ChatMode, CustomProviderConfig } from "@/lib/chat";

export type ThemePreference = "system" | "light" | "dark";

export type AppPreferences = {
  theme: ThemePreference;
  enterToSend: boolean;
  defaultMode: ChatMode;
  defaultWebSearch: boolean;
  diagnostics: boolean;
};

export type ProviderSettings = CustomProviderConfig & {
  enabled: boolean;
  fallbackEnabled: boolean;
};

export const defaultPreferences: AppPreferences = {
  theme: "system",
  enterToSend: true,
  defaultMode: "auto",
  defaultWebSearch: false,
  diagnostics: false,
};

export const defaultProviderSettings: ProviderSettings = {
  enabled: false,
  fallbackEnabled: false,
  baseUrl: "",
  apiKey: "",
  models: { brain: "", blitz: "", image: "" },
  fallbackModels: { brain: "", blitz: "", image: "" },
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

export function loadProviderSettings(): ProviderSettings {
  try {
    const stored = window.localStorage.getItem("chat-ui-provider");
    if (!stored) return defaultProviderSettings;
    const value = JSON.parse(stored);
    if (!value || typeof value !== "object") return defaultProviderSettings;
    return {
      ...defaultProviderSettings,
      ...value,
      models: { ...defaultProviderSettings.models, ...value.models },
      fallbackModels: { ...defaultProviderSettings.fallbackModels, ...value.fallbackModels },
    };
  } catch {
    window.localStorage.removeItem("chat-ui-provider");
    return defaultProviderSettings;
  }
}

export function savePreferences(preferences: AppPreferences) {
  window.localStorage.setItem("chat-ui-preferences", JSON.stringify(preferences));
  window.localStorage.setItem("chat-ui-theme", preferences.theme);
  const theme = preferences.theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preferences.theme;
  document.documentElement.dataset.theme = theme;
}

export function saveProviderSettings(provider: ProviderSettings) {
  window.localStorage.setItem("chat-ui-provider", JSON.stringify(provider));
}
