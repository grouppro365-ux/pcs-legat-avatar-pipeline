// Shared verbatim with the isolated pcs-channel-send-v1 bundle. No secrets are read.
function canonical(value,depth=0){
 if(depth>24)throw Error('channel_connection_invalid');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(item=>canonical(item,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key],depth+1)]));
 throw Error('channel_connection_invalid');
}
export async function channelConnectionFingerprint(connection,channel){
 if(!['line','whatsapp','instagram','facebook'].includes(channel)||connection?.channel!==channel||connection.enabled!==true||!['credentials_ok','active'].includes(connection.status)||typeof connection.updated_at!=='string'||!Number.isFinite(Date.parse(connection.updated_at))||!connection.public_config||typeof connection.public_config!=='object'||Array.isArray(connection.public_config))throw Error('channel_connection_unavailable');
 const source=JSON.stringify(canonical({channel,enabled:connection.enabled,status:connection.status,updated_at:connection.updated_at,public_config:connection.public_config}));
 if(source.length>65536)throw Error('channel_connection_invalid');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
