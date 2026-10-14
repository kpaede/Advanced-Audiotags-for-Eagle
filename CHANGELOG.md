# Changelog

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
