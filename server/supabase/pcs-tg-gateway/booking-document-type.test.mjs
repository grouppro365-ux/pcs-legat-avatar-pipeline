import assert from 'node:assert/strict';
import test from 'node:test';
import {bookingDocumentType} from './booking-document-type.mjs';

test('booking captions route sensitive images to manual private review', () => {
  assert.equal(bookingDocumentType('Паспорт'), 'passport');
  assert.equal(bookingDocumentType('МВУ'), 'international_permit');
  assert.equal(bookingDocumentType('International Driving Permit'), 'international_permit');
  assert.equal(bookingDocumentType('Права'), 'booking_document_unknown');
  assert.equal(bookingDocumentType('Чек предоплаты'), 'receipt');
  assert.equal(bookingDocumentType(''), 'booking_document_unknown');
});
