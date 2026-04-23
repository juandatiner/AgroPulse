import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)
    const db = await getDb()
    const docs = await db.collection('invoices')
      .find({ user_id: new ObjectId(user.id) })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()
    return json(docs.map(d => ({
      id: (d._id as ObjectId).toHexString(),
      amount: d.amount,
      status: d.status,
      card_brand: d.card_brand,
      card_last4: d.card_last4,
      reference: d.reference,
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at,
      period_start: d.period_start instanceof Date ? d.period_start.toISOString() : null,
      period_end: d.period_end instanceof Date ? d.period_end.toISOString() : null,
    })))
  })
}
