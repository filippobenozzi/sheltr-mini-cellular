import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { LogOut, RefreshCw, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { AppShell } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { apiJson, ApiError, instanceTokenConfig } from "@/lib/api"
import {
  channelProfileId,
  DOW,
  DOW_ALL,
  normalizeDays,
  normalizeSwitchEntry,
  normalizeSwitchProfile,
  normalizeThermostatEntry,
  normalizeThermostatProfile,
} from "@/lib/device"
import { applyControlPwaIdentity, registerControlPwa } from "@/lib/pwa"
import { cleanText, clamp, normalizeMode, normalizeTime, slugify } from "@/lib/utils"
import type {
  Board,
  CommandResponse,
  CommandSentItem,
  InstancePublic,
  InstanceStatus,
  StatusRoom,
  SwitchProfile,
  ThermostatProfile,
} from "@/lib/types"

type ProfileKind = "thermostat" | "light" | "shutter"

type ProfilesState = {
  thermostat: Record<string, ThermostatProfile>
  light: Record<string, SwitchProfile>
  shutter: Record<string, SwitchProfile>
}

type InstanceResponse = {
  instance: InstancePublic
}

function tokenKey(instanceId: string) {
  return `sheltr-token-${instanceId}`
}

function controlUrl(instanceId: string) {
  return `/control/${encodeURIComponent(instanceId)}`
}

function forcedInstanceFromLocation(pathname: string, search: string) {
  const parts = pathname.split("/").filter(Boolean)
  if ((parts[0] === "control" || parts[0] === "instance") && parts[1]) {
    return decodeURIComponent(parts[1])
  }
  const params = new URLSearchParams(search)
  return params.get("instance") ?? ""
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function buildProfiles(instance: InstancePublic | null): ProfilesState {
  const profiles: ProfilesState = { thermostat: {}, light: {}, shutter: {} }
  for (const board of instance?.boards ?? []) {
    if (!board || typeof board !== "object") continue
    if (board.kind !== "thermostat" && board.kind !== "light" && board.kind !== "shutter") continue
    for (const channel of board.channels ?? []) {
      const id = channelProfileId(board.id, channel.channel)
      if (board.kind === "thermostat") {
        profiles.thermostat[id] = normalizeThermostatProfile(channel.profile)
      } else {
        profiles[board.kind][id] = normalizeSwitchProfile(board.kind, channel.profile)
      }
    }
  }
  return profiles
}

function setProfileInBoards(
  boards: Board[],
  kind: ProfileKind,
  id: string,
  profile: ThermostatProfile | SwitchProfile
) {
  for (const board of boards) {
    if (board.kind !== kind) continue
    for (const channel of board.channels ?? []) {
      if (channelProfileId(board.id, channel.channel) === id) {
        channel.profile = kind === "thermostat" ? normalizeThermostatProfile(profile) : normalizeSwitchProfile(kind, profile)
        return true
      }
    }
  }
  return false
}

function collectIds(status: InstanceStatus | null, key: "lights" | "dimmers") {
  const ids: string[] = []
  for (const room of status?.rooms ?? []) {
    for (const item of room[key] ?? []) {
      if (item?.id) {
        ids.push(String(item.id))
      }
    }
  }
  return ids
}

function applySentState(status: InstanceStatus | null, sent: CommandSentItem[]) {
  if (!status) {
    return status
  }
  const next = cloneValue(status)
  const byId = new Map<string, CommandSentItem>()
  for (const item of sent) {
    if (item?.id) {
      byId.set(String(item.id), item)
    }
  }

  for (const room of next.rooms ?? []) {
    for (const light of room.lights ?? []) {
      const sentItem = byId.get(String(light.id ?? ""))
      if (sentItem && typeof sentItem.isOn === "boolean") {
        light.isOn = sentItem.isOn
      }
    }
    for (const dimmer of room.dimmers ?? []) {
      const sentItem = byId.get(String(dimmer.id ?? ""))
      if (!sentItem) continue
      if (Number.isFinite(Number(sentItem.level))) {
        dimmer.level = Math.max(0, Math.min(9, Math.round(Number(sentItem.level))))
      }
      if (typeof sentItem.isOn === "boolean") {
        dimmer.isOn = sentItem.isOn
      } else if (Number.isFinite(Number(dimmer.level))) {
        dimmer.isOn = Number(dimmer.level) > 0
      }
    }
    for (const shutter of room.shutters ?? []) {
      const sentItem = byId.get(String(shutter.id ?? ""))
      if (sentItem && typeof sentItem.action === "string" && sentItem.action) {
        shutter.action = sentItem.action
      }
    }
    for (const thermostat of room.thermostats ?? []) {
      const sentItem = byId.get(String(thermostat.id ?? ""))
      if (!sentItem) continue
      if (Number.isFinite(Number(sentItem.setpoint))) {
        thermostat.setpoint = Number(sentItem.setpoint)
      }
      if (typeof sentItem.mode === "string" && sentItem.mode) {
        thermostat.mode = sentItem.mode
      }
      if (typeof sentItem.isOn === "boolean") {
        thermostat.isOn = sentItem.isOn
      }
      if (typeof sentItem.isActive === "boolean") {
        thermostat.isActive = sentItem.isActive
      }
      if (Number.isFinite(Number(sentItem.temperature))) {
        thermostat.temperature = Number(sentItem.temperature)
      }
    }
  }

  return next
}

function sortRoomItems<T extends { name?: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "it", { sensitivity: "base" })
  )
}

