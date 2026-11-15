// Recovery codes: the way to reset a forgotten password without email. Each account gets one
// at sign-up (shown once, to save); only a scrypt hash of it is stored, like a password.
import { randomBytes } from "node:crypto";

export const MIN_PASSWORD = 8;
/** Wrong recovery-code tries allowed per account in RECOVERY_WINDOW_MIN minutes. */
export const RECOVERY_TRIES = 5;
export const RECOVERY_WINDOW_MIN = 15;

// No 0/O or 1/I/L, so a code copied by hand can't be misread. 32 letters × 12 = 60 bits.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A new code, e.g. "7KQ4-M9XD-2PWA". */
export function newRecoveryCode(): string {
  let s = "";
  for (const b of randomBytes(12)) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** A code as typed (any case, spaces or dashes) in the form it's hashed in. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
