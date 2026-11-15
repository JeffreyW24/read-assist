"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Removes an imported article from the account. The extension keeps its own copy. */
export function RemoveWebReading({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Remove this article from your account? It comes back only if you read it again with the extension.")) return;
          setBusy(true);
          setError("");
          try {
            const res = await fetch(`/api/web-readings/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error();
            router.push("/dashboard");
            router.refresh();
          } catch {
            setError("Couldn't remove it. Try again.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-sm text-skip" role="alert">{error}</span>}
    </span>
  );
}
