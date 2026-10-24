import Cocoa
import WebKit
import Foundation

// Moru Studio desktop wrapper.
//
// A real standalone window: a WKWebView pointed at the bundled copy of the
// site, served from 127.0.0.1 by the built-in SiteServer. No browser chrome,
// no tab bar, its own Dock icon — and no external dependency at all (no
// python3, no bundled runtime).

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
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = NSColor.windowBackgroundColor
        window.minSize = NSSize(width: 720, height: 560)
        window.contentView = webView
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
