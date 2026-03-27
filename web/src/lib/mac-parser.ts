/**
 * MAC/ARP/WWN CLI 출력 파서
 * 지원 벤더: Cisco, Juniper, FortiGate, Brocade FC
 */

export interface MacEntry {
  mac: string       // normalized: aa:bb:cc:dd:ee:ff
  port: string
  vlan?: number
  type: string      // dynamic / static / self
}

export interface WwnEntry {
  wwn: string       // normalized: xx:xx:xx:xx:xx:xx:xx:xx
  port_name: string
  wwn_type: string  // switch_port / target / hba
}

export type Vendor = 'cisco' | 'juniper' | 'fortigate' | 'brocade' | 'auto'
export type ParseType = 'mac' | 'arp' | 'wwn'

/** MAC 주소 정규화 → aa:bb:cc:dd:ee:ff */
export function normalizeMac(raw: string): string {
  // Cisco: 0050.56a1.0110 → 00:50:56:a1:01:10
  // Windows: 00-50-56-A1-01-10 → 00:50:56:a1:01:10
  // Standard: 00:50:56:a1:01:10
  const cleaned = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (cleaned.length !== 12) return ''
  return cleaned.match(/.{2}/g)!.join(':')
}

/** 멀티캐스트/브로드캐스트 필터 */
function isUsableMac(mac: string): boolean {
  if (!mac || mac === '00:00:00:00:00:00') return false
  if (mac === 'ff:ff:ff:ff:ff:ff') return false
  if (mac.startsWith('01:00:5e:')) return false  // IPv4 multicast
  if (mac.startsWith('33:33:')) return false      // IPv6 multicast
  if (mac.startsWith('01:80:c2:')) return false   // STP/LLDP
  return true
}

/** 벤더 자동 감지 */
export function detectVendor(text: string): Vendor {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const head = lines.slice(0, 20).join('\n').toLowerCase()

  if (head.includes('vlan') && head.includes('mac address') && head.includes('ports')) return 'cisco'
  if (head.includes('mac address') && (head.includes('type') || head.includes('ports'))) return 'cisco'
  if (head.includes('routing instance') || head.includes('ethernet-switching')) return 'juniper'
  if (head.includes('hardware addr') || head.includes('fortigate')) return 'fortigate'
  if (head.includes('switchname') || head.includes('nsshow') || head.includes('index port address')) return 'brocade'
  if (head.includes('age') && head.includes('hardware')) return 'fortigate'

  return 'auto' // 감지 실패
}

// ────────────────────────────────────────────────
// Cisco 파서
// ────────────────────────────────────────────────

/** Cisco `show mac address-table` */
function parseCiscoMac(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: "   1    0050.56a1.0110    DYNAMIC     Gi0/3"
    // or:     "  10    0050.56a1.0110    STATIC      Gi0/3"
    const m = line.match(
      /^\s*(\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\w+)\s+(\S+)/
    )
    if (!m) continue
    const mac = normalizeMac(m[2])
    if (!isUsableMac(mac)) continue
    results.push({
      mac,
      port: m[4],
      vlan: parseInt(m[1]),
      type: m[3].toLowerCase() === 'static' ? 'static' : 'dynamic',
    })
  }
  return results
}

/** Cisco `show arp` */
function parseCiscoArp(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: "Internet  192.168.1.10    5   0050.56a1.0110  ARPA   GigabitEthernet0/3"
    const m = line.match(
      /Internet\s+[\d.]+\s+\S+\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+\w+\s+(\S+)/
    )
    if (!m) continue
    const mac = normalizeMac(m[1])
    if (!isUsableMac(mac)) continue
    results.push({ mac, port: m[2], type: 'dynamic' })
  }
  return results
}

// ────────────────────────────────────────────────
// Juniper 파서
// ────────────────────────────────────────────────

/** Juniper `show ethernet-switching table` */
function parseJuniperMac(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: "default-switch  00:50:56:a1:01:10 D  -  ge-0/0/3.0"
    // or:     "                00:50:56:a1:01:10 *  10  ge-0/0/3.0"
    const m = line.match(
      /([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+([D*SL])\s+(?:(\d+)|-)\s+(\S+)/
    )
    if (!m) continue
    const mac = normalizeMac(m[1])
    if (!isUsableMac(mac)) continue
    results.push({
      mac,
      port: m[4].replace(/\.\d+$/, ''), // strip unit number
      vlan: m[3] ? parseInt(m[3]) : undefined,
      type: m[2] === 'S' ? 'static' : 'dynamic',
    })
  }
  return results
}

/** Juniper `show arp` */
function parseJuniperArp(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: "00:50:56:a1:01:10 192.168.1.10     ge-0/0/3.0   none"
    const m = line.match(
      /([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+[\d.]+\s+(\S+)/
    )
    if (!m) continue
    const mac = normalizeMac(m[1])
    if (!isUsableMac(mac)) continue
    results.push({ mac, port: m[2].replace(/\.\d+$/, ''), type: 'dynamic' })
  }
  return results
}

// ────────────────────────────────────────────────
// FortiGate 파서
// ────────────────────────────────────────────────

/** FortiGate `get system arp` / `diagnose netlink brctl name` */
function parseFortigateMac(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: "192.168.1.10    5         00:50:56:a1:01:10  port3"
    const m = line.match(
      /[\d.]+\s+\d+\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(\S+)/
    )
    if (!m) continue
    const mac = normalizeMac(m[1])
    if (!isUsableMac(mac)) continue
    results.push({ mac, port: m[2], type: 'dynamic' })
  }
  return results
}

// ────────────────────────────────────────────────
// Brocade FC 파서
// ────────────────────────────────────────────────

/** Brocade `switchshow` — FC 포트 상태 */
function parseBrocadeSwitchshow(text: string): WwnEntry[] {
  const results: WwnEntry[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Format: " 0   0   010000   id    N4    Online      FC  F-Port  20:00:00:25:b5:a1:00:01"
    const m = line.match(
      /^\s*(\d+)\s+\d+\s+\S+\s+\S+\s+\S+\s+Online\s+\S+\s+(\S+-Port)\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){7})/
    )
    if (!m) continue
    const portType = m[2].toLowerCase()
    results.push({
      wwn: m[3].toLowerCase(),
      port_name: `port${m[1]}`,
      wwn_type: portType.includes('f-port') ? 'switch_port' : 'switch_port',
    })
  }
  return results
}

