"use client";
// Shows a new recovery code once, and asks the person to keep it before moving on.
import { useState } from "react";

export function RecoveryCodeCard({
  code,
  username,
  intro,
  doneLabel = "Continue",
  onDone,
}: {
  code: string;
  username: string;
  intro: string;
  doneLabel?: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const text = `Read Assist recovery code\n\nUsername: ${username}\nRecovery code: ${code}\n\nUse it on the "Forgot password?" page to set a new password.\nIt works once; you'll get a new one after using it.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `read-assist-recovery-code-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" role="region" aria-label="Your recovery code">
      <p className="text-[15px] leading-relaxed">{intro}</p>
      <div className="rounded-xl border-2 border-dashed border-accent bg-accent-soft px-4 py-5 text-center">
        <div className="text-xs font-medium text-muted mb-1">Recovery code for {username}</div>
        <div className="font-mono text-2xl font-semibold tracking-widest select-all" data-testid="recovery-code">{code}</div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost flex-1"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-ghost flex-1" onClick={download}>
          Download
        </button>
      </div>
      <p className="text-sm text-muted leading-relaxed">
        Keep it somewhere safe (a note on your phone, or written down). It&apos;s the only way to reset a forgotten password, and it won&apos;t be shown again.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I&apos;ve saved my recovery code
      </label>
      <button type="button" className="btn btn-primary w-full !py-2.5" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
