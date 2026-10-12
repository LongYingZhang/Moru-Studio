import base64
import binascii
import email.utils
import gzip
import hashlib
import hmac
import io
import json
import os
import posixpath
import re
import secrets
import sys
import tempfile
import threading
import time
from datetime import datetime
from functools import partial
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

SHOP_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_DIR = os.path.join(SHOP_DIR, "admin")
DATA_DIR = os.path.join(ADMIN_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "products.json")
ORDERS_FILE = os.path.join(DATA_DIR, "orders.json")
AUTH_FILE = os.path.join(DATA_DIR, "auth.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
PORT = int(os.environ.get("PORT", "8787"))
HOST = os.environ.get("HOST", "127.0.0.1")
MAX_BODY = 50 * 1024 * 1024
MAX_SMALL_BODY = 64 * 1024
API_PATH = "/api/products"
SESSION_COOKIE = "ly_admin"
# Cookie Max-Age：浏览器侧长期保留；会话本身不设过期，直到主动退出
SESSION_COOKIE_MAX_AGE = 10 * 365 * 24 * 3600
PBKDF2_ROUNDS = 200_000

ORDER_NO = re.compile(r"^LY\d{10,16}$")
PHONE = re.compile(r"^[+\d][\d\s-]{6,}$")
METHODS = {"wechat", "alipay", "card"}

DATA_IMAGE = re.compile(r"^data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$")
IMAGE_EXT = {"jpeg": "jpg", "png": "png", "webp": "webp", "gif": "gif"}
UPLOAD_NAME = re.compile(r"^[0-9a-f]{32}\.(?:jpg|png|webp|gif)$")
GZIP_EXT = {".html", ".css", ".js", ".svg", ".json"}
LONG_CACHE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".woff2", ".ico", ".mp4"}
RANGE_EXT = {".mp4", ".webm", ".woff2", ".jpg", ".jpeg", ".png", ".webp", ".gif"}
ASSET_REF = re.compile(rb'\b(href|src)="((?:\./)?[\w][\w./-]*\.(?:css|js))"')
VERSION_QUERY = re.compile(r"(?:^|&)v=")


def version_assets(html, base_dir, mtime):
    """Stamp local css/js links with their mtime so browsers can cache them for good."""
    latest = mtime

    def stamp(match):
        nonlocal latest
        target = os.path.normpath(os.path.join(base_dir, match.group(2).decode()))
        if not target.startswith(SHOP_DIR + os.sep) or not os.path.isfile(target):
            return match.group(0)
        stamp_time = int(os.stat(target).st_mtime)
        latest = max(latest, stamp_time)
        return b'%s="%s?v=%x"' % (match.group(1), match.group(2), stamp_time)

    return ASSET_REF.sub(stamp, html), latest

data_lock = threading.Lock()
sessions_lock = threading.Lock()
sessions = set()


def read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False)
    os.replace(temp_path, path)


def load_sessions():
    raw = read_json(SESSIONS_FILE, [])
    if not isinstance(raw, list):
        return set()
    return {token for token in raw if isinstance(token, str) and token}


def save_sessions(tokens):
    write_json(SESSIONS_FILE, sorted(tokens))


sessions = load_sessions()


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    ).hex()


