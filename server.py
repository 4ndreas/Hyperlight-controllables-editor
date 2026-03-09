from __future__ import annotations

import argparse
import json
import threading
import uuid
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from backend.project_data import (
    discover_project_root,
    export_config_text,
    get_fixture_payload,
    preview_pixelinfo_expression,
    write_export,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the controllables editor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--project-root", type=Path, default=None)
    return parser.parse_args()


class EditorRequestHandler(SimpleHTTPRequestHandler):
    project_root: Path
    load_jobs: dict[str, dict[str, object]]
    load_jobs_lock: threading.Lock
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def log_message(self, format: str, *args) -> None:
        return

    def _send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
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
        if parsed.path.startswith("/api/load-jobs/"):
            job_id = parsed.path.rsplit("/", 1)[-1]
            with self.load_jobs_lock:
                job = self.load_jobs.get(job_id)
            if job is None:
                self._send_json({"error": "Load job not found"}, status=HTTPStatus.NOT_FOUND)
                return
            self._send_json(job)
            return
        if parsed.path in {"", "/"}:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/load-jobs":
            job_id = self._start_load_job()
            self._send_json({"jobId": job_id}, status=HTTPStatus.ACCEPTED)
            return
        if parsed.path == "/api/pixel-preview":
            try:
                request_body = self._read_json()
                expression = request_body.get("expression", "")
                if not isinstance(expression, str):
                    raise ValueError("Pixel preview expression must be a string")
                self._send_json(preview_pixelinfo_expression(self.project_root, expression))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if parsed.path != "/api/export":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        try:
            request_body = self._read_json()
            fixtures = request_body.get("fixtures", [])
            group_definitions = request_body.get("groupDefinitions")
            output_path = request_body.get("outputPath")
            content = export_config_text(self.project_root, fixtures, group_definitions)
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

    def _start_load_job(self) -> str:
        job_id = uuid.uuid4().hex
        job_state = {
            "jobId": job_id,
            "status": "running",
            "progress": 0,
            "message": "Starting fixture load",
            "payload": None,
        }
        with self.load_jobs_lock:
            self.load_jobs[job_id] = job_state

        thread = threading.Thread(target=self._run_load_job, args=(job_id,), daemon=True)
        thread.start()
        return job_id

    def _run_load_job(self, job_id: str) -> None:
        def progress_callback(percent: int, message: str) -> None:
            with self.load_jobs_lock:
                job = self.load_jobs.get(job_id)
                if job is None:
                    return
                job["progress"] = percent
                job["message"] = message

        try:
            payload = get_fixture_payload(self.project_root, progress_callback=progress_callback)
            with self.load_jobs_lock:
                job = self.load_jobs.get(job_id)
                if job is None:
                    return
                job["status"] = "completed"
                job["progress"] = 100
                job["message"] = "Fixture data loaded"
                job["payload"] = payload
        except Exception as exc:
            with self.load_jobs_lock:
                job = self.load_jobs.get(job_id)
                if job is None:
                    return
                job["status"] = "failed"
                job["message"] = str(exc)
                job["error"] = str(exc)


def main() -> None:
    args = parse_args()
    project_root = args.project_root.resolve() if args.project_root else discover_project_root()
    dist_dir = Path(__file__).resolve().parent / "frontend" / "dist"
    if not dist_dir.exists():
        raise FileNotFoundError(f"Frontend build not found: {dist_dir}")

    EditorRequestHandler.project_root = project_root
    EditorRequestHandler.load_jobs = {}
    EditorRequestHandler.load_jobs_lock = threading.Lock()
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
