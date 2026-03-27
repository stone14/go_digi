import * as tls from 'tls'
import { query, execute, queryOne } from './db'
import { sendAlert } from './notify'

interface SslCert {
  id: number
  asset_id: number | null
  hostname: string
  port: number
  warn_days: number
}

export async function checkCertificate(hostname: string, port: number): Promise<{
  subject: string; issuer: string; notBefore: Date; notAfter: Date
} | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate()
      socket.destroy()
      if (!cert?.subject) { resolve(null); return }
      resolve({
        subject:   String(cert.subject?.CN || hostname),
        issuer:    String(cert.issuer?.O  || ''),
        notBefore: new Date(cert.valid_from),
        notAfter:  new Date(cert.valid_to),
      })
    })
    socket.on('error', () => resolve(null))
    socket.setTimeout(5000, () => { socket.destroy(); resolve(null) })
  })
}

export async function runSslCheck() {
  const certs = await query<SslCert>(
    'SELECT id, asset_id, hostname, port, warn_days FROM ssl_certificates'
  )

  for (const cert of certs) {
    const info = await checkCertificate(cert.hostname, cert.port)
    if (!info) {
      await execute(
        'UPDATE ssl_certificates SET status = $1, last_checked = now() WHERE id = $2',
        ['error', cert.id]
      )
      continue
    }

    const daysLeft = Math.floor((info.notAfter.getTime() - Date.now()) / 86400000)
    const status   = daysLeft < 0 ? 'expired'
                   : daysLeft < cert.warn_days ? 'expiring'
                   : 'ok'

    await execute(
      `UPDATE ssl_certificates SET
         subject = $1, issuer = $2, not_before = $3, not_after = $4,
         status = $5, last_checked = now()
       WHERE id = $6`,
      [info.subject, info.issuer, info.notBefore, info.notAfter, status, cert.id]
    )

    if (status !== 'ok') {
      const alertRow = await queryOne<{ id: number }>(
        `INSERT INTO alerts (asset_id, severity, title, message, source)
         VALUES ($1, $2, $3, $4, 'service')
         RETURNING id`,
        [
          cert.asset_id,
          status === 'expired' ? 'critical' : 'warning',
          `SSL 인증서 ${status === 'expired' ? '만료됨' : '만료 임박'}: ${cert.hostname}`,
          `${cert.hostname}:${cert.port} 인증서가 ${daysLeft < 0 ? '만료되었습니다' : `${daysLeft}일 후 만료됩니다`}`,
        ]
      )
      if (alertRow) {
        await sendAlert(alertRow.id, {
          title: `SSL ${status === 'expired' ? '만료됨' : '만료 임박'}: ${cert.hostname}`,
          message: daysLeft < 0 ? '인증서가 만료되었습니다' : `${daysLeft}일 후 만료됩니다`,
          severity: status === 'expired' ? 'critical' : 'warning',
        }, ['slack', 'email'])
      }
    }
  }
}
