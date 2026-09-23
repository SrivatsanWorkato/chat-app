"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type AuthMode = "login" | "signup";

const content = {
  login: {
    eyebrow: "Welcome back",
    title: "Continue your conversations",
    description: "Sign in to access your chats, models, and saved preferences.",
    submit: "Sign in",
    alternate: "New to Chat UI?",
    alternateAction: "Create an account",
    alternateHref: "/signup",
  },
  signup: {
    eyebrow: "Create your account",
    title: "A smarter workspace for every idea",
    description: "Save conversations, switch between models, and keep your work in one place.",
    submit: "Create account",
    alternate: "Already have an account?",
    alternateAction: "Sign in",
    alternateHref: "/login",
  },
} satisfies Record<AuthMode, Record<string, string>>;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const copy = content[mode];
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const result = mode === "signup"
      ? await authClient.signUp.email({ name: String(data.get("name") ?? "").trim(), email, password })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Unable to authenticate");
      setPending(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Product introduction">
        <Link href="/" className="auth-brand" aria-label="Chat UI home">
          <span className="auth-brand-mark"><Sparkles /></span>
          <span>Chat UI</span>
        </Link>
        <div className="auth-story-copy">
          <p className="auth-kicker">One space. Every model.</p>
          <h1>Turn a passing thought into something real.</h1>
          <p>Move from quick answers to deep research and polished visuals without changing tools.</p>
          <ul>
            <li><span><Check /></span>Choose the right model for every task</li>
            <li><span><Check /></span>Keep your conversations organized</li>
            <li><span><Check /></span>Bring your own provider when you need it</li>
          </ul>
        </div>
        <p className="auth-story-note">Private by design. Your workspace stays yours.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <span className="auth-brand-mark"><Sparkles /></span>
          <span>Chat UI</span>
        </div>
        <div className="auth-card">
          <header>
            <span className="auth-eyebrow">{copy.eyebrow}</span>
            <h2>{copy.title}</h2>
            <p>{copy.description}</p>
          </header>

          <form onSubmit={submit} className="auth-form">
            {mode === "signup" && (
              <label className="auth-field">
                <span>Name</span>
                <span className="auth-input-wrap">
                  <UserRound aria-hidden="true" />
                  <input name="name" type="text" autoComplete="name" placeholder="Your name" required />
                </span>
              </label>
            )}
            <label className="auth-field">
              <span>Email address</span>
              <span className="auth-input-wrap">
                <Mail aria-hidden="true" />
                <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
              </span>
            </label>
            <label className="auth-field">
              <span className="auth-label-row">
                <span>Password</span>
                {mode === "login" && <span className="auth-text-muted">Password recovery is not configured yet</span>}
              </span>
              <span className="auth-input-wrap">
                <LockKeyhole aria-hidden="true" />
                <input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"} minLength={8} required />
                <button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </label>
            {mode === "signup" && <p className="auth-hint">Use 8 or more characters. A passphrase is easiest to remember.</p>}

            <Button type="submit" size="lg" className="auth-submit" disabled={pending}>
              {pending ? "Please wait…" : copy.submit}{!pending && <ArrowRight data-icon="inline-end" />}
            </Button>
            {error && <p className="auth-demo-message auth-error" role="alert">{error}</p>}
          </form>

          <p className="auth-alternate">{copy.alternate} <Link href={copy.alternateHref}>{copy.alternateAction}</Link></p>
          {mode === "signup" && <p className="auth-terms">By creating an account, you agree to our <button type="button">Terms</button> and <button type="button">Privacy Policy</button>.</p>}
        </div>
      </section>
    </main>
  );
}
