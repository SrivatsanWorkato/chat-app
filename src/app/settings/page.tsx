"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChatMode } from "@/lib/chat";
import { defaultPreferences, emptyProviderStore, loadActivePresetId, loadPreferences, loadPresets, loadProviderStore, saveActivePresetId, savePreferences, savePresets, saveProviderStore, type AppPreferences, type ModelPreset, type PresetMode, type ProviderProfile, type ProviderStore, type ThemePreference } from "@/lib/settings";

const modeLabels: Record<ChatMode, string> = { auto: "Auto", brain: "Brain", blitz: "Blitz", mix: "Mix", image: "Image" };

export default function SettingsPage() {
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
  const [providerStore, setProviderStore] = useState<ProviderStore>(emptyProviderStore);
  const [providerDraft, setProviderDraft] = useState<Omit<ProviderProfile, "id"> & { id: string | null } | null>(null);
  const [status, setStatus] = useState("");
  const [conversationCount, setConversationCount] = useState(0);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [presetDraft, setPresetDraft] = useState<{ id: string | null; name: string; provider: string; mode: PresetMode; systemPrompt: string } | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setPreferences(loadPreferences());
      setProviderStore(loadProviderStore());
      setPresets(loadPresets());
    });
    void fetch("/api/conversations").then(async (response) => {
      if (response.ok) setConversationCount((await response.json()).length);
    });
  }, []);

  function save() {
    savePreferences(preferences);
    setStatus("Settings saved");
    window.setTimeout(() => setStatus(""), 1800);
  }

  function saveProviderDraft() {
    if (!providerDraft) return;
    const name = providerDraft.name.trim();
    const baseUrl = providerDraft.baseUrl.trim().replace(/\/+$/, "");
    if (!name || name.length > 60) {
      setStatus("Provider name must be 1-60 characters.");
      return;
    }
    if (!baseUrl) {
      setStatus("Base URL is required.");
      return;
    }
    try { new URL(baseUrl); } catch {
      setStatus("Base URL must be a valid URL.");
      return;
    }
    const models = { brain: providerDraft.models.brain.trim(), blitz: providerDraft.models.blitz.trim(), image: providerDraft.models.image.trim() };
    if (!models.brain || !models.blitz || !models.image) {
      setStatus("Brain, Blitz, and Image models are required.");
      return;
    }
    const profile: ProviderProfile = { id: providerDraft.id ?? crypto.randomUUID(), name, baseUrl, apiKey: providerDraft.apiKey, models, fallbackEnabled: providerDraft.fallbackEnabled, fallbackModels: { brain: providerDraft.fallbackModels.brain.trim(), blitz: providerDraft.fallbackModels.blitz.trim(), image: providerDraft.fallbackModels.image.trim() } };
    const providers = providerDraft.id ? providerStore.providers.map((existing) => existing.id === profile.id ? profile : existing) : [...providerStore.providers, profile];
    const next = { ...providerStore, providers };
    setProviderStore(next);
    saveProviderStore(next);
    setProviderDraft(null);
    setStatus("Provider saved");
    window.setTimeout(() => setStatus(""), 1800);
  }

  function deleteProvider(id: string) {
    const providers = providerStore.providers.filter((provider) => provider.id !== id);
    const next = { providers, activeId: providerStore.activeId === id ? null : providerStore.activeId };
    setProviderStore(next);
    saveProviderStore(next);
    setStatus("Provider deleted");
    window.setTimeout(() => setStatus(""), 1800);
  }

  function selectActiveProvider(id: string) {
    const next = { ...providerStore, activeId: id === "builtin" ? null : id };
    setProviderStore(next);
    saveProviderStore(next);
  }

  function savePreset() {
    if (!presetDraft) return;
    const name = presetDraft.name.trim();
    const systemPrompt = presetDraft.systemPrompt.trim();
    if (!name || name.length > 60) {
      setStatus("Preset name must be 1-60 characters.");
      return;
    }
    if (!systemPrompt || systemPrompt.length > 2000) {
      setStatus("System prompt must be 1-2000 characters.");
      return;
    }
    const preset: ModelPreset = { id: presetDraft.id ?? crypto.randomUUID(), name, provider: presetDraft.provider, mode: presetDraft.mode, systemPrompt };
    const next = presetDraft.id ? presets.map((existing) => existing.id === preset.id ? preset : existing) : [...presets, preset];
    setPresets(next);
    savePresets(next);
    setPresetDraft(null);
    setStatus("Preset saved");
    window.setTimeout(() => setStatus(""), 1800);
  }

  function deletePreset(id: string) {
    const next = presets.filter((preset) => preset.id !== id);
    setPresets(next);
    savePresets(next);
    if (loadActivePresetId() === id) saveActivePresetId(null);
    setStatus("Preset deleted");
    window.setTimeout(() => setStatus(""), 1800);
  }

  async function testConnection() {
    if (!providerDraft) return;
    if (!providerDraft.baseUrl.trim() || !providerDraft.models.blitz.trim()) {
      setStatus("Base URL and a Blitz model are required to test the provider.");
      return;
    }
    setStatus("Testing connection…");
    try {
      // The test streams from the Blitz model only. The server requires every model slot to be
      // non-empty, so unfilled Brain/Image slots are filled with the Blitz model for this call.
      const blitzModel = providerDraft.models.blitz.trim();
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "blitz", messages: [{ role: "user", content: "Reply with OK." }], webSearch: false, provider: { baseUrl: providerDraft.baseUrl, apiKey: providerDraft.apiKey, models: { brain: providerDraft.models.brain.trim() || blitzModel, blitz: blitzModel, image: providerDraft.models.image.trim() || blitzModel } } }) });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "Provider test failed");
      }
      await response.body.cancel();
      setStatus("Provider connected");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Provider test failed");
    }
  }


  async function exportConversations() {
    try {
      const rows = await (await fetch("/api/conversations")).json();
      const conversations = await Promise.all(rows.map(async (row: { id: string }) => (await fetch(`/api/conversations/${row.id}`)).json()));
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), conversations }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `chat-ui-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch { setStatus("Unable to export conversations"); }
  }

  async function deleteAll() {
    if (!window.confirm(`Delete all ${conversationCount} conversations? This cannot be undone.`)) return;
    const rows = await (await fetch("/api/conversations")).json();
    const responses = await Promise.all(rows.map((row: { id: string }) => fetch(`/api/conversations/${row.id}`, { method: "DELETE" })));
    if (responses.some((response) => !response.ok && response.status !== 404)) {
      setStatus("Unable to delete all conversations");
      return;
    }
    setConversationCount(0);
    setStatus("All conversations deleted");
  }

  return (
    <main className="settings-page">
      <header className="settings-page-header">
        <Link href="/" className="settings-back" aria-label="Back to chat"><ArrowLeft /></Link>
        <div><h1>Settings</h1><p>Customize Chat UI on this browser.</p></div>
        <Button onClick={save}>Save changes</Button>
      </header>
      {status && <div className="settings-status" role="status"><CheckCircle2 />{status}</div>}
      <div className="settings-layout">
        <nav aria-label="Settings sections"><a href="#general">General</a><a href="#chat">Chat defaults</a><a href="#provider">Provider & models</a><a href="#presets">Model presets</a><a href="#data">Data</a><a href="#advanced">Advanced</a></nav>
        <div className="settings-content">
          <section id="general" className="settings-card"><header><h2>General</h2><p>Appearance and message composition.</p></header><div className="settings-grid">
            <label><span>Theme</span><Select value={preferences.theme} onValueChange={(theme) => setPreferences((current) => ({ ...current, theme: theme as ThemePreference }))}><SelectTrigger aria-label="Theme preference"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select></label>
            <ToggleRow title="Enter to send" detail="Use Shift+Enter for a new line" checked={preferences.enterToSend} onChange={(enterToSend) => setPreferences((current) => ({ ...current, enterToSend }))} />
          </div></section>
          <section id="chat" className="settings-card"><header><h2>Chat defaults</h2><p>Initial behavior for new sessions.</p></header><div className="settings-grid">
            <label><span>Default mode</span><Select value={preferences.defaultMode} onValueChange={(defaultMode) => setPreferences((current) => ({ ...current, defaultMode: defaultMode as ChatMode }))}><SelectTrigger aria-label="Default mode"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(modeLabels) as ChatMode[]).map((mode) => <SelectItem key={mode} value={mode}>{modeLabels[mode]}</SelectItem>)}</SelectContent></Select></label>
            <ToggleRow title="Web search" detail="Enable web search by default" checked={preferences.defaultWebSearch} onChange={(defaultWebSearch) => setPreferences((current) => ({ ...current, defaultWebSearch }))} />
          </div></section>
          <section id="provider" className="settings-card"><header><h2>Provider & models</h2><p>Connect any OpenAI-compatible endpoint.</p></header><div className="settings-grid">
            <label><span>Active provider</span><Select value={providerStore.activeId ?? "builtin"} onValueChange={(value) => value !== null && selectActiveProvider(value)}><SelectTrigger aria-label="Active provider"><SelectValue>{(value: string | null) => !value || value === "builtin" ? "Built-in (OpenRouter)" : providerStore.providers.find((provider) => provider.id === value)?.name ?? "Unknown provider"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="builtin">Built-in (OpenRouter)</SelectItem>{providerStore.providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></label>
            {providerStore.providers.length === 0 && !providerDraft && <p className="settings-note">No custom providers yet. The built-in OpenRouter models are used until you add one.</p>}
            {providerStore.providers.map((provider) => (
              <div key={provider.id} className="provider-row">
                <span><strong>{provider.name}</strong><small>{provider.baseUrl}</small></span>
                <div className="settings-buttons"><Button variant="outline" size="sm" onClick={() => setProviderDraft({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: { ...provider.models }, fallbackEnabled: provider.fallbackEnabled, fallbackModels: { ...provider.fallbackModels } })}>Edit</Button><Button variant="ghost" size="sm" onClick={() => deleteProvider(provider.id)}>Delete</Button></div>
              </div>
            ))}
            {providerDraft ? (
              <div className="provider-form">
                <label><span>Name</span><input type="text" placeholder="My OpenRouter key" autoComplete="off" value={providerDraft.name} onChange={(event) => setProviderDraft((current) => current && { ...current, name: event.target.value })} /></label>
                <TextField label="Base URL" type="url" placeholder="https://api.example.com/v1" value={providerDraft.baseUrl} onChange={(baseUrl) => setProviderDraft((current) => current && { ...current, baseUrl })} />
                <TextField label="API key" type="password" placeholder="Optional for local providers" value={providerDraft.apiKey} onChange={(apiKey) => setProviderDraft((current) => current && { ...current, apiKey })} />
                {(["brain", "blitz", "image"] as const).map((capability) => <TextField key={capability} label={`${modeLabels[capability]} model`} placeholder={`${capability}-model-id`} value={providerDraft.models[capability]} onChange={(value) => setProviderDraft((current) => current && { ...current, models: { ...current.models, [capability]: value } })} />)}
                <ToggleRow title="Custom fallbacks" detail="One backup model per mode" checked={providerDraft.fallbackEnabled} onChange={(fallbackEnabled) => setProviderDraft((current) => current && { ...current, fallbackEnabled })} />
                {providerDraft.fallbackEnabled && (["brain", "blitz", "image"] as const).map((capability) => <TextField key={`fallback-${capability}`} label={`${modeLabels[capability]} fallback`} placeholder="No fallback" value={providerDraft.fallbackModels[capability]} onChange={(value) => setProviderDraft((current) => current && { ...current, fallbackModels: { ...current.fallbackModels, [capability]: value } })} />)}
                <div className="settings-buttons"><Button variant="outline" onClick={testConnection}>Test connection</Button><Button onClick={saveProviderDraft}>Save provider</Button><Button variant="ghost" onClick={() => setProviderDraft(null)}>Cancel</Button></div>
                <p className="settings-note">The API key stays in this browser. Web search requires endpoint support.</p>
              </div>
            ) : (
              <div className="settings-buttons"><Button onClick={() => setProviderDraft({ id: null, name: "", baseUrl: "", apiKey: "", models: { brain: "", blitz: "", image: "" }, fallbackEnabled: false, fallbackModels: { brain: "", blitz: "", image: "" } })}>New provider</Button></div>
            )}
          </div></section>
          <section id="presets" className="settings-card"><header><h2>Model presets</h2><p>Reusable provider, mode, and personality combos for the composer.</p></header><div className="settings-grid">
            {presets.length === 0 && !presetDraft && <p className="settings-note">No presets yet. A preset picks the provider and mode and adds a system prompt that gives the model its personality.</p>}
            {presets.map((preset) => (
              <div key={preset.id} className="preset-row">
                <span><strong>{preset.name}</strong><small>{preset.provider === "builtin" ? "Built-in (OpenRouter)" : providerStore.providers.find((provider) => provider.id === preset.provider)?.name ?? "Provider removed"} · {modeLabels[preset.mode]}</small></span>
                <div className="settings-buttons"><Button variant="outline" size="sm" onClick={() => setPresetDraft({ id: preset.id, name: preset.name, provider: preset.provider, mode: preset.mode, systemPrompt: preset.systemPrompt })}>Edit</Button><Button variant="ghost" size="sm" onClick={() => deletePreset(preset.id)}>Delete</Button></div>
              </div>
            ))}
            {presetDraft ? (
              <div className="preset-form">
                <label><span>Name</span><input type="text" placeholder="Pirate strategist" autoComplete="off" value={presetDraft.name} onChange={(event) => setPresetDraft((current) => current && { ...current, name: event.target.value })} /></label>
                <label><span>Provider</span><Select value={presetDraft.provider} onValueChange={(value) => value !== null && setPresetDraft((current) => current && { ...current, provider: value })}><SelectTrigger aria-label="Preset provider"><SelectValue>{(value: string | null) => !value || value === "builtin" ? "Built-in (OpenRouter)" : providerStore.providers.find((provider) => provider.id === value)?.name ?? "Unknown provider"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="builtin">Built-in (OpenRouter)</SelectItem>{providerStore.providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></label>
                <label><span>Mode</span><Select value={presetDraft.mode} onValueChange={(value) => setPresetDraft((current) => current && { ...current, mode: value as PresetMode })}><SelectTrigger aria-label="Preset mode"><SelectValue /></SelectTrigger><SelectContent>{(["auto", "brain", "blitz", "image"] as const).map((mode) => <SelectItem key={mode} value={mode}>{modeLabels[mode]}</SelectItem>)}</SelectContent></Select></label>
                <label><span>System prompt</span><textarea placeholder="You are a lighthouse keeper who explains things through sea stories." value={presetDraft.systemPrompt} onChange={(event) => setPresetDraft((current) => current && { ...current, systemPrompt: event.target.value })} /></label>
                <div className="settings-buttons"><Button onClick={savePreset}>Save preset</Button><Button variant="ghost" onClick={() => setPresetDraft(null)}>Cancel</Button></div>
              </div>
            ) : (
              <div className="settings-buttons"><Button onClick={() => setPresetDraft({ id: null, name: "", provider: "builtin", mode: "brain", systemPrompt: "" })}>New preset</Button></div>
            )}
          </div></section>
          <section id="data" className="settings-card"><header><h2>Data</h2><p>Manage {conversationCount} saved conversation{conversationCount === 1 ? "" : "s"}.</p></header><div className="settings-buttons"><Button variant="outline" onClick={exportConversations} disabled={!conversationCount}>Export conversations</Button><Button variant="destructive" onClick={deleteAll} disabled={!conversationCount}>Delete all</Button></div></section>
          <section id="advanced" className="settings-card"><header><h2>Advanced</h2><p>Developer-facing details.</p></header><ToggleRow title="Diagnostics" detail="Show model attempts and provider errors" checked={preferences.diagnostics} onChange={(diagnostics) => setPreferences((current) => ({ ...current, diagnostics }))} /></section>
        </div>
      </div>
    </main>
  );
}

function ToggleRow({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{title}</strong><small>{detail}</small></span><Switch checked={checked} onCheckedChange={onChange} /></label>;
}

function TextField({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label><span>{label}</span><input type={type} value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} /></label>;
}
