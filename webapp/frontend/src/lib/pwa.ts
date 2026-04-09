import { cleanText, slugify } from "@/lib/utils"

function ensureManifestLink() {
  let link = document.head.querySelector<HTMLLinkElement>("#pwaManifest")
  if (!link) {
    link = document.createElement("link")
    link.id = "pwaManifest"
    link.rel = "manifest"
    document.head.appendChild(link)
  }
  return link
}

function ensureMeta(name: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) {
    meta = document.createElement("meta")
    meta.name = name
    document.head.appendChild(meta)
  }
  return meta
}

export function pwaAppName(instanceId: string, instanceName: string) {
  const fallback = slugify(instanceId, "dr154-1")
  const raw = cleanText(instanceName, fallback)
  const primary = cleanText(raw.split("//", 1)[0], raw)
  return primary
}

export function pwaManifestUrl(instanceId: string, appName: string) {
  const base = `/manifest/${encodeURIComponent(instanceId)}.webmanifest`
  return appName ? `${base}?name=${encodeURIComponent(appName)}` : base
}

export function applyControlPwaIdentity(instanceId: string, instanceName: string) {
  const slug = slugify(instanceId, "dr154-1")
  const name = cleanText(instanceName, slug)
  const appName = pwaAppName(slug, name)
  const manifestLink = ensureManifestLink()
  manifestLink.href = pwaManifestUrl(slug, appName)
  ensureMeta("application-name").content = appName
  ensureMeta("apple-mobile-web-app-title").content = appName
  document.title = `${name} // Sheltr Cloud`
}

export function registerControlPwa() {
  if (!("serviceWorker" in navigator)) {
    return
  }
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
}
