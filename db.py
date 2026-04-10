import sqlite3
import os
import threading

DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agropulse.db'))
_local = threading.local()

def get_db():
    if not hasattr(_local, 'conn') or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn

def query(sql, params=(), one=False):
    conn = get_db()
    cur = conn.execute(sql, params)
    rows = cur.fetchall()
    if one:
        return dict(rows[0]) if rows else None
    return [dict(r) for r in rows]

def execute(sql, params=()):
    conn = get_db()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid

def init_db():
    conn = get_db()
    conn.executescript("""
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
    """)
    conn.commit()
    # Migrations for existing databases
    cols = [r[1] for r in conn.execute("PRAGMA table_info(agreements)").fetchall()]
    if 'complete_requester' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN complete_requester INTEGER DEFAULT 0")
    if 'complete_provider' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN complete_provider INTEGER DEFAULT 0")
    # Migrations for resource snapshots
    cols = [r[1] for r in conn.execute("PRAGMA table_info(agreements)").fetchall()]
    if 'resource_snapshot_titulo' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN resource_snapshot_titulo TEXT")
    if 'resource_snapshot_tipo' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN resource_snapshot_tipo TEXT")
    if 'resource_snapshot_cat' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN resource_snapshot_cat TEXT")
    if 'resource_snapshot_desc' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN resource_snapshot_desc TEXT")
    if 'resource_snapshot_image' not in cols:
        conn.execute("ALTER TABLE agreements ADD COLUMN resource_snapshot_image TEXT")
    # Cleanup: remove stale resource references and orphaned resources
    conn.execute("""UPDATE agreements SET resource_id = NULL
        WHERE status IN ('completed','cancelled','rejected') AND resource_id IS NOT NULL""")
    conn.execute("""DELETE FROM resources WHERE id NOT IN (
        SELECT DISTINCT resource_id FROM agreements
        WHERE resource_id IS NOT NULL AND status IN ('pending','active')
    ) AND status = 'closed'""")
    conn.commit()

if __name__ == '__main__':
    init_db()
    print("Database initialized.")
