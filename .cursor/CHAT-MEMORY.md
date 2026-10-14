# LONGYING STUDIO + Moru — Agent Chat Memory

> 给之后的 agent 看。记录用户（张珑瀛）到 2026-10-14 为止提出、并已实现的功能与约定。
> 页面上的文字可以是中文；**磁盘上的文件名一律英文**（字母、数字、连字符）。
> 回复用户默认用中文。

## 1. 机器、仓库、部署

| 项目 | 本地路径（M4） | GitHub | 线上 |
|------|----------------|--------|------|
| 店铺 STUDIO | `/Users/zhanglongyingdemacbookairm4/Sites/LONGYING STUDIO` | `LongYingZhang/LONGYING-STUDIO`（main） | CF Pages `longying-studio` → https://longying-studio.pages.dev/ |
| 作品集 PORTFOLIO | `/Users/zhanglongyingdemacbookairm4/Documents/Cursor/LONGYING PORTFOLIO` | `LongYingZhang/protflio` | CF Pages → https://zhanglongying.pages.dev |

- 开发机：MacBook Air **M4**。真正的店铺服务器：MacBook Air **2015**（局域网常见 `192.168.1.8:8787`，跑 `python3 server.py`，用 DeepSeek）。
- **从 2026-10-14 起：不要再开、不要再测 M4 本机网站（`127.0.0.1:8787`）**。代码仍在 M4 上编辑、提交、推送、部署 Cloudflare；真机验证以 2015 为准。
- **每次店铺改完都要提醒用户：在 2015 上 `git pull origin main`**（改了 `server.py` 还要重启服务）。用户选择继续手动 pull，不启用 SSH。M4 无法 SSH / SMB 到 2015。
- 2015 的 `.env`：`HOST=0.0.0.0`、`PORT=8787`、`OPENAI_API_KEY=<DeepSeek>`、`OPENAI_BASE_URL=https://api.deepseek.com/v1`、`MORU_MODEL=deepseek-chat`。`.env` 不入库。
- **CF 线上没有配大模型密钥**，`functions/api/moru/chat.js` 走本地关键词大脑 `localMoruReply`。
- 用户曾在聊天里贴过 DeepSeek 密钥，已建议轮换。永远不要把密钥写进提交、前端 JS 或聊天。

### 每轮改动后的固定流程
1. 店铺仓库：`git add <改动文件>` → 简短英文提交说明 → `git push origin HEAD`。不要提交 `.env`、`.env.example` 的本地改动、`.cursor/`。
2. 店铺部署：`bash scripts/deploy-cloudflare.sh`（需要网络）。自动审核会拦截，第一次被拒后用 `request_smart_mode_approval: true` 和原样的拦截原因重试。
   - 部署脚本**排除 `admin/`**，后台只在 2015 上生效（靠 git pull）。
3. 作品集仓库：改了内容就 commit + push + `bash scripts/deploy-cloudflare.sh`。
4. **永远不要部署到 Netlify。**
5. 改了 `moru.js` / `moru.css` 要**同步升级各页面的 `?v=` 版本号**（`index/product/cart/checkout/order.html`），否则电脑浏览器会用缓存旧版。当前 `v=20261014h`。

## 2. 加载动画
- 作品集和店铺的所有加载动画，统一成**黑底细进度条**（`.boot` / `.boot-bar`）。**开屏页（splash）保持不变**。
- 店铺 `.boot` 的 z-index 是 9999；从 bfcache 返回时 `pageshow` 会清掉卡住的 boot。

## 3. 商品与后台
- 后台改的封面要同步到前台卡片：`shop.js` 的 `normalizeProduct` 只在 `cardImage` 为空或等于预设图时才套预设卡面。
- **后台「在售商品」长按拖动排序**（`admin/app.js` + `admin/styles.css`）：
  - 按住卡片约 380ms 后浮起即可拖动；鼠标、触屏都能用。按住期间移动超过 8px 视为滚动，取消拖动。
  - 拖到屏幕边缘会自动滚动；其他卡片用 FLIP 动画让位。
  - 松手后保存新顺序，并把 `no` 重新编号为 `NO. 01…`；前台按数组顺序展示。
- 前台首页第一张是「设计师作品集」链接卡片（`a.card[href*="zhanglongying"]`，打开 https://zhanglongying.pages.dev）。

