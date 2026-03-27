import { NextRequest, NextResponse } from 'next/server'
import { query, execute, queryOne } from '@/lib/db'

interface RegisterPayload {
  token:      string   // 사전 발급된 등록 토큰
  hostname:   string
  ip_address: string
  os:         string   // Linux / Windows
  os_version: string
  arch:       string   // amd64 / arm64
  agent_version: string
}

export async function POST(req: NextRequest) {
  try {
    const body: RegisterPayload = await req.json()
    const { token, hostname, ip_address, os, os_version, arch, agent_version } = body

    if (!token || !hostname) {
      return NextResponse.json({ error: 'token and hostname required' }, { status: 400 })
    }

    // 토큰 검증
    const tokenRow = await queryOne<{ id: number; asset_id: number | null; revoked: boolean }>(
      'SELECT id, asset_id, revoked FROM agent_tokens WHERE token = $1',
      [token]
    )

    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json({ error: 'Invalid or revoked token' }, { status: 401 })
    }

    let assetId = tokenRow.asset_id

    if (assetId) {
      // 기존 자산 업데이트
      await execute(
        `UPDATE assets SET
           hostname = $1, ip_address = $2, os = $3, os_version = $4,
           arch = $5, agent_version = $6, status = 'online', last_seen = now(), updated_at = now()
         WHERE id = $7`,
        [hostname, ip_address, os, os_version, arch, agent_version ?? null, assetId]
      )
    } else {
      // 신규 자산 자동 등록
      const newAsset = await queryOne<{ id: number }>(
        `INSERT INTO assets (name, hostname, ip_address, type, os, os_version, arch,
                            agent_version, node_type, registration_source, status, last_seen)
         VALUES ($1, $2, $3, 'server', $4, $5, $6, $7, 'baremetal', 'agent', 'online', now())
         RETURNING id`,
        [hostname, hostname, ip_address, os, os_version, arch, agent_version ?? null]
      )
      assetId = newAsset!.id

      // 토큰에 asset_id 연결
      await execute(
        'UPDATE agent_tokens SET asset_id = $1, last_seen = now() WHERE id = $2',
        [assetId, tokenRow.id]
      )

      // 유지보수 계약 레코드 초기화
      await execute(
        'INSERT INTO maintenance_contracts (asset_id) VALUES ($1)',
        [assetId]
      )
    }

    // 수집 설정 반환
    const settings = await query<{ key: string; value: string }>(
      `SELECT key, value FROM system_settings
       WHERE key IN ('agent_check_interval', 'metrics_raw_days')`
    )
    const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]))

    return NextResponse.json({
      asset_id:        assetId,
      collect_interval: 60,           // 메트릭 수집 주기 (초)
      log_collect:     true,
      heartbeat_interval: 30,         // 하트비트 주기 (초)
      agent_check_interval: parseInt(cfg.agent_check_interval || '5'),
    })
  } catch (err) {
    console.error('[Agent Register]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
