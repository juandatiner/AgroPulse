#!/usr/bin/env python3
import http.server
import json
import os
import re
import db
import auth

PORT = int(os.environ.get('PORT', 8080))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

def json_response(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', len(body))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.end_headers()
    handler.wfile.write(body)

def read_body(handler):
    length = int(handler.headers.get('Content-Length', 0))
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode('utf-8'))

def get_current_user(handler):
    auth_header = handler.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        return auth.get_user_from_token(token), token
    return None, None

class AgroPulseHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path == '':
            self.path = '/index.html'
            return super().do_GET()
        if self.path.startswith('/api/'):
            return self.handle_api('GET')
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self.handle_api('POST')
        json_response(self, {'error': 'Not found'}, 404)

    def do_PUT(self):
        if self.path.startswith('/api/'):
            return self.handle_api('PUT')
        json_response(self, {'error': 'Not found'}, 404)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            return self.handle_api('DELETE')
        json_response(self, {'error': 'Not found'}, 404)

    def log_message(self, format, *args):
        if '/api/' in str(args[0]) if args else False:
            super().log_message(format, *args)

    def handle_api(self, method):
        path = self.path.split('?')[0]
        qs = self.path.split('?')[1] if '?' in self.path else ''
        params = {}
        if qs:
            for part in qs.split('&'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    params[k] = v.replace('%20', ' ').replace('+', ' ')

        try:
            # --- AUTH ---
            if path == '/api/register' and method == 'POST':
                return self.api_register()
            if path == '/api/login' and method == 'POST':
                return self.api_login()
            if path == '/api/logout' and method == 'POST':
                return self.api_logout()

            # --- RESOURCES ---
            if path == '/api/resources' and method == 'GET':
                return self.api_get_resources(params)
            if path == '/api/resources' and method == 'POST':
                return self.api_create_resource()
            m = re.match(r'^/api/resources/(\d+)$', path)
            if m:
                rid = int(m.group(1))
                if method == 'GET':
                    return self.api_get_resource(rid)
                if method == 'PUT':
                    return self.api_update_resource(rid)
                if method == 'DELETE':
                    return self.api_delete_resource(rid)

            # --- AGREEMENTS ---
            if path == '/api/agreements' and method == 'GET':
                return self.api_get_agreements(params)
            if path == '/api/agreements' and method == 'POST':
                return self.api_create_agreement()
            m = re.match(r'^/api/agreements/(\d+)$', path)
            if m:
                aid = int(m.group(1))
                if method == 'GET':
                    return self.api_get_agreement(aid)
                if method == 'PUT':
                    return self.api_update_agreement(aid)
            m = re.match(r'^/api/agreements/(\d+)/rate$', path)
            if m and method == 'POST':
                return self.api_rate_agreement(int(m.group(1)))
            m = re.match(r'^/api/agreements/(\d+)/messages$', path)
            if m:
                aid = int(m.group(1))
                if method == 'GET':
                    return self.api_get_messages(aid)
                if method == 'POST':
                    return self.api_send_message(aid)

            # --- POLL ---
            if path == '/api/poll' and method == 'GET':
                return self.api_poll(params)

            # --- USERS ---
            if path == '/api/users/me' and method == 'GET':
                return self.api_get_profile()
            if path == '/api/users/me' and method == 'PUT':
                return self.api_update_profile()
            m = re.match(r'^/api/users/(\d+)$', path)
            if m and method == 'GET':
                return self.api_get_user(int(m.group(1)))

            json_response(self, {'error': 'Not found'}, 404)
        except Exception as e:
            print(f"API Error: {e}")
            import traceback
            traceback.print_exc()
            json_response(self, {'error': str(e)}, 500)

    # ===== AUTH =====
    def api_register(self):
        data = read_body(self)
        required = ['nombre', 'apellido', 'email', 'password', 'municipio', 'tipo']
        for f in required:
            if not data.get(f, '').strip():
                return json_response(self, {'error': f'Campo {f} es requerido'}, 400)
        if len(data['password']) < 6:
            return json_response(self, {'error': 'La contraseña debe tener al menos 6 caracteres'}, 400)
        existing = db.query("SELECT id FROM users WHERE email = ?", (data['email'].lower(),), one=True)
        if existing:
            return json_response(self, {'error': 'Este correo ya está registrado'}, 400)
        pw_hash = auth.hash_password(data['password'])
        uid = db.execute("""INSERT INTO users (nombre,apellido,email,password_hash,municipio,tipo,telefono,bio,latitude,longitude)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (data['nombre'].strip(), data['apellido'].strip(), data['email'].lower().strip(),
                         pw_hash, data['municipio'], data['tipo'],
                         data.get('telefono', ''), data.get('bio', ''),
                         data.get('latitude'), data.get('longitude')))
        token = auth.create_session(uid)
        user = db.query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
        del user['password_hash']
        json_response(self, {'token': token, 'user': user})

    def api_login(self):
        data = read_body(self)
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')
        if not email or not password:
            return json_response(self, {'error': 'Correo y contraseña son requeridos'}, 400)
        user = db.query("SELECT * FROM users WHERE email = ?", (email,), one=True)
        if not user or not auth.verify_password(password, user['password_hash']):
            return json_response(self, {'error': 'Correo o contraseña incorrectos'}, 401)
        token = auth.create_session(user['id'])
        del user['password_hash']
        json_response(self, {'token': token, 'user': user})

    def api_logout(self):
        user, token = get_current_user(self)
        if token:
            auth.delete_session(token)
        json_response(self, {'ok': True})

    # ===== RESOURCES =====
    def api_get_resources(self, params):
        where = []
        args = []
        is_owner = bool(params.get('owner'))
        # Show all statuses for own resources, only active for others
        if is_owner:
            where.append("r.user_id = ?")
            args.append(int(params['owner']))
        else:
            where.append("r.status = 'active'")
        if params.get('tipo'):
            where.append("r.tipo = ?")
            args.append(params['tipo'])
        if params.get('categoria'):
            where.append("r.categoria = ?")
            args.append(params['categoria'])
        if params.get('municipio'):
            where.append("r.municipio = ?")
            args.append(params['municipio'])
        if params.get('q'):
            where.append("(r.titulo LIKE ? OR r.descripcion LIKE ? OR r.municipio LIKE ?)")
            q = f"%{params['q']}%"
            args.extend([q, q, q])
        if params.get('exclude_user'):
            where.append("r.user_id != ?")
            args.append(int(params['exclude_user']))

        order = "r.created_at DESC"
        if params.get('sort') == 'oldest':
            order = "r.created_at ASC"

        if is_owner:
            # For own resources, include active agreement info
            sql = f"""SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
                      u.municipio as user_municipio, u.reputation_score as user_reputation,
                      a.id as agr_id, a.status as agr_status,
                      req.nombre as agr_req_nombre, req.apellido as agr_req_apellido
                      FROM resources r JOIN users u ON r.user_id = u.id
                      LEFT JOIN agreements a ON a.resource_id = r.id
                          AND a.status NOT IN ('rejected','cancelled','completed')
                      LEFT JOIN users req ON a.requester_id = req.id
                      WHERE {' AND '.join(where)} ORDER BY {order}"""
        else:
            sql = f"""SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
                      u.municipio as user_municipio, u.reputation_score as user_reputation
                      FROM resources r JOIN users u ON r.user_id = u.id
                      WHERE {' AND '.join(where)} ORDER BY {order}"""
        rows = db.query(sql, tuple(args))
        json_response(self, rows)

    def api_get_resource(self, rid):
        r = db.query("""SELECT r.*, u.nombre as user_nombre, u.apellido as user_apellido,
                        u.municipio as user_municipio, u.tipo as user_tipo,
                        u.reputation_score as user_reputation, u.id as owner_id
                        FROM resources r JOIN users u ON r.user_id = u.id WHERE r.id = ?""",
                     (rid,), one=True)
        if not r:
            return json_response(self, {'error': 'No encontrado'}, 404)
        json_response(self, r)

    def api_create_resource(self):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        data = read_body(self)
        required = ['tipo', 'titulo', 'descripcion', 'categoria', 'municipio']
        for f in required:
            if not data.get(f, '').strip():
                return json_response(self, {'error': f'Campo {f} es requerido'}, 400)
        rid = db.execute("""INSERT INTO resources (user_id,tipo,titulo,descripcion,categoria,modalidad,
                           municipio,latitude,longitude,cantidad,unidad,condicion,disponibilidad,
                           precio_referencia,duracion_prestamo,garantia,ofrece,recibe,image_data)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (user['id'], data['tipo'], data['titulo'].strip(), data['descripcion'].strip(),
                         data['categoria'], data.get('modalidad', ''), data['municipio'],
                         data.get('latitude'), data.get('longitude'),
                         data.get('cantidad', ''), data.get('unidad', ''),
                         data.get('condicion', ''), data.get('disponibilidad', ''),
                         data.get('precio_referencia', ''), data.get('duracion_prestamo', ''),
                         data.get('garantia', ''), data.get('ofrece', ''), data.get('recibe', ''),
                         data.get('image_data', '')))
        resource = db.query("SELECT * FROM resources WHERE id = ?", (rid,), one=True)
        json_response(self, resource, 201)

    def api_update_resource(self, rid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        r = db.query("SELECT * FROM resources WHERE id = ? AND user_id = ?", (rid, user['id']), one=True)
        if not r:
            return json_response(self, {'error': 'No encontrado o no autorizado'}, 404)
        data = read_body(self)
        fields = ['titulo', 'descripcion', 'categoria', 'modalidad', 'municipio', 'status',
                  'cantidad', 'unidad', 'condicion', 'disponibilidad', 'precio_referencia',
                  'duracion_prestamo', 'garantia', 'ofrece', 'recibe']
        updates = []
        args = []
        for f in fields:
            if f in data:
                updates.append(f"{f} = ?")
                args.append(data[f])
        if updates:
            args.append(rid)
            db.execute(f"UPDATE resources SET {', '.join(updates)} WHERE id = ?", tuple(args))
        json_response(self, {'ok': True})

    def api_delete_resource(self, rid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        db.execute("DELETE FROM resources WHERE id = ? AND user_id = ?", (rid, user['id']))
        json_response(self, {'ok': True})

    # ===== AGREEMENTS =====
    def api_get_agreements(self, params):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        where = ["(a.requester_id = ? OR a.provider_id = ?)"]
        args = [user['id'], user['id']]
        if params.get('status') and params['status'] != 'todos':
            where.append("a.status = ?")
            args.append(params['status'])
        sql = f"""SELECT a.*,
                  COALESCE(r.titulo, a.resource_snapshot_titulo) as resource_titulo,
                  COALESCE(r.tipo, a.resource_snapshot_tipo) as resource_tipo,
                  COALESCE(r.categoria, a.resource_snapshot_cat) as resource_cat,
                  req.nombre as req_nombre, req.apellido as req_apellido,
                  prov.nombre as prov_nombre, prov.apellido as prov_apellido,
                  (SELECT COUNT(*) FROM messages m WHERE m.agreement_id = a.id
                   AND m.sender_id != ? AND m.read_status = 0) as unread_count
                  FROM agreements a
                  LEFT JOIN resources r ON a.resource_id = r.id
                  JOIN users req ON a.requester_id = req.id
                  JOIN users prov ON a.provider_id = prov.id
                  WHERE {' AND '.join(where)}
                  ORDER BY a.updated_at DESC"""
        args.insert(0, user['id'])
        rows = db.query(sql, tuple(args))
        json_response(self, rows)

    def api_get_agreement(self, aid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        a = db.query("""SELECT a.*,
                        COALESCE(r.titulo, a.resource_snapshot_titulo) as resource_titulo,
                        COALESCE(r.tipo, a.resource_snapshot_tipo) as resource_tipo,
                        COALESCE(r.categoria, a.resource_snapshot_cat) as resource_cat,
                        COALESCE(r.descripcion, a.resource_snapshot_desc) as descripcion,
                        COALESCE(r.image_data, a.resource_snapshot_image) as image_data,
                        req.nombre as req_nombre, req.apellido as req_apellido,
                        prov.nombre as prov_nombre, prov.apellido as prov_apellido
                        FROM agreements a
                        LEFT JOIN resources r ON a.resource_id = r.id
                        JOIN users req ON a.requester_id = req.id
                        JOIN users prov ON a.provider_id = prov.id
                        WHERE a.id = ? AND (a.requester_id = ? OR a.provider_id = ?)""",
                     (aid, user['id'], user['id']), one=True)
        if not a:
            return json_response(self, {'error': 'No encontrado'}, 404)
        json_response(self, a)

    def api_create_agreement(self):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        data = read_body(self)
        rid = data.get('resource_id')
        if not rid:
            return json_response(self, {'error': 'resource_id requerido'}, 400)
        resource = db.query("SELECT * FROM resources WHERE id = ?", (rid,), one=True)
        if not resource:
            return json_response(self, {'error': 'Este recurso ya no está disponible'}, 404)
        if resource['status'] != 'active':
            return json_response(self, {'error': 'Este recurso ya fue asignado y no acepta nuevas solicitudes'}, 400)
        if resource['user_id'] == user['id']:
            return json_response(self, {'error': 'No puedes solicitar tu propio recurso'}, 400)
        existing = db.query("""SELECT id, status FROM agreements WHERE resource_id = ? AND requester_id = ?
                              AND status NOT IN ('rejected','cancelled')""",
                           (rid, user['id']), one=True)
        if existing:
            return json_response(self, {'error': 'Ya tienes una solicitud para este recurso', 'agreement_id': existing['id']}, 400)
        # Allow re-request after rejection - check if there was a rejected one and remove it
        old_rejected = db.query("""SELECT id FROM agreements WHERE resource_id = ? AND requester_id = ?
                                  AND status IN ('rejected','cancelled')""",
                               (rid, user['id']))
        for old in old_rejected:
            db.execute("DELETE FROM messages WHERE agreement_id = ?", (old['id'],))
            db.execute("DELETE FROM agreements WHERE id = ?", (old['id'],))
        aid = db.execute("""INSERT INTO agreements (resource_id, requester_id, provider_id, message,
                           resource_snapshot_titulo, resource_snapshot_tipo, resource_snapshot_cat,
                           resource_snapshot_desc, resource_snapshot_image)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (rid, user['id'], resource['user_id'], data.get('message', ''),
                         resource['titulo'], resource['tipo'], resource['categoria'],
                         resource['descripcion'], resource['image_data']))
        if data.get('message'):
            db.execute("""INSERT INTO messages (agreement_id, sender_id, content)
                         VALUES (?, ?, ?)""", (aid, user['id'], data['message']))
        json_response(self, {'id': aid, 'status': 'pending'}, 201)

    def api_update_agreement(self, aid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        a = db.query("SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
                    (aid, user['id'], user['id']), one=True)
        if not a:
            return json_response(self, {'error': 'No encontrado'}, 404)
        data = read_body(self)
        action = data.get('status')
        current = a['status']

        # Mark complete (either party)
        if action == 'mark_complete':
            if current != 'active':
                return json_response(self, {'error': 'Solo se puede completar un acuerdo activo'}, 400)
            is_requester = user['id'] == a['requester_id']
            if is_requester:
                db.execute("UPDATE agreements SET complete_requester = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (aid,))
            else:
                db.execute("UPDATE agreements SET complete_provider = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (aid,))
            updated = db.query("SELECT complete_requester, complete_provider FROM agreements WHERE id = ?", (aid,), one=True)
            if updated['complete_requester'] and updated['complete_provider']:
                db.execute("UPDATE agreements SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (aid,))
                return json_response(self, {'ok': True, 'status': 'completed'})
            return json_response(self, {'ok': True, 'status': 'active', 'waiting': True})

        valid_transitions = {
            'pending': ['active', 'rejected', 'cancelled'],
            'active': ['completed', 'cancelled'],
        }
        if action not in valid_transitions.get(current, []):
            return json_response(self, {'error': f'Acción no válida en estado {current}'}, 400)
        if action in ('active', 'rejected', 'completed') and user['id'] != a['provider_id']:
            return json_response(self, {'error': 'Solo el dueño del recurso puede realizar esta acción'}, 403)
        db.execute("UPDATE agreements SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                  (action, aid))
        rid = a['resource_id']
        if action == 'active' and rid:
            # Provider accepts: close resource so it disappears from marketplace
            db.execute("UPDATE resources SET status = 'closed' WHERE id = ?", (rid,))
        elif action == 'completed' and rid:
            # Service done: NULL-out resource_id on all agreements first (FK), then delete
            db.execute("UPDATE agreements SET resource_id = NULL WHERE resource_id = ?", (rid,))
            db.execute("DELETE FROM resources WHERE id = ?", (rid,))
        elif action == 'cancelled' and rid:
            prev = a['status']
            if prev == 'active':
                # Was closed when accepted: restore to active so it reappears in marketplace
                db.execute("UPDATE resources SET status = 'active' WHERE id = ?", (rid,))
            # If cancelled from pending, resource was never closed — no change needed
        json_response(self, {'ok': True, 'status': action})

    def api_rate_agreement(self, aid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        a = db.query("SELECT * FROM agreements WHERE id = ? AND status = 'completed'", (aid,), one=True)
        if not a:
            return json_response(self, {'error': 'Acuerdo no encontrado o no completado'}, 404)
        data = read_body(self)
        rating = data.get('rating')
        if not rating or rating < 1 or rating > 5:
            return json_response(self, {'error': 'Rating debe ser entre 1 y 5'}, 400)
        if user['id'] == a['requester_id']:
            db.execute("UPDATE agreements SET rating_requester = ? WHERE id = ?", (rating, aid))
            target_id = a['provider_id']
        elif user['id'] == a['provider_id']:
            db.execute("UPDATE agreements SET rating_provider = ? WHERE id = ?", (rating, aid))
            target_id = a['requester_id']
        else:
            return json_response(self, {'error': 'No autorizado'}, 403)
        # Update reputation
        ratings = db.query("""SELECT rating_requester as r FROM agreements
                             WHERE provider_id = ? AND rating_requester IS NOT NULL
                             UNION ALL
                             SELECT rating_provider as r FROM agreements
                             WHERE requester_id = ? AND rating_provider IS NOT NULL""",
                          (target_id, target_id))
        if ratings:
            avg = sum(r['r'] for r in ratings) / len(ratings)
            db.execute("UPDATE users SET reputation_score = ?, total_ratings = ? WHERE id = ?",
                      (round(avg, 1), len(ratings), target_id))
        json_response(self, {'ok': True})

    # ===== MESSAGES =====
    def api_get_messages(self, aid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        a = db.query("SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
                    (aid, user['id'], user['id']), one=True)
        if not a:
            return json_response(self, {'error': 'No encontrado'}, 404)
        msgs = db.query("""SELECT m.*, u.nombre as sender_nombre, u.apellido as sender_apellido
                          FROM messages m JOIN users u ON m.sender_id = u.id
                          WHERE m.agreement_id = ? ORDER BY m.created_at ASC""", (aid,))
        db.execute("""UPDATE messages SET read_status = 1
                     WHERE agreement_id = ? AND sender_id != ? AND read_status = 0""",
                  (aid, user['id']))
        json_response(self, msgs)

    def api_send_message(self, aid):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        a = db.query("SELECT * FROM agreements WHERE id = ? AND (requester_id = ? OR provider_id = ?)",
                    (aid, user['id'], user['id']), one=True)
        if not a:
            return json_response(self, {'error': 'No encontrado'}, 404)
        data = read_body(self)
        content = data.get('content', '').strip()
        if not content:
            return json_response(self, {'error': 'Mensaje vacío'}, 400)
        mid = db.execute("INSERT INTO messages (agreement_id, sender_id, content) VALUES (?, ?, ?)",
                        (aid, user['id'], content))
        db.execute("UPDATE agreements SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (aid,))
        msg = db.query("SELECT m.*, u.nombre as sender_nombre, u.apellido as sender_apellido FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?", (mid,), one=True)
        json_response(self, msg, 201)

    # ===== POLL =====
    def api_poll(self, params):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        since = params.get('since', '2000-01-01')
        msgs = db.query("""SELECT m.*, m.agreement_id,
                          u.nombre as sender_nombre, u.apellido as sender_apellido
                          FROM messages m JOIN users u ON m.sender_id = u.id
                          JOIN agreements a ON m.agreement_id = a.id
                          WHERE (a.requester_id = ? OR a.provider_id = ?)
                          AND m.sender_id != ?
                          AND m.created_at > ?
                          ORDER BY m.created_at ASC""",
                       (user['id'], user['id'], user['id'], since))
        pending = db.query("""SELECT COUNT(*) as c FROM agreements
                             WHERE provider_id = ? AND status = 'pending'""",
                          (user['id'],), one=True)
        unread = db.query("""SELECT COUNT(*) as c FROM messages m
                            JOIN agreements a ON m.agreement_id = a.id
                            WHERE (a.requester_id = ? OR a.provider_id = ?)
                            AND m.sender_id != ? AND m.read_status = 0""",
                         (user['id'], user['id'], user['id']), one=True)
        total_agr = db.query("""SELECT COUNT(*) as c FROM agreements
                               WHERE requester_id = ? OR provider_id = ?""",
                             (user['id'], user['id']), one=True)
        json_response(self, {
            'messages': msgs,
            'pending_agreements': pending['c'] if pending else 0,
            'unread_messages': unread['c'] if unread else 0,
            'total_agreements': total_agr['c'] if total_agr else 0
        })

    # ===== USERS =====
    def api_get_profile(self):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        stats = {
            'total_resources': db.query("SELECT COUNT(*) as c FROM resources WHERE user_id = ?",
                                       (user['id'],), one=True)['c'],
            'active_resources': db.query("SELECT COUNT(*) as c FROM resources WHERE user_id = ? AND status = 'active'",
                                        (user['id'],), one=True)['c'],
            'total_agreements': db.query("""SELECT COUNT(*) as c FROM agreements
                                           WHERE requester_id = ? OR provider_id = ?""",
                                        (user['id'], user['id']), one=True)['c'],
            'completed_agreements': db.query("""SELECT COUNT(*) as c FROM agreements
                                               WHERE (requester_id = ? OR provider_id = ?) AND status = 'completed'""",
                                            (user['id'], user['id']), one=True)['c'],
        }
        u = dict(user)
        del u['password_hash']
        u['stats'] = stats
        json_response(self, u)

    def api_update_profile(self):
        user, _ = get_current_user(self)
        if not user:
            return json_response(self, {'error': 'No autorizado'}, 401)
        data = read_body(self)
        fields = ['nombre', 'apellido', 'municipio', 'tipo', 'telefono', 'bio', 'latitude', 'longitude']
        updates = []
        args = []
        for f in fields:
            if f in data:
                updates.append(f"{f} = ?")
                args.append(data[f])
        if updates:
            args.append(user['id'])
            db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(args))
        updated = db.query("SELECT * FROM users WHERE id = ?", (user['id'],), one=True)
        del updated['password_hash']
        json_response(self, updated)

    def api_get_user(self, uid):
        u = db.query("""SELECT id, nombre, apellido, municipio, tipo, bio,
                        reputation_score, total_ratings, created_at
                        FROM users WHERE id = ?""", (uid,), one=True)
        if not u:
            return json_response(self, {'error': 'No encontrado'}, 404)
        u['resources'] = db.query("""SELECT * FROM resources WHERE user_id = ? AND status = 'active'
                                    ORDER BY created_at DESC""", (uid,))
        json_response(self, u)


if __name__ == '__main__':
    db.init_db()
    print(f"AgroPulse server running on http://localhost:{PORT}")
    server = http.server.HTTPServer(('', PORT), AgroPulseHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
