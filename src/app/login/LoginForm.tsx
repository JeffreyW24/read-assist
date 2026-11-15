"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { Role } from "@/lib/types";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";

type Mode = "signin" | "signup";
interface Demo {
  id: string;
  name: string;
  role: Role;
}

export function LoginForm({ demos }: { demos: Demo[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<Role>("student");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set right after sign-up: the new account's recovery code, shown before going on.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError("");
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setBusy(false);
      return;
    }
    if (typeof data.recoveryCode === "string") {
      setRecoveryCode(data.recoveryCode);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signin") void post("/api/auth/login", { username, password });
    else void post("/api/auth/signup", { name, username, password, role });
  }

  if (recoveryCode)
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-4">Save your recovery code</h1>
        <RecoveryCodeCard
          code={recoveryCode}
          username={username.trim().toLowerCase()}
          intro="Your account is ready. If you ever forget your password, you'll need this code to set a new one."
          doneLabel="Go to my dashboard"
          onDone={() => {
            router.push("/dashboard");
            router.refresh();
          }}
        />
      </div>
    );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <p className="text-muted mt-1.5 mb-7 text-[15px]">
        {mode === "signin" ? "Sign in to pick up your readings." : "Teachers create courses; students join them with a code."}
      </p>

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <>
            <div>
              <span className="label">I am a…</span>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-surface-2 border border-border">
                {(["student", "professor"] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`rounded-lg py-2 text-sm font-medium transition ${role === r ? "bg-surface shadow-sm text-fg" : "text-muted hover:text-fg"}`}
                  >
                    {r === "student" ? "Student" : "Teacher"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="name">Name</label>
              <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Chen" autoComplete="name" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input
            id="username"
            required
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={mode === "signup" ? "e.g. alex.chen" : ""}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={mode === "signup" ? 30 : 200}
          />
          {mode === "signup" && <p className="text-xs text-muted mt-1">3–30 letters or numbers; you can also use . _ -</p>}
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </div>
        {error && <p className="text-sm text-skip">{error}</p>}
        {mode === "signin" && (
          <p className="text-right -mt-1">
            <Link href="/forgot-password" className="text-sm text-accent hover:underline">Forgot password?</Link>
          </p>
        )}
        <button className="btn btn-primary w-full !py-2.5" disabled={busy}>
          {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-muted mt-4 text-center">
        {mode === "signin" ? "New here? " : "Already have an account? "}
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
          }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>

      {demos.length > 0 && (
        <div className="mt-8 pt-6 border-t border-border">
          <div className="text-xs font-medium text-muted mb-2.5">Or try a demo account (no password)</div>
          <div className="grid gap-2">
            {demos.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={busy}
                onClick={() => void post("/api/auth/demo", { userId: d.id })}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:border-accent transition text-left"
              >
                <span className="font-medium truncate">{d.name}</span>
                <span className="text-xs text-muted">{d.role === "professor" ? "Teacher" : "Student"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
