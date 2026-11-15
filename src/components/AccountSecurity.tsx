"use client";
// Settings → Account: change password, and sign out of every other device.
import { useState } from "react";
import { errorMessage, jsonBody } from "@/lib/http";
import { RecoveryCodeCard } from "./RecoveryCodeCard";

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

export function AccountSecurity({ demo, username, hasRecoveryCode }: { demo: boolean; username: string; hasRecoveryCode: boolean }) {
  return (
    <div className="space-y-6 mt-4">
      {demo ? (
        <p className="text-sm text-muted">This is a shared demo account, so it has no password to change.</p>
      ) : (
        <>
          <ChangePassword />
          <RecoveryCode username={username} has={hasRecoveryCode} />
        </>
      )}
      <SignOutOthers />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: "The two new passwords don't match." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
      if (!res.ok) return setMsg({ ok: false, text: errorMessage(res, await jsonBody(res), "Couldn't change the password.") });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    } catch {
      setMsg({ ok: false, text: OFFLINE });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="font-medium">Change password</div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" required className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="label" htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" required minLength={8} className="input" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">Type it again</label>
          <input id="pw-confirm" type="password" required minLength={8} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-read" : "text-skip"}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

/** Make a new recovery code (needs the password). Accounts from before codes existed start here. */
function RecoveryCode({ username, has }: { username: string; has: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [hasCode, setHasCode] = useState(has);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/recovery-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await jsonBody(res);
      if (!res.ok) return setError(errorMessage(res, data, "Couldn't make a new code."));
      setPassword("");
      setCode(String(data.recoveryCode));
      setHasCode(true);
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-5 border-t border-border">
      <div className="font-medium">Recovery code</div>
      {code ? (
        <div className="mt-3 max-w-sm">
          <RecoveryCodeCard code={code} username={username} intro="Your new recovery code. The old one no longer works." doneLabel="Done" onDone={() => setCode(null)} />
        </div>
      ) : (
        <>
          <p className={`text-sm mt-1 ${hasCode ? "text-muted" : "text-skip"}`}>
            {hasCode
              ? "You have one. It's what lets you reset a forgotten password. Lost it? Make a new one; the old one stops working."
              : "Your account doesn't have one yet, so a forgotten password couldn't be reset. Make one now and keep it somewhere safe."}
          </p>
          <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="rc-password">Your password</label>
              <input id="rc-password" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <button className={`btn ${hasCode ? "btn-ghost" : "btn-primary"}`} disabled={busy}>
              {busy ? "Making…" : hasCode ? "Make a new recovery code" : "Make my recovery code"}
            </button>
          </form>
          {error && <p className="text-sm text-skip mt-2" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

function SignOutOthers() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/sign-out-others", { method: "POST" });
      setMsg(res.ok ? { ok: true, text: "Done. Every other device will need to sign in again." } : { ok: false, text: errorMessage(res, await jsonBody(res), "That didn't work.") });
    } catch {
      setMsg({ ok: false, text: OFFLINE });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pt-5 border-t border-border">
      <div className="font-medium">Signed in somewhere else?</div>
      <p className="text-sm text-muted mt-1">Sign out on every other computer or phone. You stay signed in here.</p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-ghost" onClick={go} disabled={busy}>{busy ? "Signing out…" : "Sign out of all other devices"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-read" : "text-skip"}`} role="status">{msg.text}</span>}
      </div>
    </div>
  );
}
