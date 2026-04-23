import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { verifyAdmin, adminUnauth } from '@/lib/admin-auth'

export function OPTIONS() { return options() }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()
    const u = await db.collection('users').findOne({ _id: uid })
    if (!u) return json({ error: 'Usuario no encontrado' }, 404)

    const now = new Date()
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)
    const lastSeen = u.last_seen instanceof Date ? u.last_seen : null
    const toIso = (v: unknown) => v instanceof Date ? v.toISOString() : v ?? null

    const [resourcesCount, agrReqCount, agrProvCount] = await Promise.all([
      db.collection('resources').countDocuments({ user_id: uid }),
      db.collection('agreements').countDocuments({ requester_id: uid }),
      db.collection('agreements').countDocuments({ provider_id: uid }),
    ])

    return json({
      id: (u._id as ObjectId).toHexString(),
      nombre: u.nombre || '',
      apellido: u.apellido || '',
      email: u.email || '',
      tipo: u.tipo || '',
      municipio: u.municipio || '',
      telefono: u.telefono || '',
      bio: u.bio || '',
      reputation_score: u.reputation_score ?? 5.0,
      total_ratings: u.total_ratings ?? 0,
      created_at: toIso(u.created_at),
      last_seen: lastSeen ? lastSeen.toISOString() : null,
      is_online: lastSeen ? lastSeen >= fiveMinAgo : false,
      resources_count: resourcesCount,
      agreements_count: agrReqCount + agrProvCount,
      verified: !!u.verified,
      subscription_status: u.subscription_status || 'trial',
      trial_end: toIso(u.trial_end),
      subscription_end: toIso(u.subscription_end),
      monthly_post_count: u.monthly_post_count ?? 0,
      monthly_post_reset: toIso(u.monthly_post_reset),
    })
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const body = await request.json()
    const allowed = ['nombre', 'apellido', 'email', 'municipio', 'tipo', 'telefono', 'bio']
    const update: Record<string, unknown> = {}
    for (const k of allowed) {
      if (k in body) update[k] = String(body[k] ?? '').trim()
    }
    if (!Object.keys(update).length) return json({ error: 'Sin campos para actualizar' }, 400)

    const db = await getDb()
    await db.collection('users').updateOne({ _id: uid }, { $set: update })
    return json({ ok: true })
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    if (!verifyAdmin(request)) return adminUnauth()

    const { id } = await params
    let uid: ObjectId
    try { uid = new ObjectId(id) } catch { return json({ error: 'ID inválido' }, 400) }

    const db = await getDb()

    const agreements = await db.collection('agreements').find({
      $or: [{ requester_id: uid }, { provider_id: uid }],
    }).toArray()

    const agrIds = agreements.map(a => a._id)
    if (agrIds.length > 0) {
      await db.collection('messages').deleteMany({ agreement_id: { $in: agrIds } })
    }

    await Promise.all([
      db.collection('agreements').deleteMany({ $or: [{ requester_id: uid }, { provider_id: uid }] }),
      db.collection('resources').deleteMany({ user_id: uid }),
      db.collection('sessions').deleteMany({ user_id: uid }),
      db.collection('users').deleteOne({ _id: uid }),
    ])

    return json({ ok: true })
  })
}
