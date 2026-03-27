// Next.js instrumentation hook — 서버 시작 시 스케줄러 실행
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler')
    startScheduler()
  }
}
