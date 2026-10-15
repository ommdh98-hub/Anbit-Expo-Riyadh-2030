"""Local prototype accounts and session authorization. No real irrigation controls.

Passwords and tokens never appear in the shipped source or seed data.
"""
from datetime import datetime, timedelta, timezone
from hashlib import pbkdf2_hmac, sha256
from hmac import compare_digest
import os
import secrets
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField, SQLModel, Session, select


class AnbitAccount(SQLModel, table=True):
    username: str = SQLField(primary_key=True)
    display_name: str
    role: str
    password_hash: str
    enabled: bool = True


class AnbitSession(SQLModel, table=True):
    token_hash: str = SQLField(primary_key=True)
    username: str = SQLField(foreign_key="anbitaccount.username")
    expires_at: str


def hash_password(password: str, *, iterations: int = 390_000) -> str:
    salt = secrets.token_bytes(16)
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2-sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, hashed = stored.split("$")
        if algorithm != "pbkdf2-sha256" or not (1000 <= int(rounds) <= 1_000_000):
            return False
        actual = pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds))
        return compare_digest(actual, bytes.fromhex(hashed))
    except (ValueError, TypeError):
        return False


def install_account(engine, username: Literal["user", "survey"], password: str, *, iterations: int = 390_000):
    if len(password) < 10 or len(password) > 128:
        raise ValueError("كلمة المرور يجب أن تكون من 10 إلى 128 حرفًا")
    names = {"user": "الأفراد", "survey": "فرق المسطحات الخضراء"}
    with Session(engine) as session:
        user = session.get(AnbitAccount, username)
        if user is None:
            user = AnbitAccount(username=username, display_name=names[username], role=username, password_hash="")
        user.password_hash = hash_password(password, iterations=iterations)
        user.enabled = True
        session.add(user)
        for row in session.exec(select(AnbitSession).where(AnbitSession.username == username)).all():
            session.delete(row)
        session.commit()


ROLE_NAMES = {"user": "الأفراد", "survey": "فرق المسطحات الخضراء"}

router = APIRouter(prefix="/api/auth")


class Credentials(BaseModel):
    username: Literal["user", "survey"]
    password: str = Field(min_length=1, max_length=128)


def public_profile(account: AnbitAccount):
    return {"username": account.username, "name": ROLE_NAMES.get(account.role, account.display_name), "role": account.role}


def get_account(request: Request):
    raw = request.cookies.get("anbit_session")
    if not raw:
        return None
    with Session(request.app.state.auth_engine) as session:
        row = session.get(AnbitSession, sha256(raw.encode()).hexdigest())
        if not row or row.expires_at <= datetime.now(timezone.utc).isoformat():
            return None
        account = session.get(AnbitAccount, row.username)
        return public_profile(account) if account and account.enabled else None


def is_allowed_write(role: str, method: str, path: str) -> bool:
    if role not in ROLE_NAMES:
        return False
    if method not in {"POST", "PATCH", "DELETE", "PUT"}:
        return True
    # These calculations are read-only; neither audience can change their formulas.
    if path.startswith("/api/zones/") and (path.endswith("/estimate") or path.endswith("/simulate")):
        return method == "POST"
    if role == "survey":
        return (method == "POST" and (
            (path.startswith("/api/zones/") and path.endswith(("/measurements", "/inspections", "/recommendations", "/plan")))
            or path == "/api/irrigation-events"
        )) or (method == "PATCH" and path.startswith("/api/recommendations/"))
    return False


def maintenance_reset_allowed(request: Request) -> bool:
    # Separate opt-in administrative credential; never shipped in the frontend.
    expected = os.getenv("ANBIT_MAINTENANCE_TOKEN", "")
    supplied = request.headers.get("x-anbit-maintenance-key", "")
    return request.method == "POST" and len(expected) >= 32 and compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or path == "/api/health":
        return await call_next(request)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        # A custom header prevents an untrusted cross-site form from using cookie auth.
        if request.headers.get("x-anbit-request") != "app":
            return JSONResponse({"detail": "تعذر التحقق من الطلب"}, status_code=403)
        origin = request.headers.get("origin")
        allowed = {s.strip() for s in os.getenv("ANBIT_ALLOWED_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000").split(",") if s.strip()}
        if origin and origin not in allowed:
            return JSONResponse({"detail": "مصدر الطلب غير مسموح"}, status_code=403)
    if path == "/api/auth/login":
        return await call_next(request)
    actor = get_account(request)
    if path == "/api/auth/logout":
        return await call_next(request)
    if not actor:
        return JSONResponse({"detail": "سجّل الدخول للمتابعة"}, status_code=401)
    if not (maintenance_reset_allowed(request) if path == "/api/demo/reset" else is_allowed_write(actor["role"], request.method, path)):
        return JSONResponse({"detail": "هذه العملية غير متاحة لهذا الدور"}, status_code=403)
    request.state.actor = actor
    return await call_next(request)


@router.post("/login")
def login(payload: Credentials, response: Response, request: Request):
    with Session(request.app.state.auth_engine) as session:
        account = session.get(AnbitAccount, payload.username)
        if not account or not account.enabled or not verify_password(payload.password, account.password_hash):
            raise HTTPException(401, "بيانات تسجيل الدخول غير صحيحة")
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        for expired in session.exec(select(AnbitSession).where(AnbitSession.expires_at <= now.isoformat())).all():
            session.delete(expired)
        session.add(AnbitSession(token_hash=sha256(token.encode()).hexdigest(), username=account.username, expires_at=(now + timedelta(hours=12)).isoformat()))
        session.commit()
        response.set_cookie(
            "anbit_session", token, httponly=True, secure=os.getenv("ANBIT_SECURE_COOKIE", "0") == "1",
            samesite="strict", max_age=12 * 3600, path="/",
        )
        return public_profile(account)


@router.get("/me")
def me(request: Request):
    return request.state.actor


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("anbit_session")
    if token:
        with Session(request.app.state.auth_engine) as session:
            stored = session.get(AnbitSession, sha256(token.encode()).hexdigest())
            if stored:
                session.delete(stored)
                session.commit()
    response.delete_cookie("anbit_session", path="/", samesite="strict")
    return {"ok": True}
