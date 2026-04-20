import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, s } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const data = await request.json()
    const email = (data.email || '').toLowerCase().trim()
    const password = data.password || ''
    if (!email || !password) return json({ error: 'Correo y contraseña son requeridos' }, 400)

    const db = await getDb()
    const userDoc = await db.collection('users').findOne({ email })
    if (!userDoc) return json({ error: 'No existe una cuenta con este correo' }, 401)
    if (!verifyPassword(password, userDoc.password_hash as string))
      return json({ error: 'Contraseña incorrecta' }, 401)

    const uid = userDoc._id.toHexString()
    const token = await createSession(uid)
    const user = s(userDoc as Record<string, unknown>)
    if (user) delete user.password_hash
    return json({ token, user })
  })
}
