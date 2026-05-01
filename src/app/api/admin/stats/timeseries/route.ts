import { json, options, handleRoute, parseParams } from '@/lib/api-utils'
import { getDb } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

// Devuelve series temporales para gráficos del admin:
//   period=daily  → últimos 30 días
//   period=monthly → últimos 12 meses
export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const params = parseParams(request)
    const period = params.period === 'monthly' ? 'monthly' : 'daily'

    const db = await getDb()
    const now = new Date()

    let buckets: Array<{ key: string; label: string; from: Date; to: Date }> = []

    if (period === 'daily') {
      // Últimos 30 días (incluye hoy)
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      for (let i = 29; i >= 0; i--) {
        const from = new Date(start.getTime() - i * 86400000)
        const to = new Date(from.getTime() + 86400000)
        const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
        const label = `${String(from.getDate()).padStart(2, '0')}/${String(from.getMonth() + 1).padStart(2, '0')}`
        buckets.push({ key, label, from, to })
      }
    } else {
      // Últimos 12 meses (incluye mes actual)
      const ms = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      for (let i = 11; i >= 0; i--) {
        const from = new Date(startMonth.getFullYear(), startMonth.getMonth() - i, 1)
        const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
        const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`
        const yearShort = String(from.getFullYear()).slice(-2)
        const label = `${ms[from.getMonth()]} '${yearShort}`
        buckets.push({ key, label, from, to })
      }
    }

    const overallFrom = buckets[0].from
    const overallTo = buckets[buckets.length - 1].to

    // Invoices pagados (revenue)
    const invoiceDocs = await db.collection('invoices').find(
      { status: 'paid', created_at: { $gte: overallFrom, $lt: overallTo } },
      { projection: { amount: 1, created_at: 1 } }
    ).toArray()
    // Users registrados
    const userDocs = await db.collection('users').find(
      { created_at: { $gte: overallFrom, $lt: overallTo } },
      { projection: { created_at: 1 } }
    ).toArray()

    const revenueMap: Record<string, { amount: number; count: number }> = {}
    const usersMap: Record<string, number> = {}
    for (const b of buckets) {
      revenueMap[b.key] = { amount: 0, count: 0 }
      usersMap[b.key] = 0
    }

    const bucketKeyFor = (d: Date): string => {
      if (period === 'daily') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    for (const inv of invoiceDocs) {
      if (!(inv.created_at instanceof Date)) continue
      const k = bucketKeyFor(inv.created_at)
      if (revenueMap[k]) {
        revenueMap[k].amount += (inv.amount as number) || 0
        revenueMap[k].count += 1
      }
    }
    for (const u of userDocs) {
      if (!(u.created_at instanceof Date)) continue
      const k = bucketKeyFor(u.created_at)
      if (usersMap[k] !== undefined) usersMap[k] += 1
    }

    const revenue = buckets.map(b => ({
      key: b.key,
      label: b.label,
      amount: revenueMap[b.key].amount,
      count: revenueMap[b.key].count,
    }))
    const users = buckets.map(b => ({
      key: b.key,
      label: b.label,
      count: usersMap[b.key],
    }))

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0)
    const totalNewUsers = users.reduce((s, u) => s + u.count, 0)
    const totalPaidInvoices = revenue.reduce((s, r) => s + r.count, 0)

    return json({
      period,
      revenue,
      users,
      totals: {
        revenue: totalRevenue,
        new_users: totalNewUsers,
        paid_invoices: totalPaidInvoices,
      },
    })
  })
}
