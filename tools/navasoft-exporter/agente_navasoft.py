#!/usr/bin/env python3
"""Agente de sincronización Navasoft.

Corre en la PC con acceso a la intranet Navasoft. Hace polling a la cola
del servidor (api/navasoft.php): cuando alguien pulsa "Actualizar Navasoft"
en el dashboard (desde cualquier computadora), este agente reclama el
trabajo, ejecuta exportar_tickets.sh, sube el log en vivo y entrega las
filas JSON para que el navegador las importe.

Uso:
  python3 agente_navasoft.py            # loop infinito (servicio)

Variables (opcionalmente en export.env):
  NAV_QUEUE_URL  URL de la cola (default: https://www.bocasion.com/out/api/navasoft.php)
  NAV_QUEUE_KEY  Clave compartida con navasoft.php
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT_SH = ROOT / "exportar_tickets.sh"
SCRIPT_CMD = ROOT / "exportar_tickets.cmd"
OUTPUT = ROOT / "exports" / "tickets_navasoft.json"

POLL_INTERVAL = 4  # segundos entre consultas a la cola
LOG_FLUSH_INTERVAL = 0.8  # segundos entre envíos de log


def _load_env_file() -> None:
    env_file = ROOT / "export.env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.replace("\r", "").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

QUEUE_URL = os.environ.get(
    "NAV_QUEUE_URL", "https://www.bocasion.com/out/api/navasoft.php"
)
QUEUE_KEY = os.environ.get("NAV_QUEUE_KEY", "NAV_AGENT_2026_8oca5ion")


def _log(message: str) -> None:
    line = f"[agente] {message}"
    print(line, flush=True)
    try:
        log_path = ROOT / "agent.log"
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S") + " " + line + "\n")
    except OSError:
        pass


def _request(method: str, url: str, payload: dict | None = None, timeout: int = 30) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def claim_job() -> int | None:
    # timeout corto: el poll de rutina no debe quedarse colgado
    result = _request("GET", f"{QUEUE_URL}?action=poll&key={QUEUE_KEY}", timeout=10)
    job = result.get("job")
    return int(job["id"]) if job else None


def send_log(job_id: int, lines: list[str]) -> None:
    if not lines:
        return
    try:
        _request(
            "POST",
            QUEUE_URL,
            {"action": "log", "key": QUEUE_KEY, "id": job_id, "lines": lines},
        )
    except Exception as exc:  # noqa: BLE001 - el log no debe tumbar el trabajo
        _log(f"no se pudo subir log: {exc}")


ROWS_CHUNK_CHARS = 400_000  # ~400KB por POST: bajo cualquier post_max_size


def upload_rows(job_id: int, rows_text: str) -> None:
    """Sube el JSON de tickets por partes (los hostings limitan el POST)."""
    total = len(rows_text)
    parts = max(1, (total + ROWS_CHUNK_CHARS - 1) // ROWS_CHUNK_CHARS)
    seq = 0
    for start in range(0, total, ROWS_CHUNK_CHARS):
        chunk = rows_text[start : start + ROWS_CHUNK_CHARS]
        send_log(
            job_id,
            [f"UPLOAD {seq + 1}/{parts} bytes={len(chunk)} total={total}"],
        )
        last_err: Exception | None = None
        for attempt in range(1, 4):
            try:
                _request(
                    "POST",
                    QUEUE_URL,
                    {
                        "action": "rows",
                        "key": QUEUE_KEY,
                        "id": job_id,
                        "seq": seq,
                        "chunk": chunk,
                    },
                    timeout=120,
                )
                last_err = None
                break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                _log(f"upload parte {seq + 1} intento {attempt} falló: {exc}")
                time.sleep(1.5 * attempt)
        if last_err is not None:
            raise last_err
        seq += 1
    send_log(job_id, [f"UPLOAD complete parts={seq} bytes={total}"])
    _log(f"trabajo #{job_id}: resultado subido en {seq} parte(s) ({total} bytes)")


def send_complete(job_id: int, *, ok: bool, error: str = "") -> None:
    payload: dict = {"action": "complete", "key": QUEUE_KEY, "id": job_id, "ok": ok}
    if not ok:
        payload["error"] = error or "La sincronización falló"
    _request("POST", QUEUE_URL, payload)


def _export_command() -> list[str]:
    if sys.platform.startswith("win"):
        if SCRIPT_CMD.is_file():
            return ["cmd", "/c", str(SCRIPT_CMD)]
        # Git Bash / WSL si no hay .cmd
        bash = shutil_which_bash()
        if bash and SCRIPT_SH.is_file():
            return [bash, str(SCRIPT_SH)]
        raise FileNotFoundError("Falta exportar_tickets.cmd (Windows)")
    if not SCRIPT_SH.is_file():
        raise FileNotFoundError(f"Falta {SCRIPT_SH}")
    return ["bash", str(SCRIPT_SH)]


def shutil_which_bash() -> str | None:
    for name in ("bash.exe", "bash"):
        from shutil import which

        found = which(name)
        if found:
            return found
    return None


def run_job(job_id: int) -> None:
    _log(f"trabajo #{job_id} reclamado; ejecutando exportador")
    env = os.environ.copy()
    env["PAUSE_AT_END"] = "0"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    try:
        cmd = _export_command()
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
    except OSError as exc:
        send_complete(job_id, ok=False, error=f"No se pudo lanzar el exportador: {exc}")
        return
    except FileNotFoundError as exc:
        send_complete(job_id, ok=False, error=str(exc))
        return

    pending: list[str] = []
    last_flush = time.monotonic()
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.rstrip("\r\n")
        if line:
            pending.append(line)
        now = time.monotonic()
        if pending and now - last_flush >= LOG_FLUSH_INTERVAL:
            send_log(job_id, pending)
            pending = []
            last_flush = now

    code = proc.wait()
    send_log(job_id, pending)

    if code != 0:
        send_complete(
            job_id,
            ok=False,
            error=f"El exportador terminó con código {code}. Revisa el log.",
        )
        _log(f"trabajo #{job_id} falló (código {code})")
        return

    send_log(job_id, ["Subiendo resultados al dashboard…"])
    try:
        rows_text = OUTPUT.read_text(encoding="utf-8")
        rows = json.loads(rows_text)
        if not isinstance(rows, list):
            raise ValueError("el JSON exportado no es una lista")
    except Exception as exc:  # noqa: BLE001
        send_complete(job_id, ok=False, error=f"No se pudo leer el resultado: {exc}")
        _log(f"trabajo #{job_id}: resultado ilegible ({exc})")
        return

    try:
        upload_rows(job_id, rows_text)
    except Exception as exc:  # noqa: BLE001
        send_complete(job_id, ok=False, error=f"No se pudo subir el resultado: {exc}")
        _log(f"trabajo #{job_id}: fallo al subir resultado ({exc})")
        return

    send_complete(job_id, ok=True)
    _log(f"trabajo #{job_id} completado: {len(rows)} tickets entregados")


def main() -> None:
    _log(f"escuchando cola: {QUEUE_URL}")
    backoff = POLL_INTERVAL * 3
    while True:
        try:
            job_id = claim_job()
            backoff = POLL_INTERVAL * 3
        except (urllib.error.URLError, OSError, ValueError) as exc:
            _log(f"cola inalcanzable: {exc} (reintento en {backoff}s)")
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)
            continue

        if job_id is None:
            time.sleep(POLL_INTERVAL)
            continue

        try:
            run_job(job_id)
        except Exception as exc:  # noqa: BLE001 - nunca tumbar el loop
            _log(f"error inesperado en trabajo #{job_id}: {exc}")
            try:
                send_complete(job_id, ok=False, error=f"Error inesperado: {exc}")
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