def store_images(value):
    """把商品里的 base64 图片存成 uploads/ 下的文件，换成文件地址。"""
    if isinstance(value, list):
        return [store_images(item) for item in value]
    if isinstance(value, dict):
        return {key: store_images(item) for key, item in value.items()}
    if not isinstance(value, str):
        return value
    match = DATA_IMAGE.match(value)
    if not match:
        return value
    try:
        raw = base64.b64decode(re.sub(r"\s", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        return value
    name = hashlib.sha256(raw).hexdigest()[:32] + "." + IMAGE_EXT[match.group(1)]
    path = os.path.join(UPLOADS_DIR, name)
    if not os.path.exists(path):
        os.makedirs(UPLOADS_DIR, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(dir=UPLOADS_DIR)
        with os.fdopen(fd, "wb") as file:
            file.write(raw)
        os.replace(temp_path, path)
    return "/uploads/" + name


def migrate_inline_images():
    products = read_json(DATA_FILE, None)
    if products is None:
        return
    stored = store_images(products)
    if stored == products:
        return
    backup = DATA_FILE + ".before-uploads"
    if not os.path.exists(backup):
        with open(DATA_FILE, "rb") as src, open(backup, "wb") as dst:
            dst.write(src.read())
    write_json(DATA_FILE, stored)
    print("已把商品图片拆分到 admin/data/uploads/")


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def clean_text(value, limit):
    return str(value or "").strip()[:limit]


class ShopHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".mp4": "video/mp4",
        ".webmanifest": "application/manifest+json",
    }
    cache_override = None

    def translate_path(self, path):
        request_path = posixpath.normpath(unquote(urlsplit(path).path))
        if request_path == "/admin":
            request_path = "/admin/"

        if request_path.startswith("/uploads/"):
            name = request_path[len("/uploads/"):]
            if not UPLOAD_NAME.match(name):
                return os.path.join(ADMIN_DIR, "__forbidden__")
            return os.path.join(UPLOADS_DIR, name)

        if request_path.startswith("/admin/") or request_path == "/admin/":
            root = ADMIN_DIR
            relative = request_path[len("/admin"):]
        else:
            root = SHOP_DIR
            relative = request_path

        parts = [part for part in relative.split("/") if part not in ("", ".", "..")]
        if any(part.startswith(".") for part in parts):
            return os.path.join(ADMIN_DIR, "__forbidden__")
        if root == ADMIN_DIR and parts[:1] == ["data"]:
            return os.path.join(ADMIN_DIR, "__forbidden__")
        resolved = os.path.join(root, *parts)
        if path.split("?", 1)[0].endswith("/"):
            resolved += "/"
        return resolved

    def cache_policy(self):
        if self.cache_override:
            return self.cache_override
        path = self.route()
        if path.startswith("/uploads/"):
            return "public, max-age=31536000, immutable"
        if path.startswith("/api/"):
            return "no-store"
        ext = os.path.splitext(path)[1].lower()
        if ext in (".css", ".js") and VERSION_QUERY.search(urlsplit(self.path).query):
            return "public, max-age=31536000, immutable"
        if ext in LONG_CACHE_EXT:
            return "public, max-age=86400"
        return "no-cache"

    def end_headers(self):
        self.send_header("Cache-Control", self.cache_policy())
        super().end_headers()

    def accepts_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "")

    def send_partial(self, path, file_size):
        unit, _, ranges = (self.headers.get("Range") or "").partition("=")
        if unit.strip() != "bytes" or not ranges or "," in ranges:
            return False
        start_s, _, end_s = ranges.strip().partition("-")
        try:
            if start_s == "":
                length = int(end_s)
                start = max(0, file_size - length)
                end = file_size - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else file_size - 1
        except ValueError:
            return False
        if start < 0 or start >= file_size or end < start:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return io.BytesIO(b"")
        end = min(end, file_size - 1)
        length = end - start + 1
        with open(path, "rb") as file:
            file.seek(start)
            body = file.read(length)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", self.date_time_string(os.stat(path).st_mtime))
        self.end_headers()
        return io.BytesIO(body)

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path) and self.route().endswith("/"):
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            return super().send_head()
        ext = os.path.splitext(path)[1].lower()
        file_size = os.path.getsize(path)

        if ext in RANGE_EXT and self.headers.get("Range"):
            partial = self.send_partial(path, file_size)
            if partial is not False:
                return partial

        if ext in RANGE_EXT and ext not in GZIP_EXT:
            file = open(path, "rb")
            try:
                stat = os.fstat(file.fileno())
            except OSError:
                file.close()
                self.send_error(404, "File not found")
                return None
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
            self.end_headers()
            return file

        if ext not in GZIP_EXT:
            return super().send_head()

        with open(path, "rb") as file:
            body = file.read()
        mtime = int(os.stat(path).st_mtime)
        if ext == ".html":
            body, mtime = version_assets(body, os.path.dirname(path), mtime)
        since = self.headers.get("If-Modified-Since")
        if since and not self.headers.get("If-None-Match"):
            try:
                if email.utils.parsedate_to_datetime(since).timestamp() >= mtime:
                    self.send_response(304)
                    self.end_headers()
                    return None
            except (TypeError, ValueError, IndexError, OverflowError):
                pass
        gzipped = self.accepts_gzip()
        if gzipped:
            body = gzip.compress(body, 6)
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(path))
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", self.date_time_string(mtime))
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, format, *args):
        # 启动它的终端关掉后 stderr 会失效，写日志失败不能拖垮请求
        try:
            super().log_message(format, *args)
        except (OSError, ValueError):
            pass

    # ---- helpers ----

    def route(self):
        return urlsplit(self.path).path

    def send_json(self, status, body, cookie=None, etag=None):
        payload = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8")
        gzipped = len(payload) > 1024 and self.accepts_gzip()
        if gzipped:
            payload = gzip.compress(payload, 6)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(payload)))
        if etag:
            self.send_header("ETag", etag)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def read_body(self, limit):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > limit:
            self.send_json(413, {"error": "invalid size"})
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            self.send_json(400, {"error": "invalid json"})
            return None

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie") or "")
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else ""

    def is_authed(self):
        token = self.session_token()
        if not token:
            return False
        with sessions_lock:
            return token in sessions

    def require_auth(self):
        if self.is_authed():
            return True
        self.send_json(401, {"error": "unauthorized"})
        return False

    # ---- dispatch ----

    def do_GET(self):
        path = self.route()
        if path == API_PATH:
            return self.get_products()
        if path == "/api/auth":
            return self.send_json(200, {
                "setup": os.path.exists(AUTH_FILE),
                "authed": self.is_authed(),
            })
        if path == "/api/orders":
            if not self.require_auth():
                return
            with data_lock:
                orders = read_json(ORDERS_FILE, [])
            return self.send_json(200, orders)
        return super().do_GET()

    def do_PUT(self):
        if self.route() != API_PATH:
            return self.send_error(405)
        if not self.require_auth():
            return
        products = self.read_body(MAX_BODY)
        if products is None:
            return
        if not isinstance(products, list):
            return self.send_json(400, {"error": "expected list"})
        with data_lock:
            write_json(DATA_FILE, store_images(products))
        self.send_json(200, {"ok": True})

    def do_POST(self):
        path = self.route()
        if path == "/api/auth/setup":
            return self.auth_setup()
        if path == "/api/auth/login":
            return self.auth_login()
        if path == "/api/auth/logout":
            return self.auth_logout()
        if path == "/api/orders":
            return self.create_order()
        self.send_error(405)

    def do_PATCH(self):
        path = self.route()
        if not path.startswith("/api/orders/"):
            return self.send_error(405)
        if not self.require_auth():
            return
        self.update_order(unquote(path[len("/api/orders/"):]))

    # ---- products ----

    def get_products(self):
        with data_lock:
            try:
                stat = os.stat(DATA_FILE)
            except OSError:
                return self.send_json(404, "null")
            etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
            self.cache_override = "no-cache"
            if etag in (self.headers.get("If-None-Match") or ""):
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                return
            with open(DATA_FILE, encoding="utf-8") as file:
                body = file.read()
        self.send_json(200, body, etag=etag)

    # ---- auth ----

    def start_session(self):
        token = secrets.token_urlsafe(32)
        with sessions_lock:
            sessions.add(token)
            save_sessions(sessions)
        return (
            f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_COOKIE_MAX_AGE}; "
            "HttpOnly; SameSite=Strict"
        )

    def auth_setup(self):
        body = self.read_body(MAX_SMALL_BODY)
        if body is None:
            return
        username = clean_text(body.get("username"), 40)
        password = str(body.get("password") or "")
        if not username or len(password) < 8:
            return self.send_json(400, {"error": "账号不能为空，密码至少 8 位"})
        with data_lock:
            if os.path.exists(AUTH_FILE):
                return self.send_json(409, {"error": "后台密码已经设置过"})
            salt = secrets.token_hex(16)
            write_json(AUTH_FILE, {
                "username": username,
                "salt": salt,
                "hash": hash_password(password, salt),
            })
        self.send_json(200, {"ok": True}, cookie=self.start_session())

    def auth_login(self):
        body = self.read_body(MAX_SMALL_BODY)
        if body is None:
            return
        auth = read_json(AUTH_FILE, None)
        if not auth:
            return self.send_json(409, {"error": "请先设置后台密码"})
        username = clean_text(body.get("username"), 40)
        password = str(body.get("password") or "")
        ok = hmac.compare_digest(username, auth["username"]) & hmac.compare_digest(
            hash_password(password, auth["salt"]), auth["hash"]
        )
        if not ok:
            time.sleep(1)
            return self.send_json(401, {"error": "账号或密码错误"})
        self.send_json(200, {"ok": True}, cookie=self.start_session())

    def auth_logout(self):
        token = self.session_token()
        with sessions_lock:
            if token in sessions:
                sessions.discard(token)
                save_sessions(sessions)
        self.send_json(200, {"ok": True},
                       cookie=f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict")

    # ---- orders ----

    def create_order(self):
        body = self.read_body(MAX_SMALL_BODY)
        if body is None:
            return
        order_no = clean_text(body.get("no"), 20)
        name = clean_text(body.get("name"), 40)
        phone = clean_text(body.get("phone"), 30)
        address = clean_text(body.get("address"), 200)
        method = body.get("method") if body.get("method") in METHODS else "wechat"
        items = body.get("items")
        if not ORDER_NO.match(order_no):
            return self.send_json(400, {"error": "订单号无效"})
        if not name or not PHONE.match(phone) or not address:
            return self.send_json(400, {"error": "收件信息不完整"})
        if not isinstance(items, list) or not 0 < len(items) <= 50:
            return self.send_json(400, {"error": "购物袋是空的"})

        with data_lock:
            products = {
                str(p.get("id")): p
                for p in read_json(DATA_FILE, [])
                if isinstance(p, dict) and p.get("status", "active") == "active"
            }
            lines = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                product = products.get(str(item.get("id")))
                try:
                    qty = int(item.get("qty"))
                except (TypeError, ValueError):
                    qty = 0
                if not product or not 0 < qty <= 99:
                    return self.send_json(400, {"error": "有商品已下架，请返回购物袋检查"})
                image = str(product.get("image") or "")
                lines.append({
                    "id": product.get("id"),
                    "name": product.get("name", ""),
                    "price": float(product.get("price") or 0),
                    "qty": qty,
                    "image": image if not image.startswith("data:") else "",
                })
            orders = read_json(ORDERS_FILE, [])
            if any(o.get("no") == order_no for o in orders):
                return self.send_json(409, {"error": "订单号重复，请重试"})
            order = {
                "no": order_no,
                "createdAt": now_iso(),
                "status": "pending",
                "method": method,
                "items": lines,
                "total": round(sum(l["price"] * l["qty"] for l in lines), 2),
                "name": name,
                "phone": phone,
                "address": address,
            }
            orders.insert(0, order)
            write_json(ORDERS_FILE, orders)
        self.send_json(200, {"ok": True, "no": order_no, "total": order["total"]})

    def update_order(self, order_no):
        body = self.read_body(MAX_SMALL_BODY)
        if body is None:
            return
        action = body.get("action")
        with data_lock:
            orders = read_json(ORDERS_FILE, [])
            order = next((o for o in orders if o.get("no") == order_no), None)
            if not order:
                return self.send_json(404, {"error": "没有找到这个订单"})
            if action == "confirm" and order["status"] == "pending":
                order["status"] = "paid"
                order["paidAt"] = now_iso()
            elif action == "ship" and order["status"] == "paid":
                tracking = clean_text(body.get("trackingNo"), 40)
                if not tracking:
                    return self.send_json(400, {"error": "请填写快递单号"})
                order["status"] = "shipped"
                order["trackingNo"] = tracking
                order["shippedAt"] = now_iso()
            else:
                return self.send_json(409, {"error": "订单状态已变化，请刷新"})
            write_json(ORDERS_FILE, orders)
        self.send_json(200, order)


if __name__ == "__main__":
    if not os.path.isdir(ADMIN_DIR):
        sys.exit(f"找不到后台目录：{ADMIN_DIR}")
    migrate_inline_images()
    server = ThreadingHTTPServer((HOST, PORT), partial(ShopHandler))
    print(f"前台：http://127.0.0.1:{PORT}/index.html")
    print(f"后台：http://127.0.0.1:{PORT}/admin/#/orders")
    server.serve_forever()
