import Cocoa
import WebKit
import Foundation

// Moru Studio desktop wrapper.
//
// A real standalone window: a WKWebView pointed at the bundled copy of the
// site, served from 127.0.0.1 by the built-in SiteServer. No browser chrome,
// no tab bar, its own Dock icon — and no external dependency at all (no
// python3, no bundled runtime).

// 窗口内容视图：给页面顶部留一条「安全区」，
// 让红黄绿三个窗口按钮不再压在站点 logo 上。
// 底色跟站点 body 一样（#131313），所以看起来就是页面自己多了一圈留白，不是一条标题栏。
//
// 注意：这里不用 layout() 回调（窗口首次显示不一定会走那次 layout），
// 改成「显式设一次 frame + autoresizingMask」，这样任何时候都是确定的。
final class InsetHostView: NSView {
    static let pageColor = NSColor(srgbRed: 19.0 / 255.0, green: 19.0 / 255.0, blue: 19.0 / 255.0, alpha: 1)

    private let topInset: CGFloat
    private var web: NSView?

    init(topInset: CGFloat) {
        self.topInset = topInset
        super.init(frame: NSRect(x: 0, y: 0, width: 1280, height: 880))
        wantsLayer = true
        layer?.backgroundColor = InsetHostView.pageColor.cgColor
        autoresizesSubviews = true
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func attach(_ view: NSView) {
        web = view
        addSubview(view)
        // 宽高跟随窗口变化，上下边距固定 → 顶部 32pt 永远留着
        view.autoresizingMask = [.width, .height]
        reposition()
    }

    func reposition() {
        guard let view = web else { return }
        // 非翻转坐标系，y=0 是底部；高度减去 topInset，顶部就空出一条带子
        view.frame = NSRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - topInset))
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    var server: SiteServer?
    var webView: WKWebView?

    func applicationWillFinishLaunching(_ notification: Notification) {
        // 菜单栏必须在 app.run() 之前挂上，否则顶部只有应用名、没有各项菜单
        NSApp.mainMenu = buildMainMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        guard let site = Bundle.main.resourceURL?.appendingPathComponent("site", isDirectory: true),
              FileManager.default.fileExists(atPath: site.path)
        else {
            fatal("App 里找不到打包的站点文件。")
            return
        }

        let server = SiteServer(siteDirectory: site)
        guard let port = server.start() else {
            fatal("无法启动内置本地服务（端口都被占了）。")
            return
        }
        self.server = server

        buildWindow(port: port)
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    /* ---- 菜单栏：跟普通 Mac 应用一样有 编辑 / 显示 / 窗口 / 帮助 ---- */
    private func buildMainMenu() -> NSMenu {
        let name = "Moru Studio"
        let main = NSMenu()

        // 1) 应用菜单（Apple 标志右边那个）
        let appItem = NSMenuItem(title: name, action: nil, keyEquivalent: "")
        main.addItem(appItem)
        let appMenu = NSMenu(title: name)
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 \(name)",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        let servicesItem = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: "服务")
        servicesItem.submenu = servicesMenu
        appMenu.addItem(servicesItem)
        NSApp.servicesMenu = servicesMenu
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(name)",
                        action: #selector(NSApplication.hide(_:)),
                        keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他",
                                         action: #selector(NSApplication.hideOtherApplications(_:)),
                                         keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "显示全部",
                        action: #selector(NSApplication.unhideAllApplications(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(name)",
                        action: #selector(NSApplication.terminate(_:)),
                        keyEquivalent: "q")

        // 2) 编辑：没有这一组，网页里的 ⌘C / ⌘V / ⌘A 是没反应的
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        main.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        editItem.submenu = edit
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // 3) 显示
        let viewItem = NSMenuItem(title: "显示", action: nil, keyEquivalent: "")
        main.addItem(viewItem)
        let view = NSMenu(title: "显示")
        viewItem.submenu = view
        addItem(to: view, title: "重新载入", action: #selector(reloadPage), key: "r")
        view.addItem(.separator())
        addItem(to: view, title: "放大", action: #selector(zoomIn), key: "+")
        addItem(to: view, title: "缩小", action: #selector(zoomOut), key: "-")
        addItem(to: view, title: "实际大小", action: #selector(zoomReset), key: "0")
        view.addItem(.separator())
        let full = view.addItem(withTitle: "进入全屏幕",
                                action: #selector(NSWindow.toggleFullScreen(_:)),
                                keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]

        // 4) 窗口
        let winItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: "")
        main.addItem(winItem)
        let win = NSMenu(title: "窗口")
        winItem.submenu = win
        win.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(.separator())
        win.addItem(withTitle: "前置全部窗口",
                    action: #selector(NSApplication.arrangeInFront(_:)),
                    keyEquivalent: "")
        NSApp.windowsMenu = win

        // 5) 帮助
        let helpItem = NSMenuItem(title: "帮助", action: nil, keyEquivalent: "")
        main.addItem(helpItem)
        let help = NSMenu(title: "帮助")
        helpItem.submenu = help
        addItem(to: help, title: "打开商店网站", action: #selector(openSite), key: "")
        addItem(to: help, title: "检查新版本（打开下载页）", action: #selector(openDownload), key: "")
        NSApp.helpMenu = help

        return main
    }

    @discardableResult
    private func addItem(to menu: NSMenu, title: String, action: Selector, key: String) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc private func reloadPage() { webView?.reload() }
    @objc private func zoomIn() { setZoom((webView?.pageZoom ?? 1) + 0.1) }
    @objc private func zoomOut() { setZoom((webView?.pageZoom ?? 1) - 0.1) }
    @objc private func zoomReset() { setZoom(1.0) }
    private func setZoom(_ value: CGFloat) {
        webView?.pageZoom = min(3.0, max(0.5, value))
    }
    @objc private func openSite() {
        if let url = URL(string: "https://longying-studio.pages.dev") {
            NSWorkspace.shared.open(url)
        }
    }
    @objc private func openDownload() {
        if let url = URL(string: "https://longying-studio.pages.dev/download/Moru-Studio.dmg") {
            NSWorkspace.shared.open(url)
        }
    }

    private func buildWindow(port: UInt16) {
        let webView = WKWebView(frame: .zero)
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 880),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Moru Studio"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = InsetHostView.pageColor
        // 页面本身是深色，窗口用深色外观，红黄绿按钮在深色上更清楚
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = NSSize(width: 720, height: 560)
        let host = InsetHostView(topInset: 32)
        host.attach(webView)
        window.contentView = host
        // contentView 赋值时窗口会把 host 调成内容区大小，这里再对一次，确保网页已经缩进安全区
        host.reposition()
        window.center()
        window.makeKeyAndOrderFront(nil)

        self.window = window
        NSApp.activate(ignoringOtherApps: true)

        let url = URL(string: "http://127.0.0.1:\(port)/index.html")!
        webView.load(URLRequest(url: url))
    }

    private func fatal(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Moru Studio"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
