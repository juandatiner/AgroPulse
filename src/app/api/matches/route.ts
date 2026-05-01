import { json, options, handleRoute } from '@/lib/api-utils'
import { getDb, ObjectId } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { computeSubscriptionState } from '@/lib/subscription'

export function OPTIONS() { return options() }

// Stopwords ES + verbos comunes (infinitivos y conjugados frecuentes) + palabras genéricas.
// Heurística: filtrar tokens de baja señal para que el match compare por sustantivos/conceptos.
const STOPWORDS = new Set<string>([
  // Artículos / preposiciones / pronombres
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del', 'de', 'a', 'en',
  'por', 'para', 'con', 'sin', 'sobre', 'entre', 'desde', 'hasta', 'hacia', 'tras', 'ante',
  'bajo', 'durante', 'mediante', 'segun', 'que', 'qué', 'quien', 'cual', 'cuyo', 'donde',
  'cuando', 'como', 'cuanto', 'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'nuestro', 'vuestro',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella',
  'yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'ellas', 'se', 'me', 'te',
  'le', 'les', 'nos', 'os', 'no', 'si', 'sí', 'ni', 'o', 'u', 'y', 'e', 'pero', 'aunque',
  'porque', 'pues', 'mas', 'más', 'menos', 'muy', 'tan', 'tanto', 'también', 'tambien',
  'solo', 'sólo', 'ya', 'aún', 'aun', 'todavía', 'todavia', 'siempre', 'nunca',
  // Verbos de uso muy alto (ser, estar, haber, tener, hacer, poder, querer)
  'ser', 'siendo', 'sido', 'soy', 'eres', 'es', 'somos', 'sois', 'son', 'era', 'eras',
  'éramos', 'eramos', 'erais', 'eran', 'fui', 'fuiste', 'fue', 'fuimos', 'fuisteis',
  'fueron', 'sera', 'será', 'serán', 'seran',
  'estar', 'estando', 'estado', 'estoy', 'estás', 'estas', 'está', 'esta', 'estamos',
  'estais', 'están', 'estan', 'estaba', 'estabas', 'estaban', 'estuvo', 'estuvieron',
  'haber', 'hay', 'he', 'has', 'ha', 'hemos', 'habeis', 'han', 'habia', 'había', 'habían',
  'tener', 'tengo', 'tienes', 'tiene', 'tenemos', 'teneis', 'tienen', 'tenia', 'tenía',
  'tuve', 'tuvo', 'tuvieron', 'tendre', 'tendrá', 'tener', 'teniendo', 'tenido',
  'hacer', 'hago', 'haces', 'hace', 'hacemos', 'haceis', 'hacen', 'hizo', 'hicieron',
  'haciendo', 'hecho', 'hecha',
  'poder', 'puedo', 'puedes', 'puede', 'podemos', 'podeis', 'pueden', 'podria', 'podría',
  'querer', 'quiero', 'quieres', 'quiere', 'queremos', 'queréis', 'quereis', 'quieren',
  'quería', 'queria', 'quisiera', 'quisiéramos',
  'ir', 'voy', 'vas', 'va', 'vamos', 'vais', 'van', 'iba', 'iban', 'fue', 'fueron',
  'dar', 'doy', 'das', 'da', 'damos', 'dais', 'dan', 'di', 'dio', 'dieron', 'dado',
  'ver', 'veo', 'ves', 've', 'vemos', 'veis', 'ven', 'visto',
  'decir', 'digo', 'dices', 'dice', 'decimos', 'dicen', 'dijo', 'dijeron', 'dicho',
  'venir', 'vengo', 'viene', 'venimos', 'vienen', 'vino', 'vinieron',
  'salir', 'salgo', 'sale', 'salimos', 'salen', 'salio', 'salió', 'salieron',
  'pasar', 'pasa', 'pasan', 'pase', 'pasó', 'pasado',
  'llevar', 'llevo', 'lleva', 'llevan', 'llevado',
  'usar', 'uso', 'usa', 'usan', 'usado', 'usando',
  'necesitar', 'necesito', 'necesita', 'necesitan', 'necesitado',
  'buscar', 'busco', 'busca', 'buscan', 'buscado', 'buscando',
  'ofrecer', 'ofrezco', 'ofrece', 'ofrecen', 'ofrecido', 'ofreciendo',
  'pedir', 'pido', 'pide', 'piden', 'pedido',
  'prestar', 'presto', 'presta', 'prestan', 'prestado',
  'cambiar', 'cambio', 'cambia', 'cambian', 'cambiado',
  'vender', 'vendo', 'vende', 'venden', 'vendido', 'vendiendo',
  'comprar', 'compro', 'compra', 'compran', 'comprado', 'comprando',
  'recibir', 'recibo', 'recibe', 'reciben', 'recibido',
  'entregar', 'entrego', 'entrega', 'entregan', 'entregado',
  // Genéricos sin valor de keyword
  'cosa', 'cosas', 'algo', 'nada', 'todo', 'todos', 'toda', 'todas', 'cada', 'cualquier',
  'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas',
  'parte', 'partes', 'lado', 'forma', 'manera', 'tipo', 'clase',
  'hola', 'gracias', 'favor', 'porfa',
  'dia', 'día', 'dias', 'días', 'mes', 'meses', 'año', 'años', 'ano', 'anos',
  'hora', 'horas', 'semana', 'semanas',
  'aqui', 'aquí', 'alli', 'allí', 'ahi', 'ahí', 'arriba', 'abajo', 'cerca', 'lejos',
])

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function tokenize(text: string): Set<string> {
  if (!text) return new Set()
  const norm = stripAccents(String(text).toLowerCase())
  const raw = norm.split(/[^a-z0-9ñ]+/).filter(Boolean)
  const out = new Set<string>()
  for (const w of raw) {
    if (w.length < 4) continue
    if (STOPWORDS.has(w)) continue
    if (/^\d+$/.test(w)) continue
    out.add(w)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function commonKeywords(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = []
  for (const x of a) if (b.has(x)) out.push(x)
  return out
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { user } = await getAuthUser(request)
    if (!user) return json({ error: 'No autorizado' }, 401)

    const sub = await computeSubscriptionState(user.id)
    if (!sub.is_premium) {
      return json({ error: 'premium_required', message: 'Las alertas de match requieren suscripción activa.', subscription: sub }, 403)
    }

    const db = await getDb()
    const uid = new ObjectId(user.id)
    const myResources = await db.collection('resources').find({
      user_id: uid,
      status: 'active',
    }).toArray()

    if (!myResources.length) return json([])

    // Reglas de pareo por tipo:
    //   solicitud  ↔ oferta + prestamo
    //   oferta     ↔ solicitud
    //   prestamo   ↔ solicitud + prestamo
    //   trueque    ↔ todos (oferta + solicitud + prestamo + trueque)
    const oppositeMap: Record<string, string[]> = {
      oferta: ['solicitud', 'trueque'],
      solicitud: ['oferta', 'prestamo', 'trueque'],
      prestamo: ['solicitud', 'prestamo', 'trueque'],
      trueque: ['oferta', 'solicitud', 'prestamo', 'trueque'],
    }

    const seen = new Set<string>()
    type ScoredMatch = { score: number; common: string[]; row: Record<string, unknown> }
    const scored: ScoredMatch[] = []

    for (const r of myResources) {
      const opposites = oppositeMap[r.tipo as string] || []
      if (!opposites.length) continue
      const myTokens = tokenize(`${r.titulo || ''} ${r.descripcion || ''}`)

      const query: Record<string, unknown> = {
        status: 'active',
        tipo: { $in: opposites },
        categoria: r.categoria,
        user_id: { $ne: uid },
      }

      const candidates = await db.collection('resources').aggregate([
        { $match: query },
        { $sort: { created_at: -1 } },
        { $limit: 60 },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: '_user',
          },
        },
        { $unwind: '$_user' },
      ]).toArray()

      for (const c of candidates) {
        const key = `${(r._id as ObjectId).toHexString()}::${(c._id as ObjectId).toHexString()}`
        if (seen.has(key)) continue
        seen.add(key)

        const candTokens = tokenize(`${c.titulo || ''} ${c.descripcion || ''}`)
        const overlap = jaccard(myTokens, candTokens)
        const common = commonKeywords(myTokens, candTokens)

        // Score base: 1 si misma categoría (ya filtrada por query) + bonus municipio + overlap léxico.
        const sameMuni = r.municipio && c.municipio && r.municipio === c.municipio ? 1 : 0
        const sameTipo = r.tipo === c.tipo ? 0.15 : 0 // prestamo↔prestamo / trueque↔trueque
        const score = 1 + sameMuni * 0.6 + overlap * 2 + sameTipo

        // Mínimo: si NO hay keyword en común y NO comparten municipio → descartar (ruido).
        if (common.length === 0 && !sameMuni) continue

        scored.push({
          score,
          common,
          row: {
            my_resource_id: (r._id as ObjectId).toHexString(),
            my_resource_titulo: r.titulo,
            my_resource_tipo: r.tipo,
            my_resource_categoria: r.categoria,
            match_id: (c._id as ObjectId).toHexString(),
            match_titulo: c.titulo,
            match_tipo: c.tipo,
            match_categoria: c.categoria,
            match_municipio: c.municipio,
            match_descripcion: c.descripcion,
            match_image_data: c.image_data || '',
            match_user_id: c.user_id instanceof ObjectId ? c.user_id.toHexString() : String(c.user_id),
            match_user_nombre: c._user.nombre,
            match_user_apellido: c._user.apellido,
            match_user_verified: !!c._user.verified,
            match_user_reputation: c._user.reputation_score || 5,
            match_created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
            match_keywords: common.slice(0, 6),
            match_score: Math.round(score * 100) / 100,
            match_same_municipio: !!sameMuni,
          },
        })
      }
    }

    // Orden: score desc, luego fecha desc.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ad = new Date(a.row.match_created_at as string).getTime()
      const bd = new Date(b.row.match_created_at as string).getTime()
      return bd - ad
    })

    return json(scored.map(s => s.row))
  })
}