## 4. 手机竖屏：下拉刷新与底部
- 竖屏下拉：**只有商品列表**被拉下；空隙正中有一个圆形箭头图标，随下拉同步转动，颜色较深（`#6a6a6a`）。松手回弹并整页刷新（`shop.js` 的 `bindPullToRefresh`，`.pull-refresh`）。
- 隐私政策条和底部黑条**永远固定在底部**，不随下拉移动：`.rail-dock` 固定、纯黑、无圆角，包住 `.rail-foot`。
- 卡片底部的圆角落在平的黑色底座上（圆角来自卡片本身，不来自底座）。

## 5. Moru 悬浮助手

文件：`moru.js`、`moru.css`、`assets/moru/`（`orb.mp4`、`orb-thinking.mp4`、`chat-open.svg`、`chat-thinking.svg`）、`server.py`（`/api/moru/chat`，SSE 流式）、`functions/api/moru/chat.js`（CF 版）。

### 基本界面规则
- 聊天框**只显示当前这一条回答**，新回答替换旧回答；不显示用户的话，不用气泡。
- 高度跟着回答长度变，最多 8 行。
- 悬浮球（root）的 z-index 是 10001，展开时 10002，**永远盖在加载动画之上**。
- 手机上聊天框宽 `min(280px, 100vw-20px)`。气泡本身铺 `#1a1a1a` 底色，避免 SVG 等比缩放后底部露白条。

### 状态
- **正常态有两段动画交替播放**：`orb.mp4`（A）和 `orb-idle-2.mp4`（B，由用户的 MOV 用 `avconvert` 转成 H.264）。两段都不循环，`ended` 时切换，用 root 的 `is-idle-b` 类控制显示哪段。思考态时两段都暂停。M4 上没有 ffmpeg，转视频用 `avconvert --preset Preset1280x720`。
- 普通态 → **思考态**（`is-thinking`：思考视频 +「正在思考中」）→ 回答。
- **接管态**（`is-takeover`，同时带 `is-thinking`）：Moru 操作网站时，文字显示「正在接管LONGYING-STUDIO...」，聊天框四周有**会呼吸的白色光晕**（`moru-takeover-breathe`，不要 1px 白边）。
- **下命令时：思考态直接切到接管态，中间不显示回答**（`runClientTools` 返回 true 就清空日志，不渲染文字）。没有操作的纯聊天照常显示回答。
- 接管期间页面加载时，接管态也一直在最上层；**任务真正结束后**才退出接管，并显示**一句简短总结**（`summarize()`）。
- **接管只存在于 Moru 自己打开的页面**：sessionStorage `ly-moru-takeover` = `{t, summary, remaining[], last, sealed}`。用户离开 Moru 路线（手动返回、点别处、点回首页）就立刻回到普通态并封存（`sealed`）。
  - 同一页的 `load` 和 `pageshow` 会各进一次 `resumeTakeover`：在最后一页（`remaining` 为空且 `last === here`）时保持接管，不要误判成用户离开。
  - 详情页 → 结算页的中间跳转期间不能封存。

### 停止按钮
- 思考态、接管态时，发送箭头换成**白色圆形里带圆角的方块**（只能有一个圆，SVG 自带的发送圆已删除）。
- 点击后：停止思考（中断请求），或终止接管——**停在当前页**，取消待执行的跳转和购买计时器，聊天框**立刻**显示「**已终止任务**」，不能变回初始问候。
- 相关标志：`ly-moru-stopped`、`window.__moruStopped`、`window.__moruBuyTimer`、`ly-moru-last-reply`；钩子：`window.__moruAbortTakeover`。

### Moru 能做的操作（TOOL）
大模型在回复末尾输出 `TOOL [...]`；本地大脑用关键词判断。
- `buyAndCheckout(id, qty)`：打开 `product.html?id=…&moruBuy=1` → 750ms 后自动去结算页 → 结算页才算结束。（之前在详情页停住的 bug 已修。）
- `addToCart(id, qty)`、`openCart`、`openCheckout`、`openTerms`、`openHome`、`openProduct(id)`。
- `openPortfolio`：打开「珑瀛的作品集」。
  - 当前页有作品集卡片：接管态下滚动到卡片 → 卡片做「按下」效果（`.card.is-moru-press`）→ 打开作品集。
  - 不在首页：先跳 `index.html?moruOpen=portfolio`，再点卡片。
  - 优先开新标签；被浏览器拦截就在当前页打开。
  - 兜底：用户话里有「作品集/珑瀛/portfolio」加上「打开/看/去/带…」，但大模型没出 TOOL 时，前端自动补 `openPortfolio`。

