import { NextRequest, NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { hostname, wwn } = await req.json()

    const asset = await queryOne<{ id: number }>(
      `SELECT id FROM assets WHERE hostname = $1 OR ip_address::text = $1 LIMIT 1`,
      [hostname]
    )
    if (!asset) return NextResponse.json({ ok: true })

    await execute(
      `INSERT INTO wwn_entries (asset_id, wwn, wwn_type, first_seen, last_seen)
       VALUES ($1, $2, 'switch_port', now(), now())
       ON CONFLICT (asset_id, wwn) DO UPDATE SET last_seen = now()`,
      [asset.id, wwn]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[WWN]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
