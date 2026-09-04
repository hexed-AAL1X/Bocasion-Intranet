"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
} from "date-fns";
import { es } from "date-fns/locale";
import styles from "./DateInput.module.css";

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, onClose }) => {
  const selectedDate = value ? new Date(value + "T00:00:00") : null;
  const [viewDate, setViewDate] = useState(selectedDate || new Date());
  const [isOpen, setIsOpen] = useState(true);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [cssVars, setCssVars] = useState<Record<string, string>>({});

  useEffect(() => {
    const pageEl = containerRef.current?.closest('[class*="page"]') as HTMLElement | null;
    if (!pageEl) return;
    const id = window.requestAnimationFrame(() => {
      const computed = getComputedStyle(pageEl);
      setCssVars({
        "--card": computed.getPropertyValue("--card").trim(),
        "--text": computed.getPropertyValue("--text").trim(),
        "--text-dim": computed.getPropertyValue("--text-dim").trim(),
        "--border": computed.getPropertyValue("--border").trim(),
        "--primary": computed.getPropertyValue("--primary").trim(),
        "--bg": computed.getPropertyValue("--bg").trim(),
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 320; // approximate calendar height
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        // Open above
        setDropdownPos({ top: rect.top - dropdownHeight - 4, left: rect.left });
      } else {
        // Open below
        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
    }
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideContainer = containerRef.current?.contains(target);
      const clickedInsideDropdown = dropdownRef.current?.contains(target);

      if (!clickedInsideContainer && !clickedInsideDropdown) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const weekDays = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

  const handleSelectDay = (day: Date) => {
    const formatted = format(day, "yyyy-MM-dd");
    onChange(formatted);
    onClose();
  };

  const handleClear = () => {
    onChange("");
    onClose();
  };

  const handleToday = () => {
    const today = format(new Date(), "yyyy-MM-dd");
    onChange(today);
    onClose();
  };

  const displayValue = selectedDate
    ? format(selectedDate, "d 'de' MMMM, yyyy", { locale: es })
    : "";

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        type="text"
        readOnly
        className={styles.input}
        value={displayValue}
        placeholder="Seleccionar fecha..."
        onClick={() => setIsOpen(true)}
        autoFocus
      />

      {isOpen && dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className={styles.calendar}
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, ...cssVars } as React.CSSProperties}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <div className={styles.header}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setViewDate(subMonths(viewDate, 1))}
            >
              ‹
            </button>
            <span className={styles.monthTitle}>
              {format(viewDate, "MMMM yyyy", { locale: es })}
            </span>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setViewDate(addMonths(viewDate, 1))}
            >
              ›
            </button>
          </div>

          <div className={styles.weekRow}>
            {weekDays.map((d) => (
              <span key={d} className={styles.weekDay}>{d}</span>
            ))}
          </div>

          <div className={styles.daysGrid}>
            {days.map((day) => {
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isCurrentMonth = isSameMonth(day, viewDate);
              const isTodayDate = isToday(day);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  className={`${styles.dayBtn} ${isSelected ? styles.daySelected : ""} ${!isCurrentMonth ? styles.dayOutside : ""} ${isTodayDate && !isSelected ? styles.dayToday : ""}`}
                  onClick={() => handleSelectDay(day)}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.footerBtn} onClick={handleToday}>
              Hoy
            </button>
            <button type="button" className={styles.footerBtnClear} onClick={handleClear}>
              Limpiar
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
