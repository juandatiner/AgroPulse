import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const db = await getDb()
    const uid = new ObjectId(user.id)

    const [totalRes, activeRes, totalAgr, completedAgr] = await Promise.all([
      db.collection('resources').countDocuments({ user_id: uid }),
      db.collection('resources').countDocuments({ user_id: uid, status: 'active' }),
      db.collection('agreements').countDocuments({ $or: [{ requester_id: uid }, { provider_id: uid }] }),
      db.collection('agreements').countDocuments({
        $or: [{ requester_id: uid }, { provider_id: uid }],
        status: 'completed',
      }),
    ])

    const u = { ...user }
    delete (u as Record<string, unknown>).password_hash
    return json({
      ...u,
      stats: {
        total_resources: totalRes,
        active_resources: activeRes,
        total_agreements: totalAgr,
        completed_agreements: completedAgr,
      },
    })
  })
}

export async function PUT(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const data = await request.json()

    const allowed = ['nombre', 'apellido', 'municipio', 'tipo', 'telefono', 'bio', 'latitude', 'longitude', 'theme']
    const updates: Record<string, unknown> = {}
    const verificationAffecting = ['nombre', 'apellido', 'municipio', 'tipo', 'telefono', 'bio']
    let invalidatesVerification = false
    for (const f of allowed) {
      if (f in data) {
        updates[f] = data[f]
        if (verificationAffecting.includes(f)) invalidatesVerification = true
      }
    }
    if ('theme' in updates) {
      const t = String(updates.theme || '').toLowerCase()
      if (t !== 'light' && t !== 'dark') {
        return json({ error: 'Tema inválido' }, 400)
      }
      updates.theme = t
    }
    if ('telefono' in updates) {
      const raw = String(updates.telefono || '').trim()
      if (!raw) {
        return json({ error: 'El teléfono es obligatorio' }, 400)
      }
      const tel = raw.replace(/\D/g, '')
      if (!/^3\d{9}$/.test(tel)) {
        return json({ error: 'El teléfono debe tener 10 dígitos y empezar con 3' }, 400)
      }
      const conflict = await db.collection('users').findOne({ telefono: tel, _id: { $ne: uid } })
      if (conflict) {
        return json({ error: 'Este teléfono ya está registrado en otra cuenta' }, 400)
      }
      updates.telefono = tel
    }
    if (invalidatesVerification) updates.verified = false
    if (Object.keys(updates).length) {
      await db.collection('users').updateOne({ _id: uid }, { $set: updates })
    }

    const updated = await db.collection('users').findOne({ _id: uid })
    if (!updated) return json({ error: 'No encontrado' }, 404)

    const out: Record<string, unknown> = {
      id: uid.toHexString(),
      nombre: updated.nombre,
      apellido: updated.apellido,
      email: updated.email,
      municipio: updated.municipio,
      tipo: updated.tipo,
      telefono: updated.telefono || '',
      bio: updated.bio || '',
      latitude: updated.latitude ?? null,
      longitude: updated.longitude ?? null,
      reputation_score: updated.reputation_score ?? 5.0,
      total_ratings: updated.total_ratings ?? 0,
      created_at: updated.created_at instanceof Date ? updated.created_at.toISOString() : updated.created_at,
      verified: !!updated.verified,
      subscription_status: updated.subscription_status || 'trial',
      trial_end: updated.trial_end instanceof Date ? updated.trial_end.toISOString() : (updated.trial_end ?? null),
      subscription_end: updated.subscription_end instanceof Date ? updated.subscription_end.toISOString() : (updated.subscription_end ?? null),
      theme: updated.theme || 'light',
    }
    return json(out)
  })
}
