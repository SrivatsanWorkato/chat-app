"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChatMode } from "@/lib/chat";
import { defaultPreferences, defaultProviderSettings, loadPreferences, loadProviderSettings, savePreferences, saveProviderSettings, type AppPreferences, type ProviderSettings, type ThemePreference } from "@/lib/settings";

const modeLabels: Record<ChatMode, string> = { auto: "Auto", brain: "Brain", blitz: "Blitz", mix: "Mix", image: "Image" };

export default function SettingsPage() {
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
  const [provider, setProvider] = useState<ProviderSettings>(defaultProviderSettings);
  const [status, setStatus] = useState("");
  const [conversationCount, setConversationCount] = useState(0);

  useEffect(() => {
    queueMicrotask(() => {
      setPreferences(loadPreferences());
      setProvider(loadProviderSettings());
    });
    void fetch("/api/conversations").then(async (response) => {
      if (response.ok) setConversationCount((await response.json()).length);
    });
  }, []);

  function save() {
    const next = {
      ...provider,
      baseUrl: provider.baseUrl.trim().replace(/\/+$/, ""),
      models: { brain: provider.models.brain.trim(), blitz: provider.models.blitz.trim(), image: provider.models.image.trim() },
    };
    if (next.enabled && (!next.baseUrl || !next.models.brain || !next.models.blitz || !next.models.image)) {
      setStatus("Base URL and Brain, Blitz, and Image models are required.");
      return;
    }
    savePreferences(preferences);
    saveProviderSettings(next);
    setProvider(next);
    setStatus("Settings saved");
    window.setTimeout(() => setStatus(""), 1800);
  }

  async function testConnection() {
    if (!provider.baseUrl.trim() || !provider.models.blitz.trim()) {
      setStatus("Base URL and a Blitz model are required to test the provider.");
      return;
    }
    setStatus("Testing connection…");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "blitz", messages: [{ role: "user", content: "Reply with OK." }], webSearch: false, provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: provider.models } }) });
      if (!response.ok || !response.body) throw new Error("Provider test failed");
      await response.body.cancel();
      setStatus("Provider connected");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Provider test failed");
    }
  }

  function clearCredentials() {
    const next = { ...provider, enabled: false, apiKey: "" };
    setProvider(next);
    saveProviderSettings(next);
    setStatus("Credentials cleared");
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
        <nav aria-label="Settings sections"><a href="#general">General</a><a href="#chat">Chat defaults</a><a href="#provider">Provider & models</a><a href="#data">Data</a><a href="#advanced">Advanced</a></nav>
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
            <ToggleRow title="Use custom provider" detail="Otherwise use built-in OpenRouter" checked={provider.enabled} onChange={(enabled) => setProvider((current) => ({ ...current, enabled }))} />
            <TextField label="Base URL" type="url" placeholder="https://api.example.com/v1" value={provider.baseUrl} onChange={(baseUrl) => setProvider((current) => ({ ...current, baseUrl }))} />
            <TextField label="API key" type="password" placeholder="Optional for local providers" value={provider.apiKey} onChange={(apiKey) => setProvider((current) => ({ ...current, apiKey }))} />
            {(["brain", "blitz", "image"] as const).map((capability) => <TextField key={capability} label={`${modeLabels[capability]} model`} placeholder={`${capability}-model-id`} value={provider.models[capability]} onChange={(value) => setProvider((current) => ({ ...current, models: { ...current.models, [capability]: value } }))} />)}
            <ToggleRow title="Custom fallbacks" detail="One backup model per mode" checked={provider.fallbackEnabled} onChange={(fallbackEnabled) => setProvider((current) => ({ ...current, fallbackEnabled }))} />
            {provider.fallbackEnabled && (["brain", "blitz", "image"] as const).map((capability) => <TextField key={`fallback-${capability}`} label={`${modeLabels[capability]} fallback`} placeholder="No fallback" value={provider.fallbackModels?.[capability] ?? ""} onChange={(value) => setProvider((current) => ({ ...current, fallbackModels: { ...current.fallbackModels, [capability]: value } }))} />)}
            <div className="settings-buttons"><Button variant="outline" onClick={testConnection}>Test connection</Button><Button variant="ghost" onClick={clearCredentials}>Clear credentials</Button></div><p className="settings-note">The API key stays in this browser. Web search requires endpoint support.</p>
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
