

try {
    const pdf = require('pdf-parse')
    console.log('Main require keys:', Object.keys(pdf))
    if (pdf.PDFParse) console.log('PDFParse type:', typeof pdf.PDFParse)
} catch (e) { console.log('Main require failed', e.message) }

try {
    const pdfNode = require('pdf-parse/node')
    console.log('Node require keys:', Object.keys(pdfNode))
    if (pdfNode.default) console.log('Node default type:', typeof pdfNode.default)
} catch (e) {
    console.log('Node require failed', e.message)
}
