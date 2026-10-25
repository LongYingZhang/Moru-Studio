import Cocoa
import CryptoKit

/// 应用内自更新：app 自己把新版 dmg 下下来 → 校验 SHA-256 → 换掉自己 → 重新打开。
///
/// 为什么这样就不会弹「无法验证开发者」：
/// com.apple.quarantine 是「下载器」给文件打的标记（Safari / Chrome / 微信都会打），
/// Gatekeeper 只在看到这个标记时才去做签名 + 公证校验。app 用 URLSession 自己写到临时目录的
/// 文件没有这个标记，替换后系统当成本地文件，直接放行。
/// （为了保险，替换脚本里还会再 xattr 清一次。）
///
/// 替换自己不能在本进程里做：得写一个 sh 脚本，等本进程退出后再换目录、重新 open。
final class Updater: NSObject, URLSessionDownloadDelegate {

    static let shared = Updater()

    private var session: URLSession?
    private var expectedSHA: String?
    private var panel: NSPanel?
    private var bar: NSProgressIndicator?
    private var statusLabel: NSTextField?
    private var busy = false

    // MARK: - 对外入口

    /// downloadURL: dmg 地址；sha256: 线上 manifest 里给的校验值（可为空，为空就只校验能打开）
    func begin(downloadURL: URL, sha256: String?) {
        if busy { return }
        busy = true
        expectedSHA = (sha256 ?? "").lowercased()

        showPanel()
        update("正在连接服务器…", nil)

        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 600
        let s = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session = s
        s.downloadTask(with: downloadURL).resume()
    }

    // MARK: - 下载进度

    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else {
            update("正在下载更新…", nil)
            return
        }
        let p = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        update("正在下载更新… \(Int(p * 100))%", p)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // 这个回调返回后临时文件就被删了，必须先搬走
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("Moru-Studio-update-\(UUID().uuidString).dmg")
        do {
            try FileManager.default.moveItem(at: location, to: dest)
        } catch {
            fail("下载已完成，但保存安装包失败：\(error.localizedDescription)")
            return
        }

        update("正在校验安装包…", 1)

        DispatchQueue.global(qos: .userInitiated).async {
            if let expected = self.expectedSHA, !expected.isEmpty {
                guard let actual = Updater.sha256(of: dest) else {
                    self.fail("无法读取下载的安装包。")
                    return
                }
                guard actual == expected else {
                    self.fail("安装包校验不通过（可能没下载完整），已停止更新。请稍后再试。")
                    return
                }
            }
            self.install(dmg: dest)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        // 取消的情况（比如文件已开始安装）不提示
        let ns = error as NSError
        if ns.code == NSURLErrorCancelled { return }
        fail("下载失败：\(error.localizedDescription)")
    }

    // MARK: - 安装

    private func install(dmg: URL) {
        let fm = FileManager.default
        let work = fm.temporaryDirectory
            .appendingPathComponent("moru-update-\(UUID().uuidString)", isDirectory: true)
        let mount = work.appendingPathComponent("mnt", isDirectory: true)

        do {
            try fm.createDirectory(at: mount, withIntermediateDirectories: true)
        } catch {
            fail("无法创建临时目录：\(error.localizedDescription)")
            return
        }

        guard run("/usr/bin/hdiutil",
                  ["attach", dmg.path, "-nobrowse", "-noverify", "-quiet", "-mountpoint", mount.path]) else {
            fail("打不开下载的安装包（文件可能损坏）。")
            return
        }
        defer { _ = run("/usr/bin/hdiutil", ["detach", mount.path, "-quiet", "-force"]) }

        let entries = (try? fm.contentsOfDirectory(atPath: mount.path)) ?? []
        guard let appName = entries.first(where: { $0.hasSuffix(".app") }) else {
            fail("安装包里没找到 Moru Studio。")
            return
        }

        let source = mount.appendingPathComponent(appName)
        let staged = work.appendingPathComponent("Moru Studio.app")

        setMain("正在安装…", 1)
        guard run("/usr/bin/ditto", [source.path, staged.path]) else {
            fail("拷贝新版本失败。")
            return
        }

        let dest = Bundle.main.bundlePath
        let parent = (dest as NSString).deletingLastPathComponent
        guard fm.isWritableFile(atPath: parent) else {
            fail("当前所在的位置不可写（可能是在磁盘映像里直接打开的）。\n请先把 Moru Studio 拖进「应用程序」文件夹，再更新。")
            return
        }

        launchSwap(staged: staged.path, dest: dest, cleanup: work.path)
    }

