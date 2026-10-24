import Cocoa
import WebKit
import Foundation

// Moru Studio desktop wrapper.
//
// A real standalone window: a WKWebView pointed at the bundled copy of the
// site, served from 127.0.0.1 by Resources/server.py. No browser chrome, no
// tab bar, its own Dock icon — the same shape as any other Mac app.

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    var server: Process?
    var port: Int = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        guard let serverScript = Bundle.main.path(forResource: "server", ofType: "py") else {
            fatal("Bundled server.py is missing.")
            return
        }
        guard let python = pythonPath() else {
            fatal("这台 Mac 上没有 python3，无法启动本地服务。")
            return
        }

        let pipe = Pipe()
        let task = Process()
        task.executableURL = URL(fileURLWithPath: python)
        task.arguments = [serverScript]
        task.standardOutput = pipe
        do {
            try task.run()
        } catch {
            fatal("无法启动本地服务：\(error.localizedDescription)")
            return
        }
        server = task

        // server.py prints the port it bound, then serves forever.
        var buffer = Data()
        let handle = pipe.fileHandleForReading
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { break }
            buffer.append(chunk)
            if buffer.contains(0x0A) { break }
        }
        let line = String(data: buffer, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let p = Int(line), p > 0 else {
            fatal("本地服务没有返回可用端口（收到：\(line)）")
            return
        }
        port = p

        buildWindow()
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)

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

    private func pythonPath() -> String? {
        let candidates = ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) {
            return c
        }
        return nil
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
