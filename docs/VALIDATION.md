# Validation

Release 1.1.1: all 77 tests passed with FFmpeg/FFprobe and the reference files enabled (zero skipped). The Eagle runtime check passed 19 writes on Node 16.17.1 / Electron 22.3.7.

Five complementary checks are used:

1. Unit tests construct exact ID3/APE/FLAC bytes to verify unknown-frame retention, versions, flags, Unicode, identity checks, custom renames, CRCs, backups and external-change conflicts.
2. FFmpeg generates real files for MP3, MP2, native FLAC, Ogg Vorbis/Opus/Speex/FLAC, WAV/AIFF, AAC/ALAC in MP4, WMA, WavPack, TrueAudio, ADTS AAC, AC3/E-AC3 and Matroska/WebM. The backend writes, rereads and removes custom fields. FFprobe opens the resulting streams, and independently decoded PCM MD5 hashes must match before and after editing. Cover paths, 24-bit PCM, mono AAC, MPEG CBR/VBR and Dolby 5.1 are checked separately. CAF is tested as read-only.
3. Reference files from pinned TagLib source commit `54ae7d8ac45755e286a5c574280f48d5bef93aef` cover Monkey’s Audio (including a leading ID3 tag), Musepack, DSF and DFF. Shorten is checked as read-only. Reference audio is not copied into this repository.
4. The actual inspector runs in headless Chrome with mocked Eagle file APIs. Startup Auto/gray behavior, all six themes, compact layout, name editing/draft recovery, save and a 300 px sidebar are checked. Separate buffer roundtrips run through the actual Node subprocess in Eagle’s embedded runtime.

5. A real Electron 22.3.7 renderer reproduces the exact Worker construction failure from Eagle. It loads the actual inspector with strict CSP, uses the real file store, and launches the actual Eagle executable for its metadata subprocess. Adding, renaming and saving custom fields through the UI succeeds for FLAC, Ogg and M4A; audio payload hashes match. JSON transport tests cover shared references, buffers, cycles, BigInt and literal object keys.

The 1.1.0 standalone Node test did not exercise the renderer platform, and the browser UI test mocked the file store. Those checks missed the Worker limitation; the new renderer test closes that gap.

Run the complete local suite:

```sh
FFMPEG_PATH=/path/to/ffmpeg \
FFPROBE_PATH=/path/to/ffprobe \
TAGLIB_TEST_DATA=/path/to/taglib/tests/data npm test
npm run check
npm run test:ui
```

Tests requiring missing optional binaries/reference files are explicitly skipped. A green unit-only run is not equivalent to a completed interoperability run.

For the Eagle runtime smoke check, first collect generated `sample.*` fixtures in a temporary directory, then on macOS run:

```sh
AUDIO_TEST_FIXTURES=/path/to/fixtures ELECTRON_RUN_AS_NODE=1 \
/Applications/Eagle.app/Contents/MacOS/Eagle scripts/eagle-runtime-smoke.cjs
```

The release was checked with Eagle’s Node 16.17.1 buffer backend. Final manual use inside a running Eagle library remains separate from a mocked UI test. The tests do not establish support for every codec/container combination, all extension aliases, encrypted commercial files, malformed inputs or every nested metadata object. Encoded payload hashing is also enforced at runtime before replacing a file.

For the real renderer test:

```sh
ELECTRON_TEST_PATH=/path/to/Electron \
AUDIO_TEST_FIXTURES=/path/to/fixtures \
EAGLE_EXEC_PATH=/path/to/Eagle npm run test:renderer
```
