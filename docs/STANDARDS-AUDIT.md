# Metadata standards and implementation audit

This document separates format requirements from implementation decisions. “Audio tags” is the umbrella term: ID3 is one metadata system, not a universal format embedded identically in every audio container.

## Findings corrected in 1.1.0

| Earlier behavior | Correction and verification |
| --- | --- |
| Unknown-looking labels appeared inside invented angle brackets | Literal stored names/descriptions are shown; structural records retain their actual names. Browser test checks the custom name input. |
| Custom names were fixed labels | Editable names update ID3 user-defined descriptions, Vorbis/APE keys or mapped custom properties. Draft replay and real-file rename tests check persistence. |
| Arbitrary four-character text IDs could be treated as standard ID3 | Version-specific standard IDs are validated. Friendly names map to the existing ID3 version; arbitrary names become TXXX/TXX. |
| New ID3 identities could collide | New/renamed ordinary text frames, custom descriptions, and language/description pairs are checked before mutation. Existing duplicate frames are retained independently. |
| Every format was treated as MP3-style ID3 | A separate broad-container backend handles format-specific property mappings. ASF custom Unicode attributes use a native object writer because generic ASF mappings discard arbitrary keys. |
| Technical properties were incomplete | Independent parsing, MPEG/Dolby frame inspection, AAC AudioSpecificConfig and explicit unknown/estimated values replace assumptions. |
| A generic cover call could appear to save successfully without writing an image | Cover capabilities are explicit, and supported mapped pictures are read back and compared before replacement. |

## ID3 versions and frame identity

ID3v2.2 uses three-character frame identifiers. Versions 2.3 and 2.4 use four-character identifiers, but are not interchangeable. For example, a recording year/date uses TYE in v2.2, TYER in v2.3, and TDRC in v2.4. The plugin keeps the existing version instead of silently upgrading it.

An ordinary text frame has a defined semantic identifier. Renaming TIT2 into an arbitrary label would change its meaning or create an invalid frame. Custom text belongs in TXXX (TXX in v2.2), whose description is the custom name. Custom URLs use WXXX/WXX. Ordinary text-frame IDs are unique within a valid tag; user-defined text/URL descriptions distinguish their frames. Comments and unsynchronized lyrics additionally use language plus description as their identity.

The plugin prevents new identity collisions. It preserves pre-existing duplicate data rather than silently merging or discarding it. No general “rename raw frame ID” operation is exposed.

