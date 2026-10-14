import {CrmError,readCrmBody} from './crm-policy.mjs';
import {uuid,tokenHash,portalCommand,portalBrowse} from './portal-workflow.mjs';
export const authBase='https://ep-small-cell-av1ecg0k.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth';
export async function accountRoute(req,biz,verify){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token||token.length>10000)throw new CrmError('Войдите в учётную запись',401);
 let identity;try{identity=await verify(token);}catch{throw new CrmError('Сессия истекла. Войдите снова.',401);}
 if(!uuid(identity?.sub))throw new CrmError('Сессия недействительна',401);
 if(!['GET','POST'].includes(req.method))throw new CrmError('Метод не поддерживается',405);
 const b=req.method==='POST'?await readCrmBody(req):null;
 if(b?.action==='bind'){
  if(Object.keys(b).some(k=>!['action','invitation'].includes(k))||! /^[a-f0-9]{64}$/.test(b.invitation||''))throw new CrmError('Откройте персональную ссылку оператора',400);
  const fresh=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return (await biz.query('select pcs.portal_bind_account($1::uuid,$2,$3) result',[identity.sub,await tokenHash(b.invitation),await tokenHash(fresh)]))[0].result;
 }
 const hash=(await biz.query('select pcs.portal_account_hash($1::uuid) hash',[identity.sub]))[0].hash;
 if(req.method==='GET')return (await biz.query('select pcs.portal_home_page($1,$2::integer,$3,$4) result',[hash,...portalBrowse(req)]))[0].result;
 const command=portalCommand(b);
 return (await biz.query('select pcs.portal_action($1,$2,$3::uuid,$4::jsonb) result',[hash,command.action,command.request_id,JSON.stringify(command.payload)]))[0].result;
}
