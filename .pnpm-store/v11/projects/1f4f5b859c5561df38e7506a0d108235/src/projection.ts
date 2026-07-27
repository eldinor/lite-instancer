import type { ProjectionInput, ProjectionResult } from "./types.js";

const CLIP_EPSILON = 1e-6;

/** Project a world position into CSS pixels within one camera viewport. */
export function projectAnnotationPosition(input: ProjectionInput, output?: ProjectionResult): ProjectionResult {
  const x = input.position[0] ?? 0;
  const y = input.position[1] ?? 0;
  const z = input.position[2] ?? 0;
  const matrix = input.viewProjection;
  const clipX = at(matrix, 0) * x + at(matrix, 4) * y + at(matrix, 8) * z + at(matrix, 12);
  const clipY = at(matrix, 1) * x + at(matrix, 5) * y + at(matrix, 9) * z + at(matrix, 13);
  const clipZ = at(matrix, 2) * x + at(matrix, 6) * y + at(matrix, 10) * z + at(matrix, 14);
  const clipW = at(matrix, 3) * x + at(matrix, 7) * y + at(matrix, 11) * z + at(matrix, 15);
  const behindCamera = clipW <= CLIP_EPSILON;
  const safeW = Math.abs(clipW) > CLIP_EPSILON ? clipW : CLIP_EPSILON;
  const ndcX = clipX / safeW;
  const ndcY = clipY / safeW;
  const depth = clipZ / safeW;
  const offscreen = behindCamera || ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || depth < 0 || depth > 1;
  const dx = x - (input.cameraPosition[0] ?? 0);
  const dy = y - (input.cameraPosition[1] ?? 0);
  const dz = z - (input.cameraPosition[2] ?? 0);

  const result = (output ?? {
    behindCamera: false,
    offscreen: false,
    screenPosition: { x: 0, y: 0 },
    depth: 0,
    distance: 0
  }) as MutableProjectionResult;
  result.behindCamera = behindCamera;
  result.offscreen = offscreen;
  result.screenPosition.x = input.viewport.left + ((ndcX + 1) * 0.5) * input.viewport.width;
  result.screenPosition.y = input.viewport.top + ((1 - ndcY) * 0.5) * input.viewport.height;
  result.depth = depth;
  result.distance = input.calculateDistance === false ? 0 : Math.hypot(dx, dy, dz);
  return result;
}

interface MutableProjectionResult {
  behindCamera: boolean;
  offscreen: boolean;
  screenPosition: { x: number; y: number };
  depth: number;
  distance: number;
}

function at(matrix: ArrayLike<number>, index: number): number {
  return matrix[index] ?? 0;
}
