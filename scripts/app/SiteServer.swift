import Foundation
import Network

// Minimal static file server bound to 127.0.0.1, so the app has no external
// dependency (no python3, no bundled runtime). Supports single-range requests
// because WKWebView asks for byte ranges when it plays the site's mp4 videos.

final class SiteServer {
    private let siteDir: URL
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.moru.site-server")

    init(siteDirectory: URL) {
        self.siteDir = siteDirectory
    }

    /// Binds a free port and starts serving. Returns the port, or nil.
    func start() -> UInt16? {
        guard let port = Self.freePort() else { return nil }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // Loopback only: the shop must never be reachable from the LAN.
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: port)!
        )

        // The port lives in requiredLocalEndpoint; passing it to the
        // initializer as well makes the listener fail with EINVAL.
        guard let listener = try? NWListener(using: parameters) else {
            return nil
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
        return port
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - port discovery

    private static func freePort() -> UInt16? {
        for port in UInt16(8799)...UInt16(8820) {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { continue }
            defer { close(fd) }

            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            addr.sin_port = port.bigEndian
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")

            let ok = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if ok == 0 { return port }
        }
        return nil
    }

    // MARK: - connections

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, _, _ in
            guard let self = self, let data = data, !data.isEmpty else {
                connection.cancel()
                return
            }
            self.respond(to: String(data: data, encoding: .utf8) ?? "", on: connection)
        }
    }

    private func respond(to rawRequest: String, on connection: NWConnection) {
        let head = rawRequest.components(separatedBy: "\r\n\r\n")[0]
        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            connection.cancel()
            return
        }
        let parts = requestLine.split(separator: " ")
        let method = parts.first.map(String.init) ?? "GET"
        let rawPath = parts.count > 1 ? String(parts[1]) : "/"
        let rangeHeader = lines.dropFirst().first { $0.lowercased().hasPrefix("range:") }

        let file = resolve(rawPath)
        let isHead = method == "HEAD"

        if let file = file, let payload = Self.rangedData(file: file, rangeHeader: rangeHeader) {
            var header = "HTTP/1.1 \(payload.status)\r\n"
            header += "Content-Type: \(Self.mimeType(for: file))\r\n"
            header += "Content-Length: \(payload.data.count)\r\n"
            header += "Accept-Ranges: bytes\r\n"
            header += "Cache-Control: no-store\r\n"
            if let range = payload.range {
                header += "Content-Range: bytes \(range.lowerBound)-\(range.upperBound)/\(payload.total)\r\n"
            }
            header += "Connection: close\r\n\r\n"

            var body = Data(header.utf8)
            if !isHead { body.append(payload.data) }
            finish(body, on: connection)
        } else {
            let body = Data("Not Found".utf8)
            var header = "HTTP/1.1 404 Not Found\r\n"
            header += "Content-Type: text/plain; charset=utf-8\r\n"
            header += "Content-Length: \(body.count)\r\n"
            header += "Connection: close\r\n\r\n"
            var response = Data(header.utf8)
            if !isHead { response.append(body) }
            finish(response, on: connection)
        }
    }

    private func finish(_ data: Data, on connection: NWConnection) {
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    // MARK: - file resolution

    private func resolve(_ rawPath: String) -> URL? {
        guard let components = URLComponents(string: rawPath),
              let percentPath = components.percentEncodedPath.removingPercentEncoding,
              !percentPath.contains("..")
        else { return nil }

        var url = siteDir.appendingPathComponent(percentPath)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            url = url.appendingPathComponent("index.html")
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    private struct Payload {
        let data: Data
        let status: String
        let range: ClosedRange<Int>?
        let total: Int
    }

    private static func rangedData(file: URL, rangeHeader: String?) -> Payload? {
        guard let total = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }

        if let header = rangeHeader,
           let spec = header.split(separator: ":").last?.trimmingCharacters(in: .whitespaces),
           spec.hasPrefix("bytes=") {
            let value = spec.dropFirst("bytes=".count)
            let bounds = value.split(separator: "-")
            if let start = Int(bounds[0]), start >= 0, start < total.count {
                let end = bounds.count > 1 ? (Int(bounds[1]) ?? total.count - 1) : total.count - 1
                let clampedEnd = min(end, total.count - 1)
                return Payload(data: total[start...clampedEnd],
                               status: "206 Partial Content",
                               range: start...clampedEnd,
                               total: total.count)
            }
        }
        return Payload(data: total, status: "200 OK", range: nil, total: total.count)
    }

    private static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        case "mp3": return "audio/mpeg"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        default: return "application/octet-stream"
        }
    }
}
