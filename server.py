import hashlib
import hmac
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


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def clean_text(value, limit):
    return str(value or "").strip()[:limit]


class ShopHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        request_path = posixpath.normpath(unquote(urlsplit(path).path))
        if request_path == "/admin":
            request_path = "/admin/"

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

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        # 启动它的终端关掉后 stderr 会失效，写日志失败不能拖垮请求
        try:
            super().log_message(format, *args)
        except (OSError, ValueError):
            pass

    # ---- helpers ----

    def route(self):
        return urlsplit(self.path).path

    def send_json(self, status, body, cookie=None):
        payload = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
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
            write_json(DATA_FILE, products)
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
            if not os.path.exists(DATA_FILE):
                return self.send_json(404, "null")
            with open(DATA_FILE, encoding="utf-8") as file:
                body = file.read()
        self.send_json(200, body)

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
    server = ThreadingHTTPServer((HOST, PORT), partial(ShopHandler))
    print(f"前台：http://127.0.0.1:{PORT}/index.html")
    print(f"后台：http://127.0.0.1:{PORT}/admin/#/orders")
    server.serve_forever()
