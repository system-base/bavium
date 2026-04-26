/* ==========================================================================
   Engine — Resolver
   Topological sort of shortcut steps based on `dependsOn` edges.
   Detects cycles and produces an execution order.
   ========================================================================== */

import type { ShortcutStep } from "./types";

export class CycleError extends Error {
    constructor(public cycle: string[]) {
        super(`Cycle detected in step dependencies: ${cycle.join(" → ")}`);
        this.name = "CycleError";
    }
}

/**
 * Resolve the execution order of steps using topological sort (Kahn's algorithm).
 *
 * Steps without `dependsOn` are executed first. Steps with dependencies are
 * deferred until all their dependencies have been processed.
 *
 * Returns an array of step IDs in execution order.
 * Throws CycleError if a circular dependency is found.
 */
export function resolveExecutionOrder(steps: ShortcutStep[]): string[] {
    // Build adjacency and in-degree maps
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // dep → [steps that depend on it]

    for (const step of steps) {
        inDegree.set(step.id, 0);
        if (!dependents.has(step.id)) {
            dependents.set(step.id, []);
        }
    }

    for (const step of steps) {
        if (step.dependsOn) {
            inDegree.set(step.id, step.dependsOn.length);
            for (const dep of step.dependsOn) {
                const list = dependents.get(dep);
                if (list) {
                    list.push(step.id);
                }
            }
        }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
        if (degree === 0) {
            queue.push(id);
        }
    }

    const order: string[] = [];

    while (queue.length > 0) {
        const current = queue.shift()!;
        order.push(current);

        const deps = dependents.get(current) ?? [];
        for (const dependent of deps) {
            const newDegree = (inDegree.get(dependent) ?? 1) - 1;
            inDegree.set(dependent, newDegree);
            if (newDegree === 0) {
                queue.push(dependent);
            }
        }
    }

    // If not all steps are in the order, we have a cycle
    if (order.length !== steps.length) {
        const remaining = steps
            .filter((s) => !order.includes(s.id))
            .map((s) => s.id);
        throw new CycleError(remaining);
    }

    return order;
}

/**
 * Build a step lookup map for O(1) access by ID.
 */
export function buildStepMap(
    steps: ShortcutStep[],
): Map<string, ShortcutStep> {
    const map = new Map<string, ShortcutStep>();
    for (const step of steps) {
        map.set(step.id, step);
    }
    return map;
}
