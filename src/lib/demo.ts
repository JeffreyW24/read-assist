// The one-click demo accounts (Prof. Rivera, Sam Student) and their sample course.
// On by default on a laptop, off on a hosted site: anyone on the internet could otherwise sign
// in to them with one click. Set DEMO_ACCOUNTS=1 to force them on, DEMO_ACCOUNTS=0 to force off.
export function demoAccountsEnabled(): boolean {
  const v = process.env.DEMO_ACCOUNTS?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return process.env.NODE_ENV !== "production";
}