function formatTemperature(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "--.- C"
  }
  return `${Number(value).toFixed(1)} C`
}

function roomHasEntities(room: StatusRoom) {
  return Boolean(room.lights.length || room.dimmers.length || room.shutters.length || room.thermostats.length)
}

export function ControlPage() {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [instanceId, setInstanceId] = useState("")
  const [instance, setInstance] = useState<InstancePublic | null>(null)
  const [status, setStatus] = useState<InstanceStatus | null>(null)
  const [profiles, setProfiles] = useState<ProfilesState>({ thermostat: {}, light: {}, shutter: {} })
  const [token, setToken] = useState("")
  const [authRequired, setAuthRequired] = useState(false)
  const [loginUser, setLoginUser] = useState("")
  const [loginPass, setLoginPass] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [busyKeys, setBusyKeys] = useState<string[]>([])
  const [nowLabel, setNowLabel] = useState("")
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("")
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileKind, setProfileKind] = useState<ProfileKind>("thermostat")
  const [profileId, setProfileId] = useState("")
  const [profileData, setProfileData] = useState<ThermostatProfile | SwitchProfile>({
    enabled: false,
    entries: [],
  })

  function showNote(text: string, error = false, tone: "success" | "info" | "warning" = "success") {
    if (error) {
      toast.error(text)
      return
    }
    if (tone === "info") {
      toast.info(text)
      return
    }
    if (tone === "warning") {
      toast.warning(text)
      return
    }
    toast.success(text)
  }

  function profileOf(kind: ProfileKind, id: string) {
    if (kind === "thermostat") {
      return profiles.thermostat[id] ?? normalizeThermostatProfile({})
    }
    return profiles[kind][id] ?? normalizeSwitchProfile(kind, {})
  }

  function handleAuthError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setToken("")
      if (instanceId) {
        localStorage.removeItem(tokenKey(instanceId))
      }
      setStatus(null)
      showNote("Sessione scaduta o non valida. Effettua di nuovo il login.", true)
      return true
    }
    return false
  }

  async function fetchStatus(instanceIdValue: string, tokenValue: string, refreshDevices: boolean) {
    const suffix = refreshDevices ? "?refresh=1" : ""
    return apiJson<InstanceStatus>(`/api/instances/${encodeURIComponent(instanceIdValue)}/status${suffix}`, {
      tokenConfig: instanceTokenConfig(tokenValue),
    })
  }

  async function loadStatus(refreshDevices = false, silent = false) {
    if (!instanceId || refreshing) {
      return false
    }

    setRefreshing(true)
    try {
      const response = await fetchStatus(instanceId, token, refreshDevices)
      setStatus(response)
      setLastUpdatedLabel(`ultimo update: ${new Date().toLocaleTimeString("it-IT")}`)
      if (!silent) {
        if (response.refreshErrors?.length) {
          showNote(
            `Errori polling: ${response.refreshErrors.map((item) => `${item.address}:${item.error}`).join(" | ")}`,
            true
          )
        } else {
          showNote("Stato aggiornato", false, "info")
        }
      }
      return true
    } catch (caught) {
      if (!handleAuthError(caught) && !silent) {
        showNote(caught instanceof Error ? caught.message : "Errore caricamento stato", true)
      }
      return false
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const tick = () => setNowLabel(new Date().toLocaleString("it-IT"))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const forced = slugify(params.instanceId || forcedInstanceFromLocation(location.pathname, location.search), "")

    async function init() {
      setLoading(true)
      if (!forced) {
        setInstance(null)
        setStatus(null)
        setInstanceId("")
        showNote("Istanza non specificata. Apri URL /control/<istanza>.", true)
        setLoading(false)
        return
      }

      registerControlPwa()
      applyControlPwaIdentity(forced, forced)

      try {
        const response = await apiJson<InstanceResponse>(`/api/instances/${encodeURIComponent(forced)}`)
        if (cancelled) return

        const loadedInstance = response.instance
        const resolvedId = cleanText(loadedInstance.id, forced)
        const storedToken = cleanText(localStorage.getItem(tokenKey(resolvedId)), "")

        setInstanceId(resolvedId)
        setInstance(loadedInstance)
        setProfiles(buildProfiles(loadedInstance))
        setAuthRequired(Boolean(loadedInstance.auth?.passwordConfigured))
        setLoginUser(cleanText(loadedInstance.auth?.username, ""))
        setLoginPass("")
        applyControlPwaIdentity(resolvedId, loadedInstance.name)

        if (location.pathname !== controlUrl(resolvedId)) {
          navigate(controlUrl(resolvedId), { replace: true })
        }

        if (loadedInstance.auth?.passwordConfigured) {
          if (storedToken) {
            setToken(storedToken)
            try {
              const restored = await fetchStatus(resolvedId, storedToken, false)
              if (cancelled) return
              setStatus(restored)
              setLastUpdatedLabel(`ultimo update: ${new Date().toLocaleTimeString("it-IT")}`)
              showNote("Sessione ripristinata.", false, "info")
              return
            } catch (caught) {
              localStorage.removeItem(tokenKey(resolvedId))
              setToken("")
              if (!handleAuthError(caught)) {
                showNote("Login richiesto per questa istanza.", false, "warning")
              }
            }
          } else {
            setToken("")
            showNote("Login richiesto per questa istanza.", false, "warning")
          }
        } else {
          setToken("")
          const ok = await fetchStatus(resolvedId, "", false)
          if (cancelled) return
          setStatus(ok)
          setLastUpdatedLabel(`ultimo update: ${new Date().toLocaleTimeString("it-IT")}`)
          showNote("Stato aggiornato", false, "info")
        }
      } catch (caught) {
        if (!cancelled) {
          showNote(caught instanceof Error ? caught.message : "Errore caricamento istanza", true)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [location.pathname, location.search, navigate, params.instanceId])

  async function login() {
    if (!instanceId) {
      return
    }
    try {
      const response = await apiJson<{ token?: string }>(`/api/instances/${encodeURIComponent(instanceId)}/auth/login`, {
        method: "POST",
        body: {
          username: cleanText(loginUser, ""),
          password: cleanText(loginPass, ""),
        },
      })
      const nextToken = cleanText(response.token, "")
      if (!nextToken) {
        throw new Error("Token non valido")
      }
      setToken(nextToken)
      localStorage.setItem(tokenKey(instanceId), nextToken)
      setLoginPass("")
      const nextStatus = await fetchStatus(instanceId, nextToken, false)
      setStatus(nextStatus)
      setLastUpdatedLabel(`ultimo update: ${new Date().toLocaleTimeString("it-IT")}`)
      showNote("Login eseguito.")
    } catch (caught) {
      showNote(caught instanceof Error ? caught.message : "Login non riuscito", true)
    }
  }

  async function logout() {
    if (!instanceId) {
      setToken("")
      setStatus(null)
      return
    }
    try {
      await apiJson<{ ok?: boolean }>(`/api/instances/${encodeURIComponent(instanceId)}/auth/logout`, {
        method: "POST",
        tokenConfig: instanceTokenConfig(token),
      })
    } catch {
      // Ignore logout failures and clear client state anyway.
    }
    setToken("")
    localStorage.removeItem(tokenKey(instanceId))
    setStatus(null)
    setLoginPass("")
    showNote("Logout eseguito.", false, "info")
  }

  async function executeCommand(commandKey: string, path: string, payload: Record<string, unknown>, okMessage: string) {
    setBusyKeys((current) => [...current, commandKey])
    showNote("In attesa di risposta...", false, "info")
    try {
      const response = await apiJson<CommandResponse>(path, {
        method: "POST",
        body: payload,
        tokenConfig: instanceTokenConfig(token),
      })
      const sent = Array.isArray(response.sent) ? response.sent : []
      const verified = sent.filter((item) => item && item.verified).length
      const reasons = sent
        .filter((item) => item && !item.verified)
        .map((item) => cleanText(item.verifyReason, ""))
        .filter(Boolean)
      const nextStatus = applySentState(status, sent)
      setStatus(nextStatus)
      let message = `${okMessage} (${sent.length} inviati${sent.length ? `, confermati ${verified}/${sent.length}` : ""}).`
      if (reasons.length) {
        message += `\n${reasons.join(" | ")}`
      }
      showNote(message, reasons.length > 0)
      window.setTimeout(() => {
        void loadStatus(false, true)
      }, 150)
    } catch (caught) {
      if (!handleAuthError(caught)) {
        showNote(caught instanceof Error ? caught.message : "Comando non riuscito", true)
      }
    } finally {
      setBusyKeys((current) => current.filter((item) => item !== commandKey))
    }
  }

  async function sendAll(action: "on" | "off") {
    if (!instanceId || bulkRunning) {
      return
    }
    setBulkRunning(true)
    let ok = 0
    let ko = 0
    let authExpired = false
    try {
      for (const lightId of collectIds(status, "lights")) {
        try {
          await apiJson(`/api/instances/${encodeURIComponent(instanceId)}/lights/command`, {
            method: "POST",
            body: { lightId, action },
            tokenConfig: instanceTokenConfig(token),
          })
          ok += 1
        } catch (caught) {
          if (handleAuthError(caught)) {
            authExpired = true
            break
          }
          ko += 1
        }
      }
      if (authExpired) {
        return
      }
      for (const dimmerId of collectIds(status, "dimmers")) {
        try {
          await apiJson(`/api/instances/${encodeURIComponent(instanceId)}/dimmers/command`, {
            method: "POST",
            body: { dimmerId, action },
            tokenConfig: instanceTokenConfig(token),
          })
          ok += 1
        } catch (caught) {
          if (handleAuthError(caught)) {
            authExpired = true
            break
          }
          ko += 1
        }
      }
      if (authExpired) {
        return
      }
      if (!ok && !ko) {
        showNote("Nessuna entita da comandare", true)
      } else {
        showNote(`Comando globale '${action}': ${ok} ok${ko ? `, ${ko} errori` : ""}`, ko > 0)
        await loadStatus(false, true)
      }
    } finally {
      setBulkRunning(false)
    }
  }

  function openProfile(kind: ProfileKind, id: string) {
    setProfileKind(kind)
    setProfileId(id)
    if (kind === "thermostat") {
      setProfileData(normalizeThermostatProfile(profileOf(kind, id)))
    } else {
      setProfileData(normalizeSwitchProfile(kind, profileOf(kind, id)))
    }
    setProfileOpen(true)
  }

  function addProfileEntry() {
    if (profileKind === "thermostat") {
      const next = normalizeThermostatProfile(profileData)
      next.entries.push(
        normalizeThermostatEntry({
          from: "08:00",
          to: "18:00",
          setpoint: 21,
          mode: "winter",
          days: [...DOW_ALL],
        })
      )
      setProfileData(next)
      return
    }

    const next = normalizeSwitchProfile(profileKind, profileData)
    next.entries.push(
      normalizeSwitchEntry(profileKind, {
        time: "08:00",
        action: profileKind === "shutter" ? "down" : "off",
        days: [...DOW_ALL],
      })
    )
    setProfileData(next)
  }

  function toggleProfileDay(entryIndex: number, day: number) {
    if (profileKind === "thermostat") {
      const next = normalizeThermostatProfile(profileData)
      const entry = next.entries[entryIndex]
      if (!entry) return
      const days = new Set(normalizeDays(entry.days))
      if (days.has(day)) days.delete(day)
      else days.add(day)
      entry.days = days.size ? [...days].sort((left, right) => left - right) : [...DOW_ALL]
      setProfileData(next)
      return
    }

    const next = normalizeSwitchProfile(profileKind, profileData)
    const entry = next.entries[entryIndex]
    if (!entry) return
    const days = new Set(normalizeDays(entry.days))
    if (days.has(day)) days.delete(day)
    else days.add(day)
    entry.days = days.size ? [...days].sort((left, right) => left - right) : [...DOW_ALL]
    setProfileData(next)
  }

  function removeProfileEntry(entryIndex: number) {
    if (profileKind === "thermostat") {
      const next = normalizeThermostatProfile(profileData)
      next.entries.splice(entryIndex, 1)
      setProfileData(next)
      return
    }
    const next = normalizeSwitchProfile(profileKind, profileData)
    next.entries.splice(entryIndex, 1)
    setProfileData(next)
  }

  async function saveProfile() {
    if (!instance || !profileId) {
      return
    }

    const nextInstance = cloneValue(instance)
    const normalizedProfile =
      profileKind === "thermostat"
        ? normalizeThermostatProfile(profileData)
        : normalizeSwitchProfile(profileKind, profileData)

    if (!setProfileInBoards(nextInstance.boards, profileKind, profileId, normalizedProfile)) {
      showNote("Canale non trovato in configurazione", true)
      return
    }

    try {
      const response = await apiJson<InstanceResponse>(`/api/instances/${encodeURIComponent(instance.id)}`, {
        method: "PUT",
        body: {
          id: nextInstance.id,
          name: nextInstance.name,
          protocolVersion: nextInstance.protocolVersion || "1.6",
          mqtt: nextInstance.mqtt || {},
          boards: nextInstance.boards || [],
        },
        tokenConfig: instanceTokenConfig(token),
      })
      setInstance(response.instance)
      setProfiles(buildProfiles(response.instance))
      setProfileOpen(false)
      await loadStatus(false, true)
      showNote("Profilo orario salvato")
    } catch (caught) {
      if (!handleAuthError(caught)) {
        showNote(caught instanceof Error ? caught.message : "Salvataggio profilo non riuscito", true)
      }
    }
  }

  const requiresLogin = authRequired && !token

  return (
    <AppShell
      title={instance ? instance.name : "Controllo istanza"}
      description="Dashboard controllo per stanze, luci, dimmer, tapparelle e termostati, con supporto ai profili orari salvati nell’istanza."
      actions={
        instanceId ? (
          <>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => void loadStatus(true, false)}>
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              Aggiorna
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => void sendAll("on")} disabled={bulkRunning}>
              Accendi tutte
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => void sendAll("off")} disabled={bulkRunning}>
              Spegni tutte
            </Button>
            {authRequired ? (
              <Button variant="ghost" size="sm" className="rounded-full" onClick={logout}>
                <LogOut className="size-4" />
                Logout
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="border-border/80 bg-background/90">
            <CardHeader>
              <CardTitle>Stato sessione</CardTitle>
              <CardDescription>
                {instance ? `${instance.name} (${instance.id})` : "Apri un URL controllo valido per caricare una istanza."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Ora locale</p>
                  <p className="mt-1 text-base font-medium">{nowLabel || "--"}</p>
                </div>
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Ultimo aggiornamento</p>
                  <p className="mt-1 text-base font-medium">{lastUpdatedLabel || "--"}</p>
                </div>
              </div>

              {instance ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{instance.device?.label || instance.deviceType}</Badge>
                  {authRequired ? <Badge variant="secondary">Login richiesto</Badge> : <Badge variant="secondary">Accesso diretto</Badge>}
                </div>
              ) : null}

              {instanceId ? (
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/instance/${encodeURIComponent(instanceId)}/config`}>Apri configurazione istanza</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {requiresLogin ? (
            <Card className="border-border/80 bg-background/90">
              <CardHeader>
                <CardTitle>Login istanza</CardTitle>
                <CardDescription>Usa le credenziali impostate nella configurazione dell’istanza.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={loginUser} onChange={(event) => setLoginUser(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={loginPass}
                    onChange={(event) => setLoginPass(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void login()
                      }
                    }}
                  />
                </div>
                <Button onClick={login}>Accedi</Button>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {loading ? <p className="text-sm text-muted-foreground">Caricamento dashboard in corso...</p> : null}

          {!loading && !instance ? (
            <Card className="border-border/80 bg-background/90">
              <CardContent className="p-6 text-sm text-muted-foreground">
                Nessuna istanza caricata. Apri `/control/&lt;istanza&gt;` oppure usa il link dalla configurazione.
              </CardContent>
            </Card>
          ) : null}

          {!loading && instance && requiresLogin ? (
            <Card className="border-border/80 bg-background/90">
              <CardContent className="p-6 text-sm text-muted-foreground">
                Effettua il login per vedere le stanze e inviare comandi a questa istanza.
              </CardContent>
            </Card>
          ) : null}

          {!loading && instance && !requiresLogin ? (
            <>
              {!status?.rooms?.length ? (
                <Card className="border-border/80 bg-background/90">
                  <CardContent className="p-6 text-sm text-muted-foreground">Nessuna stanza configurata.</CardContent>
                </Card>
              ) : null}

              {(status?.rooms ?? []).map((room) => (
                <Card key={room.name} className="border-border/80 bg-background/90">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>{room.name}</CardTitle>
                        <CardDescription>
                          {roomHasEntities(room)
                            ? `${room.lights.length} luci • ${room.dimmers.length} dimmer • ${room.shutters.length} tapparelle • ${room.thermostats.length} termostati`
                            : "Nessuna entità"}
                        </CardDescription>
                      </div>
                      <Badge variant="outline">
                        {room.lights.length + room.dimmers.length + room.shutters.length + room.thermostats.length} elementi
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {roomHasEntities(room) ? (
                      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                        {sortRoomItems(room.thermostats).map((thermostat) => {
                          const busyId = `thermostat-${thermostat.id}`
                          const setpoint = Number.isFinite(Number(thermostat.setpoint)) ? Number(thermostat.setpoint) : 21
                          const active = thermostat.isActive === true || (thermostat.isActive == null && thermostat.isOn === true)
                          return (
                            <Card key={thermostat.id} className="border-border/70 shadow-none">
                              <CardContent className="space-y-4 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <h3 className="font-semibold">{thermostat.name}</h3>
                                    <p className="text-sm text-muted-foreground">
                                      Temp: {formatTemperature(thermostat.temperature)} • {active ? "ACCESO" : "SPENTO"}
                                    </p>
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => openProfile("thermostat", thermostat.id)}>
                                    <Settings2 className={`size-4 ${profiles.thermostat[thermostat.id]?.enabled ? "text-primary" : ""}`} />
                                  </Button>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant={thermostat.mode === "winter" ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/thermostats/command`,
                                        { thermostatId: thermostat.id, mode: "winter" },
                                        "Comando termostato mode 'winter'"
                                      )
                                    }
                                  >
                                    INVERNO
                                  </Button>
                                  <Button
                                    variant={thermostat.mode === "summer" ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/thermostats/command`,
                                        { thermostatId: thermostat.id, mode: "summer" },
                                        "Comando termostato mode 'summer'"
                                      )
                                    }
                                  >
                                    ESTATE
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  <Label>Setpoint</Label>
                                  <Input
                                    type="range"
                                    min={5}
                                    max={30}
                                    step={0.5}
                                    value={setpoint}
                                    onChange={(event) => {
                                      const nextValue = Number(event.target.value)
                                      setStatus((current) => {
                                        if (!current) return current
                                        const next = cloneValue(current)
                                        for (const roomItem of next.rooms) {
                                          const found = roomItem.thermostats.find((item) => item.id === thermostat.id)
                                          if (found) {
                                            found.setpoint = nextValue
                                          }
                                        }
                                        return next
                                      })
                                    }}
                                  />
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{setpoint.toFixed(1)} C</span>
                                    <Button
                                      size="sm"
                                      disabled={busyKeys.includes(busyId)}
                                      onClick={() =>
                                        void executeCommand(
                                          busyId,
                                          `/api/instances/${encodeURIComponent(instanceId)}/thermostats/command`,
                                          { thermostatId: thermostat.id, setpoint },
                                          "Comando termostato setpoint"
                                        )
                                      }
                                    >
                                      SET
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}

                        {sortRoomItems(room.lights).map((light) => {
                          const busyId = `light-${light.id}`
                          const profileEnabled = profiles.light[light.id]?.enabled
                          return (
                            <Card key={light.id} className="border-border/70 shadow-none">
                              <CardContent className="space-y-4 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <h3 className="font-semibold">{light.name}</h3>
                                    <p className="text-sm text-muted-foreground">{light.isOn ? "Accesa" : "Spenta"}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => openProfile("light", light.id)}>
                                    <Settings2 className={`size-4 ${profileEnabled ? "text-primary" : ""}`} />
                                  </Button>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant={light.isOn === true ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/lights/command`,
                                        { lightId: light.id, action: "on" },
                                        "Comando luce 'on'"
                                      )
                                    }
                                  >
                                    ON
                                  </Button>
                                  <Button
                                    variant={light.isOn === false ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/lights/command`,
                                        { lightId: light.id, action: "off" },
                                        "Comando luce 'off'"
                                      )
                                    }
                                  >
                                    OFF
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}

                        {sortRoomItems(room.dimmers).map((dimmer) => {
                          const busyId = `dimmer-${dimmer.id}`
                          const level = Number.isFinite(Number(dimmer.level)) ? Math.max(0, Math.min(9, Math.round(Number(dimmer.level)))) : 0
                          return (
                            <Card key={dimmer.id} className="border-border/70 shadow-none">
                              <CardContent className="space-y-4 p-4">
                                <div className="space-y-1">
                                  <h3 className="font-semibold">{dimmer.name}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    Livello {level} • {dimmer.isOn ? "Acceso" : "Spento"}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant={dimmer.isOn === true ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/dimmers/command`,
                                        { dimmerId: dimmer.id, action: "on" },
                                        "Comando dimmer 'on'"
                                      )
                                    }
                                  >
                                    ON
                                  </Button>
                                  <Button
                                    variant={dimmer.isOn === false ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/dimmers/command`,
                                        { dimmerId: dimmer.id, action: "off" },
                                        "Comando dimmer 'off'"
                                      )
                                    }
                                  >
                                    OFF
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  <Label>Livello dimmer</Label>
                                  <Input
                                    type="range"
                                    min={0}
                                    max={9}
                                    step={1}
                                    value={level}
                                    onChange={(event) => {
                                      const nextValue = Number(event.target.value)
                                      setStatus((current) => {
                                        if (!current) return current
                                        const next = cloneValue(current)
                                        for (const roomItem of next.rooms) {
                                          const found = roomItem.dimmers.find((item) => item.id === dimmer.id)
                                          if (found) {
                                            found.level = nextValue
                                          }
                                        }
                                        return next
                                      })
                                    }}
                                  />
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{level}</span>
                                    <Button
                                      size="sm"
                                      disabled={busyKeys.includes(busyId)}
                                      onClick={() =>
                                        void executeCommand(
                                          busyId,
                                          `/api/instances/${encodeURIComponent(instanceId)}/dimmers/command`,
                                          { dimmerId: dimmer.id, action: "set", level },
                                          "Comando dimmer 'set'"
                                        )
                                      }
                                    >
                                      SET
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}

                        {sortRoomItems(room.shutters).map((shutter) => {
                          const busyId = `shutter-${shutter.id}`
                          const profileEnabled = profiles.shutter[shutter.id]?.enabled
                          return (
                            <Card key={shutter.id} className="border-border/70 shadow-none">
                              <CardContent className="space-y-4 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <h3 className="font-semibold">{shutter.name}</h3>
                                    <p className="text-sm text-muted-foreground">Stato: {cleanText(shutter.action, "stop")}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => openProfile("shutter", shutter.id)}>
                                    <Settings2 className={`size-4 ${profileEnabled ? "text-primary" : ""}`} />
                                  </Button>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant={shutter.action === "up" ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/shutters/command`,
                                        { shutterId: shutter.id, action: "up" },
                                        "Comando tapparella 'up'"
                                      )
                                    }
                                  >
                                    SU
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/shutters/command`,
                                        { shutterId: shutter.id, action: "stop" },
                                        "Comando tapparella 'stop'"
                                      )
                                    }
                                  >
                                    STOP
                                  </Button>
                                  <Button
                                    variant={shutter.action === "down" ? "default" : "outline"}
                                    size="sm"
                                    disabled={busyKeys.includes(busyId)}
                                    onClick={() =>
                                      void executeCommand(
                                        busyId,
                                        `/api/instances/${encodeURIComponent(instanceId)}/shutters/command`,
                                        { shutterId: shutter.id, action: "down" },
                                        "Comando tapparella 'down'"
                                      )
                                    }
                                  >
                                    GIU
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Nessuna entità in questa stanza.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </>
          ) : null}
        </div>
      </section>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Profilo orario</DialogTitle>
            <DialogDescription>{profileId ? `Canale ${profileId}` : "Configura le fasce orarie della risorsa selezionata."}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border p-4">
              <div>
                <Label>Profilo orario abilitato</Label>
                <p className="text-sm text-muted-foreground">
                  {profileKind === "thermostat"
                    ? "Se disabilitato resta il fallback termostato."
                    : "Se disabilitato i comandi seguono solo le azioni manuali."}
                </p>
              </div>
              <Switch
                checked={Boolean(profileData.enabled)}
                onCheckedChange={(checked) =>
                  setProfileData((current) =>
                    profileKind === "thermostat"
                      ? { ...normalizeThermostatProfile(current), enabled: checked }
                      : { ...normalizeSwitchProfile(profileKind, current), enabled: checked }
                  )
                }
              />
            </div>

            <div className="space-y-3">
              {profileKind === "thermostat"
                ? normalizeThermostatProfile(profileData).entries.map((entry, entryIndex) => (
                    <Card key={`${profileId}-${entryIndex}`} className="border-border/70 shadow-none">
                      <CardContent className="space-y-4 p-4">
                        <div className="grid gap-3 md:grid-cols-5">
                          <div className="space-y-2">
                            <Label>Da</Label>
                            <Input
                              type="time"
                              value={entry.from}
                              onChange={(event) => {
                                const next = normalizeThermostatProfile(profileData)
                                next.entries[entryIndex].from = normalizeTime(event.target.value, "00:00")
                                setProfileData(next)
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>A</Label>
                            <Input
                              type="time"
                              value={entry.to}
                              onChange={(event) => {
                                const next = normalizeThermostatProfile(profileData)
                                next.entries[entryIndex].to = normalizeTime(event.target.value, "23:59")
                                setProfileData(next)
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Setpoint</Label>
                            <Input
                              value={String(entry.setpoint)}
                              onChange={(event) => {
                                const next = normalizeThermostatProfile(profileData)
                                const numeric = Number(String(event.target.value).replace(",", "."))
                                next.entries[entryIndex].setpoint = Number.isFinite(numeric)
                                  ? clamp(Math.round(numeric * 2) / 2, 5, 30)
                                  : entry.setpoint
                                setProfileData(next)
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Mode</Label>
                            <Select
                              value={entry.mode}
                              onValueChange={(value) => {
                                const next = normalizeThermostatProfile(profileData)
                                next.entries[entryIndex].mode = normalizeMode(value)
                                setProfileData(next)
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="winter">INVERNO</SelectItem>
                                <SelectItem value="summer">ESTATE</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-end">
                            <Button variant="destructive" size="sm" onClick={() => removeProfileEntry(entryIndex)}>
                              Rimuovi
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {DOW.map((day) => {
                            const active = normalizeDays(entry.days).includes(day.id)
                            return (
                              <Button
                                key={`${profileId}-${entryIndex}-${day.id}`}
                                variant={active ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleProfileDay(entryIndex, day.id)}
                              >
                                {day.label}
                              </Button>
                            )
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                : normalizeSwitchProfile(profileKind, profileData).entries.map((entry, entryIndex) => (
                    <Card key={`${profileId}-${entryIndex}`} className="border-border/70 shadow-none">
                      <CardContent className="space-y-4 p-4">
                        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                          <div className="space-y-2">
                            <Label>Orario</Label>
                            <Input
                              type="time"
                              value={entry.time}
                              onChange={(event) => {
                                const next = normalizeSwitchProfile(profileKind, profileData)
                                next.entries[entryIndex].time = normalizeTime(event.target.value, "00:00")
                                setProfileData(next)
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Azione</Label>
                            <Select
                              value={entry.action}
                              onValueChange={(value) => {
                                const next = normalizeSwitchProfile(profileKind, profileData)
                                next.entries[entryIndex].action = normalizeSwitchEntry(profileKind, { action: value }).action
                                setProfileData(next)
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {profileKind === "shutter" ? (
                                  <>
                                    <SelectItem value="up">SU</SelectItem>
                                    <SelectItem value="down">GIU</SelectItem>
                                  </>
                                ) : (
                                  <>
                                    <SelectItem value="on">ACCENDI</SelectItem>
                                    <SelectItem value="off">SPEGNI</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-end">
                            <Button variant="destructive" size="sm" onClick={() => removeProfileEntry(entryIndex)}>
                              Rimuovi
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {DOW.map((day) => {
                            const active = normalizeDays(entry.days).includes(day.id)
                            return (
                              <Button
                                key={`${profileId}-${entryIndex}-${day.id}`}
                                variant={active ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleProfileDay(entryIndex, day.id)}
                              >
                                {day.label}
                              </Button>
                            )
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  ))}

              {!normalizeThermostatProfile(profileKind === "thermostat" ? profileData : {}).entries.length &&
              profileKind === "thermostat" ? (
                <p className="text-sm text-muted-foreground">Nessuna fascia: fallback inverno 5C.</p>
              ) : null}

              {!normalizeSwitchProfile(
                profileKind === "thermostat" ? "light" : profileKind,
                profileKind === "thermostat" ? {} : profileData
              ).entries.length && profileKind !== "thermostat" ? (
                <p className="text-sm text-muted-foreground">Nessuna fascia oraria configurata.</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={addProfileEntry}>
              Aggiungi fascia
            </Button>
            <Button onClick={saveProfile}>Salva profilo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
