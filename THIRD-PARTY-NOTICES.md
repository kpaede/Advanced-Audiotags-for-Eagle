# Third-party notices and replaceable library source

The plugin runs entirely offline. Bundled third-party code retains its upstream licenses; the individual license texts are included in `vendor/` and `third-party/` in both the repository and installable package.

| Component | Version / source | License |
| --- | --- | --- |
| TagLib-Wasm JavaScript / bindings | npm 1.5.3, source commit `88932cecfc25dd612f5dd46a5974c44eaeba7eca` | MIT for JavaScript; upstream C/C++ notices apply to library code |
| TagLib WebAssembly binary | unmodified `taglib-web.wasm` from taglib-wasm 1.5.3; TagLib commit `54ae7d8ac45755e286a5c574280f48d5bef93aef` | LGPL-2.1-or-later, as distributed by TagLib-Wasm; TagLib also offers MPL-1.1 |
| utf8cpp | commit `819011bb01628fe1aa2f1da9f2c842a48fd5680b` | Boost Software License 1.0 |
| MPack | commit `79d3fcd3e04338b06e82d01a62f4aa98c7bad5f7` | MIT |
| music-metadata | npm 12.2.1 | MIT |
| music-metadata / JavaScript dependencies | pinned in package-lock.json | See bundled individual notices |

TagLib-Wasm is maintained by Charles Wiltgen. TagLib is maintained by its contributors. music-metadata is maintained by Borewit and its contributors. Full copyright statements remain in the license and source files; this table does not replace them.

## Corresponding library source

The [1.1.1 release](https://github.com/kpaede/Advanced-Audiotags-for-Eagle/releases/tag/v1.1.1) includes **taglib-corresponding-source-1.5.3.tar.gz**. It contains the exact upstream TagLib-Wasm source, its build recipes, the pinned TagLib/MPack submodules and TagLib’s pinned utf8cpp submodule. Sources have not been modified by this plugin. The source archive is offered alongside the binary without an additional charge.

Canonical upstream sources:

- [TagLib-Wasm source](https://github.com/CharlesWiltgen/TagLib-Wasm/tree/88932cecfc25dd612f5dd46a5974c44eaeba7eca)
- [TagLib source](https://github.com/taglib/taglib/tree/54ae7d8ac45755e286a5c574280f48d5bef93aef)
- [utf8cpp source](https://github.com/nemtrif/utfcpp/tree/819011bb01628fe1aa2f1da9f2c842a48fd5680b)
- [MPack source](https://github.com/ludocode/mpack/tree/79d3fcd3e04338b06e82d01a62f4aa98c7bad5f7)
- [music-metadata source](https://github.com/Borewit/music-metadata)

## Rebuild, replace and debug

The plugin’s `scripts/taglib-entry.mjs` instantiates the Emscripten buffer backend directly. This adapts the JavaScript loading path for Eagle’s Node 16 runtime; the distributed WebAssembly bytes are unchanged. It does not use the package’s Node 22 WASI loader.

To use a modified TagLib, unpack the corresponding sources, follow their Emscripten build instructions and run `build/build-wasm.sh`. The upstream build uses Emscripten’s zlib port and toolchain support under their respective upstream licenses. Install the rebuilt `taglib-web.wasm` and matching `taglib-wrapper.js` into `node_modules/taglib-wasm/dist/` in this project, then run `npm run build` and `npm run package`. Matching JavaScript glue and Wasm imports are required; retain the upstream consistency checks.

The resulting `vendor/taglib.cjs` and `vendor/taglib.wasm` can replace the distributed pair. The repository provides the application-side source needed to rebuild the integration. You may modify the library and reverse engineer this integration for debugging modifications to the LGPL-covered library. No signature check prevents replacing it.

Full LGPL and MPL texts are included in `third-party/`. Additional bundled JavaScript dependency licenses are copied during `npm run build`; some development-tool notices may also be present. They do not change the licenses of independent plugin source files.
