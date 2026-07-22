import {Point} from '../../domain/graph-v2.types';

export interface AssistedLayoutOptions {
  readonly origin?: Point;
  readonly columnGap?: number;
  readonly rowGap?: number;
  readonly columns?: number;
}

/** A deliberately simple, stable layout: ordering never depends on object iteration. */
export const assistedLayout = (
  nodeIds: readonly string[],
  options: AssistedLayoutOptions = {},
): ReadonlyMap<string, Point> => {
  const origin = options.origin ?? {x: 64, y: 64};
  const columnGap = options.columnGap ?? 240;
  const rowGap = options.rowGap ?? 144;
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(nodeIds.length || 1)));
  return new Map([...nodeIds].sort((left, right) => left.localeCompare(right)).map((id, index) => [id, {
    x: origin.x + (index % columns) * columnGap,
    y: origin.y + Math.floor(index / columns) * rowGap,
  }]));
};

export const snapPoint = (point: Point, gridSize = 24): Point => ({
  x: Math.round(point.x / gridSize) * gridSize,
  y: Math.round(point.y / gridSize) * gridSize,
});
