"use client";
// Applies the saved theme (dark, sepia…) once the page is running. The script in the root
// layout already does this before the first paint on normal pages, but pages React renders
// only in the browser (such as "not found") never run that script and came up light.
import { useEffect } from "react";
import { readTheme } from "./ThemeToggle";

export function ThemeSync() {
  useEffect(() => {
    const t = readTheme();
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }, []);
  return null;
}
