export function bookingFileId(message) {
  const document = message?.document;
  if (document?.file_id && String(document.mime_type || '').toLowerCase() === 'application/pdf') {
    return document.file_id;
  }
  if (document?.file_id && String(document.mime_type || '').toLowerCase().startsWith('image/')) {
    return document.file_id;
  }
  const photos = message?.photo;
  return Array.isArray(photos) && photos.length ? photos[photos.length - 1]?.file_id || null : null;
}

export function bookingMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return {mime: 'image/jpeg', ext: 'jpg'};
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return {mime: 'image/png', ext: 'png'};
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return {mime: 'image/webp', ext: 'webp'};
  if (String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return {mime: 'application/pdf', ext: 'pdf'};
  throw new Error('unsupported_booking_document_type');
}
