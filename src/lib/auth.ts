import crypto from 'crypto'
import { queryOne, execute } from './db'

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

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex')
  execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, userId])
  return token
}

interface User {
  id: number
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

export function getUserFromToken(token: string | null): User | undefined {
  if (!token) return undefined
  return queryOne<User>(
    `SELECT u.* FROM users u JOIN sessions s ON u.id = s.user_id WHERE s.token = ?`,
    [token]
  )
}

export function deleteSession(token: string): void {
  execute("DELETE FROM sessions WHERE token = ?", [token])
}

export function getAuthUser(request: Request): { user: User | undefined; token: string | null } {
  const auth = request.headers.get('Authorization') || ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7)
    return { user: getUserFromToken(token), token }
  }
  return { user: undefined, token: null }
}
