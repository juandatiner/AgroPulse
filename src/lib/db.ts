import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'agropulse.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const db = getDb()
  const stmt = db.prepare(sql)
  return stmt.all(...params) as T[]
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const db = getDb()
  const stmt = db.prepare(sql)
  return stmt.get(...params) as T | undefined
}

export function execute(sql: string, params: unknown[] = []): number {
  const db = getDb()
  const stmt = db.prepare(sql)
  const result = stmt.run(...params)
  return Number(result.lastInsertRowid)
}

export function execScript(sql: string): void {
  const db = getDb()
  db.exec(sql)
}

export function initDb(): void {
  execScript(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      apellido TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      municipio TEXT NOT NULL,
      tipo TEXT NOT NULL,
      telefono TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      latitude REAL,
      longitude REAL,
      reputation_score REAL DEFAULT 5.0,
      total_ratings INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('oferta','solicitud','prestamo','trueque')),
      titulo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      categoria TEXT NOT NULL,
      modalidad TEXT DEFAULT '',
      municipio TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      cantidad TEXT DEFAULT '',
      unidad TEXT DEFAULT '',
      condicion TEXT DEFAULT '',
      disponibilidad TEXT DEFAULT '',
      precio_referencia TEXT DEFAULT '',
      duracion_prestamo TEXT DEFAULT '',
      garantia TEXT DEFAULT '',
      ofrece TEXT DEFAULT '',
      recibe TEXT DEFAULT '',
      image_data TEXT DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS agreements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER,
      requester_id INTEGER NOT NULL,
      provider_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','active','completed','rejected','cancelled')),
      message TEXT DEFAULT '',
      rating_requester INTEGER,
      rating_provider INTEGER,
      complete_requester INTEGER DEFAULT 0,
      complete_provider INTEGER DEFAULT 0,
      resource_snapshot_titulo TEXT,
      resource_snapshot_tipo TEXT,
      resource_snapshot_cat TEXT,
      resource_snapshot_desc TEXT,
      resource_snapshot_image TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (provider_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agreement_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      read_status INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agreement_id) REFERENCES agreements(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
  `)

  // Migrations for existing databases
  const db = getDb()
  const cols = db.prepare("PRAGMA table_info(agreements)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  if (!colNames.includes('complete_requester'))
    db.exec("ALTER TABLE agreements ADD COLUMN complete_requester INTEGER DEFAULT 0")
  if (!colNames.includes('complete_provider'))
    db.exec("ALTER TABLE agreements ADD COLUMN complete_provider INTEGER DEFAULT 0")
  if (!colNames.includes('resource_snapshot_titulo'))
    db.exec("ALTER TABLE agreements ADD COLUMN resource_snapshot_titulo TEXT")
  if (!colNames.includes('resource_snapshot_tipo'))
    db.exec("ALTER TABLE agreements ADD COLUMN resource_snapshot_tipo TEXT")
  if (!colNames.includes('resource_snapshot_cat'))
    db.exec("ALTER TABLE agreements ADD COLUMN resource_snapshot_cat TEXT")
  if (!colNames.includes('resource_snapshot_desc'))
    db.exec("ALTER TABLE agreements ADD COLUMN resource_snapshot_desc TEXT")
  if (!colNames.includes('resource_snapshot_image'))
    db.exec("ALTER TABLE agreements ADD COLUMN resource_snapshot_image TEXT")

  db.exec(`UPDATE agreements SET resource_id = NULL
    WHERE status IN ('completed','cancelled','rejected') AND resource_id IS NOT NULL`)
  db.exec(`DELETE FROM resources WHERE id NOT IN (
    SELECT DISTINCT resource_id FROM agreements
    WHERE resource_id IS NOT NULL AND status IN ('pending','active')
  ) AND status = 'closed'`)
}

// Initialize on first import
initDb()
