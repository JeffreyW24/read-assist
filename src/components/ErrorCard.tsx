"use client";
// What visitors see when a page fails to load (see app/error.tsx and app/(app)/error.tsx),
// instead of the framework's bare error screen.
import Link from "next/link";
import { useEffect } from "react";

export function ErrorCard({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Server errors carry an id that matches the server log; handy when someone reports it.
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="card max-w-md w-full p-7 text-center" role="alert">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted mt-2 leading-relaxed">
          This page couldn&apos;t load. It&apos;s usually a brief connection problem, so trying again often works. Nothing you saved is lost.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn btn-primary !px-5" onClick={() => retry()}>
            Try again
          </button>
          <Link href="/dashboard" className="btn btn-ghost !px-5">
            Go to dashboard
          </Link>
        </div>
        {digest && <p className="text-[11px] text-faint mt-5">Error code: {digest}</p>}
      </div>
    </div>
  );
}
