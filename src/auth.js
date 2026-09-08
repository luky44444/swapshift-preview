import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const attempts = new Map();

export function sessionCookieName() {
  return "swapshift_session";
}

export function validateFullName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  const parts = name.split(" ").filter(Boolean);
  if (name.length < 3 || name.length > 80 || parts.length < 2) return { error: "full_name" };
  return name;
}

export function validateEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 80) return { error: "email_invalid" };
  return email;
}

export function validatePassword(raw) {
  const password = String(raw ?? "");
  if (password.length < 6 || password.length > 72) return { error: "password_format" };
  return password;
}

export async function hashSecret(secret, salt) {
  return scryptAsync(secret, salt, KEYLEN, SCRYPT);
}

export async function makePasswordRecord(passwordRaw) {
  const password = validatePassword(passwordRaw);
  if (typeof password !== "string") return password;
  const salt = randomBytes(16);
  const hash = await hashSecret(password, salt);
  return { passwordHash: hash.toString("hex"), passwordSalt: salt.toString("hex") };
}

export async function passwordMatches(passwordRaw, passwordHash, passwordSalt) {
  const password = String(passwordRaw ?? "").slice(0, 72);
  const salt = Buffer.from(passwordSalt, "hex");
  const derived = await hashSecret(password || "x", salt);
  const expected = Buffer.from(passwordHash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function newSessionToken() {
  return randomBytes(24).toString("hex");
}

export function allowAttempt(key, limit = 20, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  let bucket = attempts.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    attempts.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= limit;
}
