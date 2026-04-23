import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, s } from '@/lib/db'
import { hashPassword, createSession } from '@/lib/auth'
import { initTrialForNewUser } from '@/lib/subscription'

export function OPTIONS() { return options() }

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'yopmail.com', 'trashmail.com', 'throwaway.email', 'fakemail.net',
  'sharklasers.com', 'maildrop.cc', 'temp-mail.org', 'tempr.email',
])

function isValidEmail(email: string): boolean {
  if (!email || email.length < 6 || email.length > 254) return false
  const re = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
  if (!re.test(email)) return false
  const [local, domain] = email.split('@')
  if (local.includes('..') || domain.includes('..')) return false
  if (/^\.|\.$/.test(local)) return false
  const tld = domain.split('.').pop() || ''
  if (tld.length < 2) return false
  if (DISPOSABLE_DOMAINS.has(domain)) return false
  return true
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const data = await request.json()
    const required = ['nombre', 'apellido', 'email', 'password', 'tipo', 'telefono']
    for (const f of required) {
      if (!(data[f] || '').toString().trim()) return json({ error: `Campo ${f} es requerido` }, 400)
    }
    if (data.password.length < 6)
      return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)

    const email = data.email.toLowerCase().trim()
    if (!isValidEmail(email)) {
      return json({ error: 'Ingresa un correo electrónico válido' }, 400)
    }
    const tel = String(data.telefono).replace(/\D/g, '')
    if (!/^3\d{9}$/.test(tel)) {
      return json({ error: 'El teléfono debe tener 10 dígitos y empezar con 3 (Colombia)' }, 400)
    }
    data.telefono = tel

    const db = await getDb()
    const existing = await db.collection('users').findOne({ email })
    if (existing) return json({ error: 'Este correo ya está registrado' }, 400)
    const existingTel = await db.collection('users').findOne({ telefono: tel })
    if (existingTel) return json({ error: 'Este teléfono ya está registrado en otra cuenta' }, 400)

    const pwHash = hashPassword(data.password)
    const now = new Date()
    let result
    try {
      result = await db.collection('users').insertOne({
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
    } catch (err: unknown) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> }
      if (e?.code === 11000) {
        if (e.keyPattern?.telefono) return json({ error: 'Este teléfono ya está registrado en otra cuenta' }, 400)
        if (e.keyPattern?.email) return json({ error: 'Este correo ya está registrado' }, 400)
        return json({ error: 'Ya existe una cuenta con esos datos' }, 400)
      }
      throw err
    }

    const uid = result.insertedId.toHexString()
    await initTrialForNewUser(uid)
    const token = await createSession(uid)
    const userDoc = await db.collection('users').findOne({ _id: result.insertedId })
    const user = s(userDoc as Record<string, unknown>)
    if (user) delete user.password_hash
    return json({ token, user })
  })
}
