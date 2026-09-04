"use client";

import { useCallback, useRef, useState } from "react";

export type LocationSuggestion = {
  name: string;
  lat: string;
  lon: string;
  display_name: string;
};

/* ═══════════════════════════════════════════════════════════════════════
   Street-type abbreviations (Peru / LATAM)
   ═══════════════════════════════════════════════════════════════════════ */
const STREET_TYPES: Record<string, string> = {
  jr: "Jirón", av: "Avenida", ca: "Calle", psj: "Pasaje", pje: "Pasaje",
  urb: "Urbanización", prol: "Prolongación", mz: "Manzana", lt: "Lote",
  cdra: "Cuadra", int: "Interior", dpto: "Departamento", pq: "Parque",
  plza: "Plaza", plz: "Plaza", sta: "Santa", sto: "Santo", gral: "General",
  bol: "Bolívar", cjn: "Callejón", pza: "Plaza", ovl: "Óvalo",
};

const PLACE_ABBREVIATIONS: Record<string, string> = {
  upn: "Universidad Privada del Norte",
  pucp: "Pontificia Universidad Católica del Perú",
  unmsm: "Universidad Nacional Mayor de San Marcos",
  uni: "Universidad Nacional de Ingeniería",
  ulima: "Universidad de Lima",
  usil: "Universidad San Ignacio de Loyola",
  upc: "Universidad Peruana de Ciencias Aplicadas",
  esan: "Universidad ESAN",
  bcp: "Banco de Crédito del Perú",
  bbva: "BBVA Perú",
  bcrp: "Banco Central de Reserva del Perú",
  sunat: "Superintendencia Nacional de Aduanas y de Administración Tributaria",
  reniec: "Registro Nacional de Identificación y Estado Civil",
};

const STREET_TYPE_KEYS = Object.keys(STREET_TYPES);
const STREET_TYPE_RE = new RegExp(`^(${STREET_TYPE_KEYS.join("|")})\\.?\\s+`, "i");

const expandAbbrev = (text: string): string => {
  let out = text.trim();
  const normalized = out.toLowerCase().replace(/\./g, "");
  if (PLACE_ABBREVIATIONS[normalized]) {
    return `${PLACE_ABBREVIATIONS[normalized]} Perú`;
  }
  const m = out.match(STREET_TYPE_RE);
  if (m) {
    const abbr = m[1].toLowerCase().replace(/\.$/, "");
    out = (STREET_TYPES[abbr] || m[1]) + " " + out.slice(m[0].length);
  }
  return out.replace(/\s{2,}/g, " ").trim();
};

/* ═══════════════════════════════════════════════════════════════════════
   Smart address parser
   "Jr Rio de Janeiro 483 Sicuani Ate"
   → { type: "Jirón", name: "Rio de Janeiro", number: "483",
       trailing: ["Sicuani", "Ate"] }
   ═══════════════════════════════════════════════════════════════════════ */
type Parsed = {
  type: string;     // "Jirón"
  name: string;     // "Rio de Janeiro"
  number: string;   // "483"
  trailing: string[];  // ["Sicuani", "Ate"] – could be district, city, zone
};

const parseAddress = (raw: string): Parsed => {
  let text = raw.trim();
  const result: Parsed = { type: "", name: "", number: "", trailing: [] };

  // If user used commas, honour them
  if (text.includes(",")) {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    const first = parts[0];
    result.trailing = parts.slice(1);

    const m = first.match(STREET_TYPE_RE);
    if (m) {
      result.type = STREET_TYPES[m[1].toLowerCase().replace(/\.$/, "")] || m[1];
      text = first.slice(m[0].length).trim();
    } else {
      text = first;
    }

    const numMatch = text.match(/\b(\d{1,5})\b/);
    if (numMatch) {
      result.number = numMatch[1];
      text = text.replace(numMatch[0], "").replace(/\s{2,}/g, " ").trim();
    }
    result.name = text;
    return result;
  }

  // No commas — parse tokens
  const m = text.match(STREET_TYPE_RE);
  if (m) {
    result.type = STREET_TYPES[m[1].toLowerCase().replace(/\.$/, "")] || m[1];
    text = text.slice(m[0].length).trim();
  }

  const tokens = text.split(/\s+/);
  const nameTokens: string[] = [];
  let foundNumber = false;

  for (const tok of tokens) {
    if (!foundNumber && /^\d{1,5}$/.test(tok)) {
      result.number = tok;
      foundNumber = true;
      continue;
    }
    if (foundNumber) {
      result.trailing.push(tok);
    } else {
      nameTokens.push(tok);
    }
  }
  result.name = nameTokens.join(" ");
  return result;
};

