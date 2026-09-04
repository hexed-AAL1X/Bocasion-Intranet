"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import type { DateSelectArg, EventClickArg } from "@fullcalendar/core";
import styles from "../app/page.module.css";
import { FiX, FiTrash2, FiCheck } from "react-icons/fi";
import { useFlyoutMount } from "@/hooks/useFlyoutMount";

export type CalendarEvent = { id?: string; title: string; date: string };

type CalendarOverlayProps = {
  show: boolean;
  onClose: () => void;
  events?: CalendarEvent[];
  onAdd?: (title: string, date: string) => void;
  onDelete?: (id: string) => void;
  currentDate?: Date;
  setCurrentDate?: (d: Date) => void;
};

export function CalendarOverlay({
  show,
  onClose,
  events = [],
  onAdd,
  onDelete,
  currentDate,
  setCurrentDate,
}: CalendarOverlayProps) {
  const { mounted, exiting } = useFlyoutMount(show);
  const dateValue = currentDate ?? new Date();
  const calendarRef = useRef<FullCalendar | null>(null);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const months = useMemo(
    () => ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
    []
  );
  const normalizeDate = (value: string | Date) => {
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "";
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().split("T")[0];
  };
  const [formVisible, setFormVisible] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState(normalizeDate(dateValue));
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);
  const clampToYear = (date: Date) => {
    if (date.getFullYear() < currentYear) {
      return new Date(currentYear, 0, 1);
    }
    if (date.getFullYear() > currentYear) {
      return new Date(currentYear, 11, 1);
    }
    return date;
  };
  const openForm = (dateISO: string) => {
    setFormDate(dateISO);
    setFormTitle("");
    setFormVisible(true);
  };
  const closeForm = () => {
    setFormVisible(false);
    setFormTitle("");
  };
  const handleSelect = (info: DateSelectArg) => {
    openForm(info.startStr.split("T")[0]);
  };
  const handleEventClick = (info: EventClickArg) => {
    setPendingDelete({ id: info.event.id?.toString(), title: info.event.title, date: info.event.startStr });
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAdd || !formTitle.trim() || !formDate) return;
    onAdd(formTitle.trim(), formDate);
    closeForm();
  };
  const confirmDelete = async () => {
    if (!pendingDelete?.id || !onDelete) return;
    onDelete(pendingDelete.id);
    setPendingDelete(null);
  };
  const cancelDelete = () => setPendingDelete(null);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingDelete) {
        setPendingDelete(null);
        return;
      }
      if (formVisible) {
        closeForm();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, pendingDelete, formVisible, onClose]);

  if (!mounted) return null;

  return (
    <section
      className={`${styles.calendarPage} ${styles.calendarPageActive}`}
      data-doc-screenshot="calendar-overlay"
      aria-label="Calendario"
    >
      <div className={`${styles.calendarCard} ${exiting ? styles.flyoutPs5Exit : styles.flyoutPs5Enter}`}>
        <div className={styles.calendarHeaderRow}>
          <div>
            <h3>Calendario</h3>
            <p>Selecciona una fecha para ver eventos y recordatorios.</p>
          </div>
          <div className={styles.calendarControls}>
            <select
              className={styles.calendarSelect}
              value={dateValue.getFullYear() === currentYear ? dateValue.getMonth() : ""}
              onChange={(e) => {
                const monthIndex = Number(e.target.value);
                if (Number.isNaN(monthIndex)) return;
                const targetDate = new Date(currentYear, monthIndex, 1);
                setCurrentDate?.(targetDate);
                calendarRef.current?.getApi().gotoDate(targetDate);
              }}
            >
              <option value="" disabled>
                Mes actual
              </option>
              {months.map((m, idx) => (
                <option key={`${currentYear}-${m}`} value={idx}>
                  {m} {currentYear}
                </option>
              ))}
            </select>
            <button className={styles.calendarCloseBtn} onClick={onClose} aria-label="Cerrar calendario">
              <FiX />
            </button>
          </div>
        </div>
        <div className={styles.calendarBody}>
          <FullCalendar
            ref={(instance) => {
              calendarRef.current = instance;
            }}
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            height="auto"
            events={events}
            selectable
            select={handleSelect}
            eventClick={handleEventClick}
            headerToolbar={{ start: "prev,next today", center: "title", end: "" }}
            locale={esLocale}
            buttonText={{ today: "Hoy" }}
            initialDate={dateValue}
            datesSet={(info) => {
              const visibleMonth = new Date(info.view?.currentStart ?? info.start);
              const safeDate = clampToYear(visibleMonth);
              if (safeDate.getTime() !== visibleMonth.getTime()) {
                calendarRef.current?.getApi().gotoDate(safeDate);
                return;
              }
              setCurrentDate?.(safeDate);
            }}
          />
        </div>
      </div>

      {formVisible && (
        <div className={styles.calendarModalOverlay}>
          <div className={styles.calendarModalCard} role="dialog" aria-modal="true" aria-label="Nuevo evento">
            <div className={styles.calendarModalHeader}>
              <div>
                <p>Registrar evento</p>
                <small>Define el título y la fecha para compartirlo con tu equipo.</small>
              </div>
              <button className={styles.calendarModalClose} onClick={closeForm} aria-label="Cerrar formulario">
                <FiX />
              </button>
            </div>
            <form className={styles.calendarModalForm} onSubmit={handleSubmit}>
              <label>
                <span>Título</span>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ej. Reunión con soporte"
                  required
                />
              </label>
              <label>
                <span>Fecha</span>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
              </label>
              <div className={styles.calendarModalActions}>
                <button type="button" className={styles.btnGhost} onClick={closeForm}>
                  Cancelar
                </button>
                <button type="submit" className={styles.calendarPrimaryBtn}>
                  <FiCheck /> Guardar evento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className={styles.calendarModalOverlay}>
          <div className={styles.calendarConfirmCard} role="dialog" aria-modal="true" aria-label="Eliminar evento">
            <h4>
              ¿Eliminar &quot;{pendingDelete.title}&quot;?
            </h4>
            <p>
              {pendingDelete.date
                ? `El evento está programado para ${new Date(pendingDelete.date).toLocaleDateString("es-PE", {
                    weekday: "short",
                    day: "2-digit",
                    month: "long",
                  })}.`
                : "El evento no tiene fecha asociada."}
            </p>
            <div className={styles.calendarConfirmActions}>
              <button type="button" className={styles.btnGhost} onClick={cancelDelete}>
                Cancelar
              </button>
              <button type="button" className={styles.calendarDangerBtn} onClick={confirmDelete}>
                <FiTrash2 /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
