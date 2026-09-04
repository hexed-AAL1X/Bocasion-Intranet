#!/usr/bin/env python3
"""Console script para descargar tickets de Navasoft y exportarlos a Excel."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import json
import logging
import os
import queue
import re
import getpass
import platform
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup


LOGGER = logging.getLogger("ticket_exporter")
ILLEGAL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

STATUS_CHOICES = {
    "pendientes": "0",
    "solucionados": "1",
    "todos": "2",
}

@dataclass
class ExportStats:
    tickets_total: int = 0
    details_ok: int = 0
    details_failed: int = 0
    output: Optional[Path] = None


class AlertReporter:
    """Emite alertas visibles en consola y notificaciones del sistema."""

    LABELS = {
        "info": ("ℹ️", "INFO"),
        "success": ("✅", "LISTO"),
        "warning": ("⚠️", "AVISO"),
        "error": ("❌", "ERROR"),
    }

    def __init__(self, *, desktop: bool = True) -> None:
        self.desktop = desktop
        self.stats = ExportStats()
        self._entries: List[Tuple[str, str]] = []

    def info(self, message: str) -> None:
        self._show("info", message)

    def success(self, message: str) -> None:
        self._show("success", message)

    def warning(self, message: str) -> None:
        self._show("warning", message)

    def error(self, message: str) -> None:
        self._show("error", message)

    def _show(self, level: str, message: str) -> None:
        self._entries.append((level, message))
        icon, label = self.LABELS.get(level, ("•", level.upper()))
        stream = sys.stderr if level in {"warning", "error"} else sys.stdout
        print(f"\n{icon}  {label}: {message}", file=stream, flush=True)

    def desktop_notify(self, title: str, message: str) -> None:
        if not self.desktop:
            return

        system = platform.system().lower()
        try:
            if system == "linux":
                subprocess.run(
                    ["notify-send", title, message],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                )
            elif system == "windows":
                safe_title = title.replace("'", "''")
                safe_message = message.replace("'", "''")
                ps = (
                    "Add-Type -AssemblyName System.Windows.Forms; "
                    f"[System.Windows.Forms.MessageBox]::Show('{safe_message}', '{safe_title}')"
                )
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10,
                )
        except (OSError, subprocess.SubprocessError, FileNotFoundError):
            pass

    def summary(self) -> None:
        warnings = [msg for level, msg in self._entries if level == "warning"]
        errors = [msg for level, msg in self._entries if level == "error"]
        if not warnings and not errors:
            return

        print("\n" + "─" * 56, file=sys.stderr)
        print(
            f"Resumen: {len(warnings)} aviso(s) y {len(errors)} error(es)",
            file=sys.stderr,
        )
        for msg in warnings + errors:
            print(f"  • {msg}", file=sys.stderr)
        print("─" * 56 + "\n", file=sys.stderr)


def parse_date(value: str) -> dt.date:
    """Convierte una fecha (dd/mm/aaaa) en objeto date."""

    try:
        return dt.datetime.strptime(value, "%d/%m/%Y").date()
    except ValueError as exc:  # pragma: no cover - validación sencilla
        raise argparse.ArgumentTypeError(
            f"Fecha inválida '{value}'. Usa el formato dd/mm/aaaa"
        ) from exc


def normalize_text(raw: Optional[str]) -> str:
    """Limpia textos eliminando espacios múltiples y arreglando encoding."""

    if not raw:
        return ""
    text = html.unescape(raw).replace("\xa0", " ").strip()
    # Intenta corregir caracteres mal decodificados (Ã³, etc.).
    try:
        text = text.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    text = re.sub(r"\s+", " ", text)
    return ILLEGAL_CHAR_PATTERN.sub(" ", text)


@dataclass
class TicketDetail:
    ticket_id: int
    fecha_detalle: str = ""
    contacto: str = ""
    empresa: str = ""
    motivo: str = ""
    modulo: str = ""
    submodulo: str = ""
    adjuntos: List[str] | None = None
    descripcion: str = ""
    estado: str = ""
    prioridad: str = ""
    fecha_respuesta: str = ""
    asignado_a: str = ""
    respuesta: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "fecha_detalle": self.fecha_detalle,
            "contacto_detalle": self.contacto,
            "empresa_detalle": self.empresa,
            "motivo_detalle": self.motivo,
            "modulo": self.modulo,
            "submodulo": self.submodulo,
            "adjuntos": "\n".join(self.adjuntos or []),
            "descripcion_detallada": self.descripcion,
            "estado_detalle": self.estado,
            "prioridad": self.prioridad,
            "fecha_respuesta_detalle": self.fecha_respuesta,
            "asignado_a": self.asignado_a,
            "respuesta_detallada": self.respuesta,
        }


class NavasoftTicketClient:
    """Cliente HTTP para la intranet de soporte Navasoft."""

    def __init__(self, base_url: str, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.portal_url = f"{self.base_url}/intranet_so24"
        self.tickets_url = f"{self.base_url}/soporteonline_tickets"
        self.session = requests.Session()
        self.timeout = timeout
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (compatible; ticket-exporter/1.0)",
            }
        )

    def login(
        self, username: str, password: str, *, announce: bool = True
    ) -> None:
        if announce:
            LOGGER.info("Iniciando sesión en intranet...")
        self.session.get(f"{self.portal_url}/index.php", timeout=self.timeout)
        resp = self.session.post(
            f"{self.portal_url}/controller/validarlogin.php",
            data={"user": username, "pass": password},
            timeout=self.timeout,
        )

        if resp.text.strip() != "1":
            raise RuntimeError("No se pudo iniciar sesión. Verifique credenciales.")

        # Carga inicial para obtener la URL del iframe de tickets.
        self.session.get(f"{self.portal_url}/consultar_tickets.php", timeout=self.timeout)
        self._bootstrap_ticket_session()

    def _bootstrap_ticket_session(self) -> None:
        LOGGER.debug("Sincronizando sesión con módulo de tickets...")
        landing = self.session.get(
            f"{self.portal_url}/consultar_tickets.php", timeout=self.timeout
        )
        match = re.search(r'data="(//[^"]+)"', landing.text)
        if not match:
            raise RuntimeError("No se encontró la URL del iframe de tickets.")

        iframe_url = "http:" + match.group(1)
        resp = self.session.get(iframe_url, timeout=self.timeout)
        # El iframe redirige mediante JS (location.href = 'consultar_tickets.php')
        next_match = re.search(r"location\.href\s*=\s*'([^']+)'", resp.text)
        if next_match:
            next_url = urljoin(iframe_url, next_match.group(1))
            self.session.get(next_url, timeout=self.timeout)

    def configure_filters(
        self, estado: str, fecha_inicio: dt.date, fecha_fin: dt.date
    ) -> None:
        LOGGER.info(
            "Configurando filtros: estado=%s, rango=%s-%s",
            estado,
            fecha_inicio.strftime("%d/%m/%Y"),
            fecha_fin.strftime("%d/%m/%Y"),
        )
        self._post_tickets(
            "controller/variables_sesion.php",
            {"type": "9", "estado": estado},
        )
        self._post_tickets(
            "controller/variables_sesion.php",
            {
                "type": "10",
                "p2": fecha_inicio.strftime("%d/%m/%Y"),
                "p3": fecha_fin.strftime("%d/%m/%Y"),
            },
        )

    def list_tickets(self) -> List[Dict[str, Any]]:
        LOGGER.info("Obteniendo listado de tickets...")
        resp = self._get_tickets("controller/listar_tickets.php")
        payload = resp.content.decode("utf-8-sig")
        data = json.loads(payload)
        LOGGER.info("Se encontraron %s tickets", len(data))
        return data

    def fetch_detail(self, ticket_id: int) -> TicketDetail:
        LOGGER.debug("Consultando detalle del ticket %s", ticket_id)
        self._post_tickets(
            "controller/variables_sesion.php",
            {"type": "7", "id": str(ticket_id)},
        )
        html_resp = self._get_tickets("view/detalle_ticket.php").text
        return self._parse_detail_html(ticket_id, html_resp)

    def _parse_detail_html(self, ticket_id: int, html_text: str) -> TicketDetail:
        soup = BeautifulSoup(html_text, "html.parser")

        def value_for(label: str) -> str:
            node = soup.find(
                lambda tag: tag.name == "div" and label in normalize_text(tag.get_text())
            )
            if not node:
                return ""
            sibling = node.find_next_sibling("div")
            return normalize_text(sibling.get_text(" ", strip=True)) if sibling else ""

        adjuntos: List[str] = []
        adj_label = soup.find(
            lambda tag: tag.name == "div" and "Adjunto" in tag.get_text()
        )
        if adj_label:
            adj_div = adj_label.find_next_sibling("div")
            if adj_div:
                for link in adj_div.find_all("a"):
                    href = link.get("href")
                    if href:
                        adjuntos.append(urljoin(f"{self.tickets_url}/", href))

        descripcion = soup.select_one("#descripcion_ticket")
        respuesta = soup.select_one("#respuesta_ticket")

        return TicketDetail(
            ticket_id=ticket_id,
            fecha_detalle=value_for("Fecha y hora"),
            contacto=value_for("Contacto"),
            empresa=value_for("Empresa"),
            motivo=value_for("Motivo"),
            modulo=value_for("Módulo") or value_for("M\u00f3dulo"),
            submodulo=value_for("Submódulo") or value_for("Subm\u00f3dulo"),
            adjuntos=adjuntos or None,
            descripcion=normalize_text(
                descripcion.get_text("\n", strip=True) if descripcion else ""
            ),
            estado=value_for("Estado"),
            prioridad=value_for("Prioridad"),
            fecha_respuesta=value_for("Fec. Respuesta"),
            asignado_a=value_for("Asignado a"),
            respuesta=normalize_text(
                respuesta.get_text("\n", strip=True) if respuesta else ""
            ),
        )

    def _post_tickets(self, path: str, data: Dict[str, Any]) -> requests.Response:
        resp = self.session.post(
            f"{self.tickets_url}/{path}", data=data, timeout=self.timeout
        )
        resp.raise_for_status()
        return resp

    def _get_tickets(self, path: str) -> requests.Response:
        resp = self.session.get(
            f"{self.tickets_url}/{path}", timeout=self.timeout
        )
        resp.raise_for_status()
        return resp


def build_dataframe(
    tickets: Iterable[Dict[str, Any]],
    details: Dict[int, TicketDetail],
    alerts: Optional[AlertReporter] = None,
) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for ticket in tickets:
        ticket_id = int(ticket.get("Idincidente"))
        detail = details.get(ticket_id)
        combined = {
            "ticket_id": ticket_id,
            "contacto": normalize_text(ticket.get("contacto")),
            "cliente": normalize_text(ticket.get("cliente")),
            "fecha_registro": _parse_datetime(
                ticket.get("fecha"),
                formats=("%m/%d/%Y %H:%M",),
                ticket_id=ticket_id,
                field="fecha_registro",
                alerts=alerts,
            ),
            "motivo": normalize_text(ticket.get("motivo")),
            "responsable": normalize_text(ticket.get("CodUsuRes")),
            "fecha_respuesta": _parse_datetime(
                ticket.get("FecRespuesta"),
                formats=("%d/%m/%Y %H:%M",),
                ticket_id=ticket_id,
                field="fecha_respuesta",
                alerts=alerts,
            ),
            "estado": normalize_text(ticket.get("estado")),
        }
        if detail:
            combined.update(detail.to_dict())
        rows.append(combined)

    df = pd.DataFrame(rows)
    if not df.empty:
        df.sort_values(by="fecha_registro", ascending=False, inplace=True)
    return df


def _parse_datetime(
    value: Optional[str],
    *,
    formats: tuple[str, ...] = ("%m/%d/%Y %H:%M", "%d/%m/%Y %H:%M"),
    ticket_id: Optional[int] = None,
    field: Optional[str] = None,
    alerts: Optional[AlertReporter] = None,
) -> Optional[pd.Timestamp]:
    if not value:
        return None
    value = value.strip()
    for fmt in formats:
        try:
            return pd.to_datetime(value, format=fmt)
        except (ValueError, TypeError):
            continue
    parsed = pd.to_datetime(value, errors="coerce")
    if alerts and pd.isna(parsed):
        ticket_label = f"ticket {ticket_id}" if ticket_id else "ticket desconocido"
        field_label = field or "fecha"
        alerts.warning(
            f"No se pudo interpretar {field_label} en {ticket_label}: '{value}'"
        )
    return parsed


def export_to_json(df: pd.DataFrame, output: Path) -> Path:
    """Guarda los registros para que el dashboard los sincronice directamente."""

    output.parent.mkdir(parents=True, exist_ok=True)
    payload = df.to_json(orient="records", date_format="iso", force_ascii=False)
    output.write_text(payload, encoding="utf-8")
    LOGGER.info("Datos preparados para el dashboard: %s", output)
    return output


def parse_args() -> argparse.Namespace:
    today = dt.date.today()
    parser = argparse.ArgumentParser(
        description="Descarga todos los tickets y los prepara para el dashboard"
    )
    parser.add_argument("--usuario", help="RUC o usuario de ingreso")
    parser.add_argument("--contrasena", help="Contraseña asociada")
    parser.add_argument(
        "--base-url",
        default="http://38.210.1.85:85",
        help="URL base del portal (default: %(default)s)",
    )
    parser.add_argument(
        "--desde",
        type=parse_date,
        default=parse_date("01/01/2010"),
        help="Fecha inicial dd/mm/aaaa (default: 01/01/2010)",
    )
    parser.add_argument(
        "--hasta",
        type=parse_date,
        default=today,
        help="Fecha final dd/mm/aaaa (default: hoy)",
    )
    parser.add_argument(
        "--estado",
        choices=STATUS_CHOICES.keys(),
        default="todos",
        help="Filtro de estado (default: %(default)s)",
    )
    parser.add_argument(
        "--salida",
        type=Path,
        default=Path("tickets_navasoft.json"),
        help="Ruta del archivo JSON temporal para el dashboard",
    )
    parser.add_argument(
        "--modo-batch",
        action="store_true",
        help="Ejecuta sin la consola interactiva",
    )
    parser.add_argument("--verbose", action="store_true", help="Muestra logs debug")
    return parser.parse_args()


def run_batch_mode(
    args: argparse.Namespace,
    progress_callback: Optional[callable] = None,
    status_callback: Optional[callable] = None,
    alerts: Optional[AlertReporter] = None,
) -> Path:
    if alerts is None:
        alerts = AlertReporter()

    try:
        client = NavasoftTicketClient(args.base_url)

        if status_callback:
            status_callback("Iniciando sesión...")
        alerts.info("Conectando con Navasoft...")
        try:
            client.login(args.usuario, args.contrasena)
        except Exception as exc:
            alerts.error(f"No se pudo iniciar sesión: {exc}")
            raise
        alerts.success("Sesión iniciada correctamente")

        if status_callback:
            status_callback("Configurando filtros...")
        client.configure_filters(STATUS_CHOICES[args.estado], args.desde, args.hasta)
        alerts.info(
            "Filtros aplicados: "
            f"estado={args.estado}, "
            f"desde={args.desde.strftime('%d/%m/%Y')}, "
            f"hasta={args.hasta.strftime('%d/%m/%Y')}"
        )

        if status_callback:
            status_callback("Descargando listado de tickets...")
        tickets = client.list_tickets()
        total = len(tickets)
        alerts.stats.tickets_total = total
        if total == 0:
            alerts.warning("No se encontraron tickets con los filtros seleccionados")
        else:
            alerts.info(f"Se encontraron {total} ticket(s) para exportar")

        if status_callback:
            status_callback("Leyendo detalle de cada ticket...")
        details: Dict[int, TicketDetail] = {}
        failed_ids: List[int] = []

        # Navasoft guarda el ticket seleccionado en variables de la sesión
        # HTTP. Por eso cada trabajador necesita su propia sesión autenticada:
        # compartir una sola mezclaría detalles entre tickets.
        try:
            requested_workers = max(
                1, int(os.getenv("NAV_DETAIL_WORKERS", "4"))
            )
        except ValueError:
            requested_workers = 4
            LOGGER.warning(
                "NAV_DETAIL_WORKERS no es válido; se usarán 4 trabajadores"
            )
        worker_count = min(requested_workers, total) if total else 1
        worker_clients = [client]

        for _ in range(worker_count - 1):
            worker_client = NavasoftTicketClient(args.base_url)
            try:
                worker_client.login(
                    args.usuario, args.contrasena, announce=False
                )
            except Exception as exc:
                LOGGER.warning(
                    "No se pudo abrir otra sesión de detalle; se usarán %s "
                    "trabajador(es): %s",
                    len(worker_clients),
                    exc,
                )
                break
            worker_clients.append(worker_client)

        worker_count = len(worker_clients)
        LOGGER.info(
            "Descargando detalles con %s sesión(es) paralela(s)", worker_count
        )
        available_clients: queue.SimpleQueue[NavasoftTicketClient] = (
            queue.SimpleQueue()
        )
        for worker_client in worker_clients:
            available_clients.put(worker_client)

        worker_state = threading.local()

        def initialize_worker() -> None:
            worker_state.client = available_clients.get()

        def fetch_one(ticket: Dict[str, Any]) -> Tuple[int, TicketDetail]:
            ticket_id = int(ticket.get("Idincidente"))
            detail = worker_state.client.fetch_detail(ticket_id)
            return ticket_id, detail

        completed = 0
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="navasoft-detail",
            initializer=initialize_worker,
        ) as executor:
            future_ids = {
                executor.submit(fetch_one, ticket): int(ticket.get("Idincidente"))
                for ticket in tickets
            }
            for future in concurrent.futures.as_completed(future_ids):
                ticket_id = future_ids[future]
                try:
                    result_id, detail = future.result()
                    details[result_id] = detail
                    alerts.stats.details_ok += 1
                except Exception as exc:  # pragma: no cover
                    failed_ids.append(ticket_id)
                    alerts.stats.details_failed += 1
                    LOGGER.exception(
                        "No se pudo obtener el detalle del ticket %s: %s",
                        ticket_id,
                        exc,
                    )
                    alerts.warning(
                        f"No se pudo leer el detalle del ticket {ticket_id}: {exc}"
                    )
                finally:
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total, ticket_id)

        if failed_ids:
            alerts.warning(
                f"{len(failed_ids)} ticket(s) se exportarán sin detalle completo"
            )

        df = build_dataframe(tickets, details, alerts=alerts)
        output = export_to_json(df, args.salida)
        alerts.stats.output = output.resolve()
        alerts.success(
            f"Datos listos para sincronizar en {output.resolve()} "
            f"({total} ticket(s), {alerts.stats.details_ok} con detalle)"
        )
        alerts.desktop_notify(
            "TicketNavasoft",
            f"Sincronización lista: {total} ticket(s) preparados",
        )
        alerts.summary()
        return output
    except Exception as exc:
        if not any(level == "error" for level, _ in alerts._entries):
            alerts.error(f"La exportación falló: {exc}")
        alerts.summary()
        raise


class StatusSpinner(threading.Thread):
    FRAMES = ["◢", "◣", "◤", "◥", "✶", "✷", "✸", "✹"]

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._running = threading.Event()
        self._running.set()
        self._status = "Inicializando consola..."
        self._lock = threading.Lock()

    def update(self, message: str) -> None:
        with self._lock:
            self._status = message

    def stop(self) -> None:
        self._running.clear()
        self._clear()

    def _clear(self) -> None:
        width = shutil.get_terminal_size((80, 20)).columns
        sys.stdout.write("\r" + " " * width + "\r")
        sys.stdout.flush()

    def run(self) -> None:  # pragma: no cover - animación
        idx = 0
        while self._running.is_set():
            with self._lock:
                status = self._status
            frame = self.FRAMES[idx % len(self.FRAMES)]
            idx += 1
            width = shutil.get_terminal_size((80, 20)).columns - 1
            sys.stdout.write(f"\r{frame} {status}"[:width])
            sys.stdout.flush()
            time.sleep(0.1)
        self._clear()


def run_console_app() -> None:
    system = platform.system().lower()
    if system == "darwin":
        print("ERRORx0001: No voy a correr en esta porqueria")
        return

    banner = """
