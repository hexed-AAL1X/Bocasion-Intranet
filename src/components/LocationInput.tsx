import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { useLocationSearch, type LocationSuggestion } from "@/hooks/useLocationSearch";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import styles from "./LocationInput.module.css";

export interface LocationInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  onClose?: () => void;
  placeholder?: string;
  aliases?: string[];
}

export type LocationValue = {
  label: string;
  query: string;
  lat?: string;
  lon?: string;
  display_name?: string;
};

export type LocationAliasValue = {
  alias: string;
  query: string;
  display_name: string;
  lat?: string;
  lon?: string;
};

const LOCATION_ALIAS_STORAGE_KEY = "dashboard.locationAliases";

const normalizeAliasText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const normalizeLocationAliasValue = (value: unknown): LocationAliasValue | null => {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<LocationAliasValue> & { label?: string; name?: string };
  const alias = String(raw.alias || raw.label || raw.name || "").trim();
  const displayName = String(raw.display_name || raw.query || alias).trim();

  if (!alias || !displayName) return null;

  return {
    alias,
    query: String(raw.query || displayName).trim(),
    display_name: displayName,
    lat: raw.lat ? String(raw.lat) : undefined,
    lon: raw.lon ? String(raw.lon) : undefined,
  };
};

const loadStoredLocationAliases = (): LocationAliasValue[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LOCATION_ALIAS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(normalizeLocationAliasValue).filter((item): item is LocationAliasValue => Boolean(item));
  } catch {
    return [];
  }
};

const saveStoredLocationAliases = (aliases: LocationAliasValue[]) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LOCATION_ALIAS_STORAGE_KEY, JSON.stringify(aliases.slice(0, 100)));
  } catch {
    // Ignore storage errors.
  }
};

const findStoredLocationAlias = (value: string, aliases: LocationAliasValue[]) => {
  const normalized = normalizeAliasText(value);
  if (!normalized) return null;

  return (
    aliases.find((alias) => {
      return [alias.alias, alias.query, alias.display_name].some((candidate) => normalizeAliasText(candidate) === normalized);
    }) || null
  );
};

const normalizeLocationValue = (value: unknown): LocationValue | null => {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? { label: trimmed, query: trimmed } : null;
  }

  if (typeof value === "object") {
    const raw = value as Partial<LocationValue> & { name?: string };
    const label = String(raw.label || raw.name || raw.display_name || raw.query || "").trim();
    const query = String(raw.query || raw.display_name || label).trim();
    if (!label && !query) return null;

    return {
      label: label || query,
      query: query || label,
      lat: raw.lat ? String(raw.lat) : undefined,
      lon: raw.lon ? String(raw.lon) : undefined,
      display_name: String(raw.display_name || query || label).trim(),
    };
  }

  return null;
};

const labelFromSuggestion = (location: LocationSuggestion) => {
  const shortName = location.name?.trim();
  return location.display_name?.trim() || shortName || location.display_name;
};

const buildPreviewCandidates = (text: string, location?: LocationValue | null) => {
  const raw = text.trim();
  const candidates = new Set<string>();

  if (raw) {
    candidates.add(raw);

    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      candidates.add(parts.slice(1).join(", "));
      candidates.add(parts.slice(1, -1).join(", "));
    }
  }

  if (location?.query?.trim()) candidates.add(location.query.trim());
  if (location?.display_name?.trim()) candidates.add(location.display_name.trim());
  if (location?.label?.trim()) candidates.add(location.label.trim());

  return Array.from(candidates).filter(Boolean);
};

