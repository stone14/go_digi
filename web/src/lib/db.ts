import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import NodeCache from 'node-cache'

const pool = new Pool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '5432'),
  database:           process.env.DB_NAME     || 'argus',
  user:               process.env.DB_USER     || 'argus',
  password:           process.env.DB_PASSWORD || 'argus',
  max:                10,
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 5000,
  statement_timeout:  60000,
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err)
})

const cache = new NodeCache({ stdTTL: 60, checkperiod: 30 })

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
  cacheKey?: string,
  cacheTTL = 60
): Promise<T[]> {
  if (cacheKey) {
    const cached = cache.get<T[]>(cacheKey)
    if (cached) return cached
  }

  const client = await pool.connect()
  try {
    const result: QueryResult<QueryResultRow> = await client.query(sql, params)
    const rows = result.rows as unknown as T[]
    if (cacheKey) cache.set(cacheKey, rows, cacheTTL)
    return rows
  } finally {
    client.release()
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function execute(sql: string, params?: unknown[]): Promise<QueryResult> {
  const client = await pool.connect()
  try {
    return await client.query(sql, params)
  } finally {
    client.release()
  }
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export function invalidateCache(key: string) {
  cache.del(key)
}

export function invalidateCachePattern(prefix: string) {
  const keys = cache.keys().filter(k => k.startsWith(prefix))
  keys.forEach(k => cache.del(k))
}

export default pool
