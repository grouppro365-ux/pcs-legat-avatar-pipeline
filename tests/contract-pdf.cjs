const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '../pcs-ai-operator-v6');
const { mapContract } = require(path.join(base, 'contract-pdf-v5.js'));
const document = require(path.join(base, 'contract-document-v4.js'));
const pdfMake = require(path.join(base, 'vendor/contract-pdf/pdfmake.min.js'));
const vfs = require(path.join(base, 'vendor/contract-pdf/vfs_fonts.js'));
for (const font of ['Sarabun-Regular.ttf', 'Sarabun-Bold.ttf'])
  vfs[font] = fs.readFileSync(path.join(base, 'vendor/contract-pdf', font)).toString('base64');
pdfMake.addVirtualFileSystem(vfs);
pdfMake.addFonts({
  Sarabun: { normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf' },
  Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf' }
});

const version = {
  id: 'contract-test', version: 2, status: 'ready_to_sign',
  created_at: '2026-09-20T00:00:00Z', finalized_at: '2026-09-22T00:00:00Z',
  renter_data: { name: 'TEST CLIENT', id_or_passport: 'TEST-PASSPORT', license_no: 'TEST-LICENCE', nationality: 'Россия' },
  vehicle_data: { model: 'Ford Fiesta', registration_no: 'TEST 123', color: 'синий металлик' },
  rental_data: { start_date: '2026-12-20', end_date: '2027-01-14' },
  pricing_snapshot: { rate: 300, total: 10000, booking_deposit: 3000, paid: 5000, balance: 5000, deposit: 5000, transfer_fee: 0, currency: 'THB' },
  handover_data: {}
};
const data = mapContract(version);
assert.equal(data.issued, '2026-09-22');
assert.equal(data.nationality, 'รัสเซีย');
assert.equal(data.color, 'สีน้ำเงินเมทัลลิก');
assert.equal(data.total, 10000);
assert.equal(data.rate, 300);
assert.equal(data.advance, 3000);
assert.equal(data.balance, 5000);
assert.equal(data.security, 5000);
assert.equal(data.delivery, 0);
const definition = document.definition(data);
assert.equal(definition.pageSize, 'A4');
assert.ok(!JSON.stringify(definition).includes('image:'));
assert.ok(JSON.stringify(definition).includes('5,000.00'));
pdfMake.createPdf(definition).getBuffer(buffer => {
  const pdf = Buffer.from(buffer);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('/ToUnicode')));
  assert.ok(!pdf.includes(Buffer.from('/Subtype /Image')));
  if (process.env.PCS_CONTRACT_SAMPLE) fs.writeFileSync(process.env.PCS_CONTRACT_SAMPLE, pdf);
  console.log('Native Thai contract PDF test passed:', pdf.length, 'bytes');
});
