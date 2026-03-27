'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Building2, ChevronRight, ChevronDown, Plus, Edit2, Trash2,
  RefreshCw, X, Users, Package, FolderTree,
} from 'lucide-react'

interface Org {
  id: number
  name: string
  parent_id: number | null
  org_type: string
  manager_name: string | null
  contact: string | null
  sort_order: number
  asset_count: number
}

const TYPE_LABEL: Record<string, string> = {
  division: '부서', team: '팀',
}

const TYPE_COLOR: Record<string, string> = {
  division: 'text-purple-400',
  team:     'text-green-400',
}

interface TreeNode extends Org {
  children: TreeNode[]
}

function buildTree(orgs: Org[]): TreeNode[] {
  const map = new Map<number, TreeNode>()
  orgs.forEach(o => map.set(o.id, { ...o, children: [] }))
  const roots: TreeNode[] = []
  map.forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function TreeItem({
  node, depth, expanded, onToggle, onEdit, onDelete, onAddChild,
}: {
  node: TreeNode; depth: number; expanded: Set<number>
  onToggle: (id: number) => void; onEdit: (org: Org) => void
  onDelete: (id: number) => void; onAddChild: (parentId: number) => void
}) {
  const open = expanded.has(node.id)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--c-card)] group transition-colors"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        <button
          onClick={() => hasChildren && onToggle(node.id)}
          className={`w-5 h-5 flex items-center justify-center ${hasChildren ? 'text-[var(--c-muted)] hover:text-[var(--c-text)]' : 'invisible'}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <Building2 size={16} className={TYPE_COLOR[node.org_type] || 'text-[var(--c-muted)]'} />

        <span className="text-sm text-[var(--c-text)] font-medium flex-1">{node.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLOR[node.org_type] || 'text-[var(--c-muted)]'} bg-[var(--c-bg)]`}>
          {TYPE_LABEL[node.org_type] || node.org_type}
        </span>

        {node.manager_name && (
          <span className="text-xs text-[var(--c-muted)] flex items-center gap-1">
            <Users size={12} /> {node.manager_name}
          </span>
        )}

        {node.contact && (
          <span className="text-xs text-[var(--c-faint)] truncate max-w-[180px]" title={node.contact}>
            {node.contact}
          </span>
        )}

        <span className="text-xs text-[var(--c-faint)] flex items-center gap-1">
          <Package size={12} /> {node.asset_count}
        </span>

        <div className="hidden group-hover:flex items-center gap-1">
          {depth < 2 && (
            <button onClick={() => onAddChild(node.id)} className="p-1 rounded hover:bg-[var(--c-border)]/40 text-[var(--c-muted)] hover:text-green-400" title="하위 조직 추가">
              <Plus size={14} />
            </button>
          )}
          <button onClick={() => onEdit(node)} className="p-1 rounded hover:bg-[var(--c-border)]/40 text-[var(--c-muted)] hover:text-cyan-400" title="수정">
            <Edit2 size={14} />
          </button>
          <button onClick={() => onDelete(node.id)} className="p-1 rounded hover:bg-[var(--c-border)]/40 text-[var(--c-muted)] hover:text-red-400" title="삭제">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {open && node.children.map(child => (
        <TreeItem
          key={child.id} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          onEdit={onEdit} onDelete={onDelete} onAddChild={onAddChild}
        />
      ))}
    </div>
  )
}

const EMPTY_ORG = { name: '', parent_id: null as number | null, org_type: 'team', manager_name: '', contact: '', sort_order: 0 }

