import { queryOne } from './db'

interface NotifyPayload {
  title: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  assetName?: string
  alertId?: number
}

// Slack
export async function sendSlack(payload: NotifyPayload): Promise<boolean> {
  const setting = await queryOne<{ value: string }>(
    "SELECT value FROM system_settings WHERE key = 'slack_webhook_url'"
  )
  const webhookUrl = setting?.value
  if (!webhookUrl) return false

  const color = payload.severity === 'critical' ? '#ef4444'
              : payload.severity === 'warning'  ? '#f59e0b'
              : '#3b82f6'

  const body = {
    attachments: [{
      color,
      title: `[Digicap] ${payload.title}`,
      text:  payload.message,
      fields: payload.assetName ? [
        { title: '장비', value: payload.assetName, short: true },
        { title: '심각도', value: payload.severity.toUpperCase(), short: true },
      ] : [],
      footer: 'Digicap Monitoring',
      ts: Math.floor(Date.now() / 1000),
    }],
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch (err) {
    console.error('[Slack] Send failed:', err)
    return false
  }
}

// Email (nodemailer)
export async function sendEmail(
  to: string | string[],
  payload: NotifyPayload
): Promise<boolean> {
  const settings = await queryOne<Record<string, string>>(
    `SELECT
       MAX(CASE WHEN key='smtp_host'     THEN value END) AS smtp_host,
       MAX(CASE WHEN key='smtp_port'     THEN value END) AS smtp_port,
       MAX(CASE WHEN key='smtp_user'     THEN value END) AS smtp_user,
       MAX(CASE WHEN key='smtp_password' THEN value END) AS smtp_password,
       MAX(CASE WHEN key='smtp_from'     THEN value END) AS smtp_from
     FROM system_settings
     WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_password','smtp_from')`
  )

  if (!settings?.smtp_host) return false

  try {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.default.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port || '587'),
      secure: settings.smtp_port === '465',
      auth: settings.smtp_user ? {
        user: settings.smtp_user,
        pass: settings.smtp_password,
      } : undefined,
    })

    const severityEmoji = payload.severity === 'critical' ? '🔴'
                        : payload.severity === 'warning'  ? '🟡' : '🔵'

    await transporter.sendMail({
      from:    settings.smtp_from || 'argus@monitoring.local',
      to:      Array.isArray(to) ? to.join(',') : to,
      subject: `${severityEmoji} [Digicap] ${payload.title}`,
      text:    payload.message,
      html:    `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:${payload.severity === 'critical' ? '#ef4444' : '#f59e0b'}">
            ${severityEmoji} ${payload.title}
          </h2>
          ${payload.assetName ? `<p><b>장비:</b> ${payload.assetName}</p>` : ''}
          <p>${payload.message}</p>
          <hr/>
          <small style="color:#888">Digicap Monitoring System</small>
        </div>`,
    })
    return true
  } catch (err) {
    console.error('[Email] Send failed:', err)
    return false
  }
}

// 통합 알림 발송 + 이력 저장
export async function sendAlert(
  alertId: number,
  payload: NotifyPayload,
  channels: Array<'slack' | 'email' | 'webhook'>,
  emailRecipients?: string[]
) {
  const { execute } = await import('./db')

  for (const channel of channels) {
    let success = false
    let errorMsg: string | undefined

    try {
      if (channel === 'slack') {
        success = await sendSlack(payload)
      } else if (channel === 'email' && emailRecipients?.length) {
        success = await sendEmail(emailRecipients, payload)
      }
    } catch (err) {
      errorMsg = String(err)
    }

    await execute(
      `INSERT INTO alert_notifications (alert_id, channel, recipient, status, sent_at, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        alertId,
        channel,
        channel === 'email' ? emailRecipients?.join(',') : null,
        success ? 'sent' : 'failed',
        success ? new Date() : null,
        errorMsg ?? null,
      ]
    )
  }
}
