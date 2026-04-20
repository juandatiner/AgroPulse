import { json, options, handleRoute } from '@/lib/api-utils'
import { getAuthUser, deleteSession } from '@/lib/auth'

export function OPTIONS() { return options() }

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { token } = await getAuthUser(request)
    if (token) await deleteSession(token)
    return json({ ok: true })
  })
}
