"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconLogout } from "./icons";

/**
 * Sign out. Only leaves the page once the server has ended the session: if the request
 * fails, going to the sign-in page would just bounce back to the dashboard, still signed in.
 */
export function LogoutButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="btn btn-ghost !px-2.5 !py-1.5 text-muted hover:text-fg"
        title="Sign out"
        aria-label="Sign out"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            const res = await fetch("/api/auth/logout", { method: "POST" });
            if (!res.ok) throw new Error();
            router.push("/login");
            router.refresh();
          } catch {
            setState("failed");
          }
        }}
      >
        <IconLogout size={16} />
      </button>
      {state === "failed" && (
        <span role="alert" className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
          Couldn&apos;t sign out: the server didn&apos;t answer. Check your connection and try again.
        </span>
      )}
    </span>
  );
}
