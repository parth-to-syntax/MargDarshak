import hashlib
import json
import os
import secrets
import sqlite3
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).with_name("skygrid.db")


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row[1] == column for row in rows)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT,
                role TEXT NOT NULL CHECK(role IN ('admin', 'officer')),
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                seg_id TEXT NOT NULL,
                location TEXT NOT NULL,
                incident_type TEXT NOT NULL,
                severity INTEGER NOT NULL,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playback_state (
                key TEXT PRIMARY KEY,
                value_text TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS incident_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                incident_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                message TEXT NOT NULL
            );
            """
        )
        conn.commit()

        if not _column_exists(conn, "users", "email"):
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
            conn.commit()

        conn.execute(
            """
            UPDATE users
            SET email = CASE
                WHEN email IS NOT NULL AND email != '' THEN email
                WHEN username = 'admin' THEN 'admin@skygrid.city'
                WHEN username = 'officer' THEN 'officer@skygrid.city'
                ELSE username || '@skygrid.city'
            END
            """
        )
        conn.commit()

        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is None:
            create_user("admin", "admin123", "admin", email="admin@skygrid.city", is_active=True, send_email=False)
            create_user("officer", "officer123", "officer", email="officer@skygrid.city", is_active=True, send_email=False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}:${digest.hex()}"


def generate_temp_password(length: int = 12) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash or ":" not in password_hash:
        return False
    salt, digest_hex = password_hash.split(":", 1)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return digest.hex() == digest_hex.replace("$", "")


def create_user(
    username: str,
    password: Optional[str],
    role: str,
    email: Optional[str] = None,
    is_active: bool = True,
    send_email: bool = False,
) -> dict:
    if not username:
        raise ValueError("username is required")

    if not password:
        password = generate_temp_password()
    if not email:
        email = f"{username.lower()}@skygrid.city"

    password_hash = hash_password(password)
    now = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (username, email, role, password_hash, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username.lower(), email.lower(), role.lower(), password_hash, 1 if is_active else 0, now),
        )
        user_id = cursor.lastrowid
        conn.commit()

    if send_email:
        send_credentials_email(email, username, password)

    return {
        "id": user_id,
        "username": username.lower(),
        "email": email.lower(),
        "role": role.lower(),
        "is_active": 1 if is_active else 0,
        "temporary_password": password,
    }


def get_user_by_username(username: str) -> Optional[dict]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, email, role, password_hash, is_active, created_at FROM users WHERE username = ?",
            (username.lower(),),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def authenticate_user(username: str, password: str) -> Optional[dict]:
    user = get_user_by_username(username)
    if not user or not user["is_active"]:
        return None
    if verify_password(password, user["password_hash"]):
        email = user.get("email") or f'{user["username"]}@skygrid.city'
        return {
            "id": user["id"],
            "username": user["username"],
            "email": email,
            "role": user["role"],
            "is_active": user["is_active"],
            "display_name": user["username"],
        }
    return None


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=8)).isoformat()
    created_at = now.isoformat()

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, expires_at, created_at),
        )
        conn.commit()
    return token


def get_user_from_session(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None

    with get_connection() as conn:
        row = conn.execute(
            "SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.email, u.role, u.is_active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()

    if not row:
        return None

    expires_at = datetime.fromisoformat(row["expires_at"])
    if expires_at <= datetime.now(timezone.utc):
        delete_session(token)
        return None

    email = row["email"] or f"{row['username']}@skygrid.city"
    return {
        "id": row["user_id"],
        "username": row["username"],
        "email": email,
        "role": row["role"],
        "is_active": row["is_active"],
        "display_name": row["username"],
    }


def delete_session(token: Optional[str]) -> None:
    if not token:
        return
    with get_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def list_users() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, username, email, role, is_active, created_at FROM users ORDER BY id"
        ).fetchall()
    users = []
    for row in rows:
      user = dict(row)
      user["email"] = user.get("email") or f"{user['username']}@skygrid.city"
      users.append(user)
    return users


def delete_user(user_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()


def save_incident(incident: dict) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO incidents (id, seg_id, location, incident_type, severity, status, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                seg_id=excluded.seg_id,
                location=excluded.location,
                incident_type=excluded.incident_type,
                severity=excluded.severity,
                status=excluded.status,
                payload_json=excluded.payload_json,
                created_at=excluded.created_at
            """,
            (
                incident["id"],
                incident.get("seg_id", ""),
                incident.get("location", ""),
                incident.get("type", "ACCIDENT"),
                int(incident.get("severity", 0)),
                incident.get("status", "ACTIVE"),
                json.dumps(incident),
                incident.get("created_at") or datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()


def load_incidents() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, seg_id, location, incident_type, severity, status, payload_json FROM incidents ORDER BY created_at"
        ).fetchall()

    incidents = []
    for row in rows:
        payload = json.loads(row["payload_json"])
        incidents.append(payload)
    return incidents


def save_playback_state(state: dict) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO playback_state (key, value_text, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_text=excluded.value_text, updated_at=excluded.updated_at",
            ("main", json.dumps(state), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()


def load_playback_state() -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT value_text FROM playback_state WHERE key = ?", ("main",)).fetchone()
    if not row:
        return {}
    return json.loads(row["value_text"])


def send_credentials_email(email: str, username: str, password: str) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        print(f"[auth] email not configured. Temporary password for {username}<{email}>: {password}")
        return

    msg = EmailMessage()
    msg["Subject"] = "Your SkyGrid Account Credentials"
    msg["From"] = os.getenv("SMTP_FROM", "skygrid@example.com")
    msg["To"] = email
    msg.set_content(
        "Welcome to SkyGrid.\n\n"
        f"Username:\n{username}\n\n"
        f"Temporary Password:\n{password}\n\n"
        "Please change your password after first login."
    )

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME")
    smtp_pass = os.getenv("SMTP_PASSWORD")

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as smtp:
            if smtp_user:
                smtp.starttls()
                smtp.login(smtp_user, smtp_pass or "")
            smtp.send_message(msg)
    except Exception as e:
        print(f"[auth] Failed to send email credentials: {e}")


def add_incident_log(incident_id: str, message: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO incident_logs (incident_id, timestamp, message) VALUES (?, ?, ?)",
            (incident_id, datetime.now().strftime("%H:%M"), message),
        )
        conn.commit()


def get_incident_logs() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT incident_id, timestamp, message FROM incident_logs ORDER BY id"
        ).fetchall()
    return [
        {
            "incident_id": r["incident_id"],
            "timestamp": r["timestamp"],
            "message": r["message"],
        }
        for r in rows
    ]


def get_next_incident_id() -> str:
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM incidents").fetchall()
    if not rows:
        return "INC_001"
    
    max_num = 0
    for r in rows:
        iid = r["id"]
        if iid.startswith("INC_"):
            try:
                num = int(iid.split("_")[1])
                if num > max_num:
                    max_num = num
            except Exception:
                pass
    return f"INC_{max_num + 1:03d}"


init_db()
