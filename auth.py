import hashlib
import secrets
import db

def hash_password(password):
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return salt + '$' + h.hex()

def verify_password(password, stored):
    parts = stored.split('$', 1)
    if len(parts) != 2:
        return False
    salt, expected = parts
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return h.hex() == expected

def create_session(user_id):
    token = secrets.token_hex(32)
    db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
    return token

def get_user_from_token(token):
    if not token:
        return None
    row = db.query("""SELECT u.* FROM users u JOIN sessions s ON u.id = s.user_id
                      WHERE s.token = ?""", (token,), one=True)
    return row

def delete_session(token):
    db.execute("DELETE FROM sessions WHERE token = ?", (token,))
