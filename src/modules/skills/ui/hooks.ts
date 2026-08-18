import { useEffect, useState } from "react";
import type { Skill } from "../types";
import { listSkills, watchSkills } from "../store";

/** The stored skills as live state — options list and form collision checks. */
export function useSkillsList(): Skill[] {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    let live = true;
    void listSkills().then((list) => live && setSkills(list));
    const unwatch = watchSkills(setSkills);
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return skills;
}
