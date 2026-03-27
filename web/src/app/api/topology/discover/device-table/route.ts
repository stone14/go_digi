import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

// POST — 네트워크 장비 MAC 테이블 저장
export async function POST(req: NextRequest) {
  try {
    const { asset_id, entries, replace } = await req.json() as {
      asset_id: number
      entries: Array<{ mac: string; port: string; vlan?: number; type?: string }>
      replace?: boolean
    }

    if (!asset_id || !entries?.length) {
      return NextResponse.json({ error: 'asset_id and entries required' }, { status: 400 })
    }

    if (replace) {
      await execute('DELETE FROM device_mac_table WHERE asset_id = $1', [asset_id])
    }

    let inserted = 0, updated = 0
    for (const e of entries) {
      const res = await execute(
        `INSERT INTO device_mac_table (asset_id, mac, port_name, vlan_id, entry_type, source, updated_at)
         VALUES ($1, $2::macaddr, $3, $4, $5, 'manual', now())
         ON CONFLICT (asset_id, mac, port_name)
         DO UPDATE SET vlan_id = $4, entry_type = $5, updated_at = now()
         RETURNING (xmax = 0) AS is_insert`,
        [asset_id, e.mac, e.port || null, e.vlan || null, e.type || 'dynamic']
      )
      if (res.rows[0]?.is_insert) inserted++; else updated++
    }

    return NextResponse.json({ inserted, updated })
  } catch (err) {
    console.error('[DeviceTable POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// GET — 장비별 MAC 테이블 조회
export async function GET(req: NextRequest) {
  try {
    const assetId = new URL(req.url).searchParams.get('asset_id')
    if (!assetId) {
      return NextResponse.json({ error: 'asset_id required' }, { status: 400 })
    }

    const rows = await query(
      `SELECT mac::text, port_name, vlan_id, entry_type, updated_at
       FROM device_mac_table WHERE asset_id = $1 ORDER BY port_name, mac`,
      [parseInt(assetId)]
    )
    return NextResponse.json({ entries: rows })
  } catch (err) {
    console.error('[DeviceTable GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// DELETE — 장비 MAC 테이블 삭제
export async function DELETE(req: NextRequest) {
  try {
    const assetId = new URL(req.url).searchParams.get('asset_id')
    if (!assetId) {
      return NextResponse.json({ error: 'asset_id required' }, { status: 400 })
    }
    await execute('DELETE FROM device_mac_table WHERE asset_id = $1', [parseInt(assetId)])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DeviceTable DELETE]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
