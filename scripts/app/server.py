#!/usr/bin/env python3
"""Serve the bundled site on 127.0.0.1 and print the port on stdout.

The native wrapper (main.swift) reads that one line, then points its
WKWebView at it. Printing the port keeps the two processes from racing
over a hardcoded port.
"""
import http.server
import os
import socketserver
import sys

BASE_PORT = 8799


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    site = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
    os.chdir(site)

    socketserver.TCPServer.allow_reuse_address = True
    httpd = None
    port = None
    for p in range(BASE_PORT, BASE_PORT + 16):
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue

    if httpd is None:
        sys.stderr.write("Moru: no free port near %d\n" % BASE_PORT)
        return 1

    # Flush: the wrapper blocks on this line before it opens the window.
    sys.stdout.write("%d\n" % port)
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
