import type { Skill } from "../types";
import { listSkills, watchSkills } from "../store";

/**
 * Synchronous mirror of the stored skill list, for the one caller that cannot
 * await: the slash menu's `candidates()` (slash-commands.ts). Panel-only —
 * `initSkillsCatalog()` is called once from the side panel's App. Same
 * module-level pattern as the help sheet's open state.
 */
let skills: Skill[] = [];
let started = false;

export function initSkillsCatalog(): void {
  if (started) return;
  started = true;
  void listSkills().then((list) => (skills = list));
  watchSkills((list) => (skills = list));
}

/** Every stored skill, enabled or not — callers filter for their surface. */
export function loadedSkills(): Skill[] {
  return skills;
}
