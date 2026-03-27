import { query, queryOne } from './db'
import { sendAlert } from './notify'

export async function runMaintenanceCheck() {
  // 30일 이내 만료 예정 계약
  const expiring = await query<{
    asset_id: number; asset_name: string; contract_end: string; contact_email: string
  }>(
    `SELECT a.id AS asset_id, a.name AS asset_name,
            mc.contract_end::text, mc.contact_email
     FROM maintenance_contracts mc
     JOIN assets a ON a.id = mc.asset_id
     WHERE mc.has_contract = true
       AND mc.contract_end BETWEEN now() AND now() + interval '30 days'`
  )

  for (const row of expiring) {
    const daysLeft = Math.floor(
      (new Date(row.contract_end).getTime() - Date.now()) / 86400000
    )

    const alertRow = await queryOne<{ id: number }>(
      `INSERT INTO alerts (asset_id, severity, title, message, source)
       VALUES ($1, 'warning', $2, $3, 'service')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        row.asset_id,
        `유지보수 계약 만료 임박: ${row.asset_name}`,
        `${row.asset_name}의 유지보수 계약이 ${daysLeft}일 후 만료됩니다 (${row.contract_end.slice(0, 10)})`,
      ]
    )

    if (alertRow) {
      const recipients = row.contact_email ? [row.contact_email] : []
      await sendAlert(alertRow.id, {
        title: `유지보수 계약 만료 임박: ${row.asset_name}`,
        message: `${daysLeft}일 후 만료됩니다 (${row.contract_end.slice(0, 10)})`,
        severity: 'warning',
        assetName: row.asset_name,
      }, ['slack', 'email'], recipients)
    }
  }
}
