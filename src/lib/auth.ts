// Sign-in. Real accounts use a username + password (hashed with scrypt, never stored as-is).
// Demo accounts (the seeded professor/student and anyone from the old demo) sign in with one click.
// We remember who you are with a signed cookie, "<sessionId>.<signature>", naming a sign-in
// session stored on the server. It can't be forged, and signing out (or changing the password)
// deletes the session, so a copied cookie stops working too.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAuthSession, deleteAuthSession, deleteAuthSessionsForUser, getOrCreateSecret, userForAuthSession } from "./db";
import type { User } from "./types";

export const SESSION_COOKIE = "ra_session";
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

async function secret(): Promise<string> {
  return process.env.AUTH_SECRET || (await getOrCreateSecret());
}

async function sign(sessionId: string): Promise<string> {
  const mac = createHmac("sha256", await secret()).update(sessionId).digest("base64url");
  return `${sessionId}.${mac}`;
}

/** The session id in a cookie, if its signature is right (it may still be signed out: see userForAuthSession). */
async function verify(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const expected = Buffer.from(await sign(sessionId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? sessionId : null;
}

const MAX_AGE_SEC = 60 * 60 * 24 * 30;

/** The id of the sign-in session this request carries (valid signature), or null. */
export async function currentSessionId(): Promise<string | null> {
  return verify((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, saltB64, hashB64] = stored.split(":");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, "base64url");
  const got = await scrypt(pw, Buffer.from(saltB64, "base64url"), want.length);
  return timingSafeEqual(want, got);
}

/** Call from a route handler after a successful sign-in / sign-up. */
export async function startSession(userId: string): Promise<string> {
  const sessionId = await createAuthSession(userId, MAX_AGE_SEC);
  const store = await cookies();
  store.set(SESSION_COOKIE, await sign(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return sessionId;
}

/** Sign out this browser: the session is deleted on the server, not just the cookie. */
export async function endSession() {
  const sessionId = await currentSessionId();
  if (sessionId) await deleteAuthSession(sessionId);
  (await cookies()).delete(SESSION_COOKIE);
}

/** Sign a user out on every device, keeping (optionally) the browser making this request. */
export async function endOtherSessions(userId: string, keepCurrent: boolean) {
  await deleteAuthSessionsForUser(userId, keepCurrent ? await currentSessionId() : null);
}

/** The signed-in user. Looked up once per request, however many layouts and pages ask. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const sessionId = await currentSessionId();
  return sessionId ? userForAuthSession(sessionId) : null;
});

/** Use in pages: sends signed-out visitors to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
