'use client'

export type UnitType = 'server' | 'switch' | 'firewall' | 'storage' | 'patch_panel' | 'kvm' | 'ups' | 'pdu'

export interface StencilConfig {
  label: string
  defaultSizeU: number
  color: string
  stroke: string
}

export const STENCILS: Record<UnitType, StencilConfig> = {
  server:      { label: '서버',        defaultSizeU: 1, color: '#0e7490', stroke: '#06b6d4' },
  switch:      { label: '스위치',      defaultSizeU: 1, color: '#065f46', stroke: '#10b981' },
  firewall:    { label: '방화벽',      defaultSizeU: 1, color: '#92400e', stroke: '#f59e0b' },
  storage:     { label: '스토리지',    defaultSizeU: 2, color: '#581c87', stroke: '#a855f7' },
  patch_panel: { label: '패치 패널',   defaultSizeU: 1, color: '#334155', stroke: '#94a3b8' },
  kvm:         { label: 'KVM',         defaultSizeU: 1, color: '#334155', stroke: '#94a3b8' },
  ups:         { label: 'UPS',         defaultSizeU: 2, color: '#713f12', stroke: '#eab308' },
  pdu:         { label: 'PDU',         defaultSizeU: 1, color: '#374151', stroke: '#9ca3af' },
}

/* ── SVG Renderers ─────────────────────────────────── */

function ServerSvg({ w, h, s }: { w: number; h: number; s: string }) {
  // Front panel: handles, drive bays, power LED
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.6" />
      {/* Left handle */}
      <rect x="4" y="5" width="2" height="12" fill={s} opacity="0.4" rx="0.5" />
      {/* Power LED */}
      <circle cx="14" cy="11" r="2" fill="#22c55e" opacity="0.7" />
      {/* Drive bays */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={24 + i * 18} y="4" width="14" height="14" fill={s} opacity="0.15" rx="1" stroke={s} strokeWidth="0.5" strokeOpacity="0.3" />
      ))}
      {/* Right handle */}
      <rect x="194" y="5" width="2" height="12" fill={s} opacity="0.4" rx="0.5" />
    </svg>
  )
}

function SwitchSvg({ w, h, s }: { w: number; h: number; s: string }) {
  // Front panel: port row, status LEDs
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.6" />
      {/* Status LEDs */}
      <circle cx="8" cy="7" r="1.5" fill={s} opacity="0.5" />
      <circle cx="8" cy="15" r="1.5" fill={s} opacity="0.3" />
      {/* Ports row 1 */}
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={i} x={18 + i * 7.2} y="3" width="5.5" height="6" fill={s} opacity="0.2" rx="0.5" stroke={s} strokeWidth="0.4" strokeOpacity="0.4" />
      ))}
      {/* Ports row 2 */}
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={`b${i}`} x={18 + i * 7.2} y="12" width="5.5" height="6" fill={s} opacity="0.15" rx="0.5" stroke={s} strokeWidth="0.4" strokeOpacity="0.3" />
      ))}
    </svg>
  )
}

function FirewallSvg({ w, h, s }: { w: number; h: number; s: string }) {
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.6" />
      {/* Shield icon */}
      <path d="M12,4 L18,6 L18,13 C18,16 15,18 12,19 C9,18 6,16 6,13 L6,6 Z" fill={s} opacity="0.25" stroke={s} strokeWidth="0.8" strokeOpacity="0.5" />
      {/* Ports */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={28 + i * 14} y="5" width="10" height="12" fill={s} opacity="0.15" rx="1" stroke={s} strokeWidth="0.5" strokeOpacity="0.3" />
      ))}
      {/* Status LED */}
      <circle cx="185" cy="11" r="2.5" fill={s} opacity="0.4" />
      <circle cx="193" cy="11" r="2.5" fill={s} opacity="0.25" />
    </svg>
  )
}

function StorageSvg({ w, h, s }: { w: number; h: number; s: string }) {
  // Dense drive bay grid (front-loading)
  return (
    <svg width={w} height={h} viewBox="0 0 200 44" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="44" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="42" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.6" />
      {/* Drive bays 4x6 */}
      {Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 12 }, (_, col) => (
          <rect key={`${row}-${col}`} x={8 + col * 15.5} y={4 + row * 9.5} width="13" height="7.5" fill={s} opacity="0.12" rx="0.5" stroke={s} strokeWidth="0.4" strokeOpacity="0.3" />
        ))
      )}
    </svg>
  )
}