/* ═══════════════════════════════════════════════════════════════════════
   Build many query variants (comma-formatted = geocoder-friendly)

   For "Jr Rio de Janeiro 483 Sicuani Ate" we produce:
     "Jirón Rio de Janeiro 483, Sicuani, Ate, Peru"
     "Jirón Rio de Janeiro 483, Sicuani, Ate"
     "Jirón Rio de Janeiro 483, Ate, Peru"          ← each trailing word as city
     "Jirón Rio de Janeiro 483, Sicuani, Peru"
     "Jirón Rio de Janeiro, Sicuani, Ate, Peru"      ← without number
     "Jirón Rio de Janeiro, Ate, Peru"
     "Jirón Rio de Janeiro 483, Lima, Peru"          ← default Lima
     "Rio de Janeiro 483, Sicuani, Ate, Peru"        ← without type
     raw input as-is
   ═══════════════════════════════════════════════════════════════════════ */
const buildVariants = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const p = parseAddress(trimmed);

  const streetFull = [p.type, p.name, p.number].filter(Boolean).join(" ");
  const streetNoNum = [p.type, p.name].filter(Boolean).join(" ");
  const streetNoType = [p.name, p.number].filter(Boolean).join(" ");
  const trail = p.trailing;

  const v = new Set<string>();

  // With all trailing words
  if (trail.length) {
    const trailStr = trail.join(", ");
    v.add(`${streetFull}, ${trailStr}, Peru`);
    v.add(`${streetFull}, ${trailStr}`);
    v.add(`${streetNoNum}, ${trailStr}, Peru`);
    v.add(`${streetNoType}, ${trailStr}, Peru`);

    // Each trailing word individually as city
    for (const word of trail) {
      v.add(`${streetFull}, ${word}, Peru`);
      v.add(`${streetNoNum}, ${word}, Peru`);
    }

    // Reversed trailing (sometimes district before city)
    if (trail.length >= 2) {
      v.add(`${streetFull}, ${[...trail].reverse().join(", ")}, Peru`);
    }
  }

  // Default city Lima
  v.add(`${streetFull}, Lima, Peru`);
  v.add(`${streetNoNum}, Lima, Peru`);

  // Just Peru
  v.add(`${streetFull}, Peru`);

  // Bare
  v.add(streetFull);

  // Expanded original
  const expanded = expandAbbrev(trimmed);
  if (expanded !== streetFull) v.add(expanded);

  // Raw original
  v.add(trimmed);

  return Array.from(v).filter((q) => q.length >= 4);
};

/* ═══════════════════════════════════════════════════════════════════════
   Fetch helpers
   ═══════════════════════════════════════════════════════════════════════ */
const mapNominatim = (data: unknown[]): LocationSuggestion[] =>
  data.map((item) => {
    const loc = item as Record<string, unknown>;
    const displayName = typeof loc.display_name === "string" ? loc.display_name : "";
    const name =
      typeof loc.name === "string" ? loc.name : displayName.split(",")[0]?.trim() || "";
    return {
      name,
      lat: String(loc.lat ?? ""),
      lon: String(loc.lon ?? ""),
      display_name: displayName,
    };
  });

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

const mapPhoton = (features: unknown[]): LocationSuggestion[] =>
  features
    .filter((f): f is PhotonFeature => {
      const feat = f as PhotonFeature;
      return feat.geometry?.coordinates?.length === 2;
    })
    .map((f) => {
      const pr = f.properties ?? {};
      const geo = f.geometry?.coordinates;
      if (!geo || geo.length < 2) {
        return { name: "", lat: "0", lon: "0", display_name: "" };
      }
      const [lon, lat] = geo;
      const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
      const parts: string[] = [];
      const name0 = s(pr.name);
      if (name0) parts.push(name0);
      const hn = s(pr.housenumber);
      if (hn) {
        parts[parts.length - 1] = `${parts[parts.length - 1] || ""} ${hn}`.trim();
      }
      const street = s(pr.street);
      if (street && !parts.includes(street)) parts.push(street);
      const locality = s(pr.locality);
      if (locality) parts.push(locality);
      const district = s(pr.district);
      if (district) parts.push(district);
      const city = s(pr.city);
      if (city) parts.push(city);
      const state = s(pr.state);
      if (state) parts.push(state);
      const country = s(pr.country);
      if (country) parts.push(country);
      const display = parts.filter(Boolean).join(", ") || name0 || "";
      const name = name0 || street || display.split(",")[0]?.trim() || "";
      return { name, lat: String(lat), lon: String(lon), display_name: display };
    });

