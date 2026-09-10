"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatMode, ChatResponse, MixPlan, MixTaskState } from "@/lib/chat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowUp, Menu, Mic, Moon, MoreVertical, Pin, Plus, Sparkles, Sun, Trash2, X } from "lucide-react";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  route?: Pick<ChatResponse, "mode" | "model" | "rationale" | "trace" | "routeSource"> & { fallbackModels?: string[]; webSearch?: boolean };
  image?: ChatResponse["image"];
  attachments?: ChatAttachment[];
  mix?: { plan: MixPlan; tasks: MixTaskState[]; completed: boolean };
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
};

const STORAGE_KEY = "chat-ui-conversations-v1";

const starters = [
  { icon: "✦", title: "Create an image", detail: "for my presentation" },
  { icon: "⌁", title: "Make a plan", detail: "for a weekend trip" },
  { icon: "</>", title: "Help me code", detail: "a small web app" },
  { icon: "◎", title: "Explain a concept", detail: "in simple terms" },
];

const initialMessages: Message[] = [];
const modeLabels: Record<ChatMode, string> = {
  auto: "Auto",
  brain: "Brain",
  blitz: "Blitz",
  mix: "Mix",
  image: "Image",
};


export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [mode, setMode] = useState<ChatMode>("auto");
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");
  const [developerMode, setDeveloperMode] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mixApproval, setMixApproval] = useState<{ messageId: number; prompt: string; plan: MixPlan; taskId: string } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editedMessage, setEditedMessage] = useState("");
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState("");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) as unknown : [];
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((item): item is Conversation => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.title === "string" && typeof item.updatedAt === "number" && Array.isArray(item.messages)));
        setConversations(valid);
        if (valid[0]) {
          setActiveConversationId(valid[0].id);
          setMessages(valid[0].messages);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, storageReady]);

  useEffect(() => {
    if (!storageReady || !activeConversationId) return;
    setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
      ? { ...conversation, messages, title: messages.find((message) => message.role === "user")?.content.slice(0, 44) || conversation.title, updatedAt: Date.now() }
      : conversation));
  }, [messages, activeConversationId, storageReady]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("chat-ui-theme");
    const initialTheme = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("chat-ui-theme", nextTheme);
  }
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isResponding]);
  function startNewChat() {
    const id = crypto.randomUUID();
    const conversation: Conversation = { id, title: "New chat", updatedAt: Date.now(), messages: [] };
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(id);
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
    setAttachments([]);
    setError("");
  }

  function selectConversation(conversation: Conversation) {
    if (isResponding) return;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setSidebarOpen(false);
    setError("");
  }

  function deleteConversation(id: string) {
    if (isResponding) return;
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (id === activeConversationId) {
      const next = remaining[0];
      setActiveConversationId(next?.id ?? "");
      setMessages(next?.messages ?? []);
    }
  }

  function togglePinnedConversation(id: string) {
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, pinned: !conversation.pinned } : conversation));
    setConversationMenuId(null);
  }

  function startRenamingConversation(conversation: Conversation) {
    setRenamingConversationId(conversation.id);
    setConversationTitle(conversation.title);
    setConversationMenuId(null);
  }

  function saveConversationTitle(id: string) {
    const title = conversationTitle.trim();
    if (!title) return;
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title: title.slice(0, 80), updatedAt: Date.now() } : conversation));
    setRenamingConversationId(null);
    setConversationTitle("");
  }
  async function runMix(prompt: string, plan?: MixPlan, approveImageTaskId?: string, existingMessageId?: number) {
    const assistantId = existingMessageId ?? Date.now() + 1;
    setRequestStatus(plan ? "Generating approved image" : "Planning workflow");
    setIsResponding(true);
    try {
      const response = await fetch("/api/mix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, plan, approveImageTaskId }) });
      if (!response.ok || !response.body) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Mix failed");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activePlan = plan;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; plan?: MixPlan; taskId?: string; model?: string; content?: string; output?: string; image?: { dataUrl: string; model: string }; error?: string };
          if (event.type === "mix_plan" && event.plan) {
            activePlan = event.plan;
            const mix = { plan: event.plan, tasks: event.plan.tasks.map((task) => ({ ...task, status: "pending" as const })), completed: false };
            if (existingMessageId) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, mix } : message));
            else setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", mix }]);
          } else if (event.type === "mix_task_started") {
            setRequestStatus(`Running ${event.taskId}`);
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, tasks: message.mix.tasks.map((task) => task.id === event.taskId ? { ...task, status: "running", model: event.model } : task) } } : message));
          } else if (event.type === "mix_task_delta") {
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, tasks: message.mix.tasks.map((task) => task.id === event.taskId ? { ...task, output: (task.output ?? "") + (event.content ?? "") } : task) } } : message));
          } else if (event.type === "mix_task_completed") {
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, tasks: message.mix.tasks.map((task) => task.id === event.taskId ? { ...task, status: "completed", output: event.output ?? task.output, image: event.image, model: event.model ?? task.model } : task) } } : message));
          } else if (event.type === "mix_approval" && event.taskId && activePlan) {
            setMixApproval({ messageId: assistantId, prompt, plan: activePlan, taskId: event.taskId });
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, tasks: message.mix.tasks.map((task) => task.id === event.taskId ? { ...task, status: "approval_required" } : task) } } : message));
          } else if (event.type === "mix_task_failed") {
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, tasks: message.mix.tasks.map((task) => task.id === event.taskId ? { ...task, status: "failed", error: event.error } : task) } } : message));
          } else if (event.type === "mix_completed") {
            setMessages((current) => current.map((message) => message.id === assistantId && message.mix ? { ...message, mix: { ...message.mix, completed: true } } : message));
          }
        }
      }
    } catch (mixError) {
      setError(mixError instanceof Error ? mixError.message : "Mix failed");
    } finally {
      setRequestStatus("");
      setIsResponding(false);
    }
  }


  async function submitMessage(text = input, requestedMode: ChatMode = mode) {
    const content = text.trim();
    if ((!content && attachments.length === 0) || isResponding) return;
    if (!activeConversationId) {
      const id = crypto.randomUUID();
      setActiveConversationId(id);
      setConversations((current) => [{ id, title: content.slice(0, 44) || "New chat", updatedAt: Date.now(), messages: [] }, ...current]);
    }

    const userMessage: Message = { id: Date.now(), role: "user", content, attachments };
    const recentMessages = messages.slice(-11);
    const requestMessages = [...recentMessages.map(({ role, content: messageContent }) => ({
      role,
      content: messageContent,
    })), {
      role: userMessage.role,
      content: userMessage.content,
      attachments: userMessage.attachments,
    }];
    setMessages((current) => [...current, userMessage]);
    setInput("");
    if (requestedMode === "mix") {
      runMix(content);
      return;
    }
    setAttachments([]);
    setError("");
    setRequestStatus(requestedMode === "auto" ? "Choosing the best model" : webSearch ? "Searching the web" : `${modeLabels[requestedMode]} is thinking`);
    setIsResponding(true);

    try {
      const request = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: requestedMode, messages: requestMessages, webSearch }),
      });
      if (!request.ok || request.headers.get("content-type")?.includes("application/json")) {
        const result = (await request.json()) as Partial<ChatResponse> & { error?: string };
        if (!request.ok) throw new Error(result.error ?? "The request failed");
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content: result.content ?? "", route: { mode: result.mode!, model: result.model!, rationale: result.rationale!, trace: result.trace ?? [] }, image: result.image }]);
        return;
      }

      const reader = request.body?.getReader();
      if (!reader) throw new Error("The response stream was unavailable");
      const assistantId = Date.now() + 1;
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantAdded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = JSON.parse(line) as { type: string; content?: string; mode?: ChatResponse["mode"]; model?: string; fallbackModels?: string[]; routeSource?: ChatResponse["routeSource"]; rationale?: string; webSearch?: boolean; status?: string; trace?: ChatResponse["trace"]; error?: string };
          if (event.type === "meta") {
            assistantAdded = true;
            setRequestStatus(event.webSearch ? "Searching the web" : `${modeLabels[event.mode!]} is thinking`);
            setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", route: { mode: event.mode!, model: event.model!, fallbackModels: event.fallbackModels, routeSource: event.routeSource, rationale: event.rationale!, webSearch: event.webSearch, trace: event.trace ?? [] } }]);
          } else if (event.type === "status" && event.status) {
            setRequestStatus(event.status);
          } else if (event.type === "fallback") {
            setRequestStatus(`Trying fallback ${event.model}`);
            setMessages((current) => current.map((message) => message.id === assistantId && message.route ? { ...message, route: { ...message.route, model: event.model ?? message.route.model, rationale: `Primary model failed; continuing with ${event.model}.`, trace: event.trace ?? message.route.trace } } : message));
          } else if (event.type === "delta" && event.content) {
            setRequestStatus("Generating response");
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + event.content } : message));
          } else if (event.type === "done") {
            setRequestStatus("");
            setMessages((current) => current.map((message) => message.id === assistantId && message.route ? { ...message, route: { ...message.route, trace: event.trace ?? [] } } : message));
          } else if (event.type === "error") {
            if (assistantAdded) setMessages((current) => current.map((message) => message.id === assistantId && message.route ? { ...message, content: message.content || event.error || "The provider stream failed", route: { ...message.route, trace: event.trace ?? [] } } : message));
            throw new Error(event.error ?? "The provider stream failed");
          }
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reach the assistant");
    } finally {
      setIsResponding(false);
      setRequestStatus("");
    }
  }

  async function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const remaining = 4 - attachments.length;
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) setError("You can attach up to 4 files per message.");

    for (const file of accepted) {
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError(`${file.name} is not supported. Use PDF, PNG, JPEG, or WebP.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds the 10 MB limit.`);
        continue;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read file"));
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
        reader.readAsDataURL(file);
      });
      setAttachments((current) => [...current, { name: file.name, mediaType: file.type as ChatAttachment["mediaType"], dataUrl }]);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitMessage();
  }
  function resendEditedMessage(messageId: number) {
    const index = messages.findIndex((message) => message.id === messageId && message.role === "user");
    const content = editedMessage.trim();
    if (index < 0 || !content || isResponding) return;
    setMessages(messages.slice(0, index));
    setEditingMessageId(null);
    setEditedMessage("");
    submitMessage(content, mode);
  }

  function startEditingMessage(message: Message) {
    setEditingMessageId(message.id);
    setEditedMessage(message.content);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  function retryMessage(messageId: number, nextMode: Exclude<ChatMode, "auto">) {
    const index = messages.findIndex((message) => message.id === messageId);
    const precedingUser = index >= 0 ? messages.slice(0, index).reverse().find((message) => message.role === "user") : undefined;
    if (!precedingUser) return;
    setMode(nextMode);
    submitMessage(precedingUser.content, nextMode);
  }

  return (
    <div className="app-shell">
      {sidebarOpen && <Button variant="ghost" className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <Button variant="ghost" size="icon" className="icon-button mobile-close" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X /></Button>
          <div className="brand-mark" aria-label="Chat UI"><Sparkles /></div>
          <Button variant="ghost" size="icon" className="icon-button" aria-label="New chat" onClick={startNewChat}><Plus /></Button>
        </div>
        <Button variant="ghost" className="new-chat" onClick={startNewChat}><Plus /><span>New chat</span></Button>
        <nav className="history" aria-label="Chat history">
          <p className="history-label">Conversations</p>
          {conversations.length === 0 && <p className="history-empty">No saved chats yet</p>}
          {[...conversations].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt).map((conversation) => (
            <div key={conversation.id} className={`history-row ${conversation.id === activeConversationId ? "active" : ""}`}>
              {renamingConversationId === conversation.id ? (
                <div className="history-rename">
                  <input value={conversationTitle} onChange={(event) => setConversationTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveConversationTitle(conversation.id); if (event.key === "Escape") setRenamingConversationId(null); }} autoFocus />
                  <button onClick={() => saveConversationTitle(conversation.id)}>Save</button>
                </div>
              ) : (
                <>
                  {conversation.pinned && <Pin className="history-pin" aria-label="Pinned" />}
                  <Button variant="ghost" className="history-item" onClick={() => selectConversation(conversation)} disabled={isResponding}>{conversation.title}</Button>
                  <div className="history-menu-wrap">
                    <Button variant="ghost" size="icon-sm" className="history-menu-trigger" onClick={() => setConversationMenuId((current) => current === conversation.id ? null : conversation.id)} disabled={isResponding} aria-label={`Actions for ${conversation.title}`}><MoreVertical /></Button>
                    {conversationMenuId === conversation.id && (
                      <div className="history-menu">
                        <button onClick={() => startRenamingConversation(conversation)}>Rename</button>
                        <button onClick={() => togglePinnedConversation(conversation.id)}><Pin />{conversation.pinned ? "Unpin" : "Pin"}</button>
                        <button className="danger" onClick={() => { setConversationMenuId(null); deleteConversation(conversation.id); }}><Trash2 />Delete</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>
        <Button variant="ghost" className="profile">
          <Avatar size="sm"><AvatarFallback>S</AvatarFallback></Avatar>
          <span className="profile-copy"><strong>Srivatsan</strong><small>Free plan</small></span>
          <span className="profile-more">•••</span>
        </Button>
      </aside>

      <main className="chat-main">
        <header className="topbar">
          <Button variant="ghost" size="icon" className="icon-button menu-button" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu /></Button>
          <Select value={mode} onValueChange={(value) => setMode(value as ChatMode)} disabled={isResponding}>
            <SelectTrigger className="mode-picker" aria-label="Assistant mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(modeLabels) as ChatMode[]).map((option) => (
                <SelectItem key={option} value={option}>{modeLabels[option]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="top-actions">
            <Button variant="ghost" size="icon" className="icon-button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <label className="developer-toggle">
              <Switch size="sm" checked={developerMode} onCheckedChange={setDeveloperMode} />
              Diagnostics
            </label>
            <Button variant="outline" className="share-button">Share</Button>
            <Button variant="ghost" size="icon" className="icon-button" aria-label="More options">•••</Button>
          </div>
        </header>

        <section className={`conversation ${messages.length === 0 ? "conversation-empty" : ""}`}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-mark"><Sparkles /></div>
              <h1>How can I help you today?</h1>
              <div className="starter-grid">
                {starters.map((starter) => (
                  <Card key={starter.title} size="sm" className="starter-card">
                    <Button variant="ghost" className="starter" onClick={() => submitMessage(`${starter.title} ${starter.detail}`)}>
                      <span className="starter-icon">{starter.icon}</span>
                      <span><strong>{starter.title}</strong><small>{starter.detail}</small></span>
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role}`}>
                  {message.role === "assistant" && <Avatar size="sm" className="message-avatar"><AvatarFallback><Sparkles /></AvatarFallback></Avatar>}
                  <div className="message-content">
                    {message.route && (
                      <div className="route-card">
                        <details className={`route-summary route-${message.route.mode}`}>
                          <summary>
                            <Badge variant="secondary">{modeLabels[message.route.mode]}</Badge>
                            {message.route.webSearch && <Badge variant="outline">web</Badge>}
                          </summary>
                          <div><span>Model</span><code>{message.route.model}</code></div>
                        </details>
                        {developerMode && message.route.trace.length > 0 && (
                          <details className="execution-trace">
                            <summary>{message.route.trace.length} model attempt{message.route.trace.length === 1 ? "" : "s"}</summary>
                            <div>{message.route.trace.map((attempt, index) => (
                              <p key={`${attempt.stage}-${attempt.model}-${index}`} className={attempt.status}>
                                <span>{attempt.status === "succeeded" ? "✓" : "×"}</span><b>{attempt.stage}</b><code>{attempt.model}</code>{attempt.fallback && <em>fallback</em>}<small>{attempt.durationMs} ms</small>{attempt.error && <i>{attempt.error}</i>}
                              </p>
                            ))}</div>
                          </details>
                        )}
                      </div>
                    )}
                    {message.mix && (
                      <Card className="mix-workflow">
                        <CardHeader>
                          <div><Badge variant="secondary">Mix plan</Badge><span>{message.mix.completed ? "Complete" : "In progress"}</span></div>
                          <CardTitle>{message.mix.plan.goal}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ol>
                            {message.mix.tasks.map((task) => (
                              <li key={task.id} className={`mix-task ${task.status}`}>
                                <div className="mix-task-head">
                                  <span className="mix-status">{task.status === "completed" ? "✓" : task.status === "failed" ? "!" : task.status === "running" ? "●" : task.status === "approval_required" ? "$" : "○"}</span>
                                  <strong>{task.title}</strong><Badge variant="outline">{task.capability}</Badge>
                                </div>
                                {task.model && <code>{task.model}</code>}
                                {task.output && <div className="mix-output"><ReactMarkdown remarkPlugins={[remarkGfm]}>{task.output}</ReactMarkdown></div>}
                                {task.image && <figure className="generated-image-wrap"><img className="generated-image" src={task.image.dataUrl} alt={task.title} /><a className="image-download" href={task.image.dataUrl} download={`${task.id}.png`}>Download</a></figure>}
                                {task.error && <Alert variant="destructive" className="mix-error"><AlertDescription>{task.error}</AlertDescription></Alert>}
                                {task.status === "approval_required" && mixApproval?.taskId === task.id && (
                                  <Button className="approve-image" onClick={() => { const approval = mixApproval; setMixApproval(null); runMix(approval.prompt, approval.plan, approval.taskId, approval.messageId); }} disabled={isResponding}>Generate image · ~$0.019</Button>
                                )}
                              </li>
                            ))}
                          </ol>
                        </CardContent>
                      </Card>
                    )}
                    {message.attachments?.length ? (
                      <div className="message-attachments">
                        {message.attachments.map((attachment) => attachment.mediaType.startsWith("image/") ? (
                          <img key={attachment.name} src={attachment.dataUrl} alt={attachment.name} />
                        ) : (
                          <span key={attachment.name} className="document-chip"><b>PDF</b>{attachment.name}</span>
                        ))}
                      </div>
                    ) : null}
                    {message.role === "user" && editingMessageId === message.id ? (
                      <div className="message-editor">
                        <Textarea value={editedMessage} onChange={(event) => setEditedMessage(event.target.value)} rows={3} autoFocus />
                        <div>
                          <Button type="button" variant="outline" onClick={() => { setEditingMessageId(null); setEditedMessage(""); }}>Cancel</Button>
                          <Button type="button" className="save-resend" onClick={() => resendEditedMessage(message.id)} disabled={!editedMessage.trim() || isResponding}>Save & resend</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="message-bubble">
                        {message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.content}
                      </div>
                    )}
                    {message.role === "user" && editingMessageId !== message.id && (
                      <Button type="button" variant="ghost" size="icon-sm" className="edit-message" onClick={() => startEditingMessage(message)} disabled={isResponding} aria-label="Edit and resend message" title="Edit message">
                        <span aria-hidden="true">⋮</span>
                      </Button>
                    )}
                    {message.image && (
                      <figure className="generated-image-wrap">
                        <img className="generated-image" src={message.image.dataUrl} alt="AI-generated result" />
                        <a className="image-download" href={message.image.dataUrl} download={`generated-image-${message.id}.png`} aria-label="Download generated image" title="Download image">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                          <span>Download</span>
                        </a>
                      </figure>
                    )}
                    {message.role === "assistant" && message.content && (
                      <div className="route-overrides" aria-label="Retry with another mode">
                        <span>Try with</span>
                        <Button variant="outline" size="xs" type="button" onClick={() => retryMessage(message.id, "blitz")} disabled={isResponding}>Blitz</Button>
                        <Button variant="outline" size="xs" type="button" onClick={() => retryMessage(message.id, "brain")} disabled={isResponding}>Brain</Button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {isResponding && requestStatus && <div className="request-status"><span /><strong>{requestStatus}</strong></div>}
              {isResponding && (
                <article className="message-row assistant">
                  <Avatar size="sm" className="message-avatar"><AvatarFallback><Sparkles /></AvatarFallback></Avatar>
                  <div className="typing"><span /><span /><span /></div>
                </article>
              )}
              {error && (
                <Alert variant="destructive" className="error-row">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div ref={endRef} />
            </div>
          )}
        </section>

        <div className="composer-area">
          <div className="mode-strip" aria-label="Model modes">
            {(Object.keys(modeLabels) as ChatMode[]).map((option) => (
              <Button variant={mode === option ? "default" : "outline"} size="sm" key={option} className={mode === option ? "active" : ""} onClick={() => setMode(option)} disabled={isResponding}>
                {modeLabels[option]}
              </Button>
            ))}
          </div>
          {attachments.length > 0 && (
            <div className="attachment-tray">
              {attachments.map((attachment, index) => (
                <div key={`${attachment.name}-${index}`} className="attachment-preview">
                  {attachment.mediaType.startsWith("image/")
                    ? <img src={attachment.dataUrl} alt="" />
                    : <span className="pdf-icon">PDF</span>}
                  <span>{attachment.name}</span>
                  <Button variant="ghost" size="icon-xs" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></Button>
                </div>
              ))}
            </div>
          )}
          <form className="composer" onSubmit={onSubmit}>
            <Textarea
              aria-label="Message"
              placeholder="Message Chat UI"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="composer-actions">
              <Tooltip>
                <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className={`web-toggle ${webSearch ? "active" : ""}`} aria-label="Search web" aria-pressed={webSearch} onClick={() => setWebSearch((enabled) => !enabled)} disabled={isResponding} />}>
                  <span aria-hidden="true">◎</span>
                </TooltipTrigger>
                <TooltipContent>Search web</TooltipContent>
              </Tooltip>
              <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onChange={onFilesSelected} />
              <Button type="button" variant="ghost" size="icon" className="composer-icon" aria-label="Attach images or PDFs" onClick={() => fileInputRef.current?.click()} disabled={isResponding || attachments.length >= 4}><Plus /></Button>
              <Button type="button" variant="ghost" size="icon" className="composer-icon" aria-label="Voice input"><Mic /></Button>
              <Button type="submit" size="icon" className="send-button" aria-label="Send message" disabled={(!input.trim() && attachments.length === 0) || isResponding}><ArrowUp /></Button>
            </div>
          </form>
          <p className="disclaimer">Chat UI can make mistakes. Check important info.</p>
        </div>
      </main>
    </div>
  );
}
