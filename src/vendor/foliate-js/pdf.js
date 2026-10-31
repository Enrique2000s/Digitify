// Digitify: stands in for foliate-js's pdf.js, which needs PDF.js (about 10 MB). PDFs open in
// Digitify's page reader through PDFium, so the ebook reader never receives one.
export const makePDF = async () => {
    throw new Error('PDFs open in the page reader')
}
