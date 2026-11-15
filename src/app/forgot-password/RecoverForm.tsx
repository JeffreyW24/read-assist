"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, jsonBody } from "@/lib/http";
import { RecoveryCodeCard } from "@/components/RecoveryCodeCard";

export function RecoverForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code, password }),
      });
      const data = await jsonBody(res);
      if (!res.ok) return setError(errorMessage(res, data, "Couldn't reset the password."));
      setNewCode(String(data.recoveryCode));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (newCode)
    return (
      <RecoveryCodeCard
        code={newCode}
        username={username.trim().toLowerCase()}
        intro="Your password is changed and you're signed in. Your old recovery code is used up, so here's a new one."
        doneLabel="Go to my dashboard"
        onDone={() => {
          router.push("/dashboard");
          router.refresh();
        }}
      />
    );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input id="username" required className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </div>
      <div>
        <label className="label" htmlFor="code">Recovery code</label>
        <input id="code" required className="input font-mono tracking-widest uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </div>
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input id="password" type="password" required minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Type it again</label>
        <input id="confirm" type="password" required minLength={8} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-skip" role="alert">{error}</p>}
      <button className="btn btn-primary w-full !py-2.5" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
      <p className="text-sm text-muted leading-relaxed">
        Lost your recovery code too? The password can&apos;t be reset without it. Ask whoever runs eyeRead at your school for help.
      </p>
      <p className="text-sm text-center">
        <Link href="/login" className="text-accent hover:underline">← Back to sign in</Link>
      </p>
    </form>
  );
}
