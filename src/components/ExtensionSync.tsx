"use client";
// Brings in articles the eyeRead browser extension measured on other sites (WSJ etc.).
// The extension's content script runs on this page too: we say hello, it asks the student
// once whether to share, then hands over new or updated articles, and we save them to the
// account with the normal sign-in. Nothing happens if the extension isn't installed.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type State = "waiting" | "none" | "asking" | "syncing" | "done" | "declined" | "error";

export function ExtensionSync({ account }: { account: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("waiting");
  const [added, setAdded] = useState(0);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    let replied = false, stopped = false, tries = 0;
    const post = (msg: object) => window.postMessage({ source: "read-assist-app", account, ...msg }, location.origin);
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.source !== "read-assist-ext") return;
      replied = true;
      if (d.type === "status") {
        if (["asking", "declined", "error"].includes(d.state)) setState(d.state);
        return;
      }
      if (d.type !== "articles" || handled.current.has(d.id)) return;
      handled.current.add(d.id);
      const articles = Array.isArray(d.articles) ? d.articles : [];
      if (!articles.length) {
        setState("done");
        return;
      }
      setState("syncing");
      try {
        const res = await fetch("/api/web-readings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articles }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { changed: number };
        post({ type: "imported", id: d.id });
        setAdded((n) => n + j.changed);
        setState("done");
        if (j.changed) router.refresh();
      } catch {
        setState("error");
      }
    };
    window.addEventListener("message", onMsg);
    // The extension's script may load after this page does, so say hello a few times.
    const hello = () => {
      if (replied || stopped) return;
      if (tries++ >= 6) return setState("none");
      post({ type: "hello" });
      setTimeout(hello, 700);
    };
    hello();
    return () => {
      stopped = true;
      window.removeEventListener("message", onMsg);
    };
  }, [account, router]);

  const text: Record<State, string> = {
    waiting: "",
    none: "Read articles on other sites, like the WSJ? Add the eyeRead browser extension and they'll show up here.",
    asking: "The browser extension is asking whether to add your web reading. Choose Allow in the box on the page.",
    syncing: "Adding articles from the browser extension…",
    done: added
      ? `Added ${added} article${added === 1 ? "" : "s"} from the browser extension.`
      : "Connected to the browser extension. Articles you read on other sites show up here.",
    declined: "Not connected to the browser extension. Reload the page to be asked again.",
    error: "Couldn't add articles from the browser extension. Reload the page to try again.",
  };
  return (
    <p role="status" aria-live="polite" className="text-xs text-muted mt-2 min-h-4">
      {text[state]}
    </p>
  );
}
