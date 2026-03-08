from __future__ import annotations

import argparse
import json
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from backend.project_data import discover_project_root, export_config_text, get_fixture_payload, write_export


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the controllables editor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--project-root", type=Path, default=None)
    return parser.parse_args()


class EditorRequestHandler(SimpleHTTPRequestHandler):
    project_root: Path

    def log_message(self, format: str, *args) -> None:
        return

    def _send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self) -> dict[str, object]:
        raw_length = self.headers.get("Content-Length", "0")
        length = int(raw_length)
        raw_body = self.rfile.read(length) if length else b"{}"
        return json.loads(raw_body.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json({"ok": True})
            return
        if parsed.path == "/api/fixtures":
            self._send_json(get_fixture_payload(self.project_root))
            return
        if parsed.path in {"", "/"}:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/export":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        try:
            request_body = self._read_json()
            fixtures = request_body.get("fixtures", [])
            output_path = request_body.get("outputPath")
            content = export_config_text(self.project_root, fixtures)
            saved_path = write_export(self.project_root, content, output_path if isinstance(output_path, str) else None)
            self._send_json(
                {
                    "content": content,
                    "savedPath": saved_path,
                    "fileName": "controllables.py",
                }
            )
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)


def main() -> None:
    args = parse_args()
    project_root = args.project_root.resolve() if args.project_root else discover_project_root()
    dist_dir = Path(__file__).resolve().parent / "frontend" / "dist"
    if not dist_dir.exists():
        raise FileNotFoundError(f"Frontend build not found: {dist_dir}")

    EditorRequestHandler.project_root = project_root
    handler = partial(EditorRequestHandler, directory=str(dist_dir))

    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving controllables editor at http://{args.host}:{args.port}")
    print(f"Using project root: {project_root}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
