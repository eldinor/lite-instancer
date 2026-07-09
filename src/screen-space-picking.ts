import { getViewProjectionMatrix, type Camera, type Mat4 } from "@babylonjs/lite";
import type { InstanceId, Vec3Like } from "./types.js";

export interface ScreenPointLike {
  readonly x: number;
  readonly y: number;
}

export interface ScreenViewportLike {
  readonly width: number;
  readonly height: number;
}

export interface PointerViewportLike extends ScreenViewportLike {
  getBoundingClientRect(): DOMRect;
}

export interface ScreenSpaceInstancePickOptions {
  ids: Iterable<InstanceId>;
  camera: Camera;
  viewport: ScreenViewportLike;
  point: ScreenPointLike;
  getWorldPosition(id: InstanceId): Vec3Like | undefined;
  getScreenRadius?(id: InstanceId): number;
  isVisible?(id: InstanceId): boolean;
  has?(id: InstanceId): boolean;
}

export interface PointerScreenSpaceInstancePickOptions
  extends Omit<ScreenSpaceInstancePickOptions, "point" | "viewport"> {
  event: Pick<PointerEvent, "clientX" | "clientY">;
  canvas: PointerViewportLike;
}

export interface ScreenSpaceInstancePick {
  id: InstanceId;
  distanceSquared: number;
  screen: ScreenPointLike;
  radius: number;
}

export function pickScreenSpaceInstance(options: ScreenSpaceInstancePickOptions): ScreenSpaceInstancePick | undefined {
  const matrix = getViewProjectionMatrix(options.camera, options.viewport.width / options.viewport.height);
  let nearest: ScreenSpaceInstancePick | undefined;

  for (const id of options.ids) {
    if (options.has && !options.has(id)) {
      continue;
    }
    if (options.isVisible && !options.isVisible(id)) {
      continue;
    }

    const position = options.getWorldPosition(id);
    if (!position) {
      continue;
    }

    const screen = projectWorldToScreen(position, matrix, options.viewport);
    if (!screen) {
      continue;
    }

    const radius = options.getScreenRadius?.(id) ?? 24;
    const dx = options.point.x - screen.x;
    const dy = options.point.y - screen.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radius * radius) {
      continue;
    }
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { id, distanceSquared, screen, radius };
    }
  }

  return nearest;
}

export function pickScreenSpaceInstanceFromPointer(
  options: PointerScreenSpaceInstancePickOptions
): ScreenSpaceInstancePick | undefined {
  const rect = options.canvas.getBoundingClientRect();
  return pickScreenSpaceInstance({
    ...options,
    point: {
      x: options.event.clientX - rect.left,
      y: options.event.clientY - rect.top
    },
    viewport: {
      width: rect.width || options.canvas.width,
      height: rect.height || options.canvas.height
    }
  });
}

export function projectWorldToScreen(
  position: Vec3Like,
  matrix: Mat4,
  viewport: ScreenViewportLike
): ScreenPointLike | undefined {
  const x = position[0];
  const y = position[1];
  const z = position[2];
  const clipX = matrixAt(matrix, 0) * x + matrixAt(matrix, 4) * y + matrixAt(matrix, 8) * z + matrixAt(matrix, 12);
  const clipY = matrixAt(matrix, 1) * x + matrixAt(matrix, 5) * y + matrixAt(matrix, 9) * z + matrixAt(matrix, 13);
  const clipW = matrixAt(matrix, 3) * x + matrixAt(matrix, 7) * y + matrixAt(matrix, 11) * z + matrixAt(matrix, 15);

  if (Math.abs(clipW) < 1e-6) {
    return undefined;
  }

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (ndcX < -1.1 || ndcX > 1.1 || ndcY < -1.1 || ndcY > 1.1) {
    return undefined;
  }

  return {
    x: ((ndcX + 1) * 0.5) * viewport.width,
    y: ((1 - ndcY) * 0.5) * viewport.height
  };
}

function matrixAt(matrix: Mat4, index: number): number {
  return matrix[index] ?? 0;
}