    /// 写一个 sh 脚本：等本进程退出 → 备份旧的 → 换新的 → 清隔离标记 → 打开
    private func launchSwap(staged: String, dest: String, cleanup: String) {
        let script = Updater.swapScript(pid: ProcessInfo.processInfo.processIdentifier,
                                        staged: staged,
                                        dest: dest,
                                        cleanup: cleanup)

        let scriptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("moru-update-\(UUID().uuidString).sh")
        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
        } catch {
            fail("无法准备安装脚本：\(error.localizedDescription)")
            return
        }

        setMain("即将重启完成更新…", 1)

        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = [scriptURL.path]
        do {
            try task.run()
        } catch {
            fail("无法启动安装脚本：\(error.localizedDescription)")
            return
        }

        // 给面板一点时间让用户看到最后一行字，然后退出让脚本接手
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            NSApp.terminate(nil)
        }
    }

    // MARK: - 工具

    static func sha256(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { return nil }
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    @discardableResult
    private func run(_ launchPath: String, _ args: [String]) -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: launchPath)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            p.waitUntilExit()
            return p.terminationStatus == 0
        } catch {
            return false
        }
    }

    /// 生成替换脚本。单独抽出来是为了能直接拿脚本内容做验证。
    /// 逻辑：等旧进程退出 → mv 旧 app 备份 → ditto 新的过去 → 成功就删备份、
    /// 失败就回滚；每一步都清一次隔离标记，最后重新打开。
    static func swapScript(pid: Int32, staged: String, dest: String, cleanup: String) -> String {
        return """
        #!/bin/sh
        PID=\(pid)
        NEW=\(shellQuote(staged))
        DEST=\(shellQuote(dest))
        WORK=\(shellQuote(cleanup))
        LOG=/tmp/moru-update.log
        echo "--- $(date) update start" >>"$LOG"

        i=0
        while [ $i -lt 300 ]; do
          kill -0 $PID 2>/dev/null || break
          sleep 0.2
          i=$((i+1))
        done
        sleep 0.6

        /bin/mv "$DEST" "$DEST.old" >>"$LOG" 2>&1 || { echo "mv old failed" >>"$LOG"; /bin/rm -rf "$WORK"; exit 1; }

        if /usr/bin/ditto "$NEW" "$DEST" >>"$LOG" 2>&1; then
          /usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
          /bin/rm -rf "$DEST.old"
          echo "update ok" >>"$LOG"
        else
          echo "ditto failed, rollback" >>"$LOG"
          /bin/rm -rf "$DEST"
          /bin/mv "$DEST.old" "$DEST"
        fi

        /bin/rm -rf "$WORK"
        /usr/bin/open "$DEST"
        """
    }

    static func shellQuote(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    // MARK: - 面板 / 提示

    private func showPanel() {
        if panel == nil {
            let content = NSView(frame: NSRect(x: 0, y: 0, width: 340, height: 96))
            let label = NSTextField(labelWithString: "正在下载更新…")
            label.frame = NSRect(x: 24, y: 56, width: 292, height: 18)
            label.font = NSFont.systemFont(ofSize: 13)
            let nb = NSProgressIndicator(frame: NSRect(x: 24, y: 26, width: 292, height: 12))
            nb.style = .bar
            nb.isIndeterminate = false
            nb.minValue = 0
            nb.maxValue = 1
            nb.doubleValue = 0
            content.addSubview(label)
            content.addSubview(nb)

            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 96),
                            styleMask: [.titled],
                            backing: .buffered,
                            defer: false)
            p.title = "更新 Moru Studio"
            p.contentView = content
            p.isReleasedWhenClosed = false
            p.level = .floating
            p.center()
            panel = p
            bar = nb
            statusLabel = label
        }
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func update(_ text: String, _ progress: Double?) {
        DispatchQueue.main.async {
            self.statusLabel?.stringValue = text
            if let progress {
                self.bar?.isIndeterminate = false
                self.bar?.doubleValue = progress
            } else {
                self.bar?.isIndeterminate = true
                self.bar?.startAnimation(nil)
            }
        }
    }

    private func setMain(_ text: String, _ progress: Double) {
        DispatchQueue.main.async {
            self.statusLabel?.stringValue = text
            self.bar?.isIndeterminate = false
            self.bar?.doubleValue = progress
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async {
            self.busy = false
            self.panel?.orderOut(nil)
            self.panel = nil
            self.session?.invalidateAndCancel()
            self.session = nil

            let alert = NSAlert()
            alert.messageText = "更新没有完成"
            alert.informativeText = message
            alert.addButton(withTitle: "好")
            alert.runModal()
        }
    }
}
