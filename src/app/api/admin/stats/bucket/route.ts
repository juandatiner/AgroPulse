import { json, options, handleRoute, parseParams } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

// Detalle de un bucket (día o mes) — items que componen la barra del gráfico.
//   ?period=daily|monthly
//   ?key=2026-04-15  (daily)  ó  2026-04 (monthly)
//   ?type=revenue|users
export async function GET(request: Request) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const params = parseParams(request)
    const period = params.period === 'monthly' ? 'monthly' : 'daily'
    const type = params.type === 'users' ? 'users' : 'revenue'
    const key = String(params.key || '')

    let from: Date, to: Date
    if (period === 'daily') {
      const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) return json({ error: 'key inválida (YYYY-MM-DD)' }, 400)
      from = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
      to = new Date(from.getTime() + 86400000)
    } else {
      const m = key.match(/^(\d{4})-(\d{2})$/)
      if (!m) return json({ error: 'key inválida (YYYY-MM)' }, 400)
      from = new Date(parseInt(m[1]), parseInt(m[2]) - 1, 1)
      to = new Date(parseInt(m[1]), parseInt(m[2]), 1)
    }

    const db = await getDb()
    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    if (type === 'revenue') {
      const docs = await db.collection('invoices').aggregate([
        { $match: { status: 'paid', created_at: { $gte: from, $lt: to } } },
        {
          $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: '_u' },
        },
        { $unwind: { path: '$_u', preserveNullAndEmptyArrays: true } },
        { $sort: { created_at: -1 } },
      ]).toArray()
      return json({
        period, key, type, from: from.toISOString(), to: to.toISOString(),
        items: docs.map(d => ({
          id: (d._id as ObjectId).toHexString(),
          amount: d.amount || 0,
          plan_tier: d.plan_tier || null,
          reference: d.reference || '',
          card_brand: d.card_brand || '',
          card_last4: d.card_last4 || '',
          is_upgrade: !!d.is_upgrade,
          created_at: toIso(d.created_at),
          user_id: d._u?._id ? (d._u._id as ObjectId).toHexString() : null,
          user_nombre: d._u?.nombre || '',
          user_apellido: d._u?.apellido || '',
          user_email: d._u?.email || '',
        })),
      })
    }

    // users registered in bucket
    const docs = await db.collection('users').find(
      { created_at: { $gte: from, $lt: to } },
      { projection: { nombre: 1, apellido: 1, email: 1, tipo: 1, municipio: 1, created_at: 1 } }
    ).sort({ created_at: -1 }).toArray()
    return json({
      period, key, type, from: from.toISOString(), to: to.toISOString(),
      items: docs.map(d => ({
        id: (d._id as ObjectId).toHexString(),
        nombre: d.nombre || '',
        apellido: d.apellido || '',
        email: d.email || '',
        tipo: d.tipo || '',
        municipio: d.municipio || '',
        created_at: toIso(d.created_at),
      })),
    })
  })
}