╔═╗╦ ╦╔═╗╔═╗╔═╗╦╔═╗  ╔╦╗╔═╗╔╦╗╔═╗╔╗ ╔═╗
╠═╝║ ║╠╣ ╠╣ ║ ║║╚═╗   ║ ║ ║║║║║╣ ╠╩╗╚═╗
╩  ╚═╝╚  ╚  ╚═╝╩╚═╝   ╩ ╚═╝╩ ╩╚═╝╚═╝╚═╝
"""
    print(banner)
    print("Extractor turbo listo. Deja vacío para aceptar el valor por defecto.\n")

    def prompt(label: str, default: str) -> str:
        value = input(f"{label} [{default}]: ").strip()
        return value or default

    def prompt_date(label: str, default: dt.date) -> dt.date:
        while True:
            raw = input(
                f"{label} (dd/mm/aaaa) [{default.strftime('%d/%m/%Y')}]: "
            ).strip()
            if not raw:
                return default
            try:
                return parse_date(raw)
            except argparse.ArgumentTypeError as exc:
                print(f"  ⚠️  {exc}. Intenta nuevamente.")

    usuario = prompt("RUC/Usuario", "")
    contrasena = getpass.getpass("Contraseña [oculta]: ")
    if not usuario or not contrasena:
        raise RuntimeError("Usuario y contraseña son obligatorios")
    base_url = prompt("URL del portal", "http://38.210.1.85:85")
    desde = prompt_date("Desde", parse_date("01/01/2010"))
    hasta = prompt_date("Hasta", dt.date.today())
    estado_raw = prompt("Estado (pendientes/solucionados/todos)", "todos").lower()
    estado = estado_raw if estado_raw in STATUS_CHOICES else "todos"
    salida = Path(prompt("Archivo de salida", "tickets_navasoft.xlsx"))

    spinner = StatusSpinner()
    spinner.start()

    progress_started = False

    def status_callback(message: str) -> None:
        spinner.update(message)

    def progress_callback(done: int, total: int, ticket_id: int) -> None:
        nonlocal progress_started
        if not progress_started:
            progress_started = True
            spinner.stop()
            print("\nArmando reporte...\n")
        bar_width = 50
        filled = int(bar_width * done / total)
        bar = "█" * filled + "·" * (bar_width - filled)
        sys.stdout.write(
            f"\r[{bar}] {done}/{total} tickets procesados (ID {ticket_id})"
        )
        sys.stdout.flush()
        if done == total:
            sys.stdout.write("\n")

    args = argparse.Namespace(
        usuario=usuario,
        contrasena=contrasena,
        base_url=base_url,
        desde=desde,
        hasta=hasta,
        estado=estado,
        salida=salida,
        modo_batch=False,
        verbose=False,
    )

    alerts = AlertReporter()
    try:
        result = run_batch_mode(
            args,
            progress_callback=progress_callback,
            status_callback=status_callback,
            alerts=alerts,
        )
    finally:
        spinner.stop()

    print(f"\n✅ Reporte listo: {result.resolve()}\n")


def main() -> None:
    args = parse_args()
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
        sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:
        pass

    class _FlushHandler(logging.StreamHandler):
        def emit(self, record: logging.LogRecord) -> None:
            super().emit(record)
            self.flush()

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.DEBUG if args.verbose else logging.INFO)
    handler = _FlushHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s - %(levelname)s - %(name)s - %(message)s")
    )
    root.addHandler(handler)

    if platform.system().lower() == "darwin":
        print("ERRORx0001: No voy a correr en esta porqueria")
        return

    if args.modo_batch or all([args.usuario, args.contrasena]):
        def batch_progress(done: int, total: int, ticket_id: int) -> None:
            if total <= 0:
                return
            # línea parseable por el panel: progreso real ticket a ticket
            print(
                f"PROGRESS {done}/{total} id={ticket_id}",
                flush=True,
            )

        try:
            run_batch_mode(args, progress_callback=batch_progress)
        except Exception:
            raise SystemExit(1)
    else:
        run_console_app()


if __name__ == "__main__":
    main()
