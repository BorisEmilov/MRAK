/** Directional village alerts (docs/systems/night-exploration.md → Implementation). */
export type Direction = 'left' | 'right' | 'center';

/** Where the village lies on screen: toward the exit that leads there. */
export function directionTo(exitX: number | null, guardianX: number, deadZone = 48): Direction {
  if (exitX === null) return 'center';
  if (exitX < guardianX - deadZone) return 'left';
  if (exitX > guardianX + deadZone) return 'right';
  return 'center';
}

/** Patrol points around a spawn (tiles): a small loop the creature walks while unaware. */
export function patrolAround(x: number, y: number): { x: number; y: number }[] {
  return [
    { x: x + 2, y },
    { x, y: y + 2 },
    { x: x - 2, y },
    { x, y: y - 2 },
  ];
}
