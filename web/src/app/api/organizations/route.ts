import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { requireAuth, requireRole } from '@/lib/auth'

interface OrgRow {
  id: number
  name: string
  parent_id: number | null
  org_type: string
  manager_name: string | null
  contact: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  asset_count: number
}

// GET /api/organizations — 전체 조직 목록 (트리 빌드용)
export async function GET() {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await query<OrgRow>(
    `SELECT o.*, COALESCE(ac.cnt, 0)::int AS asset_count
     FROM organizations o
     LEFT JOIN (
       SELECT org_id, COUNT(*) AS cnt FROM assets WHERE is_active = true GROUP BY org_id
     ) ac ON ac.org_id = o.id
     WHERE o.is_active = true
     ORDER BY o.sort_order, o.name`
  )

  return NextResponse.json({ organizations: rows })
}

// POST /api/organizations — 조직 생성 (admin only)
export async function POST(req: NextRequest) {
  try { await requireRole('admin') } catch {
    return NextResponse.json({ error: '관리자만 조직을 생성할 수 있습니다' }, { status: 403 })
  }

  const body = await req.json()
  const { name, parent_id, org_type, manager_name, contact, sort_order } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: '조직명을 입력하세요' }, { status: 400 })
  }

  // 최대 3단계 검증
  if (parent_id) {
    const parent = await queryOne<{ depth: number }>(
      `WITH RECURSIVE tree AS (
         SELECT id, parent_id, 1 AS depth FROM organizations WHERE id = $1
         UNION ALL
         SELECT o.id, o.parent_id, t.depth + 1 FROM organizations o JOIN tree t ON o.id = t.parent_id
       )
       SELECT MAX(depth) AS depth FROM tree`,
      [parent_id]
    )
    if (parent && parent.depth >= 3) {
      return NextResponse.json({ error: '최대 3단계까지만 지원됩니다' }, { status: 400 })
    }
  }

  const result = await queryOne<{ id: number }>(
    `INSERT INTO organizations (name, parent_id, org_type, manager_name, contact, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [name.trim(), parent_id || null, org_type || 'team', manager_name || null, contact || null, sort_order ?? 0]
  )

  return NextResponse.json({ ok: true, id: result?.id })
}

// PUT /api/organizations — 조직 수정 (admin only)
export async function PUT(req: NextRequest) {
  try { await requireRole('admin') } catch {
    return NextResponse.json({ error: '관리자만 조직을 수정할 수 있습니다' }, { status: 403 })
  }

  const body = await req.json()
  const { id, name, parent_id, org_type, manager_name, contact, sort_order } = body

  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 })
  if (!name?.trim()) return NextResponse.json({ error: '조직명을 입력하세요' }, { status: 400 })

  // 자기 자신을 부모로 설정 방지
  if (parent_id === id) {
    return NextResponse.json({ error: '자기 자신을 상위 조직으로 설정할 수 없습니다' }, { status: 400 })
  }

  await execute(
    `UPDATE organizations SET name=$1, parent_id=$2, org_type=$3, manager_name=$4, contact=$5, sort_order=$6
     WHERE id = $7`,
    [name.trim(), parent_id || null, org_type || 'team', manager_name || null, contact || null, sort_order ?? 0, id]
  )

  return NextResponse.json({ ok: true })
}

// DELETE /api/organizations?id=N — 조직 삭제 (admin only, soft delete)
export async function DELETE(req: NextRequest) {
  try { await requireRole('admin') } catch {
    return NextResponse.json({ error: '관리자만 조직을 삭제할 수 있습니다' }, { status: 403 })
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 })

  // 하위 조직의 parent_id를 null로 설정
  await execute(`UPDATE organizations SET parent_id = NULL WHERE parent_id = $1`, [id])
  // 자산의 org_id를 null로 설정
  await execute(`UPDATE assets SET org_id = NULL WHERE org_id = $1`, [id])
  // soft delete
  await execute(`UPDATE organizations SET is_active = false WHERE id = $1`, [id])

  return NextResponse.json({ ok: true })
}
