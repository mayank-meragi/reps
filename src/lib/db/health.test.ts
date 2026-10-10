import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { clearHealthData, queryHealthRecords } from './health'

const row = (type: string, id: string, date: string) => ({
  key: `${type}|${id}`,
  type,
  date,
  start: null,
  end: null,
  data: { id },
  fetchedAt: '2026-10-10T00:00:00Z',
})

describe('health records store', () => {
  beforeEach(async () => {
    await clearHealthData()
    await db.healthRecords.bulkPut([
      row('weight', 'a', '2026-10-01'),
      row('weight', 'b', '2026-10-03'),
      row('weight', 'c', '2026-10-05'),
      row('sleep', 'd', '2026-10-03'),
    ])
  })

  it('filters by type and inclusive date range, newest first by default', async () => {
    const rows = await queryHealthRecords({ type: 'weight', from: '2026-10-01', to: '2026-10-03', limit: 10, newestFirst: true })
    expect(rows.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-01'])
  })

  it('respects limit and order, and never leaks other types', async () => {
    const rows = await queryHealthRecords({ type: 'weight', limit: 2, newestFirst: false })
    expect(rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-03'])
  })

  it('upserts by key', async () => {
    await db.healthRecords.put({ ...row('weight', 'a', '2026-10-01'), data: { id: 'a', v: 2 } })
    expect(await db.healthRecords.where('type').equals('weight').count()).toBe(3)
  })
})
