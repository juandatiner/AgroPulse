import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { isStrongPassword } from '@/lib/email'
import crypto from 'crypto'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const data = await request.json()
    const email = (data.email || '').toLowerCase().trim()
    if (!email) return json({ error: 'Correo requerido' }, 400)

    const db = await getDb()
    const user = await db.collection('users').findOne({ email })

    // Step 1: check email exists
    if (!data.nombre && !data.apellido) {
      if (!user) return json({ error: 'No existe una cuenta con este correo' }, 404)
      return json({ ok: true, step: 1 })
    }

    // Step 2: verify identity (nombre + apellido)
    if (!user) return json({ error: 'No existe una cuenta con este correo' }, 404)

    const normalize = (s: string) => (s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const nombreOk = normalize(data.nombre) === normalize(user.nombre as string)
    const apellidoOk = normalize(data.apellido) === normalize(user.apellido as string)

    if (!nombreOk || !apellidoOk)
      return json({ error: 'Los datos no coinciden con nuestra información' }, 400)

    // Identity verified — generate short-lived reset token
    await db.collection('password_resets').deleteMany({ user_id: user._id })
    const token = crypto.randomBytes(32).toString('hex')
    await db.collection('password_resets').insertOne({
      token,
      user_id: user._id,
      expires_at: new Date(Date.now() + 15 * 60 * 1000), // 15 min
      used: false,
    })

    return json({ ok: true, step: 2, token })
  })
}

// Step 3: set new password using the token from step 2
export async function PUT(request: Request) {
  return handleRoute(async () => {
    const data = await request.json()
    const token = (data.token || '').trim()
    const password = data.password || ''

    if (!token) return json({ error: 'Token requerido' }, 400)
    if (!isStrongPassword(password))
      return json({ error: 'La contraseña no cumple los requisitos de seguridad' }, 400)

    const db = await getDb()
    const resetDoc = await db.collection('password_resets').findOne({ token, used: false })
    if (!resetDoc) return json({ error: 'Sesión de recuperación expirada. Intenta de nuevo.' }, 400)

    await db.collection('users').updateOne(
      { _id: resetDoc.user_id },
      { $set: { password_hash: hashPassword(password) } }
    )
    await db.collection('password_resets').updateOne({ token }, { $set: { used: true } })
    await db.collection('sessions').deleteMany({ user_id: resetDoc.user_id })

    return json({ ok: true })
  })
}
