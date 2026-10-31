# foliate-js (vendored)

The ebook engine behind Digitify's ebook reader (decision D-014): EPUB, MOBI, AZW3/KF8 and FB2.

- **Upstream:** https://github.com/johnfactotum/foliate-js
- **Pinned commit:** `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- **Tarball sha256:** `4878cd5f04073af5046ea543da73a963a7f9e1a4b30ddc63ac86cea5adf02f38`
- **License:** MIT (`LICENSE` in this folder). `vendor/zip.js` is zip.js (BSD-3-Clause) and
  `vendor/fflate.js` is fflate (MIT), both as bundled by foliate-js; their license texts are in
  `THIRD_PARTY_NOTICES.md`.

## What's here

The files `view.js` needs to open books, copied unmodified from the pinned commit:
`view.js`, `epub.js`, `epubcfi.js`, `mobi.js`, `fb2.js`, `comic-book.js`, `paginator.js`,
`fixed-layout.js`, `overlayer.js`, `progress.js`, `text-walker.js`, `search.js`, `tts.js`,
`vendor/zip.js`, `vendor/fflate.js`.

Changed for Digitify:

- `pdf.js` is a stand-in that refuses PDFs. Upstream's version loads PDF.js (about 10 MB);
  Digitify reads PDFs with PDFium in its page reader instead.
- `view.d.ts` declares the parts of `view.js` that Digitify's TypeScript uses.

Not copied: PDF.js, the demo reader, `footnotes.js`, `dict.js`, `opds.js`, `quote-image.js`,
`ui/` and the tests.

## Updating

Download the tarball for a new commit, check its sha256, copy the same files over, keep the
stand-in `pdf.js`, update the commit and hash above, and run the ebook reader's e2e test.
