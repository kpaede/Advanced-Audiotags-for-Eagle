// Use the buffer backend directly; Eagle ships an older Node.js than the WASI loader.
import { TagLib } from '../node_modules/taglib-wasm/dist/src/taglib/taglib-class.js';
import createModule from '../node_modules/taglib-wasm/dist/taglib-wrapper.js';
export async function initialize(wasmBinary) {
  return new TagLib(await createModule({ wasmBinary }));
}
// Keep wire keys and LYRICS intact; the convenience PropertyMap remaps/omits them.
// This adapter is pinned to the vendored version and covered by round-trip tests.
export const getWireProperties = file => file.handle.getProperties();
export const setWireProperties = (file, properties) => file.handle.setProperties(properties);