Sources: [ID3v2.2](https://id3.org/id3v2-00), [ID3v2.3](https://id3.org/id3v2.3.0), [ID3v2.4 frame definitions](https://id3.org/id3v2.4.0-frames).

## Text and multiple values

ID3v2.3 allows ISO-8859-1 and UTF-16 with a byte-order marker. ID3v2.4 additionally allows UTF-16BE and UTF-8. These constraints apply per frame/version. Edited legacy text is emitted as UTF-16 with a BOM; edited v2.4 text uses UTF-8. Invalid encodings become protected raw fields where parsing can continue.

ID3v2.4 text values can use NUL separators. That is not a license to split every comment, URL or legacy text frame at NUL. Legacy text with nonstandard content after a terminator is protected. ID3v2.3 defines separators for particular fields; the editor does not impose one universal slash-based list rule. APE and Vorbis also have different multi-value representations.

Language editing requires three lowercase letters. The plugin checks the shape, not membership in the complete ISO 639-2 registry. `eng` and `deu` are examples; the application cannot infer the correct language from the value.

Sources: [ID3v2.3 text encoding and individual frames](https://id3.org/id3v2.3.0), [ID3v2.4 frame definitions](https://id3.org/id3v2.4.0-frames).

## Binary structures, flags and preservation

Frame-size encoding differs: v2.3 uses ordinary big-endian sizes; v2.4 uses synchsafe sizes. Tag and frame unsynchronization require version-aware handling. Extended headers, CRCs and a v2.4 footer are structural data, not editable text tags.

The binary codec retains original unchanged container bytes. During a changed tag rebuild, it reconstructs frame headers and updates supported CRCs. Compression, encryption, grouping and data-length indicators are not decoded by this plugin; those payloads remain inspectable/exportable and protected. Unknown flags and unsupported extended restrictions also restrict writing. An opaque frame that would have to be discarded when a tag changes blocks that change rather than losing data silently. Audio-payload verification is independent of metadata CRCs.

The generic backend uses TagLib’s property interface, which can normalize text representation or tag versions. It is deliberately documented differently from the preservation-oriented binary backend.

Source: [ID3v2.4 structure](https://id3.org/id3v2.4.0-structure). Implementation checks: `test/tag-codec.test.js`, `test/standards.test.js`.

## Labels and interpretation

TENC identifies the person or organization that encoded the audio. TSSE describes encoding software/hardware/settings; they should not share an “encoder” label. TPE2 formally describes a band/orchestra/accompaniment, although many applications use it for album artist. The UI uses the interoperable “Album artist” convention while raw identifiers remain available in field details.

A filename extension does not determine the actual codec. MP4 AAC sample-entry channel counts can disagree with AudioSpecificConfig. The implementation checks the latter before reporting channels. A lossy file’s decoding sample format does not establish its original PCM recording bit depth.

Sources: [ID3v2.4 frame definitions](https://id3.org/id3v2.4.0-frames), [TagLib property mappings](https://taglib.org/api/p_propertymapping.html). The AAC channel correction is an implementation finding reproduced with generated mono files and FFprobe.

## Vorbis Comments and FLAC

Vorbis field names use printable ASCII from 0x20 through 0x7D, excluding equals; comparison is case-insensitive. Values are UTF-8. Repeated fields are valid and are not reduced to one scalar. Names are not surrounded with presentation-only brackets. Native FLAC uses Vorbis Comments and dedicated metadata blocks, rather than a blanket ID3 model.

FLAC STREAMINFO, padding and seek tables are protected structural blocks. Other raw blocks can be exported and eligible application/picture data can be edited. A second native Vorbis Comment block is treated as an unsupported write situation. Ogg FLAC follows the Ogg/container path instead of pretending to be native FLAC.

Sources: [Xiph Vorbis Comment specification](https://xiph.org/vorbis/doc/v-comment.html), [FLAC specification, RFC 9639](https://www.rfc-editor.org/rfc/rfc9639.html).

## ASF, APE and mapped containers

ASF descriptive fields and Extended Content Description attributes are parsed directly. Unicode attributes can be edited and custom attributes renamed. Numeric/binary attributes retain their types and bytes and are read-only. Other header objects, including nested extension objects, are preserved. The file-size field is updated when header size changes. Arbitrary ASF custom attributes cannot be reliably represented by TagLib’s general property map; this was reproduced by adding and reading back several custom names.

APE name validation uses printable ASCII, length and reserved-name checks. Comparisons for new names are case-insensitive. Existing duplicates remain visible. Generic mapped formats are read back after writing; any requested value that the container drops or changes aborts the save. This detects unsupported mappings, but is not a proof that every unmodeled metadata byte has retained its original representation.

Sources: [TagLib ASF implementation](https://github.com/taglib/taglib/blob/54ae7d8ac45755e286a5c574280f48d5bef93aef/taglib/asf/asftag.cpp), [TagLib property mappings](https://taglib.org/api/p_propertymapping.html), [TagLib APE implementation](https://github.com/taglib/taglib/blob/54ae7d8ac45755e286a5c574280f48d5bef93aef/taglib/ape/apetag.cpp).

## Technical audio properties

A bitrate average alone does not identify CBR, VBR or ABR. The MPEG inspector checks frame rates and available Xing/Info/VBRI/LAME indicators. ABR is reported only when signaled. Unknown mode remains unknown. Dolby frame parsing derives frame sizes, sampling rate, samples, channels/LFE and observed rate variation; 44.1 kHz frame padding is not treated as VBR by itself. Lossless variable compression is distinguished from uncompressed PCM and DSD.

When no reliable stream bitrate exists, a labeled estimate can include container/metadata overhead. Small files can therefore have high estimated rates. No exact stream measurement is claimed for such estimates. Codec profiles, channel layouts and encoder details are displayed only when available.

Sources: [ATSC A/52 AC-3/E-AC-3 standard](https://www.atsc.org/wp-content/uploads/2015/03/A52-201212-17.pdf), [Mutagen MPEG implementation](https://github.com/quodlibet/mutagen/blob/main/mutagen/mp3/__init__.py), [music-metadata](https://github.com/Borewit/music-metadata).

## Remaining limits

- Not every ID3 binary frame has a semantic editor. Complex/opaque frames are raw or protected; no automatic decryption, decompression or tag-version conversion is performed.
- Generic mapped metadata is not an exhaustive low-level editor for all MP4 atoms, WAV chunks, ASF nested metadata objects or Matroska tag scopes. Native parser records remain inspectable in Properties.
- The generic cover API exposes fewer formats than TagLib’s full C++ API. The UI enables only the verified writer paths.
- CAF and Shorten are read-only. Tracker modules and formats unsupported by the bundled engines are not advertised as editable audio formats.
- Raw AC3/E-AC3 descriptive tags are an interoperability convention, not an ATSC descriptive-tag standard. Playback software may reject tagged raw streams.
- Header parsing and audio hashing cover supported structures, not every malformed or exotic container variant. Writing is refused when payload boundaries cannot be verified.
- Files above 512 MB, automatic batch changes, native Eagle list/grid columns and editing Eagle library keywords are outside this version’s scope.
