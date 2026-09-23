import { publicVehicleName } from './vehicle-offer.mjs';

const PUBLIC_CATALOG_PREFIX = 'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/public/pcs-catalog/';

export function publicCatalogPhotoUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PUBLIC_CATALOG_PREFIX)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function offerPhotos(offer, mediaRows, maxPerItem = 2) {
  if (!Array.isArray(offer?.items) || !Array.isArray(mediaRows)) return [];
  const photos = [];
  for (const [index, item] of offer.items.entries()) {
    const rows = mediaRows
      .filter(row => row.catalog_item_id === item.id && row.customer_visible === true && row.media_type === 'photo')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    let count = 0;
    for (const row of rows) {
      const url = publicCatalogPhotoUrl(row.public_url);
      if (!url) continue;
      photos.push({ id: row.id, url, caption: count === 0 ? `${index + 1}. ${publicVehicleName(item.title)}` : '' });
      count += 1;
      if (count >= maxPerItem || photos.length >= 10) break;
    }
    if (photos.length >= 10) break;
  }
  return photos;
}
