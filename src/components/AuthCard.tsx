import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

/** The simple centered layout of the signed-out pages (forgot / reset password). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center p-5">
        <Link href="/login"><Logo /></Link>
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted mt-1.5 mb-7 text-[15px]">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
