"use client";
// Any other page failed (the reader, sign-in, or the app's own layout).
import { ErrorCard } from "@/components/ErrorCard";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorCard error={error} retry={retry} />;
}