const photonFetch = async (q: string, signal: AbortSignal): Promise<LocationSuggestion[]> => {
  const params = new URLSearchParams({ q, limit: "14", lat: "-12.04", lon: "-77.03" });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: unknown[] };
  if (!Array.isArray(data.features)) return [];
  const peruOnly = data.features.filter((f: unknown) => {
    const feat = f as { properties?: { countrycode?: string } };
    return feat.properties?.countrycode === "PE";
  });
  return mapPhoton(peruOnly.length > 0 ? peruOnly : data.features.slice(0, 8));
};

const addPeruContext = (text: string) => {
  if (/\b(peru|perú|lima|cusco|arequipa|trujillo|ate|miraflores)\b/i.test(text)) return text;
  return `${text} Lima Peru`;
};

const fetchPhoton = async (query: string, signal: AbortSignal): Promise<LocationSuggestion[]> => {
  // 1st try: with numbers (exact address) + Peru context
  const withContext = addPeruContext(query);
  const results = await photonFetch(withContext, signal);
  if (results.length > 0) return results;

  // 2nd try: strip numbers for street-level match
  const stripped = query.replace(/\b\d{1,5}\b/g, "").replace(/\s{2,}/g, " ").trim();
  if (stripped.length < 3 || stripped === query) return [];
  const strippedWithContext = addPeruContext(stripped);
  return photonFetch(strippedWithContext, signal);
};

const fetchNominatim = async (
  query: string,
  signal: AbortSignal,
  cc?: string
): Promise<LocationSuggestion[]> => {
  const p = new URLSearchParams({ format: "json", q: query, limit: "5", addressdetails: "1" });
  if (cc) p.set("countrycodes", cc);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${p}`,
    { headers: { "User-Agent": "DashBoard/1.0" }, signal }
  );
  if (!res.ok) return [];
  const raw: unknown = await res.json();
  return Array.isArray(raw) ? mapNominatim(raw) : [];
};

const dedup = (list: LocationSuggestion[]): LocationSuggestion[] => {
  const seen = new Set<string>();
  return list.filter((l) => {
    const k = `${parseFloat(l.lat).toFixed(5)},${parseFloat(l.lon).toFixed(5)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* ═══════════════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════════════ */
export function useLocationSearch() {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchLocations = useCallback(async (query: string): Promise<LocationSuggestion[]> => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve) => {
      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        const sig = controller.signal;

        const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
          try { return await fn(); } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            return null;
          }
        };

        try {
          const variants = buildVariants(query);
          let pool: LocationSuggestion[] = [];

          // ① Photon with expanded abbreviations + geographic bias to Peru
          const expanded = expandAbbrev(query);
          const photonResult = await safe(() => fetchPhoton(expanded, sig));
          if (photonResult?.length) pool = dedup(photonResult);

          // If expanded differs from raw, try raw too
          if (!pool.length && expanded !== query.trim() && !sig.aborted) {
            const photon2 = await safe(() => fetchPhoton(query.trim(), sig));
            if (photon2?.length) pool = dedup(photon2);
          }

          // ② Nominatim — single best query (first variant = most specific)
          if (pool.length < 3 && !sig.aborted && variants.length > 0) {
            const res = await safe(() => fetchNominatim(variants[0], sig, "pe"));
            if (res?.length) pool = dedup([...pool, ...res]);
          }

          // ③ Nominatim 2nd variant (without number or different city) — only if still few
          if (pool.length < 2 && !sig.aborted && variants.length > 2) {
            const res = await safe(() => fetchNominatim(variants[2], sig, "pe"));
            if (res?.length) pool = dedup([...pool, ...res]);
          }

          // ④ Fallback: Nominatim no country restriction
          if (!pool.length && !sig.aborted && variants.length > 0) {
            const res = await safe(() => fetchNominatim(variants[0], sig));
            if (res?.length) pool = dedup(res);
          }

          const final = pool.slice(0, 8);
          setSuggestions(final);
          setLoading(false);
          resolve(final);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") { resolve([]); return; }
          setError(err instanceof Error ? err.message : "Error en la búsqueda");
          setSuggestions([]);
          setLoading(false);
          resolve([]);
        }
      }, 300);
    });
  }, []);

  return { suggestions, loading, error, searchLocations };
}
