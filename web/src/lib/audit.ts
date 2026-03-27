import { execute } from '@/lib/db'

interface AuditParams {
  userId?: number
  action: string
  targetType?: string
  targetId?: number
  detail?: Record<string, unknown>
  ipAddress?: string
}

export async function logAudit(params: AuditParams) {
  const { userId, action, targetType, targetId, detail, ipAddress } = params
  try {
    await execute(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId ?? null,
        action,
        targetType ?? null,
        targetId ?? null,
        detail ? JSON.stringify(detail) : null,
        ipAddress ?? null,
      ]
    )
  } catch (err) {
    console.error('[Audit] Failed to log:', err)
  }
}

// Helper to extract user id and IP from request context
export async function logAuditFromRequest(
  action: string,
  targetType?: string,
  targetId?: number,
  detail?: Record<string, unknown>,
) {
  try {
    const { getAuthUser } = await import('@/lib/auth')
    const user = await getAuthUser()
    await logAudit({
      userId: user?.id,
      action,
      targetType,
      targetId,
      detail,
    })
  } catch {
    // If auth fails, still try to log without user
    await logAudit({ action, targetType, targetId, detail })
  }
}
