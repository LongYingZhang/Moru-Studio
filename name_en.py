"""商品中文名 → 卡片英文名（nameEn 全大写 / detailEn 首字母大写）。

先按商品词表做最长匹配；词表没有的中文再走在线翻译，失败就略过。
"""

import json
import re
import urllib.parse
import urllib.request

PLACEHOLDER_EN = "LONGYING OBJECT"
PLACEHOLDER_DETAIL = "Longying object"

# 长词放前面不影响结果：匹配时按长度从长到短取
GLOSSARY = {
    # 服装
    "短袖T恤": "short sleeve tee", "短袖t恤": "short sleeve tee", "长袖T恤": "long sleeve tee",
    "长袖t恤": "long sleeve tee", "T恤": "tee", "t恤": "tee", "短袖": "short sleeve tee",
    "长袖": "long sleeve tee", "连帽卫衣": "hoodie", "卫衣": "sweatshirt", "帽衫": "hoodie",
    "外套": "jacket", "夹克": "jacket", "衬衫": "shirt", "背心": "tank top", "马甲": "vest",
    "毛衣": "sweater", "针织衫": "knit", "短裤": "shorts", "长裤": "pants", "裤子": "pants",
    "裙子": "skirt", "连衣裙": "dress", "袜子": "socks", "围巾": "scarf", "手套": "gloves",
    "童装": "kids wear", "夏装": "summer", "冬装": "winter", "春装": "spring", "秋装": "autumn",
    # 帽子 / 包
    "帆布帽": "canvas cap", "棒球帽": "baseball cap", "鸭舌帽": "cap", "渔夫帽": "bucket hat",
    "针织帽": "beanie", "毛线帽": "beanie", "帽子": "cap", "帽": "cap",
    "帆布袋": "canvas bag", "帆布包": "canvas bag", "托特包": "tote bag", "斜挎包": "crossbody bag",
    "双肩包": "backpack", "背包": "backpack", "零钱包": "coin purse", "钱包": "wallet",
    "收纳袋": "pouch", "化妆包": "pouch", "包": "bag", "袋": "bag",
    # 杯具 / 家居
    "马克杯": "mug", "保温杯": "thermos", "玻璃杯": "glass", "水杯": "cup", "杯子": "cup",
    "杯垫": "coaster", "杯": "cup", "香片": "sachet", "香包": "sachet", "香薰": "aroma",
    "蜡烛": "candle", "抱枕": "pillow", "毯子": "blanket", "毛巾": "towel", "镜子": "mirror",
    "雨伞": "umbrella", "伞": "umbrella", "摆件": "figurine", "雕塑": "sculpture",
    "玩偶": "plush", "毛绒": "plush", "公仔": "figure", "手机壳": "phone case",
    # 纸品 / 文具
    "雪梨纸": "tissue paper", "包装纸": "wrapping paper", "明信片": "postcard", "海报": "poster",
    "冰箱贴": "fridge magnet", "徽章": "badge", "胸针": "pin", "贴纸": "sticker", "和纸胶带": "washi tape", "胶带": "tape", "笔记本": "notebook",
    "本子": "notebook", "书签": "bookmark", "卡片": "card", "印章": "stamp", "画册": "art book",
    "日历": "calendar", "纸": "paper",
    # 配饰
    "钥匙扣": "keychain", "挂件": "charm", "徽章": "badge", "胸针": "pin", "项链": "necklace",
    "手链": "bracelet", "戒指": "ring", "耳环": "earrings", "耳钉": "earrings",
    "发夹": "hair clip", "发圈": "scrunchie", "帆布鞋": "canvas shoes", "鞋": "shoes",
    # 修饰词
    "限定": "limited", "限量": "limited", "联名": "collab", "新款": "new", "套装": "set",
    "礼盒": "gift box", "周边": "merch", "夏季": "summer", "冬季": "winter",
    "黑色": "black", "白色": "white", "灰色": "grey", "帆布": "canvas", "儿童": "kids",
    "版": "edition",
}
DROP = {"的", "款", "式", "件", "个", "只", "套"}
_KEYS = sorted(GLOSSARY, key=len, reverse=True)
_HAN = re.compile(r"[\u4e00-\u9fff]")


def _online(text):
    query = urllib.parse.urlencode({"q": text, "langpair": "zh-CN|en"})
    try:
        with urllib.request.urlopen(
            "https://api.mymemory.translated.net/get?" + query, timeout=8
        ) as resp:
            data = json.load(resp)
        out = str(data.get("responseData", {}).get("translatedText") or "").strip()
    except (OSError, ValueError):
        return ""
    if not out or _HAN.search(out) or "MYMEMORY" in out.upper():
        return ""
    return re.sub(r"[^A-Za-z0-9 '&-]+", " ", out).strip().lower()


def translate(name):
    """返回 (nameEn, detailEn)；完全译不出来时返回占位。"""
    words = []
    pending = ""

    def flush():
        nonlocal pending
        if pending:
            guess = _online(pending)
            if guess:
                words.append(guess)
            pending = ""

    text = str(name or "").strip()
    i = 0
    while i < len(text):
        ch = text[i]
        if not _HAN.match(ch):
            flush()
            m = re.match(r"[A-Za-z0-9][A-Za-z0-9'&.-]*", text[i:])
            if m:
                words.append(m.group(0).lower())
                i += len(m.group(0))
            else:
                i += 1
            continue
        hit = next((k for k in _KEYS if text.startswith(k, i)), None)
        if hit:
            flush()
            words.append(GLOSSARY[hit])
            i += len(hit)
        else:
            if ch not in DROP:
                pending += ch
            else:
                flush()
            i += 1
    flush()

    seen = []
    for word in " ".join(words).split():
        if not seen or seen[-1] != word:
            seen.append(word)
    if not seen:
        return PLACEHOLDER_EN, PLACEHOLDER_DETAIL
    phrase = " ".join(seen)
    return phrase.upper(), phrase[:1].upper() + phrase[1:]


def apply(products, previous=None):
    """给新商品 / 改了名字 / 还是占位英文名的商品补上英文名，原地修改。"""
    before = {}
    for item in previous or []:
        if isinstance(item, dict) and "id" in item:
            before[item["id"]] = item
    changed = False
    for product in products:
        if not isinstance(product, dict):
            continue
        name = str(product.get("name") or "").strip()
        if not name:
            continue
        old = before.get(product.get("id"))
        renamed = old is not None and str(old.get("name") or "").strip() != name
        stale_auto = product.get("nameEnSource") not in (None, name)
        placeholder = (product.get("nameEn") or PLACEHOLDER_EN) == PLACEHOLDER_EN
        if not (renamed or stale_auto or placeholder):
            continue
        name_en, detail_en = translate(name)
        if name_en == PLACEHOLDER_EN and not placeholder:
            continue
        product["nameEn"] = name_en
        product["detailEn"] = detail_en
        product["nameEnSource"] = name
        changed = True
    return changed
