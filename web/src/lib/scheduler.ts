/**
 * Digicap 스케줄러
 * Next.js instrumentation hook을 통해 서버 시작 시 1회 실행
 */
import cron from 'node-cron'
import { runAlertEvaluation, runOfflineCheck, runAggregation } from './alert-engine'
import { query } from './db'

let initialized = false

export function startScheduler() {
  if (initialized) return
  initialized = true


  // 알림 평가: 1분마다
  cron.schedule('* * * * *', async () => {
    await runAlertEvaluation()
    await runOfflineCheck()
  })

  // 메트릭 집계: 5분마다
  cron.schedule('*/5 * * * *', async () => {
    await runAggregation()
  })

  // SSL 체크: 매일 새벽 2시
  cron.schedule('0 2 * * *', async () => {
    const { runSslCheck } = await import('./ssl-checker')
    await runSslCheck()
  })

  // BMC 수집: 5분마다
  cron.schedule('*/5 * * * *', async () => {
    try {
      await fetch('http://localhost:3100/api/bmc/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    } catch {}
  })

  // 서비스 체크: 1분마다
  cron.schedule('* * * * *', async () => {
    const { runServiceChecks } = await import('./service-checker')
    await runServiceChecks()
  })

  // 유지보수 만료 임박 체크: 매일 새벽 3시
  cron.schedule('0 3 * * *', async () => {
    const { runMaintenanceCheck } = await import('./maintenance-checker')
    await runMaintenanceCheck()
  })

  // agent 폴링: 1분마다 (agent_url이 설정된 자산)
  cron.schedule('* * * * *', async () => {
    await runAgnetPoll()
  })

  // LLM 예측 분석: 5분마다
  cron.schedule('*/5 * * * *', async () => {
    const { runLLMPrediction } = await import('./llm-analyzer')
    await runLLMPrediction()
  })

}

async function runAgnetPoll() {
  try {
    const assets = await query<{ id: number }>(
      `SELECT id FROM assets WHERE agent_url IS NOT NULL AND status != 'inactive'`
    )
    for (const asset of assets) {
      try {
        await fetch(`http://localhost:3100/api/agent/pull/collect?asset_id=${asset.id}`)
      } catch (e) {
        console.error(`[agent poll] asset_id=${asset.id} 실패:`, e)
      }
    }
  } catch (e) {
    console.error('[agent poll] 목록 조회 실패:', e)
  }
}