function PatchPanelSvg({ w, h, s }: { w: number; h: number; s: string }) {
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.5" />
      {/* Port circles row 1 */}
      {Array.from({ length: 24 }, (_, i) => (
        <circle key={i} cx={12 + i * 7.5} cy="7" r="2.2" fill="none" stroke={s} strokeWidth="0.6" opacity="0.4" />
      ))}
      {/* Port circles row 2 */}
      {Array.from({ length: 24 }, (_, i) => (
        <circle key={`b${i}`} cx={12 + i * 7.5} cy="15" r="2.2" fill="none" stroke={s} strokeWidth="0.6" opacity="0.35" />
      ))}
    </svg>
  )
}

function KvmSvg({ w, h, s }: { w: number; h: number; s: string }) {
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.5" />
      {/* Display area */}
      <rect x="6" y="4" width="30" height="14" fill={s} opacity="0.1" rx="1" stroke={s} strokeWidth="0.5" strokeOpacity="0.3" />
      {/* KVM Ports */}
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={44 + i * 9.5} y="5" width="7" height="12" fill={s} opacity="0.15" rx="0.5" stroke={s} strokeWidth="0.4" strokeOpacity="0.3" />
      ))}
    </svg>
  )
}

function UpsSvg({ w, h, s }: { w: number; h: number; s: string }) {
  return (
    <svg width={w} height={h} viewBox="0 0 200 44" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="44" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="42" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.6" />
      {/* LCD Panel */}
      <rect x="10" y="6" width="50" height="20" fill={s} opacity="0.08" rx="2" stroke={s} strokeWidth="0.6" strokeOpacity="0.4" />
      {/* Battery bars */}
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={16 + i * 8} y="10" width="5" height="12" fill={s} opacity={0.15 + i * 0.06} rx="0.5" />
      ))}
      {/* Buttons */}
      <circle cx="75" cy="16" r="4" fill={s} opacity="0.2" stroke={s} strokeWidth="0.5" strokeOpacity="0.3" />
      {/* Vents */}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={100 + i * 10} y1="8" x2={100 + i * 10} y2="36" stroke={s} strokeWidth="0.5" opacity="0.2" />
      ))}
      {/* Power LED */}
      <circle cx="190" cy="22" r="3" fill="#22c55e" opacity="0.5" />
    </svg>
  )
}

function PduSvg({ w, h, s }: { w: number; h: number; s: string }) {
  return (
    <svg width={w} height={h} viewBox="0 0 200 22" preserveAspectRatio="none">
      <rect x="0" y="0" width="200" height="22" fill="#0d1120" rx="2" />
      <rect x="1" y="1" width="198" height="20" fill="none" stroke={s} strokeWidth="1" rx="2" opacity="0.5" />
      {/* Power switch */}
      <circle cx="10" cy="11" r="3" fill={s} opacity="0.25" stroke={s} strokeWidth="0.5" strokeOpacity="0.4" />
      {/* Outlets */}
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i}>
          <rect x={24 + i * 14} y="5" width="10" height="12" fill={s} opacity="0.1" rx="1" stroke={s} strokeWidth="0.5" strokeOpacity="0.3" />
          <circle cx={29 + i * 14} cy="9" r="1" fill={s} opacity="0.3" />
          <circle cx={29 + i * 14} cy="13" r="1" fill={s} opacity="0.3" />
        </g>
      ))}
    </svg>
  )
}

/* ── Main Component ────────────────────────────────── */

const RENDERERS: Record<UnitType, (props: { w: number; h: number; s: string }) => React.ReactNode> = {
  server: ServerSvg,
  switch: SwitchSvg,
  firewall: FirewallSvg,
  storage: StorageSvg,
  patch_panel: PatchPanelSvg,
  kvm: KvmSvg,
  ups: UpsSvg,
  pdu: PduSvg,
}

export default function StencilIcon({ type, width, height }: {
  type: string
  width: number
  height: number
}) {
  const unitType = type as UnitType
  const config = STENCILS[unitType]
  const Renderer = RENDERERS[unitType]
  if (!config || !Renderer) return null
  return <Renderer w={width} h={height} s={config.stroke} />
}
