# Changelog

## 1.1.1

- Fix the inspector startup error: Eagle’s renderer V8 platform cannot create Node Workers.
- Run metadata parsing in a separate process using the Eagle executable supplied by the host API.
- Use reference-preserving JSON IPC to avoid Electron 22 binary-serialization crashes.
- Close background processes on inspector unload or idle timeout.
- Add a real Electron renderer regression test covering the actual inspector, file store and Eagle subprocess, including real FLAC/Ogg/M4A saves.
- Normalize packaged filenames so release downloads match checksum filenames.

## 1.1.0

- Use English throughout the inspector, errors and repository documentation.
- Match Eagle’s native theme, fonts and compact inspector spacing; honor resolved Auto themes.
- Show literal tag names and allow direct custom-name editing with draft recovery.
- Validate ID3 frame versions, custom identities, language/description pairs, encodings and format-specific field names.
- Preserve protected/opaque payloads and block unsupported changes instead of discarding metadata.
- Add broad audio-container support through offline TagLib and music-metadata bundles, including Ogg, Opus, WAV, AIFF, MP4/AAC/ALAC, WMA/ASF, APE, WavPack, Musepack, TrueAudio, DSD and Matroska/WebM.
- Edit arbitrary ASF Unicode attributes directly; retain typed and binary attributes.
- Display codec/profile, bitrate, CBR/VBR/ABR where known, sample rate, channels, precision, duration, encoder and native records.
- Verify mapped values, supported covers and encoded audio before saving; retain backups and external-change checks.
- Document read-only formats, cover restrictions, standards decisions and reproducible validation.
