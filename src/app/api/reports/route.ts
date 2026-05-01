import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

const VALID_TYPES = new Set(['resource', 'user'])
// Motivos diferenciados por tipo de reporte
const REASONS_BY_TYPE: Record<string, Set<string>> = {
  resource: new Set([
    'spam_ad',
    'misleading_photo',
    'fake_info',
    'unauthorized_sale',
    'illegal_product',
    'misleading_price',
    'duplicate',
    'inappropriate_content',
    'other_resource',
  ]),
  user: new Set([
    'harassment',
    'impersonation',
    'fake_account',
    'fraud_scam',
    'inappropriate_behavior',
    'no_show',
    'abusive_language',
    'other_user',
  ]),
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const data = await request.json()
    const type = String(data.type || '')
    const targetIdStr = String(data.target_id || '')
    const reason = String(data.reason || '')
    const description = String(data.description || '').trim().slice(0, 1000)

    if (!VALID_TYPES.has(type)) return json({ error: 'Tipo inválido' }, 400)
    if (!REASONS_BY_TYPE[type].has(reason)) return json({ error: 'Razón inválida para este tipo de reporte' }, 400)
    if (!targetIdStr) return json({ error: 'target_id requerido' }, 400)

    let targetId: ObjectId
    try { targetId = new ObjectId(targetIdStr) } catch { return json({ error: 'target_id inválido' }, 400) }

    const db = await getDb()
    const reporterId = new ObjectId(user.id)

    // No reportarse a uno mismo
    if (type === 'user' && targetId.toHexString() === user.id) {
      return json({ error: 'No puedes reportarte a ti mismo' }, 400)
    }
    if (type === 'resource') {
      const r = await db.collection('resources').findOne({ _id: targetId })
      if (!r) return json({ error: 'Publicación no encontrada' }, 404)
      if (r.user_id instanceof ObjectId && r.user_id.toHexString() === user.id) {
        return json({ error: 'No puedes reportar tu propia publicación' }, 400)
      }
    }
    if (type === 'user') {
      const u = await db.collection('users').findOne({ _id: targetId })
      if (!u) return json({ error: 'Usuario no encontrado' }, 404)
    }

    // Bloquear duplicados pendientes (mismo reporter + target en últimas 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const dup = await db.collection('reports').findOne({
      reporter_id: reporterId,
      target_id: targetId,
      type,
      created_at: { $gte: oneDayAgo },
    })
    if (dup) return json({ error: 'Ya reportaste esto recientemente. Gracias.' }, 400)

    const now = new Date()
    const doc = {
      type,
      target_id: targetId,
      reporter_id: reporterId,
      reason,
      description,
      status: 'pending' as const,
      admin_notes: null,
      resolved_by: null,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    }
    const result = await db.collection('reports').insertOne(doc)
    return json({ id: result.insertedId.toHexString(), ok: true }, 201)
  })
}
