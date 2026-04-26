/* ==========================================================================
   Skills — Registry
   Central registry for all available skills.
   Skills register themselves at import time.
   ========================================================================== */

import type { ISkill } from "./types";

class SkillRegistry {
    private skills = new Map<string, ISkill>();

    /**
     * Register a skill. Overwrites if same name exists.
     */
    register(skill: ISkill): void {
        this.skills.set(skill.name, skill);
    }

    /**
     * Get a skill by name. Returns undefined if not found.
     */
    get(name: string): ISkill | undefined {
        return this.skills.get(name);
    }

    /**
     * Get a skill or throw if not found.
     */
    getOrThrow(name: string): ISkill {
        const skill = this.skills.get(name);
        if (!skill) {
            throw new Error(
                `Unknown skill "${name}". Available: ${this.listNames().join(", ")}`,
            );
        }
        return skill;
    }

    /**
     * Check if a skill is registered.
     */
    has(name: string): boolean {
        return this.skills.has(name);
    }

    /**
     * List all registered skill names.
     */
    listNames(): string[] {
        return [...this.skills.keys()];
    }

    /**
     * Get all registered skills.
     */
    listAll(): ISkill[] {
        return [...this.skills.values()];
    }

    /**
     * Get the total number of registered skills.
     */
    get size(): number {
        return this.skills.size;
    }
}

/**
 * The global skill registry singleton.
 */
export const skillRegistry = new SkillRegistry();