/** Brocade `nsshow` — Name Server (장비 등록 WWN) */
function parseBrocadeNsshow(text: string): WwnEntry[] {
  const results: WwnEntry[] = []
  const lines = text.split('\n')
  let currentPort = ''

  for (const line of lines) {
    // Port Index line
    const portMatch = line.match(/Port\s+Index:\s*(\d+)/)
    if (portMatch) {
      currentPort = `port${portMatch[1]}`
      continue
    }

    // Node Name / Port Name WWN
    const wwnMatch = line.match(
      /(?:Port|Node)\s+Name:\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){7})/i
    )
    if (wwnMatch && currentPort) {
      const isTarget = line.toLowerCase().includes('target')
      results.push({
        wwn: wwnMatch[1].toLowerCase(),
        port_name: currentPort,
        wwn_type: isTarget ? 'target' : 'switch_port',
      })
    }
  }
  return results
}

// ────────────────────────────────────────────────
// CSV 파서
// ────────────────────────────────────────────────

function parseCsvMac(text: string): MacEntry[] {
  const results: MacEntry[] = []
  const lines = text.split('\n').filter(l => l.trim())

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t]/).map(c => c.trim())
    // skip header
    if (i === 0 && cols.some(c => /mac|address/i.test(c))) continue

    // expect: mac, port[, vlan[, type]]
    if (cols.length < 2) continue
    const mac = normalizeMac(cols[0])
    if (!isUsableMac(mac)) continue
    results.push({
      mac,
      port: cols[1],
      vlan: cols[2] ? parseInt(cols[2]) || undefined : undefined,
      type: cols[3]?.toLowerCase() || 'dynamic',
    })
  }
  return results
}

function parseCsvWwn(text: string): WwnEntry[] {
  const results: WwnEntry[] = []
  const lines = text.split('\n').filter(l => l.trim())

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t]/).map(c => c.trim())
    if (i === 0 && cols.some(c => /wwn|port/i.test(c))) continue
    if (cols.length < 2) continue
    results.push({
      wwn: cols[0].toLowerCase(),
      port_name: cols[1],
      wwn_type: cols[2]?.toLowerCase() || 'switch_port',
    })
  }
  return results
}

// ────────────────────────────────────────────────
// 메인 파서
// ────────────────────────────────────────────────

export interface ParseResult {
  vendor_detected: string
  type_detected: ParseType
  mac_entries?: MacEntry[]
  wwn_entries?: WwnEntry[]
}

export function parseDeviceOutput(
  text: string,
  vendor: Vendor = 'auto',
  type: ParseType = 'mac'
): ParseResult {
  if (vendor === 'auto') vendor = detectVendor(text)

  // type 자동 감지: brocade이거나 WWN 패턴이 있으면 wwn
  if (type === 'mac' && (vendor === 'brocade' || /switchshow|nsshow|([0-9a-f]{2}:){7}[0-9a-f]{2}/i.test(text))) {
    type = 'wwn'
  }
  // ARP 자동 감지: show arp / get system arp 패턴
  if (type === 'mac' && /show\s+arp|get\s+system\s+arp/i.test(text)) {
    type = 'arp'
  }

  // CSV 감지
  const firstLine = text.split('\n')[0] || ''
  const isCsv = firstLine.includes(',') || firstLine.includes('\t')

  if (type === 'wwn') {
    let entries: WwnEntry[]
    if (isCsv) {
      entries = parseCsvWwn(text)
    } else if (vendor === 'brocade') {
      // switchshow + nsshow 혼합 파싱
      entries = [...parseBrocadeSwitchshow(text), ...parseBrocadeNsshow(text)]
    } else {
      entries = parseCsvWwn(text) // fallback to CSV
    }
    return { vendor_detected: vendor === 'auto' ? 'unknown' : vendor, type_detected: 'wwn', wwn_entries: entries }
  }

  // MAC / ARP
  let entries: MacEntry[]
  if (isCsv) {
    entries = parseCsvMac(text)
  } else {
    switch (vendor) {
      case 'cisco':
        entries = type === 'arp' ? parseCiscoArp(text) : parseCiscoMac(text)
        break
      case 'juniper':
        entries = type === 'arp' ? parseJuniperArp(text) : parseJuniperMac(text)
        break
      case 'fortigate':
        entries = parseFortigateMac(text)
        break
      default:
        // 여러 파서 시도
        entries = parseCiscoMac(text)
        if (entries.length === 0) entries = parseJuniperMac(text)
        if (entries.length === 0) entries = parseFortigateMac(text)
        if (entries.length === 0) entries = parseCsvMac(text)
        break
    }
  }

  return { vendor_detected: vendor === 'auto' ? 'unknown' : vendor, type_detected: type, mac_entries: entries }
}
