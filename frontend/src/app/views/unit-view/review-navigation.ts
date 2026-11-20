import type { ReviewItemVariableReferences } from '../../core/models/api.models';
import type {
  PlayerTargetIdentifierKind,
  PlayerTargetLocation,
} from '../../core/services/voud.service';
import type { CodingVariableLike } from '../item-explorer/item-explorer-solution-prefill';

export interface ReviewNavigationTarget {
  locations: PlayerTargetLocation[];
  directLocation?: PlayerTargetLocation;
  codingId?: string;
  sourceCodingId?: string;
}

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/** Keep coding identities separate from the aliases used by the player. */
export class ReviewNavigationResolver {
  private readonly targets: (ReviewNavigationTarget | undefined)[];
  private readonly sources: number[][];
  private readonly identifiers = {
    id: new Map<string, number[]>(),
    alias: new Map<string, number[]>(),
  };

  constructor(
    variables: CodingVariableLike[],
    private readonly codingIds: string[],
    private readonly locate: (
      identifier: string,
      kind?: PlayerTargetIdentifierKind,
    ) => PlayerTargetLocation | undefined,
  ) {
    variables.forEach((variable, index) => {
      for (const key of ['id', 'alias'] as const) {
        const name = normalize(variable[key]);
        if (!name) continue;
        const matches = this.identifiers[key].get(name);
        if (matches) matches.push(index);
        else this.identifiers[key].set(name, [index]);
      }
    });

    const parents = variables.map((): number[] => []);
    const directLocations: (PlayerTargetLocation | undefined)[] = [];
    const pages = variables.map(() => new Map<number, PlayerTargetLocation>());
    const queue: { index: number; location: PlayerTargetLocation }[] = [];
    this.sources = variables.map((variable, index) => {
      const type = normalize(variable.sourceType) || 'base';
      if (type === 'base' || type === 'base_no_value') {
        // Match each identifier in its own namespace before trying legacy references.
        for (const [name, kind] of [
          [variable.alias, 'alias'],
          [variable.id, 'id'],
          [variable.alias, 'id'],
          [variable.id, 'alias'],
        ] as const) {
          if (typeof name !== 'string' || !name.trim()) continue;
          const location = locate(name, kind);
          if (location) {
            directLocations[index] = location;
            pages[index].set(location.absolutePageIndex, location);
            queue.push({ index, location });
            break;
          }
        }
        return [];
      }
      const sources: number[] = [];
      if (!Array.isArray(variable.deriveSources)) return sources;
      for (const reference of variable.deriveSources) {
        const source = this.findVariable(reference, ['id', 'alias']);
        if (source !== undefined) {
          parents[source].push(index);
          sources.push(source);
        }
      }
      return sources;
    });
    // Propagate each reachable page through each variable once, including cycles.
    for (const { index, location } of queue) {
      for (const parent of parents[index]) {
        if (pages[parent].has(location.absolutePageIndex)) continue;
        pages[parent].set(location.absolutePageIndex, location);
        queue.push({ index: parent, location });
      }
    }
    this.targets = pages.map((locations, index) =>
      locations.size
        ? {
            locations: [...locations.values()],
            directLocation: directLocations[index],
            codingId: codingIds[index],
          }
        : undefined,
    );
  }

  forVariable(index: number): ReviewNavigationTarget | undefined {
    return this.targets[index];
  }

  forItem(
    references: ReviewItemVariableReferences,
    fallbackIds: string[],
  ): ReviewNavigationTarget | undefined {
    const playerReferences = [references.sourceVariable, references.variableId];
    const internalId = normalize(references.variableReadOnlyId);
    if (internalId) {
      const matches = this.findVariables(internalId, ['id']);
      // A known internal ID pins the coding, even when its page cannot be resolved.
      if (matches.length === 1) return this.itemTarget(matches[0], references);
      if (matches.length > 1) return this.playerItemTarget(...playerReferences);
    }
    for (const reference of playerReferences) {
      // Recover a stale internal ID only through a reference that is unique
      // across both namespaces, rather than preferring another variable's alias.
      const matches = internalId ? this.findVariables(reference, ['id', 'alias']) : undefined;
      if (matches && matches.length > 1) return this.playerItemTarget(...playerReferences);
      // Legacy references use internal IDs first, as in the Item Explorer.
      const index = matches ? matches[0] : this.findVariable(reference, ['id', 'alias']);
      if (index !== undefined) return this.itemTarget(index, references);
      const target = this.playerItemTarget(reference);
      if (target) return target;
    }
    // Never reinterpret a missing internal ID as another variable's public alias.
    if (internalId) return undefined;
    for (const id of fallbackIds) {
      const index = this.findVariable(id, ['id', 'alias']);
      if (index !== undefined) return this.itemTarget(index, references);
      const target = this.playerItemTarget(id);
      if (target) return target;
    }
    return undefined;
  }

  // A player reference can locate the item independently of the coding scheme.
  private playerItemTarget(
    ...references: (string | undefined)[]
  ): ReviewNavigationTarget | undefined {
    for (const reference of references) {
      if (typeof reference !== 'string' || !reference.trim()) continue;
      const location = this.locate(reference);
      if (location) return { locations: [location], directLocation: location };
    }
    return undefined;
  }

  private itemTarget(
    index: number,
    references: ReviewItemVariableReferences,
  ): ReviewNavigationTarget {
    const explicit = [references.sourceVariable, references.variableId];
    const visibleReference =
      normalize(references.sourceVariable) || normalize(references.variableId);
    const source = this.findItemSource(index, visibleReference);
    // An explicit source limits the item's pages, even when it is itself derived.
    const target = this.targets[source ?? index];
    let locations = target?.locations || [];
    let directLocation = target?.directLocation;
    // A derived coding's source pages can differ from the item's explicit player page.
    if ((source === undefined || !target) && directLocation?.scrollPageIndex === undefined) {
      for (const name of explicit) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const location = this.locate(name);
        if (location) {
          directLocation = location;
          if (!locations.some((page) => page.absolutePageIndex === location.absolutePageIndex)) {
            locations = [...locations, location];
          }
          break;
        }
      }
    }
    return {
      locations,
      directLocation,
      codingId: this.codingIds[index],
      sourceCodingId: source === undefined ? undefined : this.codingIds[source],
    };
  }

  private findItemSource(index: number, reference: string): number | undefined {
    if (!reference || !this.sources[index].length) return undefined;
    // A shared aggregate may name the visible input several derivations below it.
    const reachable = new Set([index]);
    for (const parent of reachable) {
      for (const source of this.sources[parent]) reachable.add(source);
    }
    reachable.delete(index);
    return this.findVariable(reference, ['id', 'alias'], reachable);
  }

  private findVariables(reference: unknown, keys: ('id' | 'alias')[]): number[] {
    const target = normalize(reference);
    return [...new Set(keys.flatMap((key) => this.identifiers[key].get(target) || []))];
  }

  private findVariable(
    reference: unknown,
    keys: ('id' | 'alias')[],
    withinSources?: ReadonlySet<number>,
  ): number | undefined {
    for (const key of keys) {
      const candidates = this.findVariables(reference, [key]);
      const matches = withinSources
        ? candidates.filter((index) => withinSources.has(index))
        : candidates;
      if (matches.length) return matches.length === 1 ? matches[0] : undefined;
    }
    return undefined;
  }
}
