import type { ProjectData } from "./types";
import { uid } from "./ids";

/** clone a published project into a brand-new editable draft with fresh IDs */
export function remixProject(source: ProjectData): ProjectData {
  const project = structuredClone(source);
  const elementMap = new Map<string, string>();
  const eventMap = new Map<string, string>();

  for (const element of project.elements) {
    const next = uid(element.type === "text" ? "tx" : "el");
    elementMap.set(element.id, next);
    element.id = next;
  }
  for (const event of project.events) {
    const next = uid("ev");
    eventMap.set(event.id, next);
    event.id = next;
  }
  for (const event of project.events) {
    event.triggerId = elementMap.get(event.triggerId) ?? event.triggerId;
    event.nextEventId = event.nextEventId ? (eventMap.get(event.nextEventId) ?? null) : null;
    for (const step of event.steps) {
      if (step.targetId) step.targetId = elementMap.get(step.targetId) ?? step.targetId;
      if (step.eventId) step.eventId = eventMap.get(step.eventId) ?? step.eventId;
    }
  }

  project.title = `${source.title.slice(0, 60)} · Remix`;
  project.updatedAt = Date.now();
  return project;
}

const PENDING_KEY = "ms.pending";

export function stagePendingProject(project: ProjectData): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(project));
  } catch {
    // ignore
  }
}

export function takePendingProject(): ProjectData | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as ProjectData;
  } catch {
    return null;
  }
}
