/** The canonical task title and ID, independent of a booklet occurrence's alias. */
export function unitLabel(unit: { id: string; name?: unknown }): string {
  const id = unit.id.trim();
  const name = typeof unit.name === 'string' ? unit.name.trim() : '';
  return name && name !== id ? `${name} (${id})` : id;
}
