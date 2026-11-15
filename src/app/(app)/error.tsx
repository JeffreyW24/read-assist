"use client";
// A page inside the signed-in app failed: show this in place of the page, keeping the app's menu.
import { ErrorCard } from "@/components/ErrorCard";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorCard error={error} retry={retry} />;
}
