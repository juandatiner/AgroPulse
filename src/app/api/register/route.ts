import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, s } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const data = await request.json()
    const required = ['nombre', 'apellido', 'email', 'password', 'tipo']
    for (const f of required) {
      if (!(data[f] || '').trim()) return json({ error: `Campo ${f} es requerido` }, 400)
    }
    if (data.password.length < 6)
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)

    const db = await getDb()
    const email = data.email.toLowerCase().trim()
    const existing = await db.collection('users').findOne({ email })
    if (existing) return json({ error: 'Este correo ya está registrado' }, 400)

    const pwHash = hashPassword(data.password)
    const now = new Date()
    const result = await db.collection('users').insertOne({
      nombre: data.nombre.trim(),
      apellido: data.apellido.trim(),
      email,
      password_hash: pwHash,
      municipio: data.municipio || '',
      tipo: data.tipo,
      telefono: data.telefono || '',
      bio: data.bio || '',
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      reputation_score: 5.0,
      total_ratings: 0,
      created_at: now,
    })

    const uid = result.insertedId.toHexString()
    const token = await createSession(uid)
    const userDoc = await db.collection('users').findOne({ _id: result.insertedId })
    const user = s(userDoc as Record<string, unknown>)
    if (user) delete user.password_hash
    return json({ token, user })
  })
}
