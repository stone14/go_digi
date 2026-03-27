import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/assets/software-installations?asset_id=N
//   → 해당 서버에 설치된 SW 목록
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const rows = await query(
    `SELECT si.id, si.installed_at, si.notes AS install_notes,
            mc.software_name, mc.software_version, mc.vendor,
            mc.license_count,
            mc.contract_end::text AS end_date
     FROM software_installations si
     JOIN maintenance_contracts mc ON mc.id = si.contract_id
     WHERE si.asset_id = $1
       AND mc.is_active = true
     ORDER BY mc.software_name`,
    [assetId]
  )

  return NextResponse.json({ installations: rows })
}
