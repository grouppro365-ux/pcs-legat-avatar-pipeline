import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { offerPhotos, publicCatalogPhotoUrl } from './catalog-photo.mjs';

const base = 'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/public/pcs-catalog/';

test('only public PCS catalog URLs may be sent to a customer', () => {
  assert.equal(publicCatalogPhotoUrl(base + 'car/photo.jpg'), base + 'car/photo.jpg');
  assert.equal(publicCatalogPhotoUrl('https://example.com/photo.jpg'), null);
  assert.equal(publicCatalogPhotoUrl('https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/sign/private/photo.jpg'), null);
  assert.equal(publicCatalogPhotoUrl(base + 'car/photo.jpg?token=secret'), null);
});

test('offer media respects customer visibility and item order', () => {
  const offer = {items:[{id:'a',title:'LTC-001 · Ford Fiesta · красный · 3675'},{id:'b',title:'Ford Focus 2014'}]};
  const rows = [
    {id:'b1',catalog_item_id:'b',customer_visible:true,media_type:'photo',public_url:base+'b/1.jpg',sort_order:1},
    {id:'a2',catalog_item_id:'a',customer_visible:true,media_type:'photo',public_url:base+'a/2.jpg',sort_order:2},
    {id:'a1',catalog_item_id:'a',customer_visible:true,media_type:'photo',public_url:base+'a/1.jpg',sort_order:1},
    {id:'private',catalog_item_id:'a',customer_visible:false,media_type:'photo',public_url:base+'a/private.jpg',sort_order:0},
  ];
  const photos = offerPhotos(offer, rows);
  assert.deepEqual(photos.map(x=>x.id), ['a1','a2','b1']);
  assert.equal(photos[0].caption, '1. Ford Fiesta · красный · 3675');
  assert.equal(photos[1].caption, '');
  assert.equal(photos[2].caption, '2. Ford Focus 2014');
});

test('runtime sends photo albums through the same conversation event store', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /sendMediaGroup/);
  assert.match(source, /offerPhotos\(/);
  assert.match(source, /const key='runtime-media:'/);
  assert.match(source, /return processMessage\(\{db:sb,channel:'telegram',key,/);
});
