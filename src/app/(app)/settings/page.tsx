import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { DyslexiaFontToggle } from "@/components/DyslexiaFontToggle";
import { AccountSecurity } from "@/components/AccountSecurity";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="These follow your account, on any device you sign in on." />
      <section className="card p-6">
        <h2 className="font-semibold">Reading</h2>
        <DyslexiaFontToggle initial={!!user.dyslexiaFont} />
      </section>
      <section className="card p-6 mt-6">
        <h2 className="font-semibold">Account</h2>
        <p className="text-sm text-muted mt-1">Signed in as <b className="text-fg">{user.username}</b></p>
        <AccountSecurity demo={!!user.demo} username={user.username} hasRecoveryCode={!!user.hasRecoveryCode} />
      </section>
    </div>
  );
}
