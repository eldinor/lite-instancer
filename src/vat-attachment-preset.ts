/** A remotely addressable curated asset or the filename of a locally selected GLB. */
export type VatAttachmentAssetReference =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "local-glb"; readonly fileName: string };

/** Human-editable rigid offset from a sampled VAT socket to its attachment root. */
export interface VatAttachmentGrip {
  readonly translation: readonly [number, number, number];
  readonly rotationEulerDegrees: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

/** Portable configuration emitted by the VAT socket configurator. */
export interface VatAttachmentPreset {
  readonly version: 1;
  readonly character: VatAttachmentAssetReference;
  readonly attachment: VatAttachmentAssetReference;
  readonly socket: {
    readonly key: string;
    readonly nodeIndex: number;
    readonly nodeName: string;
  };
  readonly clipScope: "all";
  readonly grip: VatAttachmentGrip;
}

/** Clone configuration values so UI-owned mutable arrays never leak into an exported preset. */
export function createVatAttachmentPreset(preset: VatAttachmentPreset): VatAttachmentPreset {
  return {
    version: 1,
    character: cloneAsset(preset.character),
    attachment: cloneAsset(preset.attachment),
    socket: { ...preset.socket },
    clipScope: "all",
    grip: {
      translation: [...preset.grip.translation] as [number, number, number],
      rotationEulerDegrees: [...preset.grip.rotationEulerDegrees] as [number, number, number],
      scale: [...preset.grip.scale] as [number, number, number]
    }
  };
}

/** Format a preset for a downloadable JSON file. */
export function serializeVatAttachmentPreset(preset: VatAttachmentPreset): string {
  return `${JSON.stringify(createVatAttachmentPreset(preset), null, 2)}\n`;
}

/** Convert the configurator's pitch/yaw/roll degrees into an XYZW quaternion. */
export function quaternionFromEulerDegrees(
  pitch: number,
  yaw: number,
  roll: number
): readonly [number, number, number, number] {
  const halfPitch = (pitch * Math.PI) / 360;
  const halfYaw = (yaw * Math.PI) / 360;
  const halfRoll = (roll * Math.PI) / 360;
  const cp = Math.cos(halfPitch);
  const sp = Math.sin(halfPitch);
  const cy = Math.cos(halfYaw);
  const sy = Math.sin(halfYaw);
  const cr = Math.cos(halfRoll);
  const sr = Math.sin(halfRoll);
  return [
    sp * cy * cr + cp * sy * sr,
    cp * sy * cr - sp * cy * sr,
    cp * cy * sr + sp * sy * cr,
    cp * cy * cr - sp * sy * sr
  ];
}

function cloneAsset(asset: VatAttachmentAssetReference): VatAttachmentAssetReference {
  return asset.kind === "url" ? { kind: "url", url: asset.url } : { kind: "local-glb", fileName: asset.fileName };
}
