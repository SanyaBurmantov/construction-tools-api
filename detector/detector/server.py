"""A small JSON HTTP API around the classifier (standard library only).

    GET  /health          → {ok, model}
    POST /analyze         {text, fragments?}  → full report (analyze.py)
    POST /analyze/batch   {texts: [...]}      → [{probability, verdict, …}]

It sits on the compose network and only the backend calls it. When
`DETECTOR_TOKEN` is set every request but /health must carry
`Authorization: Bearer <token>` — that is what makes it safe to publish for
a crawler running elsewhere (GitHub Actions). One request is scored at a
time (the model holds a lock); the HTTP threads only parse and wait.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import signal
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .analyze import analyze, score_many
from .model import Classifier

MAX_BODY = 2 * 1024 * 1024
MAX_TEXT = 100_000
MAX_BATCH = 32

log = logging.getLogger("detector")


class Handler(BaseHTTPRequestHandler):
    server_version = "gost-detector/1"
    classifier: Classifier
    token: str = ""

    def log_message(self, fmt: str, *args) -> None:  # route through logging
        log.debug("%s %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, {"error": message})

    def _authorized(self) -> bool:
        if not self.token:
            return True
        header = self.headers.get("Authorization", "")
        return hmac.compare_digest(header, f"Bearer {self.token}")

    def _body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Слишком большой запрос")
            return None
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._error(HTTPStatus.BAD_REQUEST, "Тело запроса — не JSON")
            return None
        if not isinstance(data, dict):
            self._error(HTTPStatus.BAD_REQUEST, "Ожидался JSON-объект")
            return None
        return data

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(HTTPStatus.OK, {"ok": True, "model": self.classifier.name})
        else:
            self._error(HTTPStatus.NOT_FOUND, "Нет такого адреса")

    def do_POST(self) -> None:
        if self.path not in ("/analyze", "/analyze/batch"):
            self._error(HTTPStatus.NOT_FOUND, "Нет такого адреса")
            return
        if not self._authorized():
            self._error(HTTPStatus.UNAUTHORIZED, "Нужен токен")
            return
        data = self._body()
        if data is None:
            return
        started = time.monotonic()
        try:
            if self.path == "/analyze":
                text = data.get("text")
                if not isinstance(text, str) or not text.strip():
                    self._error(HTTPStatus.BAD_REQUEST, "Пустой текст")
                    return
                if len(text) > MAX_TEXT:
                    self._error(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        f"Текст длиннее {MAX_TEXT} символов",
                    )
                    return
                result = analyze(
                    text, self.classifier, with_fragments=data.get("fragments", True) is not False
                )
            else:
                texts = data.get("texts")
                if (
                    not isinstance(texts, list)
                    or not texts
                    or len(texts) > MAX_BATCH
                    or not all(isinstance(t, str) and t.strip() for t in texts)
                ):
                    self._error(
                        HTTPStatus.BAD_REQUEST,
                        f"texts — от 1 до {MAX_BATCH} непустых строк",
                    )
                    return
                if any(len(t) > MAX_TEXT for t in texts):
                    self._error(
                        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                        f"Текст длиннее {MAX_TEXT} символов",
                    )
                    return
                result = {"results": score_many([t.strip() for t in texts], self.classifier)}
        except Exception:  # never leak a stack to the caller
            log.exception("analysis failed")
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "Ошибка анализа")
            return
        if isinstance(result, dict):
            result["ms"] = round((time.monotonic() - started) * 1000)
        self._send(HTTPStatus.OK, result)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("DETECTOR_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    model_dir = os.environ.get("DETECTOR_MODEL_DIR", "/models/modernbert")
    classifier = Classifier(
        model_dir,
        max_tokens=int(os.environ.get("DETECTOR_MAX_TOKENS", "2048")),
        threads=int(os.environ.get("DETECTOR_THREADS", "1")),
    )
    # Warm-up: the first run allocates and optimises; do it before /health
    # can say ok, not on the first admin's request.
    classifier.probabilities(["Проверка модели после запуска."])
    Handler.classifier = classifier
    Handler.token = os.environ.get("DETECTOR_TOKEN", "")
    port = int(os.environ.get("DETECTOR_PORT", "8100"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    # serve_forever runs in this thread, so shutdown() from here would wait
    # for itself; leave the loop by exception instead.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    log.info("model %s, window %d tokens, listening on :%d", classifier.name, classifier.window, port)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
