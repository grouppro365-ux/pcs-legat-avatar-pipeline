import assert from 'node:assert/strict';
import test from 'node:test';
import {bookingFileId, bookingMime} from './booking-file.mjs';

test('booking intake accepts images and PDF documents, not unrelated files', () => {
  assert.equal(bookingFileId({photo: [{file_id: 'small'}, {file_id: 'large'}]}), 'large');
  assert.equal(bookingFileId({document: {file_id: 'pdf', mime_type: 'application/pdf'}}), 'pdf');
  assert.equal(bookingFileId({document: {file_id: 'image', mime_type: 'image/jpeg'}}), 'image');
  assert.equal(bookingFileId({document: {file_id: 'archive', mime_type: 'application/zip'}}), null);
  assert.equal(bookingMime(new TextEncoder().encode('%PDF-1.7')).mime, 'application/pdf');
  assert.equal(bookingMime(Uint8Array.of(0xff, 0xd8, 0xff)).ext, 'jpg');
  assert.throws(() => bookingMime(Uint8Array.of(0x50, 0x4b, 0x03, 0x04)), /unsupported_booking_document_type/);
});