- `openOrder`：打开最近订单页（订单只存在本机 localStorage，没有按单号查询的公开接口；发货状态不要编造）。
- **页面内操作**（`PAGE_ACTIONS`，`runPageAction` 真的去按页面按钮，按之前亮一下 `.is-moru-press`）：
  - `showPhoto {dir, steps, id?}`：详情页点左右箭头；首页在全屏画册里切换。只有一张图时回答「只有一张图」。
  - `openGallery {id?}`：首页先点对应卡片，再打开全屏画册。
  - `setCartQty {id, qty}`（逐次点 +/−，0 = 删除）、`removeCartItem {id}`、`clearCart`：在购物袋页操作。
  - `choosePayment {method: wechat|alipay}`：在结算页点支付方式。购物袋为空时不跳转，直接说明。
  - `scrollPage {dir: down|up|top|bottom}`：滚动 `#cards` / `.page` / `main` 或整页。
  - `refreshPage`、`goBack`：先收尾、封存总结，再刷新或返回，落地后显示总结。
  - 不在目标页时：sessionStorage `ly-moru-pending` = `{page, tool}`，先跳页，`resumeTakeover` 到最后一页时再执行；`sealTakeover` 会清掉它。
- 推荐（预算、送人）和对比：大模型按商品目录回答并 `openProduct`；本地大脑选预算内最贵的一件。
- `pageContext` 会带上 `cart`、`cartTotal`、`lastOrder`、`productId`，供回答总价和订单问题。
- **前端直通口令**（`moru.js` 的 `localIntent`）：清空、删除、改数量、选支付、刷新、返回、滚动、画册、翻图这类意思明确的命令，不请求 `/api/moru/chat`，思考 450ms 后直接接管执行。原因：2015 的 DeepSeek 曾经推脱说「不能清空」（当时 `server.py` 没重启，用的是旧提示词）。
- 本地关键词大脑：`functions/api/moru/chat.js` 的 `pageActionReply`，以及 `server.py` 的 `page_action_reply`，两边规则保持一致。

### 语气与限流
- 俏皮、简短、中文；有手，不推脱「不能下单」。被问到创造者时才说：产品设计师 ZHANGLONGYING。
- `server.py` 限流（只针对 `/api/moru/chat`）：全站每日 token、单条输入过长、每 IP 5 分钟 5 次后冷却 10 分钟、每 IP 每日 token；超限返回 JSON 429 `{message}`，前端显示 message。

## 6. 文件速查
```
LONGYING STUDIO/
  index.html product.html cart.html checkout.html order.html terms.html
  shop.js shop.css            # 店铺逻辑、下拉刷新、navigate、boot
  moru.js moru.css            # Moru 全部逻辑和样式
  assets/moru/                # 悬浮球视频 + 聊天框 SVG
  server.py                   # 2015 用：商品/订单/登录/Moru/访问统计/限流
  functions/api/              # CF 版：products.js、moru/chat.js、traffic/hit.js
  admin/                      # 后台（不部署到 CF）；admin/data/ 不入库
  scripts/deploy-cloudflare.sh
```

## Brand / home-screen labels (2026-10-14)
- **In-page UI names stay** LONGYING STUDIO / 后台 BACKEND / ZHANGLONGYING. Do not rename on-page headers to Moru.
- **Home-screen labels only:** shop `apple-mobile-web-app-title` + `site.webmanifest` → **Moru Studio**; admin → **Moru Admin**.
- App icons/favicons: shop+admin use portfolio's solid-white Moru; portfolio uses admin's outline Moru. Portfolio in-page header logos stay the original filled/outline duo.

## Admin traffic monitor (2026-10-14)
- Nav **访问监控** (`#/traffic`): KPI + 7 日柱 + 设备/热门页。
- **只统计 Cloudflare 公网**；本机 / 局域网 / 私网 IP **不计**。
- 存储：CF KV binding `TRAFFIC`（id 在 `wrangler.toml`）。`POST /api/traffic/hit`、`GET /api/traffic?range=7|30|all`（CORS `*`）。
- 前台 `shop.js`：仅在 `longying-studio.pages.dev`（及预览子域）或其它 https 公网域名打点；`ly-traffic-sid` + 约 60s 心跳。
- 后台 `admin/app.js` 直连 `https://longying-studio.pages.dev/api/traffic`（不经 2015）。
- 2015 `server.py` 的 hit 故意不落盘。Admin 仍只在 2015：git push 后用户 pull；**改 Functions/KV 必须 CF deploy**。
