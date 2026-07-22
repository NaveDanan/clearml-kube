import {Dimensions, Point} from '../../domain/graph-v2.types';

export const DEFAULT_LAYOUT_DIMENSIONS: Dimensions = {width: 176, height: 72};
export const DEFAULT_LAYOUT_GUTTER = 48;

export interface LayoutNode {
  readonly id: string;
  readonly dimensions?: Dimensions;
}

export interface AssistedLayoutOptions {
  readonly origin?: Point;
  readonly gutter?: number;
  readonly columns?: number;
}

/** A deliberately simple, stable layout: ordering never depends on object iteration. */
export const assistedLayout = (
  items: readonly (string | LayoutNode)[],
  options: AssistedLayoutOptions = {},
): ReadonlyMap<string, Point> => {
  const origin = options.origin ?? {x: 64, y: 64};
  const gutter = options.gutter ?? DEFAULT_LAYOUT_GUTTER;
  const nodes = items.map(item => typeof item === 'string' ? {id: item} : item)
    .sort((left, right) => left.id.localeCompare(right.id));
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(nodes.length || 1)));
  const dimensions = (node: LayoutNode): Dimensions => ({...DEFAULT_LAYOUT_DIMENSIONS, ...node.dimensions});
  const columnWidths = Array.from({length: columns}, (_, column) => Math.max(0,
    ...nodes.filter((_, index) => index % columns === column).map(node => dimensions(node).width)));
  const rows = Math.ceil(nodes.length / columns);
  const rowHeights = Array.from({length: rows}, (_, row) => Math.max(0,
    ...nodes.slice(row * columns, (row + 1) * columns).map(node => dimensions(node).height)));
  const x = (column: number): number => origin.x + columnWidths.slice(0, column).reduce((total, width) => total + width + gutter, 0);
  const y = (row: number): number => origin.y + rowHeights.slice(0, row).reduce((total, height) => total + height + gutter, 0);
  return new Map(nodes.map((node, index) => [node.id, {x: x(index % columns), y: y(Math.floor(index / columns))}]));
};

export const snapPoint = (point: Point, gridSize = 24): Point => ({
  x: Math.round(point.x / gridSize) * gridSize,
  y: Math.round(point.y / gridSize) * gridSize,
});
