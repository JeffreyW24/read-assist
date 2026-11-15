import Link from "next/link";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";
import { IconSettings, Logo } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./LogoutButton";

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 h-14 flex items-center gap-6">
          <Link href="/dashboard" className="shrink-0">
            <Logo />
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <Link href="/dashboard" className="px-3 py-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface-2">
              {user.role === "professor" ? "My courses" : "Dashboard"}
            </Link>
            <Link href="/readings/new" className="px-3 py-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface-2">
              {user.role === "professor" ? "Post a reading" : "Upload a reading"}
            </Link>
            {user.role === "student" && (
              <Link href="/habits" className="px-3 py-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface-2">
                Reading habits
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/settings" className="btn btn-ghost !px-2.5 !py-1.5 text-muted" aria-label="Settings" title="Settings">
              <IconSettings size={17} />
            </Link>
            <div className="hidden sm:flex flex-col items-end leading-tight px-2">
              <span className="text-sm font-medium">{user.name}</span>
              <span className="text-[11px] text-muted">{user.role === "professor" ? "Teacher" : "Student"}</span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted mt-1.5 text-[15px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
