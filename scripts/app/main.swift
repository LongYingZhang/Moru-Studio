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

    private func buildWindow(port: UInt16) {
        let webView = WKWebView(frame: .zero)

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
