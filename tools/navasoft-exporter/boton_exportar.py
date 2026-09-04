#!/usr/bin/env python3
"""Panel terminal Bocasion (ASCII + colores) con consola en tiempo real.

Uso:
  python3 boton_exportar.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "exportar_tickets.sh"
PANEL = ROOT / "panel.html"
LATEST_DATA = ROOT / "exports" / "tickets_navasoft.json"
HOST = "127.0.0.1"
PORT = 8765

_lock = threading.Lock()
_running = False


def _sse(handler: BaseHTTPRequestHandler, payload: dict) -> None:
    raw = f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
    handler.wfile.write(raw)
    handler.wfile.flush()


class Handler(BaseHTTPRequestHandler):
    ALLOWED_ORIGINS = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://bocasion.com",
        "https://www.bocasion.com",
    }

    def log_message(self, fmt: str, *args) -> None:
        return

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin in self.ALLOWED_ORIGINS

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in self.ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self.send_error(403)
            return
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        global _running
        path = urlparse(self.path).path

        if not self._origin_allowed():
            self.send_error(403)
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self._cors_headers()
            self.end_headers()
            return

        if path == "/health":
            body = json.dumps({"ok": True, "running": _running}).encode("utf-8")
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/export/latest":
            if not LATEST_DATA.is_file():
                self.send_error(404, "Todavía no existen datos sincronizados")
                return
            body = LATEST_DATA.read_bytes()
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        if path in ("/", "/index.html"):
            if not PANEL.is_file():
                self.send_error(500, "Falta panel.html")
                return
            body = PANEL.read_bytes()
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/export/stream":
            if not SCRIPT.is_file():
                self.send_response(500)
                self._cors_headers()
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                _sse(self, {"type": "error", "text": "No existe exportar_tickets.sh"})
                _sse(self, {"type": "done", "ok": False, "code": 1})
                return

            with _lock:
                if _running:
                    self.send_response(409)
                    self._cors_headers()
                    self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    _sse(self, {"type": "error", "text": "Ya hay una exportación en curso."})
                    _sse(self, {"type": "done", "ok": False, "code": 409})
                    return
                _running = True

            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            env = os.environ.copy()
            env["PAUSE_AT_END"] = "0"
            env["PYTHONUNBUFFERED"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"

            lines = 0
            proc = None
            try:
                cmd = (
                    ["stdbuf", "-oL", "-eL", "bash", str(SCRIPT)]
                    if shutil.which("stdbuf")
                    else ["bash", str(SCRIPT)]
                )
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    bufsize=1,
                )
                assert proc.stdout is not None
                for line in proc.stdout:
                    _sse(self, {"type": "line", "text": line.rstrip("\r\n")})
                    lines += 1
                code = proc.wait(timeout=5)
                _sse(self, {"type": "done", "ok": code == 0, "code": code, "lines": lines})
            except BrokenPipeError:
                if proc is not None and proc.poll() is None:
                    proc.kill()
            except Exception as exc:  # noqa: BLE001
                try:
                    _sse(self, {"type": "error", "text": str(exc)})
                    _sse(self, {"type": "done", "ok": False, "code": 1, "lines": lines})
                except BrokenPipeError:
                    pass
            finally:
                with _lock:
                    _running = False
            return

        self.send_error(404)


def main() -> None:
    if not SCRIPT.is_file():
        print(f"Falta {SCRIPT}", file=sys.stderr)
        sys.exit(1)
    if not PANEL.is_file():
        print(f"Falta {PANEL}", file=sys.stderr)
        sys.exit(1)
    SCRIPT.chmod(SCRIPT.stat().st_mode | 0o111)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.allow_reuse_address = True
    url = f"http://{HOST}:{PORT}/"
    print(f"Panel Bocasion ASCII: {url}")
    print("Ctrl+C para detener.")
    if os.getenv("NAV_OPEN_PANEL", "1") == "1":
        try:
            import webbrowser

            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrado.")
        time.sleep(0.1)


if __name__ == "__main__":
    main()
