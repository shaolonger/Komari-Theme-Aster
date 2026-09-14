# Fleet3D Phase 3 Visual Checks

Run date: 2026-07-04

Local target: `http://127.0.0.1:4175/fleet-3d`

## Browser Matrix

| Viewport | Renderer mode | Runtime fallback | Layout | Canvas | Animation | Overlap | Console |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | `webgpu` | `webgpu-detected-webgl2-fallback` | `orbit` | nonblank | changed between frames | none | no error/warn |
| 390x844 | `webgpu` | `webgpu-detected-webgl2-fallback` | `orbit` | nonblank | changed between frames | none | no error/warn |

## Pixel Sampling

| Viewport | Samples A/B | Nonblank A/B | Avg brightness A/B | Hash A/B |
| --- | ---: | ---: | ---: | --- |
| 1440x900 | 45477 / 45477 | 45135 / 45146 | 17.34 / 17.32 | `3543451434` / `2345242154` |
| 390x844 | 68442 / 68442 | 67564 / 67563 | 28.50 / 28.49 | `3929440363` / `1675781483` |

## Notes

- The browser exposed WebGPU, and the scene correctly reported the stable Three.js WebGL2 fallback runtime.
- Initial visual sampling found top overlay collisions after Phase 3 controls were added. The 3D overlay offsets were adjusted and rechecked until desktop and mobile overlap lists were empty.
- Globe mode was disabled in this local run because the dev server had no live Komari node data, leaving zero reliable region matches. The disabled state was verified in both viewports.
