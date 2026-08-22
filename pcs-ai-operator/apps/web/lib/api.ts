export const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:3001';
export async function getJson(path:string){const r=await fetch(`${API}${path}`,{credentials:'include',cache:'no-store'});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json()}
