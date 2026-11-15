"use client";
// Last resort: the root layout itself failed. It replaces the whole document, so it can't
// rely on the app's styles and keeps its own small inline ones.
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#faf9f7", color: "#1c1917" }}>
        <title>Something went wrong · Read Assist</title>
        <div style={{ maxWidth: 420, padding: 28, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#57534e", lineHeight: 1.5 }}>Read Assist couldn&apos;t load. Nothing you saved is lost. Try again in a moment.</p>
          <button onClick={() => retry()} style={{ font: "inherit", padding: "9px 18px", borderRadius: 8, border: 0, background: "#1c1917", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
