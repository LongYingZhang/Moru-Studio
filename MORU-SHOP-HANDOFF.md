# Moru 商店交接（2026-10-16）

给下一个 agent。用户是张珑瀛。回复用中文。磁盘文件名用英文（字母、数字、连字符），不要用中文文件名。

仓库：`/Users/zhanglongyingdemacbookairm4/Sites/LONGYING STUDIO`  
GitHub：`LongYingZhang/LONGYING-STUDIO`，分支 `main`（交接时最新提交 `e42746e`）。  
公网：https://longying-studio.pages.dev/（Cloudflare Pages 项目 `longying-studio`）。

作品集是另一个仓库：`/Users/zhanglongyingdemacbookairm4/Documents/Cursor/LONGYING PORTFOLIO`，GitHub `LongYingZhang/protflio`，线上 https://zhanglongying.pages.dev。不要把两个仓库的分支混在一起。

## 两台电脑

- **M4**（这台）：改代码、提交、推送、部署 Cloudflare。
- **2015**：真正跑店铺的机器。常见地址 `192.168.1.8:8787`，命令是 `python3 server.py`。DeepSeek 密钥只在 2015 的 `.env` 里（`HOST=0.0.0.0`、`PORT=8787`、`OPENAI_BASE_URL=https://api.deepseek.com/v1`、`MORU_MODEL=deepseek-chat`）。`.env` 不入库。不要把密钥写进代码或聊天。用户曾经把密钥贴进过聊天，已提醒轮换。
- **不要在 M4 上开或测 `127.0.0.1:8787`。** M4 连不上 2015 的 SSH / SMB。用户自己在 2015 上 `git pull origin main`。改了 `server.py` 要额外提醒重启服务。只改了 `admin/` 的 HTML/CSS/JS，pull 后刷新即可。
- Cloudflare **不部署 `admin/`**。后台只在 2015 上。公网 Functions 在 `functions/api/`。
- **不要部署到 Netlify。**
- 用户要求改完**自动**提交并推远程，不要再等一句「推上去」。英文提交说明 → `git push origin HEAD`。动到公网页或 `functions/` 时再部署 Cloudflare：`NPM_CONFIG_CACHE="$HOME/.npm" script -q /dev/null bash scripts/deploy-cloudflare.sh`（完整权限；沙箱里的 npm 缓存会缺 workerd）。只改了 `admin/` 不用部署。`wrangler.toml` 里有 KV，部署必须走这个脚本（它会生成 `.cf-stage`，这个目录是临时的，可以删）。

## 现在的品牌（以代码为准，不要信过期备忘）

- 主屏幕名字：店铺 **Moru Studio**，后台 **Studio Admin**（`apple-mobile-web-app-title` + webmanifest）。后台页头文字也是 STUDIO ADMIN。
- 主屏幕图标和网址栏图标：用户给的 `STUDIO ADMIN.png`（黑底灰 Moru），店铺和后台共用 `favicon.png`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png`。链接带 `?v=7`。iPhone 会缓存旧图标，要删掉主屏幕图标再重新添加。
- 店铺页头字标：`ZHANGLONGYING__STUDIO_7.svg`，读作 MORU STUDIO。页面里不要改回「LONGYING STUDIO」。
- 后台页头是 `admin/assets/wordmark-studio-admin.svg`（灰字 STUDIO ADMIN）。没有「退出登录」。
- 横屏顶栏一行：左字标、中导航、右「查看前台」。
- 竖屏顶栏两行：第一行左字标、右「查看前台」；第二行导航四个入口平均铺开（订单管理、在售商品、访问监控、上新商品）。
- 订单空状态（「暂无待确认收款订单」等）：**不要黑色底块**，文字在页面上居中。横竖一样。样式在 `admin/styles.css` 的 `.orders-page .empty-state`。

## 访问监控（真实数据，只计公网）

- 后台 `#/traffic`。数据在 Cloudflare KV，binding 名 `TRAFFIC`，id 在 `wrangler.toml`。
- `POST /api/traffic/hit`、`GET /api/traffic?range=7|30|all`。实现：`functions/_traffic.js`、`functions/api/traffic.js`、`functions/api/traffic/hit.js`。
- 前台 `shop.js` 只在公网 https（含 `longying-studio.pages.dev` 和临时隧道）打点，请求发到 `https://longying-studio.pages.dev/api/traffic/hit`。本机、localhost、局域网、私网 IP **不计**。访客 id 在 localStorage `ly-traffic-sid`，约 60 秒心跳；在线 = 5 分钟内活跃。
- 后台 `admin/app.js` 直接请求 `https://longying-studio.pages.dev/api/traffic`，不经过 2015。
- 2015 的 `server.py` 收到打点会故意不保存。从公网部署成功那天起才有数，没有更早的历史。
- 改统计逻辑必须重新部署 Cloudflare，只 git pull 不够。

## 后台其它行为

- 在售商品：长按约 380ms 可拖动排序（鼠标和触屏）。移动超过 8px 当成滚动，取消拖动。松手后重排 `NO. 01…`。前台按数组顺序展示。
- 封面：`shop.js` 的 `normalizeProduct` 只在 `cardImage` 为空或等于预设图时才套预设卡面。后台改过的封面不要被盖掉。
- 首页第一张卡片是作品集链接，打开 https://zhanglongying.pages.dev。
- `admin/data/` 不入库（订单、商品、登录）。公网商品目录由部署脚本从 `admin/data/products.json` 复制出去。

## Moru 悬浮助手（摘要）

详细行为在本机 `.cursor/CHAT-MEMORY.md`（已 gitignore，别的电脑没有这份）。代码以 `moru.js`、`moru.css`、`server.py`、`functions/api/moru/chat.js` 为准。

- 聊天框只显示当前这一条回答，不用气泡，高度最多约 8 行。悬浮球永远盖在加载动画上面。
- 2015 走 DeepSeek 流式接口。Cloudflare 没配大模型密钥，走本地关键词回答。两边的页面操作规则要保持一致。
- 能做的事：打开商品、加购、去结算、清空购物袋、改数量、选支付、翻图、打开作品集、打开最近订单。意思明确的操作前端直接做，不必先问模型。
- 接管过程中用户自己点走，就退出接管。停止后停在当前页，并显示「已终止任务」。
- 改 `moru.js` / `moru.css` 时，同步把各 HTML 里的 `?v=` 版本号加大，否则浏览器继续用旧文件。

## 加载与手机

- 加载动画是黑底细进度条（`.boot`）。开屏 splash 图不要改掉。
- 竖屏没有下拉刷新。底部黑条固定不动。

## 不要再做的事

- 不要在 M4 上把 `127.0.0.1:8787` 当验证环境。
- 不要把后台部署进 Cloudflare。
- 不要提交 `.env`、`admin/data/`、`.cursor/`、`.cf-stage/`。
- 根目录曾经有的 `0.svg`–`4.svg`、转视频临时目录、未引用的 `logo-moru.svg` 已删。部署临时目录 `.cf-stage` 可以随时删，下次部署会再生。
