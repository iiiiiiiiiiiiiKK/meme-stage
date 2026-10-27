import rawDemo from "../data/demo-project.json";
import { normalizeProject } from "./schema";
import type { ProjectData } from "./types";

export const DEMO_SLUG = "demo";

/** the official example shown on the landing page — validated like any other project */
export const DEMO_PROJECT: ProjectData = normalizeProject(rawDemo);

export function cloneProject(project: ProjectData): ProjectData {
  return structuredClone(project);
}

/** deep copy of the official example (used by "remix" on the demo page) */
export function demoTemplate(): ProjectData {
  return normalizeProject(structuredClone(rawDemo));
}
