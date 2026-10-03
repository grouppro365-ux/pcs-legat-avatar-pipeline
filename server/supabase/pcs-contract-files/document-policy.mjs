export const MAX_DOCUMENT_BYTES=15*1024*1024;
export const MAX_OCR_BYTES=24*1024*1024;
export function documentUpload(body) {
 const mime=String(body.mime||'');
 const extensions={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!extensions[mime])throw Error('unsupported_file_type');
 const base64=String(body.base64||'');
 if(!base64)throw Error('file_required');
 if(base64.length>Math.ceil(MAX_DOCUMENT_BYTES/3)*4)throw Error('file_too_large');
 if(base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error('invalid_base64');
 let raw;try{raw=atob(base64)}catch{throw Error('invalid_base64')}
 if(!raw.length)throw Error('file_required');
 if(raw.length>MAX_DOCUMENT_BYTES)throw Error('file_too_large');
 const data=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const base=String(body.filename||'document').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.[^.]+$/,'').slice(0,140)||'document';
 return {data,mime,name:base+'.'+extensions[mime]};
}
export function selectedDocumentFiles(files,selection) {
 const images=files.filter(file=>/\.(jpe?g|png|webp)$/i.test(file.name));
 if(selection===undefined)return images.slice(0,8);
 if(!Array.isArray(selection)||!selection.length)throw Error('no_supported_images');
 if(selection.length>8)throw Error('too_many_images');
 const names=[...new Set(selection)];
 if(names.some(name=>typeof name!=='string'||name.includes('/')||name.includes('\\')||!images.some(file=>file.name===name)))throw Error('document_not_found');
 return names.map(name=>images.find(file=>file.name===name));
}
export function recognizedFields(value) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('vision_invalid_response');
 const fields={};
 for(const key of ['full_name','passport_number','nationality','date_of_birth','driving_license_number','driving_license_expiry'])fields[key]=typeof value[key]==='string'?value[key].trim().slice(0,500):'';
 return fields;
}
