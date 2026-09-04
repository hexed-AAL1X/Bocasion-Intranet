# Sincronizador de tickets NavaSoft

Descarga tickets desde Navasoft y los actualiza directamente en el dashboard.
Debe correrse en una **PC con acceso** a `38.210.1.85:85` (el hosting público
tipo Yachay no llega a esa red).

## Requisitos

- Python 3.10+
- Dependencias: `pip install -r requirements.txt` (mejor dentro de `.venv`)

## Uso rápido

```bash
# Desde la raíz de dashboard: deja activo el conector para el botón
npm run navasoft:connector

# Script (terminal)
./exportar_tickets.sh

# Panel con botón en el navegador
python3 boton_exportar.py
# → http://127.0.0.1:8765
```

Credenciales opcionales: `export.env.example` → `export.env`.

El botón **Actualizar Navasoft** de Tickets llama al conector local, ejecuta la
sincronización, muestra las terminales de `panel.html` y persiste los cambios
directamente mediante la API de Tickets. No genera ni descarga archivos Excel.
El conector debe permanecer abierto en la PC que tiene acceso a Navasoft.

## Modo avanzado

```bash
python3 ticket_exporter.py \
  --usuario TU_RUC \
  --contrasena TU_CLAVE \
  --estado todos \
  --desde 01/01/2010 \
  --hasta 15/07/2026 \
  --salida exports/tickets_navasoft.json \
  --modo-batch
```

## Notas

- Parsea fechas Navasoft: registro `MM/dd`, respuesta `dd/MM`.
- Incluye listado + detalle de cada ticket.
- En macOS el script se niega a correr a propósito.
