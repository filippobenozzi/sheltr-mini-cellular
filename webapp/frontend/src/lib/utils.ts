import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim()
  return text || fallback
}

export function slugify(value: unknown, fallback: string) {
  const normalized = cleanText(value, fallback)
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized || fallback
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function toInt(value: unknown, fallback: number) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

export function normalizeTime(value: unknown, fallback = "00:00") {
  const text = cleanText(value, fallback)
  if (!/^\d{2}:\d{2}$/.test(text)) return fallback
  const hh = toInt(text.slice(0, 2), -1)
  const mm = toInt(text.slice(3, 5), -1)
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

export function normalizeMode(value: unknown) {
  return cleanText(value, "").toLowerCase() === "summer" ? "summer" : "winter"
}
