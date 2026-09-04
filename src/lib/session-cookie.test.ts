import { describe, expect, it } from "vitest";
import {
  signSessionPayload,
  verifySessionToken,
  sessionPayloadFromPublicUser,
} from "./session-cookie";

describe("session-cookie", () => {
  const secret = "unit-test-secret";

  it("firma y verifica payload válido", () => {
    const payload = sessionPayloadFromPublicUser(
      { id: "u1", username: "a", displayName: "A", role: "user" },
      3600
    );
    const tok = signSessionPayload(payload, secret);
    const got = verifySessionToken(tok, secret);
    expect(got).not.toBeNull();
    expect(got?.username).toBe("a");
    expect(got?.role).toBe("user");
  });

  it("rechaza firma incorrecta", () => {
    const payload = sessionPayloadFromPublicUser(
      { id: "u1", username: "a", displayName: "A", role: "admin" },
      120
    );
    const tok = signSessionPayload(payload, secret);
    const tampered = tok.slice(0, -4) + "dead";
    expect(verifySessionToken(tampered, secret)).toBeNull();
  });

  it("rechaza token expirado", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const tok = signSessionPayload(
      { id: "u1", username: "a", displayName: "A", role: "user", areas: [], exp: past },
      secret
    );
    expect(verifySessionToken(tok, secret)).toBeNull();
  });
});
