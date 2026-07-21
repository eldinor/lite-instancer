import { projectWorldToScreen } from "../src/screen-space-picking.js";
import { createIdentityMat4 } from "../src/transforms.js";

describe("Babylon.js screen-space projection", () => {
  it("projects the origin to the viewport center", () => {
    expect(projectWorldToScreen([0, 0, 0], createIdentityMat4(), { width: 200, height: 100 })).toEqual({ x: 100, y: 50 });
  });
});