export default function OrganizationsPage() {
  const [orgs, setOrgs]       = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editOrg, setEditOrg] = useState<(Partial<typeof EMPTY_ORG> & { id?: number }) | null>(null)
  const [userRole, setUserRole] = useState<string>('readonly')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/organizations')
      const data = await res.json()
      setOrgs(data.organizations ?? [])
      // 기본 모두 펼침
      setExpanded(new Set((data.organizations ?? []).map((o: Org) => o.id)))
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    fetch('/api/auth').then(r => r.json()).then(d => { if (d.user) setUserRole(d.user.role) }).catch(() => {})
  }, [load])

  const tree = buildTree(orgs)

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    if (!editOrg) return
    const method = editOrg.id ? 'PUT' : 'POST'
    const res = await fetch('/api/organizations', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editOrg),
    })
    if (res.ok) {
      setEditOrg(null)
      load()
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('이 조직을 삭제하시겠습니까? 하위 조직은 최상위로 이동됩니다.')) return
    const res = await fetch(`/api/organizations?id=${id}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  const totalAssets = orgs.reduce((s, o) => s + o.asset_count, 0)
  const unassigned = orgs.length === 0 ? 0 : totalAssets // recalculate below if needed

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderTree size={24} className="text-cyan-400" />
          <h1 className="text-xl font-bold text-[var(--c-text)]">조직 관리</h1>
          <span className="text-sm text-[var(--c-muted)]">{orgs.length}개 조직</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => setEditOrg({ ...EMPTY_ORG })}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/30 text-sm"
            >
              <Plus size={16} /> 조직 추가
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '부서', value: orgs.filter(o => o.org_type === 'division').length, color: 'text-purple-400' },
          { label: '팀', value: orgs.filter(o => o.org_type === 'team').length, color: 'text-green-400' },
          { label: '담당자', value: orgs.filter(o => o.manager_name).length, color: 'text-cyan-400' },
        ].map((s, i) => (
          <div key={i} className="p-4 rounded-xl bg-[var(--c-card)] border border-[var(--c-border)]">
            <p className="text-xs text-[var(--c-faint)]">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="rounded-xl bg-[var(--c-card)] border border-[var(--c-border)] p-4">
        {loading ? (
          <p className="text-[var(--c-faint)] text-center py-8">로딩 중...</p>
        ) : tree.length === 0 ? (
          <p className="text-[var(--c-faint)] text-center py-8">조직이 없습니다. 조직을 추가해주세요.</p>
        ) : (
          tree.map(node => (
            <TreeItem
              key={node.id} node={node} depth={0}
              expanded={expanded} onToggle={toggleExpand}
              onEdit={(org) => setEditOrg({ id: org.id, name: org.name, parent_id: org.parent_id, org_type: org.org_type, manager_name: org.manager_name || '', contact: org.contact || '', sort_order: org.sort_order })}
              onDelete={handleDelete}
              onAddChild={(parentId) => setEditOrg({ ...EMPTY_ORG, parent_id: parentId })}
            />
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {editOrg && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--c-card)] border border-[var(--c-border)] rounded-2xl p-6 w-[440px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--c-text)]">
                {editOrg.id ? '조직 수정' : '조직 추가'}
              </h2>
              <button onClick={() => setEditOrg(null)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">조직명 *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.name ?? ''} onChange={e => setEditOrg({ ...editOrg, name: e.target.value })}
                  placeholder="예: 개발팀"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">유형</label>
                <select
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.org_type ?? 'team'} onChange={e => setEditOrg({ ...editOrg, org_type: e.target.value })}
                >
                  <option value="division">부서</option>
                  <option value="team">팀</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">상위 조직</label>
                <select
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.parent_id ?? ''} onChange={e => setEditOrg({ ...editOrg, parent_id: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">없음 (최상위)</option>
                  {orgs.filter(o => o.id !== editOrg.id).map(o => (
                    <option key={o.id} value={o.id}>{TYPE_LABEL[o.org_type] || o.org_type} — {o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">관리자</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.manager_name ?? ''} onChange={e => setEditOrg({ ...editOrg, manager_name: e.target.value })}
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">연락처 (장애 알림 발송용)</label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.contact ?? ''} onChange={e => setEditOrg({ ...editOrg, contact: e.target.value })}
                  placeholder="010-1234-5678 / email@example.com"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-faint)] mb-1">정렬 순서</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-sm text-[var(--c-text)]"
                  value={editOrg.sort_order ?? 0} onChange={e => setEditOrg({ ...editOrg, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditOrg(null)} className="px-4 py-2 rounded-lg border border-[var(--c-border)] text-sm text-[var(--c-muted)] hover:text-[var(--c-text)]">
                취소
              </button>
              <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/30 text-sm">
                {editOrg.id ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
