import * as net  from 'net'
import * as dns  from 'dns/promises'
import { query, execute, queryOne } from './db'
import { sendAlert } from './notify'

interface ServiceCheck {
  id: number
  asset_id: number
  name: string
  type: 'ping' | 'port' | 'http' | 'process'
  target: string
  timeout_s: number
  expected_code: number | null
  expected_body: string | null
}

interface CheckResult {
  status: 'ok' | 'critical' | 'unknown'
  response_ms: number
  message: string
}

export async function runServiceChecks() {
  const checks = await query<ServiceCheck>(
    'SELECT * FROM service_checks WHERE is_active = true'
  )

  await Promise.allSettled(checks.map(check => runCheck(check)))
}

async function runCheck(check: ServiceCheck) {
  const start = Date.now()
  let result: CheckResult

  try {
    switch (check.type) {
      case 'ping': result = await checkPing(check.target, check.timeout_s); break
      case 'port': {
        const [host, portStr] = check.target.split(':')
        result = await checkPort(host, parseInt(portStr), check.timeout_s)
        break
      }
      case 'http':
        result = await checkHTTP(check.target, check.timeout_s,
          check.expected_code, check.expected_body)
        break
      case 'process':
        result = { status: 'unknown', response_ms: 0, message: 'Process check via agent' }
        break
      default:
        result = { status: 'unknown', response_ms: 0, message: 'Unknown check type' }
    }
  } catch (err) {
    result = { status: 'critical', response_ms: Date.now() - start, message: String(err) }
  }

  // 결과 저장
  await execute(
    `INSERT INTO service_check_results (check_id, checked_at, status, response_ms, message)
     VALUES ($1, now(), $2, $3, $4)`,
    [check.id, result.status, result.response_ms, result.message.slice(0, 499)]
  )

  // 이전 상태와 비교 → 변경 시 알림
  const prev = await queryOne<{ status: string }>(
    `SELECT status FROM service_check_results
     WHERE check_id = $1 AND checked_at < now() - interval '1 minute'
     ORDER BY checked_at DESC LIMIT 1`,
    [check.id]
  )

  if (result.status !== 'ok' && prev?.status === 'ok') {
    const asset = await queryOne<{ name: string }>(
      'SELECT name FROM assets WHERE id = $1', [check.asset_id]
    )
    const alertRow = await queryOne<{ id: number }>(
      `INSERT INTO alerts (asset_id, severity, title, message, source)
       VALUES ($1, 'critical', $2, $3, 'service')
       RETURNING id`,
      [
        check.asset_id,
        `서비스 장애: ${check.name}`,
        `${check.type.toUpperCase()} ${check.target} — ${result.message}`,
      ]
    )
    if (alertRow) {
      await sendAlert(alertRow.id, {
        title:     `서비스 장애: ${check.name}`,
        message:   `${check.type.toUpperCase()} ${check.target} 응답 없음`,
        severity:  'critical',
        assetName: asset?.name,
      }, ['slack', 'email'])
    }
  }

  // 복구 → active 알림 resolve
  if (result.status === 'ok' && prev?.status !== 'ok') {
    await execute(
      `UPDATE alerts SET status = 'resolved', resolved_at = now()
       WHERE asset_id = $1 AND title LIKE $2 AND status = 'active'`,
      [check.asset_id, `%서비스 장애: ${check.name}%`]
    )
  }
}

async function checkPing(host: string, timeoutS: number): Promise<CheckResult> {
  const start = Date.now()
  try {
    // DNS 조회로 응답 확인 (ICMP는 Node.js 기본 미지원)
    await dns.lookup(host)
    // TCP 연결 시도로 간접 확인 (80 또는 443)
    await checkPort(host, 80, timeoutS)
    return { status: 'ok', response_ms: Date.now() - start, message: 'Reachable' }
  } catch {
    // DNS는 되지만 포트 응답 없을 수 있음 — DNS 성공이면 OK로 처리
    try {
      await dns.lookup(host)
      return { status: 'ok', response_ms: Date.now() - start, message: 'DNS resolved' }
    } catch (err) {
      return { status: 'critical', response_ms: Date.now() - start, message: `DNS failed: ${err}` }
    }
  }
}

async function checkPort(host: string, port: number, timeoutS: number): Promise<CheckResult> {
  const start = Date.now()
  return new Promise(resolve => {
    const socket = new net.Socket()
    const timeout = timeoutS * 1000

    socket.setTimeout(timeout)
    socket.connect(port, host, () => {
      const ms = Date.now() - start
      socket.destroy()
      resolve({ status: 'ok', response_ms: ms, message: `Port ${port} open` })
    })
    socket.on('error', (err) => {
      socket.destroy()
      resolve({ status: 'critical', response_ms: Date.now() - start, message: err.message })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ status: 'critical', response_ms: timeout, message: 'Timeout' })
    })
  })
}

async function checkHTTP(
  url: string, timeoutS: number,
  expectedCode: number | null, expectedBody: string | null
): Promise<CheckResult> {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutS * 1000),
      redirect: 'follow',
    })
    const ms   = Date.now() - start
    const code = res.status
    const body = expectedBody ? await res.text() : ''

    if (expectedCode && code !== expectedCode) {
      return { status: 'critical', response_ms: ms, message: `HTTP ${code} (expected ${expectedCode})` }
    }
    if (expectedBody && !body.includes(expectedBody)) {
      return { status: 'critical', response_ms: ms, message: `Response body mismatch` }
    }
    return { status: 'ok', response_ms: ms, message: `HTTP ${code}` }
  } catch (err) {
    return { status: 'critical', response_ms: Date.now() - start, message: String(err) }
  }
}
