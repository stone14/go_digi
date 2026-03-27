/**
 * Redfish API 클라이언트
 * iDRAC 7+, iLO 4+, Supermicro IPMI, Lenovo XCC, Fujitsu iRMC 지원
 */

export interface RedfishThermal {
  temperatures: Array<{
    name: string
    readingCelsius: number | null
    physicalContext: string
  }>
  fans: Array<{
    name: string
    reading: number | null
    readingUnits: string
  }>
}

export interface RedfishPower {
  powerConsumedWatts: number | null
  powerSupplies: Array<{
    name: string
    status: string
    powerCapacityWatts: number | null
  }>
}

export interface RedfishHealth {
  overall: string
  cpu: string
  memory: string
  storage: string
  network: string
}

export interface RedfishInventory {
  biosVersion:  string
  bmcVersion:   string
  cpuModel:     string
  cpuCount:     number
  cpuCores:     number
  memTotalGB:   number
  memSlots:     unknown[]
  disks:        unknown[]
  nics:         unknown[]
}

export interface RedfishSelEntry {
  id:          string
  created:     string
  severity:    string
  message:     string
  sensorType?: string
}

export class RedfishClient {
  private baseURL: string
  private headers: HeadersInit

  constructor(bmcIP: string, username: string, password: string) {
    this.baseURL = `https://${bmcIP}`
    const cred   = Buffer.from(`${username}:${password}`).toString('base64')
    this.headers = {
      Authorization: `Basic ${cred}`,
      'Content-Type': 'application/json',
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      headers: this.headers,
      // @ts-ignore — Node.js fetch
      rejectUnauthorized: false,
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Redfish ${path} → HTTP ${res.status}`)
    return res.json()
  }

  async getThermal(): Promise<RedfishThermal> {
    const raw = await this.get<Record<string, unknown>>(
      '/redfish/v1/Chassis/1/Thermal'
    )
    const temps = ((raw.Temperatures ?? raw.Members ?? []) as Record<string, unknown>[]).map(t => ({
      name:            String(t.Name ?? t.MemberID ?? ''),
      readingCelsius:  t.ReadingCelsius != null ? Number(t.ReadingCelsius) : null,
      physicalContext: String(t.PhysicalContext ?? ''),
    }))
    const fans = ((raw.Fans ?? []) as Record<string, unknown>[]).map(f => ({
      name:         String(f.Name ?? f.FanName ?? ''),
      reading:      f.Reading != null ? Number(f.Reading) : null,
      readingUnits: String(f.ReadingUnits ?? 'RPM'),
    }))
    return { temperatures: temps, fans }
  }

  async getPower(): Promise<RedfishPower> {
    const raw = await this.get<Record<string, unknown>>(
      '/redfish/v1/Chassis/1/Power'
    )
    const ctrl = ((raw.PowerControl ?? []) as Record<string, unknown>[])[0] ?? {}
    const psus  = ((raw.PowerSupplies ?? []) as Record<string, unknown>[]).map(p => ({
      name:               String(p.Name ?? ''),
      status:             String((p.Status as Record<string, unknown>)?.Health ?? p.Status ?? 'Unknown'),
      powerCapacityWatts: p.PowerCapacityWatts != null ? Number(p.PowerCapacityWatts) : null,
    }))
    return {
      powerConsumedWatts: ctrl.PowerConsumedWatts != null ? Number(ctrl.PowerConsumedWatts) : null,
      powerSupplies: psus,
    }
  }

  async getHealth(): Promise<RedfishHealth> {
    const raw = await this.get<Record<string, unknown>>(
      '/redfish/v1/Systems/1'
    )
    const status = raw.Status as Record<string, unknown> ?? {}
    const sub    = status.SubStatus as Record<string, unknown> ?? {}
    return {
      overall: String(status.Health ?? 'Unknown'),
      cpu:     String(sub.CPU     ?? ((raw.ProcessorSummary as Record<string, unknown>)?.Status as Record<string, unknown>)?.Health ?? 'Unknown'),
      memory:  String(sub.Memory  ?? ((raw.MemorySummary   as Record<string, unknown>)?.Status as Record<string, unknown>)?.Health ?? 'Unknown'),
      storage: String(sub.Storage ?? 'Unknown'),
      network: String(sub.Network ?? 'Unknown'),
    }
  }

  async getInventory(): Promise<Partial<RedfishInventory>> {
    const raw = await this.get<Record<string, unknown>>('/redfish/v1/Systems/1')
    const procSum = raw.ProcessorSummary as Record<string, unknown> ?? {}
    const memSum  = raw.MemorySummary  as Record<string, unknown> ?? {}
    return {
      biosVersion: String(raw.BiosVersion ?? ''),
      cpuModel:    String(procSum.Model    ?? ''),
      cpuCount:    Number(procSum.Count    ?? 0),
      memTotalGB:  Number(memSum.TotalSystemMemoryGiB ?? 0),
    }
  }

  async getSEL(lastEventId?: string): Promise<RedfishSelEntry[]> {
    const raw = await this.get<Record<string, unknown>>(
      '/redfish/v1/Systems/1/LogServices/Sel/Entries'
    )
    const members = (raw.Members ?? []) as Record<string, unknown>[]
    return members
      .filter(e => !lastEventId || String(e['@odata.id']).includes(lastEventId) === false)
      .map(e => ({
        id:         String(e.Id ?? e['@odata.id'] ?? ''),
        created:    String(e.Created ?? ''),
        severity:   String((e.Severity ?? 'OK')),
        message:    String(e.Message ?? e.MessageArgs ?? ''),
        sensorType: String(e.SensorType ?? ''),
      }))
  }
}
