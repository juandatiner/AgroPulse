import { NextResponse } from 'next/server'

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function handleRoute(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error del servidor'
    console.error('[API]', msg)
    return json({ error: msg }, 500)
  }
}

export function parseParams(request: Request): Record<string, string> {
  const url = new URL(request.url)
  const params: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { params[k] = v })
  return params
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

export function options() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
