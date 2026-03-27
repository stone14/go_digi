import { NextRequest, NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'

// POST — FC 스위치/스토리지 WWN 테이블 저장
export async function POST(req: NextRequest) {
  try {
    const { asset_id, entries, replace } = await req.json() as {
      asset_id: number
      entries: Array<{ wwn: string; port_name?: string; wwn_type: string }>
      replace?: boolean
    }

    if (!asset_id || !entries?.length) {
      return NextResponse.json({ error: 'asset_id and entries required' }, { status: 400 })
    }

    if (replace) {
      await execute(
        `DELETE FROM wwn_entries WHERE asset_id = $1 AND wwn_type IN ('switch_port', 'target')`,
        [asset_id]
      )
    }

    let inserted = 0, updated = 0
    for (const e of entries) {
      const res = await execute(
        `INSERT INTO wwn_entries (asset_id, wwn, wwn_type, port_name, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (asset_id, wwn)
         DO UPDATE SET wwn_type = $3, port_name = $4, last_seen = now()
         RETURNING (xmax = 0) AS is_insert`,
        [asset_id, e.wwn, e.wwn_type || 'switch_port', e.port_name || null]
      )
      if (res.rows[0]?.is_insert) inserted++; else updated++
    }

    return NextResponse.json({ inserted, updated })
  } catch (err) {
    console.error('[WwnTable POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// GET — 장비별 WWN 목록 조회
export async function GET(req: NextRequest) {
  try {
    const assetId = new URL(req.url).searchParams.get('asset_id')
    if (!assetId) {
      return NextResponse.json({ error: 'asset_id required' }, { status: 400 })
    }

    const rows = await query(
      `SELECT wwn, wwn_type, port_name, last_seen
       FROM wwn_entries WHERE asset_id = $1 ORDER BY port_name, wwn`,
      [parseInt(assetId)]
    )
    return NextResponse.json({ entries: rows })
  } catch (err) {
    console.error('[WwnTable GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
