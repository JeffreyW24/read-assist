"use client";
// The Settings switch for the dyslexia-friendly font. It changes the page straight away, then
// saves to the account so every page (and the reader) uses it from now on.
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { errorMessage, jsonBody } from "@/lib/http";

function apply(on: boolean) {
  if (on) document.documentElement.dataset.font = "dyslexic";
  else delete document.documentElement.dataset.font;
}

export function DyslexiaFontToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  async function toggle() {
    const next = !on;
    setOn(next);
    apply(next);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dyslexiaFont: next }) });
      if (!res.ok) throw new Error(errorMessage(res, await jsonBody(res), "Couldn't save the setting."));
      router.refresh();
    } catch (e) {
      // Not saved: put the page back the way the account has it.
      setOn(!next);
      apply(!next);
      setError(e instanceof Error ? e.message : "Couldn't save the setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <label htmlFor={id} className="font-medium cursor-pointer">
            Dyslexia-friendly font
          </label>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            Uses OpenDyslexic everywhere on the site, including the reader. Its heavier letter bottoms and distinct letter shapes make
            letters harder to flip or mix up.
          </p>
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={toggle}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full border transition ${on ? "bg-accent border-accent" : "bg-surface-2 border-border"}`}
        >
          <span className="sr-only">{on ? "On" : "Off"}</span>
          <span className={`absolute top-0.5 h-5.5 w-5.5 rounded-full bg-surface shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      <p className="mt-4 rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[15px] leading-relaxed">
        Preview: The quick brown fox jumps over the lazy dog. b d p q · was saw · 69
      </p>
      {error && <p className="text-sm text-skip mt-2">{error}</p>}
    </div>
  );
}
