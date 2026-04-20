import { json, options } from '@/lib/api-utils'
import { getAuthUser, deleteSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  const { token } = getAuthUser(request)
  if (token) deleteSession(token)
  return json({ ok: true })
}
