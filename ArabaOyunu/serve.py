#!/usr/bin/env python3
# WebHID icin gerekli: oyunu http://localhost uzerinden sunar.
# ES module .js dosyalarinin dogru MIME ile sunulmasini garanti eder (Windows fix).
import http.server
import socketserver
import webbrowser
import os

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
    }
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
        url = f'http://localhost:{PORT}/'
        print(f'Sunucu calisiyor: {url}')
        print('Durdurmak icin Ctrl+C')
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()
