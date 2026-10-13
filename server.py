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
from urllib import error as urllib_error
from urllib import request as urllib_request

import name_en

SHOP_DIR = os.path.dirname(os.path.abspath(__file__))
ADMIN_DIR = os.path.join(SHOP_DIR, "admin")
DATA_DIR = os.path.join(ADMIN_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "products.json")
ORDERS_FILE = os.path.join(DATA_DIR, "orders.json")
AUTH_FILE = os.path.join(DATA_DIR, "auth.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
ENV_FILE = os.path.join(SHOP_DIR, ".env")
PORT = int(os.environ.get("PORT", "8787"))
HOST = os.environ.get("HOST", "127.0.0.1")
MAX_BODY = 50 * 1024 * 1024
MAX_SMALL_BODY = 64 * 1024
API_PATH = "/api/products"
MORU_CHAT_PATH = "/api/moru/chat"

# ---- Moru 限流（内存；重启清零；每日 0 点按自然日清空）----
MORU_GLOBAL_TOKEN_DAY = 150_000
MORU_IP_TOKEN_DAY = 60_000
MORU_INPUT_CHAR_MAX = 1200
MORU_ASK_WINDOW_SEC = 5 * 60
MORU_ASK_LIMIT = 5
MORU_COOLDOWN_SEC = 10 * 60

MORU_MSG_GLOBAL = "Moru今天电量已经耗尽啦，明天再来唠吧！"
MORU_MSG_TOO_LONG = "文字太长扛不住咯，精简一小段再问我吧"
MORU_MSG_COOLDOWN = "Moru摸鱼休息10分钟，稍后再来找我哦"
MORU_MSG_IP_QUOTA = "你的今日额度用光咯，明天继续调戏Moru吧"


class MoruRateLimit:
    """按 IP 的内存限流；命中则不调用 DeepSeek。"""

    def __init__(self):
        self.lock = threading.Lock()
        self.day = None
        self.global_tokens = 0
        self.ip_tokens = {}       # ip -> int
        self.ip_asks = {}         # ip -> [timestamps]
        self.ip_cooldown_until = {}  # ip -> unix ts

    def _roll_day(self):
        today = datetime.now().astimezone().date().isoformat()
        if self.day != today:
            self.day = today
            self.global_tokens = 0
            self.ip_tokens.clear()
            self.ip_asks.clear()
            self.ip_cooldown_until.clear()

    def check(self, ip, user_text):
        """按优先级返回拦截文案；通过则返回 None。"""
        now = time.time()
        with self.lock:
            self._roll_day()
            if self.global_tokens >= MORU_GLOBAL_TOKEN_DAY:
                return MORU_MSG_GLOBAL
            if len(user_text or "") > MORU_INPUT_CHAR_MAX:
                return MORU_MSG_TOO_LONG
            until = self.ip_cooldown_until.get(ip) or 0
            if until > now:
                return MORU_MSG_COOLDOWN
            window = [t for t in self.ip_asks.get(ip, []) if now - t <= MORU_ASK_WINDOW_SEC]
            self.ip_asks[ip] = window
            if len(window) >= MORU_ASK_LIMIT:
                self.ip_cooldown_until[ip] = now + MORU_COOLDOWN_SEC
                return MORU_MSG_COOLDOWN
            if self.ip_tokens.get(ip, 0) >= MORU_IP_TOKEN_DAY:
                return MORU_MSG_IP_QUOTA
            return None

    def record_ask(self, ip):
        now = time.time()
        with self.lock:
            self._roll_day()
            window = [t for t in self.ip_asks.get(ip, []) if now - t <= MORU_ASK_WINDOW_SEC]
            window.append(now)
            self.ip_asks[ip] = window
            if len(window) >= MORU_ASK_LIMIT:
                self.ip_cooldown_until[ip] = now + MORU_COOLDOWN_SEC

    def add_tokens(self, ip, total_tokens):
        n = max(0, int(total_tokens or 0))
        if n <= 0:
            return
        with self.lock:
            self._roll_day()
            self.global_tokens += n
            self.ip_tokens[ip] = self.ip_tokens.get(ip, 0) + n


moru_rate_limit = MoruRateLimit()


def load_dotenv(path=ENV_FILE):
    """Load KEY=VALUE pairs from .env into os.environ (does not overwrite)."""
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as file:
            for raw in file:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'").strip('"')
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


load_dotenv()
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
# 开屏图直接嵌进 HTML，页面一到就能画出来，不用再等一次图片请求
INLINE_SPLASH = re.compile(rb'url\("((?:\.\./)?assets/splash/[\w-]+\.webp)"\)')


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

    def inline(match):
        nonlocal latest
        target = os.path.normpath(os.path.join(base_dir, match.group(1).decode()))
        if not target.startswith(SHOP_DIR + os.sep) or not os.path.isfile(target):
            return match.group(0)
        latest = max(latest, int(os.stat(target).st_mtime))
        with open(target, "rb") as file:
            data = base64.b64encode(file.read())
        return b'url("data:image/webp;base64,%s")' % data

    html = INLINE_SPLASH.sub(inline, html)
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


def fill_english_names():
    products = read_json(DATA_FILE, None)
    if not isinstance(products, list):
        return
    if name_en.apply(products):
        write_json(DATA_FILE, products)
        print("已为商品补上英文名")


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def clean_text(value, limit):
    return str(value or "").strip()[:limit]


def catalog_snapshot():
    with data_lock:
        products = read_json(DATA_FILE, [])
    if not isinstance(products, list):
        return []
    rows = []
    for product in products:
        if not isinstance(product, dict):
            continue
        if product.get("status") and product.get("status") != "active":
            continue
        rows.append({
            "id": product.get("id"),
            "no": product.get("no") or "",
            "name": product.get("name") or "",
            "nameEn": product.get("nameEn") or "",
            "price": product.get("price"),
            "desc": product.get("desc") or "",
            "dimension": product.get("dimension") or product.get("dimensions") or "",
            "material": product.get("material") or "",
        })
    return rows


def moru_system_prompt(page_context=None):
    catalog = catalog_snapshot()
    lines = [
        "你是 Moru，LONGYING STUDIO 商店的吉祥物与前台助手。",
        "说话简短、亲切、口语化，默认中文。不知道就诚实说不知道。",
        "你可以介绍在售商品、价格、下单流程、运费与售后、隐私政策。",
        "店铺规则：中国大陆订单免运费；支持微信/支付宝扫码付款；确认收款后现货一般 3 个工作日内发货；签收 7 天内质量问题可联系售后。",
        "若用户明确要去购物袋/结算/须知/某商品详情，可在回答末尾单独一行输出工具指令（不要解释这行）：",
        'TOOL [{"name":"openCart"}] 或 TOOL [{"name":"openCheckout"}] 或 TOOL [{"name":"openTerms"}] 或 TOOL [{"name":"openHome"}] 或 TOOL [{"name":"openProduct","args":{"id":数字}}]',
        "没有必要时不要输出 TOOL 行。",
        "当前在售商品：",
        json.dumps(catalog, ensure_ascii=False),
    ]
    if page_context and isinstance(page_context, dict):
        lines.append("用户当前页面：" + json.dumps(page_context, ensure_ascii=False))
    return "\n".join(lines)


def local_moru_reply(user_text, page_context=None):
    """Offline shop brain when no LLM API key is configured."""
    text = (user_text or "").strip()
    low = text.lower()
    catalog = catalog_snapshot()
    tools = []

    def product_blurb(product):
        price = product.get("price")
        price_s = f"¥{price:g}" if isinstance(price, (int, float)) else "价格见页面"
        bits = [f"{product.get('no') or ''} {product.get('name') or ''}".strip(), price_s]
        if product.get("desc"):
            bits.append(product["desc"])
        return " · ".join(bits)

    if any(k in text for k in ("购物袋", "购物车", "去买", "结算")) or "cart" in low:
        tools.append({"name": "openCart"})
        return "好，带你去购物袋看看～", tools
    if any(k in text for k in ("隐私", "须知", "退换", "售后政策")):
        tools.append({"name": "openTerms"})
        return "购物须知和隐私政策在这里，我帮你打开。", tools
    if any(k in text for k in ("运费", "快递", "包邮", "邮费")):
        return "中国大陆订单目前免运费。发货后会有快递单号，可以联系我们查物流。", tools
    if any(k in text for k in ("付款", "支付", "下单", "怎么买", "购买")):
        return "挑好商品加入购物袋 → 去结算 → 选微信或支付宝扫码付款 → 点「我已支付」提交订单。我们人工核对到账后会安排发货。", tools
    if any(k in text for k in ("你好", "嗨", "在吗", "hello", "hi")):
        return "嗨，我是 Moru～想看商品、问运费，或让我带你去购物袋，都可以说。", tools

    matched = []
    for product in catalog:
        hay = " ".join([
            str(product.get("name") or ""),
            str(product.get("nameEn") or ""),
            str(product.get("desc") or ""),
            str(product.get("no") or ""),
        ]).lower()
        if any(token and token in hay for token in re.split(r"\s+", low) if len(token) >= 2):
            matched.append(product)
        elif any(k in text for k in ("香片", "帆布袋", "马克杯", "帆布帽", "雪梨纸", "作品集")):
            name = product.get("name") or ""
            if ("香片" in text and "香片" in name) or ("帆布袋" in text and "帆布袋" in name) \
                    or ("马克杯" in text and "马克杯" in name) or ("帆布帽" in text and "帆布帽" in name) \
                    or ("雪梨纸" in text and "雪梨纸" in name) or ("作品集" in text and "作品集" in name):
                matched.append(product)

    # de-dupe
    seen = set()
    uniq = []
    for product in matched:
        key = product.get("id")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(product)

    if uniq:
        if len(uniq) == 1:
            product = uniq[0]
            tools.append({"name": "openProduct", "args": {"id": product.get("id")}})
            return f"找到了：{product_blurb(product)}\n要不要我打开详情页？", tools
        lines = ["这些可能是你要的："] + [f"- {product_blurb(p)}" for p in uniq[:5]]
        return "\n".join(lines), tools

    if any(k in text for k in ("在卖", "有什么", "商品", "清单", "catalog", "产品")):
        if not catalog:
            return "现在橱窗还是空的，等上新了再来找我～", tools
        lines = ["现在在售："] + [f"- {product_blurb(p)}" for p in catalog]
        return "\n".join(lines), tools

    if catalog:
        preview = "、".join((p.get("name") or "未命名") for p in catalog[:3])
        return f"我可以介绍在售商品（比如 {preview}），也可以讲运费、怎么下单。你想问哪一块？", tools
    return "我在～可以问商品、运费或怎么买。", tools


def split_moru_tools(text):
    tools = []
    clean = text or ""
    match = re.search(r"(?m)^TOOL\s+(\[.*\])\s*$", clean)
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                tools = [t for t in parsed if isinstance(t, dict) and t.get("name")]
        except ValueError:
            tools = []
        clean = (clean[: match.start()] + clean[match.end():]).strip()
    return clean, tools


def openai_stream_chat(messages):
    """OpenAI-compatible Chat Completions stream (DeepSeek 等)。"""
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("MORU_API_KEY")
    if not api_key:
        return None
    base = (os.environ.get("OPENAI_BASE_URL") or os.environ.get("MORU_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("MORU_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
    body = json.dumps({
        "model": model,
        "stream": True,
        "temperature": 0.7,
        "messages": messages,
        "stream_options": {"include_usage": True},
    }).encode("utf-8")
    req = urllib_request.Request(
        base + "/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    return urllib_request.urlopen(req, timeout=90)


def estimate_moru_tokens(prompt_text, completion_text):
    """API 未返回 usage 时的粗估（偏中文：约 1 字 ≈ 1 token）。"""
    return max(1, len(prompt_text or "") + len(completion_text or ""))


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
            previous = read_json(DATA_FILE, [])
        name_en.apply(products, previous if isinstance(previous, list) else [])
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
        if path == MORU_CHAT_PATH:
            return self.moru_chat()
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

    # ---- Moru assistant (local floating chat) ----

    def sse_write(self, obj):
        payload = ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode("utf-8")
        self.wfile.write(payload)
        self.wfile.flush()

    def client_ip(self):
        forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
        return self.client_address[0] if self.client_address else "unknown"

    def moru_chat(self):
        body = self.read_body(MAX_SMALL_BODY)
        if body is None:
            return
        raw_messages = body.get("messages") if isinstance(body, dict) else None
        page_context = body.get("pageContext") if isinstance(body, dict) else None
        if not isinstance(raw_messages, list) or not raw_messages:
            return self.send_json(400, {"error": "messages required", "message": "messages required"})

        history = []
        for item in raw_messages[-16:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                history.append({"role": role, "content": content.strip()[:4000]})
        if not history or history[-1]["role"] != "user":
            return self.send_json(400, {
                "error": "last message must be from user",
                "message": "last message must be from user",
            })

        user_text = history[-1]["content"]
        ip = self.client_ip()
        limited = moru_rate_limit.check(ip, user_text)
        if limited:
            # 限流：JSON + message，不调 DeepSeek
            return self.send_json(429, {"message": limited, "error": limited})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        # 通过限流后记一次提问；满 5 次开启 10 分钟冷却
        moru_rate_limit.record_ask(ip)

        try:
            llm_messages = [{"role": "system", "content": moru_system_prompt(page_context)}] + history
            stream = openai_stream_chat(llm_messages)
            if stream is None:
                reply, tools = local_moru_reply(user_text, page_context)
                chunk = 12
                for i in range(0, len(reply), chunk):
                    self.sse_write({"type": "text", "text": reply[i:i + chunk]})
                    time.sleep(0.012)
                if tools:
                    self.sse_write({"type": "tools", "tools": tools})
                self.sse_write({"type": "done"})
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return

            full = []
            usage = None
            with stream:
                while True:
                    line = stream.readline()
                    if not line:
                        break
                    if isinstance(line, bytes):
                        line = line.decode("utf-8", errors="ignore")
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        evt = json.loads(data)
                    except ValueError:
                        continue
                    if isinstance(evt.get("usage"), dict):
                        usage = evt["usage"]
                    delta = (((evt.get("choices") or [{}])[0]).get("delta") or {}).get("content")
                    if delta:
                        full.append(delta)
                        self.sse_write({"type": "text", "text": delta})

            reply_text = "".join(full)
            _clean, tools = split_moru_tools(reply_text)
            if tools:
                self.sse_write({"type": "tools", "tools": tools})
            self.sse_write({"type": "done"})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()

            # DeepSeek 成功后累加本次 input+output token
            if usage:
                total = int(usage.get("total_tokens") or 0)
                if total <= 0:
                    total = int(usage.get("prompt_tokens") or 0) + int(usage.get("completion_tokens") or 0)
            else:
                prompt_blob = "\n".join(m.get("content") or "" for m in llm_messages)
                total = estimate_moru_tokens(prompt_blob, reply_text)
            moru_rate_limit.add_tokens(ip, total)
        except urllib_error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="ignore")[:300]
            try:
                self.sse_write({"type": "error", "error": f"模型接口错误 {err.code}: {detail}"})
            except BrokenPipeError:
                pass
        except Exception as err:
            try:
                self.sse_write({"type": "error", "error": str(err) or "chat failed"})
            except BrokenPipeError:
                pass


if __name__ == "__main__":
    if not os.path.isdir(ADMIN_DIR):
        sys.exit(f"找不到后台目录：{ADMIN_DIR}")
    migrate_inline_images()
    fill_english_names()
    server = ThreadingHTTPServer((HOST, PORT), partial(ShopHandler))
    print(f"前台：http://127.0.0.1:{PORT}/index.html")
    print(f"后台：http://127.0.0.1:{PORT}/admin/#/orders")
    print(f"Moru：本机悬浮助手已启用（/api/moru/chat）")
    server.serve_forever()
