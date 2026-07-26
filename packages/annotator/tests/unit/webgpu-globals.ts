Object.assign(globalThis, {
  GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4 },
  GPUBufferUsage: { COPY_DST: 8, INDEX: 16, UNIFORM: 64, VERTEX: 32 },
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  GPUColorWrite: { ALL: 15 }
});
