"use client";

import { useEffect, useState } from "react";

export type AvatarGender = "female" | "male";

export type AvatarCharacter = {
  id: string;
  gender: AvatarGender;
  label: string;
  url: string;
};

const DICEBEAR = "https://api.dicebear.com/9.x/avataaars/svg";

function buildUrl(opts: {
  seed: string;
  top: string;
  hairColor: string;
  facialHair?: string;
  skinColor?: string;
  background: string;
}): string {
  const params = new URLSearchParams();
  params.set("seed", opts.seed);
  params.set("top", opts.top);
  params.set("hairColor", opts.hairColor);
  if (opts.facialHair) {
    params.set("facialHair", opts.facialHair);
    params.set("facialHairProbability", "100");
  } else {
    params.set("facialHairProbability", "0");
  }
  params.set("skinColor", opts.skinColor ?? "f8d25c");
  params.set("backgroundColor", opts.background);
  params.set("radius", "50");
  return `${DICEBEAR}?${params.toString()}`;
}

/** Catálogo de personajes NPC entre los que el usuario puede elegir. */
export const AVATAR_CHARACTERS: AvatarCharacter[] = [
  // Mujeres
  { id: "f1", gender: "female", label: "Mujer 1", url: buildUrl({ seed: "Sofia", top: "straight01", hairColor: "4a312c", skinColor: "edb98a", background: "b6e3f4" }) },
  { id: "f2", gender: "female", label: "Mujer 2", url: buildUrl({ seed: "Valentina", top: "curly", hairColor: "2c1b18", skinColor: "f8d25c", background: "ffd5dc" }) },
  { id: "f3", gender: "female", label: "Mujer 3", url: buildUrl({ seed: "Camila", top: "bob", hairColor: "a55728", skinColor: "d08b5b", background: "c0aede" }) },
  { id: "f4", gender: "female", label: "Mujer 4", url: buildUrl({ seed: "Lucia", top: "miaWallace", hairColor: "090806", skinColor: "ffdbb4", background: "d1d4f9" }) },
  { id: "f5", gender: "female", label: "Mujer 5", url: buildUrl({ seed: "Martina", top: "bigHair", hairColor: "724133", skinColor: "edb98a", background: "ffdfbf" }) },
  { id: "f6", gender: "female", label: "Mujer 6", url: buildUrl({ seed: "Isabella", top: "straight02", hairColor: "b58143", skinColor: "fd9841", background: "b6e3f4" }) },
  // Hombres
  { id: "m1", gender: "male", label: "Hombre 1", url: buildUrl({ seed: "Mateo", top: "shortFlat", hairColor: "2c1b18", skinColor: "edb98a", background: "b6e3f4" }) },
  { id: "m2", gender: "male", label: "Hombre 2", url: buildUrl({ seed: "Diego", top: "shortWaved", hairColor: "4a312c", facialHair: "beardLight", skinColor: "d08b5b", background: "ffdfbf" }) },
  { id: "m3", gender: "male", label: "Hombre 3", url: buildUrl({ seed: "Sebastian", top: "theCaesar", hairColor: "090806", skinColor: "ffdbb4", background: "d1d4f9" }) },
  { id: "m4", gender: "male", label: "Hombre 4", url: buildUrl({ seed: "Nicolas", top: "shortCurly", hairColor: "724133", facialHair: "moustacheFancy", skinColor: "edb98a", background: "c0aede" }) },
  { id: "m5", gender: "male", label: "Hombre 5", url: buildUrl({ seed: "Andres", top: "sides", hairColor: "a55728", skinColor: "fd9841", background: "ffd5dc" }) },
  { id: "m6", gender: "male", label: "Hombre 6", url: buildUrl({ seed: "Carlos", top: "shortRound", hairColor: "2c1b18", facialHair: "beardMedium", skinColor: "d08b5b", background: "b6e3f4" }) },
];

const FEMALE_CHARS = AVATAR_CHARACTERS.filter((c) => c.gender === "female");
const MALE_CHARS = AVATAR_CHARACTERS.filter((c) => c.gender === "male");

// Nombres masculinos frecuentes que terminan en "a" (para no marcarlos como femeninos)
const MALE_EXCEPTIONS = new Set(["josua", "joshua", "elias", "elian", "matias", "matías", "tobias", "tobías", "lucas", "jonas", "jonás", "nicolas", "nicolás", "andrea"]);
const FEMALE_HINTS = new Set(["maria", "maría", "ana", "sofia", "sofía", "lucia", "lucía", "camila", "valentina", "isabella", "martina", "carmen", "rocio", "rocío", "belen", "belén", "pilar", "beatriz", "raquel", "miriam", "abigail", "ines", "inés"]);

/** Heurística simple para inferir género a partir del nombre. */
export function guessGender(name: string): AvatarGender {
  const first = (name || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!first) return "male";
  if (FEMALE_HINTS.has(first)) return "female";
  if (MALE_EXCEPTIONS.has(first)) return "male";
  return first.endsWith("a") ? "female" : "male";
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Personaje por defecto (determinista) según nombre y género inferido. */
export function getDefaultAvatarId(name: string): string {
  const gender = guessGender(name);
  const pool = gender === "female" ? FEMALE_CHARS : MALE_CHARS;
  const idx = hashString(name || "user") % pool.length;
  return pool[idx].id;
}

export function getAvatarById(id: string | null | undefined): AvatarCharacter | undefined {
  return AVATAR_CHARACTERS.find((c) => c.id === id);
}

/** URL determinista a partir del nombre (para usuarios sin elección propia). */
export function getAvatarUrlForName(name: string): string {
  const char = getAvatarById(getDefaultAvatarId(name));
  return char?.url ?? AVATAR_CHARACTERS[0].url;
}

const STORAGE_PREFIX = "bocasion.avatar.";
const AVATAR_EVENT = "bocasion-avatar-change";

function storageKey(username: string): string {
  return `${STORAGE_PREFIX}${username}`;
}

export function readStoredAvatarId(username: string): string | null {
  if (typeof window === "undefined" || !username) return null;
  try {
    return window.localStorage.getItem(storageKey(username));
  } catch {
    return null;
  }
}

export function writeStoredAvatarId(username: string, id: string): void {
  if (typeof window === "undefined" || !username) return;
  try {
    window.localStorage.setItem(storageKey(username), id);
    window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { username, id } }));
  } catch {
    /* noop */
  }
}

/**
 * Hook: devuelve el id/URL del avatar del usuario (elección guardada o por
 * defecto según el nombre) y una función para cambiarlo.
 */
export function useUserAvatar(username: string, displayName: string) {
  const defaultId = getDefaultAvatarId(displayName || username);
  const [avatarId, setAvatarId] = useState<string>(defaultId);

  useEffect(() => {
    const stored = readStoredAvatarId(username);
    setAvatarId(stored ?? getDefaultAvatarId(displayName || username));

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { username: string; id: string } | undefined;
      if (detail && detail.username === username) setAvatarId(detail.id);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(username) && e.newValue) setAvatarId(e.newValue);
    };
    window.addEventListener(AVATAR_EVENT, onChange as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AVATAR_EVENT, onChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [username, displayName]);

  const character = getAvatarById(avatarId) ?? AVATAR_CHARACTERS[0];
  const setAvatar = (id: string) => {
    setAvatarId(id);
    writeStoredAvatarId(username, id);
  };

  return { avatarId, url: character.url, character, setAvatar };
}
