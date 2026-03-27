import { NextRequest, NextResponse } from 'next/server'
import { queryOne, query } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/bmc/latest?asset_id=N
export async function GET(req: NextRequest) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const [metric, hw] = await Promise.all([
    queryOne<{
      collected_at: string
      power_watts: number | null
      psu1_status: string | null; psu2_status: string | null
      cpu1_temp_c: number | null; cpu2_temp_c: number | null
      inlet_temp_c: number | null; outlet_temp_c: number | null
      overall_health: string | null
    }>(
      `SELECT collected_at, power_watts, psu1_status, psu2_status,
              cpu1_temp_c, cpu2_temp_c, inlet_temp_c, outlet_temp_c,
              overall_health
       FROM bmc_metrics
       WHERE asset_id = $1
       ORDER BY collected_at DESC
       LIMIT 1`,
      [assetId]
    ),
    query<{ component: string; name: string; status: string; checked_at: string }>(
      `SELECT DISTINCT ON (component, name)
              component, name, status, checked_at
       FROM hw_health
       WHERE asset_id = $1
       ORDER BY component, name, checked_at DESC`,
      [assetId]
    ),
  ])

  return NextResponse.json({ metric: metric ?? null, hw })
}
