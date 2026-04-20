import crypto from 'crypto'
import { getDb, ObjectId } from './db'

export interface User {
  id: string
  nombre: string
  apellido: string
  email: string
  password_hash: string
  municipio: string
  tipo: string
  telefono: string
  bio: string
  latitude: number | null
  longitude: number | null
  reputation_score: number
  total_ratings: number
  created_at: string
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const h = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return salt + '$' + h.toString('hex')
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$', 2)
  if (parts.length !== 2) return false
  const [salt, expected] = parts
  const h = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return h.toString('hex') === expected
}

export async function createSession(userId: string): Promise<string> {
  const db = await getDb()
  const token = crypto.randomBytes(32).toString('hex')
  await db.collection('sessions').insertOne({
    token,
    user_id: new ObjectId(userId),
    created_at: new Date(),
  })
  return token
}

export async function getUserFromToken(token: string | null): Promise<User | null> {
  if (!token) return null
  const db = await getDb()
  const session = await db.collection('sessions').findOne({ token })
  if (!session) return null
  const user = await db.collection('users').findOne({ _id: session.user_id })
  if (!user) return null
  return {
    id: (user._id as ObjectId).toHexString(),
    nombre: user.nombre,
    apellido: user.apellido,
    email: user.email,
    password_hash: user.password_hash,
    municipio: user.municipio,
    tipo: user.tipo,
    telefono: user.telefono || '',
    bio: user.bio || '',
    latitude: user.latitude ?? null,
    longitude: user.longitude ?? null,
    reputation_score: user.reputation_score ?? 5.0,
    total_ratings: user.total_ratings ?? 0,
    created_at: user.created_at instanceof Date ? user.created_at.toISOString() : String(user.created_at),
  }
}

export async function deleteSession(token: string): Promise<void> {
  const db = await getDb()
  await db.collection('sessions').deleteOne({ token })
}

export async function getAuthUser(request: Request): Promise<{ user: User | null; token: string | null }> {
  const auth = request.headers.get('Authorization') || ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7)
    const user = await getUserFromToken(token)
    return { user, token }
  }
  return { user: null, token: null }
}