export const LocationInput: React.FC<LocationInputProps> = ({
  value,
  onChange,
  onClose,
  placeholder = "Buscar ubicación...",
  aliases = [],
}) => {
  const normalizedValue = normalizeLocationValue(value);
  const { darkMode } = useUiPrefs();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(normalizedValue?.label || "");
  const [savedLocation, setSavedLocation] = useState<LocationValue | null>(normalizedValue);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: string; lon: string } | null>(
    normalizedValue?.lat && normalizedValue?.lon ? { lat: normalizedValue.lat, lon: normalizedValue.lon } : null
  );
  const [storedAliases, setStoredAliases] = useState<LocationAliasValue[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const [isAliasEditorOpen, setIsAliasEditorOpen] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const { suggestions, loading, searchLocations } = useLocationSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const savedLocationRef = useRef<LocationValue | null>(normalizedValue);
  const [cssVars, setCssVars] = useState<Record<string, string>>({});

  const updateDropdownPos = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const dropdownHeight = 300;
      const spaceBelow = window.innerHeight - rect.bottom;
      const width = Math.max(rect.width, 260);
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        setDropdownPos({ top: rect.top - dropdownHeight - 4, left: rect.left, width });
      } else {
        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width });
      }
    }
  };

  const openDropdown = () => {
    updateDropdownPos();
    setIsOpen(true);
  };

  const resolveLocationPreview = useCallback(
    async (locationQuery: string, fallback?: LocationValue | null) => {
      const candidates = buildPreviewCandidates(locationQuery, fallback);

      for (const candidate of candidates) {
        if (candidate.trim().length < 2) continue;

        try {
          const results = await searchLocations(candidate);
          if (!results.length) continue;

          const normalized = candidate.toLowerCase();
          const match =
            results.find(
              (location) => location.display_name.toLowerCase() === normalized || location.name.toLowerCase() === normalized
            ) || results[0];

          return match;
        } catch (error) {
          console.error("No se pudo resolver la vista previa de ubicación:", error);
        }
      }

      return null;
    },
    [searchLocations]
  );

  useEffect(() => {
    const stored = loadStoredLocationAliases();
    const optionAliases = aliases
      .map((alias) => alias.trim())
      .filter(Boolean)
      .filter((alias) => !stored.some((storedAlias) => normalizeAliasText(storedAlias.alias) === normalizeAliasText(alias)))
      .map((alias) => ({ alias, query: alias, display_name: alias }));
    setStoredAliases([...stored, ...optionAliases]);
  }, [aliases]);

  useEffect(() => {
    const pageEl = containerRef.current?.closest('[class*="page"]') as HTMLElement | null;
    if (pageEl) {
      const computed = getComputedStyle(pageEl);
      setCssVars({
        "--card": computed.getPropertyValue("--card").trim(),
        "--text": computed.getPropertyValue("--text").trim(),
        "--text-dim": computed.getPropertyValue("--text-dim").trim(),
        "--border": computed.getPropertyValue("--border").trim(),
        "--primary": computed.getPropertyValue("--primary").trim(),
        "--bg": computed.getPropertyValue("--bg").trim(),
      });
    }
  }, []);

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      openDropdown();
    });
    return () => cancelAnimationFrame(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      const aliasMatch = findStoredLocationAlias(trimmed, storedAliases);

      if (aliasMatch) {
        const aliasValue: LocationValue = {
          label: aliasMatch.alias,
          query: aliasMatch.query,
          display_name: aliasMatch.display_name,
          lat: aliasMatch.lat,
          lon: aliasMatch.lon,
        };
        setSavedLocation(aliasValue);
        savedLocationRef.current = aliasValue;
        setQuery(aliasValue.label);
        if (aliasValue.lat && aliasValue.lon) {
          setSelectedCoords({ lat: aliasValue.lat, lon: aliasValue.lon });
        } else {
          setSelectedCoords(null);
        }
        return;
      }

      const current = savedLocationRef.current;
      if (current && current.label.trim() === trimmed && current.lat && current.lon) {
        setQuery(current.label);
        setSelectedCoords({ lat: current.lat, lon: current.lon });
        return;
      }
    }

    const nextValue = normalizeLocationValue(value);
    setSavedLocation(nextValue);
    savedLocationRef.current = nextValue;
    setQuery(nextValue?.label || "");
    if (!nextValue) {
      setSelectedCoords(null);
      return;
    }

    if (nextValue.lat && nextValue.lon) {
      setSelectedCoords({ lat: nextValue.lat, lon: nextValue.lon });
    } else {
      setSelectedCoords(null);
    }
  }, [value, storedAliases]);

  useEffect(() => {
    if (!isOpen || isGeolocating) return;
    const trimmed = query.trim();
    void searchLocations(trimmed.length > 1 ? trimmed : "");
  }, [isOpen, query, searchLocations, isGeolocating]);

  useEffect(() => {
    if (!isOpen || selectedCoords || isGeolocating) return;

    const lookupValue = savedLocation?.query || query;
    if (lookupValue.trim().length < 2) return;

    let cancelled = false;
    void resolveLocationPreview(lookupValue, savedLocation).then((location) => {
      if (!cancelled && location) {
        setSelectedCoords({ lat: location.lat, lon: location.lon });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, query, savedLocation, selectedCoords, resolveLocationPreview, isGeolocating]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    setSelectedCoords(null);
    openDropdown();
  };

  const commitLocation = useCallback((next: LocationValue | null) => {
    setSavedLocation(next);
    savedLocationRef.current = next;
    setQuery(next?.label || "");
    setSelectedCoords(next?.lat && next?.lon ? { lat: next.lat, lon: next.lon } : null);
    setIsAliasEditorOpen(false);
    setAliasDraft("");
    onChange(next || "");
  }, [onChange]);

  const handleClearLocation = () => {
    commitLocation(null);
    openDropdown();
  };

  const handleSelectLocation = (location: LocationSuggestion) => {
    const label = labelFromSuggestion(location);
    const displayName = location.display_name || location.name || label;
    commitLocation({
      label,
      query: displayName,
      lat: location.lat,
      lon: location.lon,
      display_name: displayName,
    });
  };

  const handleSelectAlias = useCallback((alias: LocationAliasValue) => {
    commitLocation({
      label: alias.alias,
      query: alias.query,
      lat: alias.lat,
      lon: alias.lon,
      display_name: alias.display_name,
    });
  }, [commitLocation]);

  const handleCommitDraft = useCallback(async () => {
    const trimmed = query.trim();

    if (!trimmed) {
      commitLocation(null);
      setIsOpen(false);
      return;
    }

    const aliasMatch = findStoredLocationAlias(trimmed, storedAliases);
    if (aliasMatch) {
      handleSelectAlias(aliasMatch);
      setIsOpen(false);
      return;
    }

    if (savedLocation && trimmed === savedLocation.label.trim()) {
      setIsOpen(false);
      return;
    }

    let nextLocation: LocationValue = {
      label: trimmed,
      query: savedLocation?.query || trimmed,
      lat: savedLocation?.lat,
      lon: savedLocation?.lon,
      display_name: savedLocation?.display_name || trimmed,
    };

    if (!nextLocation.lat || !nextLocation.lon) {
      const resolved = await resolveLocationPreview(trimmed, savedLocation);
      if (resolved) {
        nextLocation = {
          label: trimmed,
          query: resolved.display_name || resolved.name || trimmed,
          lat: resolved.lat,
          lon: resolved.lon,
          display_name: resolved.display_name || resolved.name || trimmed,
        };
      }
    }

    commitLocation(nextLocation);
    setIsOpen(false);
  }, [query, savedLocation, storedAliases, resolveLocationPreview, commitLocation, handleSelectAlias]);

  const handleSaveAlias = () => {
    const alias = aliasDraft.trim();
    if (!alias || !selectedCoords || !savedLocation) return;

    const currentLabel = savedLocation.display_name || savedLocation.query || savedLocation.label;
    const nextAlias: LocationAliasValue = {
      alias,
      query: currentLabel,
      display_name: currentLabel,
      lat: selectedCoords.lat,
      lon: selectedCoords.lon,
    };

    setStoredAliases((prev) => {
      const filtered = prev.filter((item) => item.alias.trim().toLowerCase() !== alias.toLowerCase());
      const next = [nextAlias, ...filtered];
      saveStoredLocationAliases(next);
      return next;
    });

    setAliasDraft("");
    setIsAliasEditorOpen(false);
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) return;

    setIsGeolocating(true);
    void searchLocations("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const coords = { lat: String(latitude), lon: String(longitude) };
        setSelectedCoords(coords);

        let label = "";
        let displayName = "";

        // Usar Photon (Komoot) para reverse geocoding - sin rate-limit agresivo
        try {
          const res = await fetch(
            `https://photon.komoot.io/reverse?lon=${longitude}&lat=${latitude}`
          );

          if (res.ok) {
            const data = await res.json();
            const feature = data.features?.[0]?.properties;

            if (feature) {
              const parts: string[] = [];

              if (feature.street) {
                const streetPart = feature.housenumber
                  ? `${feature.street} ${feature.housenumber}`
                  : feature.street;
                parts.push(streetPart);
              } else if (feature.name) {
                parts.push(feature.name);
              }

              if (feature.postcode && feature.district) {
                parts.push(`${feature.postcode} ${feature.district}`);
              } else if (feature.district) {
                parts.push(feature.district);
              } else if (feature.city) {
                parts.push(feature.city);
              }

              if (feature.country) parts.push(feature.country);

              displayName = parts.join(", ");
              label = displayName;
            }
          }
        } catch {
          // continuar con fallback
        }

        setIsGeolocating(false);

        if (displayName && label) {
          commitLocation({
            label,
            query: displayName,
            lat: coords.lat,
            lon: coords.lon,
            display_name: displayName,
          });
        } else {
          const fallback = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          commitLocation({
            label: fallback,
            query: fallback,
            lat: coords.lat,
            lon: coords.lon,
            display_name: fallback,
          });
        }
      },
      () => {
        setIsGeolocating(false);
        setQuery(savedLocation?.label || "");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const groupedSuggestions = suggestions.reduce((acc, location) => {
    const parts = location.display_name.split(",").map((part) => part.trim()).filter(Boolean);
    const groupName = parts.length > 1 ? parts[parts.length - 2] : "Ubicaciones";

    if (!acc[groupName]) {
      acc[groupName] = [];
    }

    acc[groupName].push(location);
    return acc;
  }, {} as Record<string, LocationSuggestion[]>);

  const aliasSuggestions = storedAliases.filter((alias) => {
    const search = query.trim().toLowerCase();
    if (!search) return true;

    return [alias.alias, alias.query, alias.display_name].some((candidate) => candidate.toLowerCase().includes(search));
  });

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideContainer = containerRef.current?.contains(target);
      const clickedInsideDropdown = dropdownRef.current?.contains(target);

      if (containerRef.current && !clickedInsideContainer && !clickedInsideDropdown) {
        void handleCommitDraft().then(() => onClose?.());
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [handleCommitDraft, onClose]);

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => {
          openDropdown();
          const resolvedQuery = savedLocation?.query || query;
          if (resolvedQuery.trim().length > 1 && !selectedCoords) {
            void resolveLocationPreview(resolvedQuery, savedLocation).then((location) => {
              if (location) {
                setSelectedCoords({ lat: location.lat, lon: location.lon });
              }
            });
          }
        }}
        onMouseDown={openDropdown}
        onBlur={() => {
          window.setTimeout(() => {
            const activeElement = document.activeElement;
            const focusedInsideContainer = containerRef.current?.contains(activeElement);
            const focusedInsideDropdown = dropdownRef.current?.contains(activeElement);

            if (!focusedInsideContainer && !focusedInsideDropdown) {
              void handleCommitDraft();
            }
          }, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleCommitDraft();
          }

          if (event.key === "Escape") {
            setQuery(savedLocation?.label || "");
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        className={styles.input}
        autoFocus
      />

      {(query.trim() || savedLocation || selectedCoords) && (
        <button
          type="button"
          className={styles.clearBtn}
          aria-label="Borrar ubicación"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={handleClearLocation}
        >
          ×
        </button>
      )}

      {isOpen && dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          onMouseDown={(e) => {
            // Prevent input blur only when clicking interactive elements, not scrollbar
            const target = e.target as HTMLElement;
            if (target.closest("button, li, a")) e.preventDefault();
          }}
          onWheel={(e) => {
            e.stopPropagation();
            const target = e.currentTarget;
            target.scrollTop += e.deltaY;
          }}
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, ...cssVars } as React.CSSProperties}
        >
          <button type="button" className={styles.currentLocationBtn} onClick={handleGetCurrentLocation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 3L3 10.5l7.5 3L14 21l7-18z" />
            </svg>
            Ubicación actual
          </button>

          {aliasSuggestions.length > 0 && (
            <div className={styles.aliasSection}>
              <div className={styles.aliasSectionTitle}>Apodos guardados</div>
              <ul className={styles.aliasList}>
                {aliasSuggestions.map((alias) => (
                  <li
                    key={`${alias.alias}-${alias.display_name}`}
                    className={styles.aliasItem}
                  >
                    <div className={styles.aliasItemContent} onClick={() => handleSelectAlias(alias)}>
                      <div className={styles.aliasItemLabel}>{alias.alias}</div>
                      <div className={styles.aliasItemMeta}>{alias.display_name}</div>
                    </div>
                    <button
                      type="button"
                      className={styles.aliasDeleteBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        const updated = storedAliases.filter(
                          (a) => !(a.alias === alias.alias && a.display_name === alias.display_name)
                        );
                        saveStoredLocationAliases(updated);
                        setStoredAliases(updated);
                      }}
                      title="Eliminar apodo"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading && <div className={styles.loading}>Buscando ubicaciones...</div>}
          {!loading && suggestions.length === 0 && aliasSuggestions.length === 0 && (
            <div className={styles.noResults}>No se encontraron ubicaciones</div>
          )}

          {suggestions.length > 0 && (
            <ul className={styles.list}>
              {Object.entries(groupedSuggestions).map(([groupName, items]) => (
                <React.Fragment key={groupName}>
                  <li className={styles.groupHeader}>
                    <div className={styles.groupHeaderText}>{groupName}</div>
                  </li>
                  {items.map((location, idx) => (
                    <li
                      key={`${location.lat}-${location.lon}-${idx}`}
                      onClick={() => handleSelectLocation(location)}
                      className={styles.item}
                    >
                      <div className={styles.itemName}>{location.name}</div>
                      <div className={styles.itemAddress}>{location.display_name}</div>
                    </li>
                  ))}
                </React.Fragment>
              ))}
            </ul>
          )}

          {selectedCoords && (
            <div className={styles.minimapContainer}>
              <div className={styles.minimapClip}>
                <iframe
                  className={`${styles.minimap} ${darkMode ? styles.minimapDark : ""}`}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(selectedCoords.lon) - 0.003},${Number(selectedCoords.lat) - 0.002},${Number(selectedCoords.lon) + 0.003},${Number(selectedCoords.lat) + 0.002}&layer=mapnik&marker=${selectedCoords.lat},${selectedCoords.lon}`}
                  title="Mapa de ubicación"
                />
              </div>
            </div>
          )}

          {selectedCoords && savedLocation && (
            <div className={styles.aliasEditorSection}>
              {!isAliasEditorOpen ? (
                <button type="button" className={styles.aliasActionBtn} onClick={() => setIsAliasEditorOpen(true)}>
                  Añadir apodo
                </button>
              ) : (
                <div className={styles.aliasForm}>
                  <input
                    type="text"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    placeholder="Ej. Casa, Oficina, Taller"
                    className={styles.aliasInput}
                    autoFocus
                  />
                  <div className={styles.aliasButtonsRow}>
                    <button type="button" className={styles.aliasSaveBtn} onClick={handleSaveAlias}>
                      Guardar apodo
                    </button>
                    <button
                      type="button"
                      className={styles.aliasCancelBtn}
                      onClick={() => {
                        setIsAliasEditorOpen(false);
                        setAliasDraft("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>,
        document.body
      )}
    </div>
  );
};
