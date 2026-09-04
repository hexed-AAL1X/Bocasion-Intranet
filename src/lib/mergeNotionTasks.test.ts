import { describe, expect, it } from "vitest";
import { mergeNotionTask, mergeNotionTasks } from "./mergeNotionTasks";

describe("mergeNotionTasks", () => {
  it("preserva adjuntos locales cuando el servidor devuelve la columna vacía", () => {
    const attachments = [
      { name: "a.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,AAA" },
      { name: "b.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,BBB" },
    ];
    const local = {
      id: "task_1",
      updatedAt: "2026-05-20T12:00:00.000Z",
      custom_adjuntos: attachments,
    };
    const server = {
      id: "task_1",
      updatedAt: "2026-05-20T11:00:00.000Z",
      custom_adjuntos: [],
    };

    const merged = mergeNotionTask(local, server);
    expect(merged.custom_adjuntos).toEqual(attachments);
  });

  it("respeta string vacío local cuando el usuario borró el contenido", () => {
    const local = {
      id: "task_1",
      updatedAt: "2026-05-20T12:00:00.000Z",
      actividad: "",
    };
    const server = {
      id: "task_1",
      updatedAt: "2026-05-20T11:00:00.000Z",
      actividad: "Texto anterior",
    };

    const merged = mergeNotionTask(local, server);
    expect(merged.actividad).toBe("");
  });

  it("prefiere adjuntos locales más pesados aunque el servidor sea más reciente", () => {
    const local = {
      id: "task_1",
      updatedAt: "2026-05-20T11:00:00.000Z",
      custom_adjuntos: [
        { name: "a.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,AAA" },
        { name: "b.png", type: "image/png", size: 1, dataUrl: "data:image/png;base64,BBB" },
      ],
    };
    const server = {
      id: "task_1",
      updatedAt: "2026-05-20T12:00:00.000Z",
      custom_adjuntos: [],
    };

    const merged = mergeNotionTask(local, server);
    expect(merged.custom_adjuntos).toEqual(local.custom_adjuntos);
  });

  it("conserva filas locales y añade la nueva fila del servidor", () => {
    const local = [
      {
        id: "task_1",
        updatedAt: "2026-05-20T12:00:00.000Z",
        custom_adjuntos: [{ name: "a.png", dataUrl: "data:image/png;base64,AAA" }],
      },
    ];
    const server = [
      { id: "task_1", updatedAt: "2026-05-20T11:00:00.000Z", custom_adjuntos: [] },
      { id: "task_2", updatedAt: "2026-05-20T12:01:00.000Z", actividad: "Nueva fila" },
    ];

    const merged = mergeNotionTasks(local, server);
    expect(merged).toHaveLength(2);
    expect(merged[0].custom_adjuntos).toEqual(local[0].custom_adjuntos);
    expect(merged[1].id).toBe("task_2");
  });
});
