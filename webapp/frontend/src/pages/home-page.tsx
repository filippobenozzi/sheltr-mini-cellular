import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Boxes, Cloud, SlidersHorizontal } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { apiJson } from "@/lib/api"
import { DEVICE_TYPE_META } from "@/lib/device"
import type { ConfigInstanceListItem } from "@/lib/types"

type InstancesResponse = {
  instances?: ConfigInstanceListItem[]
}

const FEATURE_CARDS = [
  {
    title: "Sheltr Mini",
    description: "Cloud standard dal firmware, sincronizzazione dispositivi dal retained e UI dedicata senza campi superflui.",
    icon: Cloud,
  },
  {
    title: "Sheltr 4G / DR154",
    description: "Configurazione completa di schede, canali, stanze e publish MQTT mantenendo la compatibilità storica.",
    icon: Boxes,
  },
  {
    title: "Controllo live",
    description: "Stanze, dimmer, tapparelle, termostati e profili orari in una dashboard unica pronta per mobile e desktop.",
    icon: SlidersHorizontal,
  },
] as const

export function HomePage() {
  const [instances, setInstances] = useState<ConfigInstanceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function loadInstances() {
      try {
        const response = await apiJson<InstancesResponse>("/api/instances")
        if (!cancelled) {
          const items = Array.isArray(response.instances) ? response.instances : []
          setInstances(items.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" })))
          setError("")
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Errore caricamento istanze")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInstances()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell
      title="Portale Sheltr Cloud"
      description="Frontend React + shadcn/ui per configurare istanze, sincronizzare Sheltr Mini e controllare i dispositivi pubblicati dal cloud."
      actions={
        <>
          <Button asChild size="sm" className="rounded-full">
            <Link to="/config">Apri configurazione</Link>
          </Button>
          {instances[0] ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to={instances[0].controlUrl || `/control/${encodeURIComponent(instances[0].id)}`}>
                Vai al controllo
              </Link>
            </Button>
          ) : null}
        </>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="overflow-hidden border-border/80 bg-background/90">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Tema chiaro</Badge>
              <Badge variant="secondary">shadcn/ui</Badge>
              <Badge variant="secondary">React + Vite</Badge>
            </div>
            <div className="space-y-3">
              <CardTitle className="max-w-3xl text-3xl leading-tight md:text-4xl">
                Un’unica UI per configurare e controllare Sheltr Mini e Sheltr 4G senza dover più saltare tra pagine statiche diverse.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                La nuova interfaccia mantiene gli endpoint Flask esistenti, ma porta dentro routing applicativo,
                layout coerente, componenti shadcn e un flusso molto più pulito per Mini, sync cloud e gestione DR154.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {FEATURE_CARDS.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="border-border/70 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl border bg-muted/50">
                    <Icon className="size-5" />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm leading-6 text-muted-foreground">{description}</CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-background/90">
          <CardHeader>
            <CardTitle>Istanze disponibili</CardTitle>
            <CardDescription>Elenco pubblico delle istanze già registrate nel portale.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Caricamento non riuscito</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!error && loading ? <p className="text-sm text-muted-foreground">Caricamento istanze in corso...</p> : null}

            {!error && !loading && !instances.length ? (
              <p className="text-sm text-muted-foreground">Nessuna istanza configurata al momento.</p>
            ) : null}

            {!error && instances.length ? (
              <div className="space-y-3">
                {instances.slice(0, 6).map((instance) => (
                  <Card key={instance.id} className="border-border/70 shadow-none">
                    <CardContent className="flex flex-col gap-3 p-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{instance.name}</h3>
                          <Badge variant="outline">
                            {instance.deviceLabel || DEVICE_TYPE_META[instance.deviceType]?.label || instance.deviceType}
                          </Badge>
                          {instance.authRequired ? <Badge variant="secondary">Login richiesto</Badge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          `{instance.id}` •{" "}
                          {instance.deviceType === "sheltr_mini"
                            ? "autoconfigurazione"
                            : `${instance.boardsCount} schede`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={instance.controlUrl || `/control/${encodeURIComponent(instance.id)}`}>Controlla</Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/instance/${encodeURIComponent(instance.id)}/config`}>
                            Modifica
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/80 bg-background/90">
          <CardHeader>
            <CardTitle>Preset dispositivo</CardTitle>
            <CardDescription>
              Il portale usa i profili esposti dal backend e applica la configurazione giusta in base al tipo modulo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {Object.entries(DEVICE_TYPE_META).map(([key, meta]) => (
              <Card key={key} className="border-border/70 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{meta.label}</CardTitle>
                    <Badge variant="outline">{meta.module}</Badge>
                  </div>
                  <CardDescription>{meta.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0 text-sm text-muted-foreground">
                  <p>Transport: {meta.transport}</p>
                  <p>Payload default: {meta.defaultPayloadFormat}</p>
                  <Separator />
                  <Button asChild variant="outline" size="sm">
                    <Link to="/config">Usa questo preset</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-background/90">
          <CardHeader>
            <CardTitle>Flussi supportati</CardTitle>
            <CardDescription>
              La migrazione porta gli stessi flussi backend dentro una UI unificata e responsiva.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
            <p>Configurazione istanze con autenticazione dedicata lato config e link controllo immediato.</p>
            <p>Sheltr Mini con topic derivati dall’ID istanza, sync dal retained cloud e dispositivi in sola lettura.</p>
            <p>Sheltr 4G / DR154 con schede, canali, stanze, publish MQTT e profili orari per luce, shutter e termostati.</p>
            <Button asChild className="rounded-full">
              <Link to="/config">Apri la console di configurazione</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  )
}
