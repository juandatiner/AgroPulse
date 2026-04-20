import { MongoClient, Db, ObjectId } from 'mongodb'

export { ObjectId }

const MONGO_URI = process.env.MONGO_URI!
const DB_NAME = process.env.MONGO_DB || 'agropulse'

let _client: MongoClient | null = null
let _db: Db | null = null

export async function getDb(): Promise<Db> {
  if (_db) return _db
  if (!MONGO_URI) throw new Error('MONGO_URI no está configurado')
  if (!_client) {
    _client = new MongoClient(MONGO_URI)
    await _client.connect()
  }
  _db = _client.db(DB_NAME)
  await ensureIndexes(_db)
  return _db
}

async function ensureIndexes(db: Db): Promise<void> {
  // users
  await db.collection('users').createIndex({ email: 1 }, { unique: true })
  await db.collection('users').createIndex({ last_seen: -1 })

  // sessions
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true })
  await db.collection('sessions').createIndex(
    { created_at: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 30 }
  )

  // resources
  await db.collection('resources').createIndex({ user_id: 1 })
  await db.collection('resources').createIndex({ status: 1 })
  await db.collection('resources').createIndex({ created_at: -1 })

  // agreements
  await db.collection('agreements').createIndex({ requester_id: 1 })
  await db.collection('agreements').createIndex({ provider_id: 1 })
  await db.collection('agreements').createIndex({ resource_id: 1 })
  await db.collection('agreements').createIndex({ updated_at: -1 })

  // messages
  await db.collection('messages').createIndex({ agreement_id: 1 })
  await db.collection('messages').createIndex({ created_at: 1 })

  // password resets (TTL: expires_at)
  await db.collection('password_resets').createIndex({ token: 1 }, { unique: true })
  await db.collection('password_resets').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
}

/** Serialize a MongoDB document: _id → id (string), nested ObjectIds → string, Date → ISO */
export function s(doc: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!doc) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id') {
      out['id'] = v instanceof ObjectId ? v.toHexString() : String(v)
    } else if (v instanceof ObjectId) {
      out[k] = v.toHexString()
    } else if (v instanceof Date) {
      out[k] = v.toISOString()
    } else {
      out[k] = v
    }
  }
  return out
}

/** Map s() over an array */
export function sa(docs: Record<string, unknown>[]): Record<string, unknown>[] {
  return docs.map(d => s(d) as Record<string, unknown>)
}

/** Parse an ObjectId string safely; throws if invalid */
export function toId(str: string): ObjectId {
  return new ObjectId(str)
}
