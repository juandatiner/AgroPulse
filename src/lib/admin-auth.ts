import crypto from 'crypto'
import { NextResponse } from 'next/server'

function getAdminToken(): string {
  const pw = process.env.ADMIN_PASSWORD || 'admin123'
  return crypto.createHash('sha256').update(pw + ':agropulse-admin').digest('hex')
}

export function verifyAdmin(request: Request): boolean {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  return auth.slice(7) === getAdminToken()
}

export function adminToken(): string {
  return getAdminToken()
}

export function adminUnauth() {
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
}
