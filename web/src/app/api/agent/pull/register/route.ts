import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

interface RegisterPayload {
  token:         string
  hostname:      string
  ip:            string
  port:          number
  node_type:     string   // baremetal | vm | cloud
  os:            string
  arch:          string
  agent_version: string
}

export async function POST(req: NextRequest) {
  try {
    const body: RegisterPayload = await req.json()
    const { token, hostname, ip, port, node_type, os, arch, agent_version } = body

    if (!token || !hostname || !ip || !port) {
      return NextResponse.json({ error: 'token, hostname, ip, port required' }, { status: 400 })
    }

    // 토큰 검증
    const tokenRow = await queryOne<{ id: number; asset_id: number | null; revoked: boolean }>(
      'SELECT id, asset_id, revoked FROM agent_tokens WHERE token = $1',
      [token]
    )
    if (!tokenRow || tokenRow.revoked) {
      return NextResponse.json({ error: 'Invalid or revoked token' }, { status: 401 })
    }

    const agentUrl = `http://${ip}:${port}`

    let assetId = tokenRow.asset_id

    if (assetId) {
      // 기존 자산에 agent_url 업데이트
      await execute(
        `UPDATE assets SET
           hostname = $1, ip_address = $2, os = $3, arch = $4,
           agent_version = $5, agent_url = $6, node_type = $7,
           status = 'online', last_seen = now(), updated_at = now()
         WHERE id = $8`,
        [hostname, ip, os, arch, agent_version ?? null, agentUrl, node_type ?? null, assetId]
      )
    } else {
      // 신규 자산 등록
      const newAsset = await queryOne<{ id: number }>(
        `INSERT INTO assets (name, hostname, ip_address, type, os, arch, agent_url, node_type, status, last_seen)
         VALUES ($1, $2, $3, 'server', $4, $5, $6, $7, 'online', now())
         RETURNING id`,
        [hostname, hostname, ip, os, arch, agentUrl, node_type ?? null]
      )
      assetId = newAsset!.id

      await execute(
        'UPDATE agent_tokens SET asset_id = $1, last_seen = now() WHERE id = $2',
        [assetId, tokenRow.id]
      )

      await execute(
        'INSERT INTO maintenance_contracts (asset_id) VALUES ($1)',
        [assetId]
      )
    }

    // 토큰 last_seen 갱신
    await execute(
      'UPDATE agent_tokens SET last_seen = now() WHERE id = $1',
      [tokenRow.id]
    )


    return NextResponse.json({
      asset_id:      assetId,
      poll_interval: 60,
    })
  } catch (err) {
    console.error('[agent register]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
