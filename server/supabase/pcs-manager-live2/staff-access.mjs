import {CrmError,readCrmBody} from './crm-policy.mjs';
import {uuid} from './portal-workflow.mjs';
export const staffRoles=['OPS_ADMIN','CONCIERGE_MANAGER','CATALOG_MANAGER','FINANCE_RECONCILIATION','AUDITOR_READONLY','PARTNERSHIP_MANAGER'];
export const staffRequirements={session:[], 'staff-session':[],
 'application-queue':['applications.view','clients.manage'], 'application-workspace':['applications.view','clients.manage'], 'application-offers':['applications.view','clients.manage'],
 workflow:[], 'workflow-action':[],
 'unified-inbox':['clients.manage'], 'runtime-conversation':['clients.manage'], 'runtime-send':['clients.manage'], 'runtime-intake':['applications.assign','clients.manage'],
 'workflow-delivery':['notifications.view'], 'workflow-delivery-review':['notifications.manage'],finance:['settlements.view'], audit:['audit.view'], notifications:['notifications.view'], 'notification-read':['notifications.view'],
 catalog:['catalog.view','pricing.view_internal'], 'catalog-detail':['catalog.view','pricing.view_internal']};
export function staffCan(ctx,permission){return ctx.permissions.includes('*')||ctx.permissions.includes(permission);}
export async function authorizeStaff(req,biz,verify,op){
 let identity;try{identity=await verify((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));}catch{throw new CrmError('Войдите в учётную запись сотрудника',401);}
 if(!uuid(identity?.sub))throw new CrmError('Сессия недействительна',401);
 const ctx=(await biz.query('select pcs.staff_context($1::uuid) context',[identity.sub]))[0]?.context;
 if(!ctx||!Array.isArray(ctx.permissions))throw new CrmError('Доступ сотрудника не назначен или отозван',403);
 const required=staffRequirements[op];
 if(!required||!required.every(p=>staffCan(ctx,p)))throw new CrmError('Недостаточно прав для этого раздела',403);
 if(op==='workflow'&&!staffCan(ctx,'settlements.view')&&!staffCan(ctx,'applications.view'))throw new CrmError('Недостаточно прав для заявки',403);
 const write=['workflow-action','workflow-delivery-review','runtime-send','runtime-intake','notification-read'].includes(op);
 if(req.method!==(write?'POST':'GET'))throw new CrmError('Метод не поддерживается',405);
 return {...ctx,auth_user_id:identity.sub};
}
export async function staffTeam(req,biz){
 if(req.method==='GET'){
  const users=await biz.query(`select n.id,n.name,n.email,u.id staff_id,u.active,coalesce((select jsonb_agg(distinct m.role) from memberships m where m.user_id=u.id and m.active and m.partner_id is null),'[]'::jsonb) roles from neon_auth."user" n left join app_users u on u.external_id=n.id::text where n.banned is not true order by n."createdAt" desc,n.id limit 100`,[]);
  return {users,roles:staffRoles,limit:100};
 }
 if(req.method!=='POST')throw new CrmError('Метод не поддерживается',405);
 const b=await readCrmBody(req);
 if(!uuid(b.auth_user_id)||!staffRoles.includes(b.role)||typeof b.active!=='boolean'||Object.keys(b).some(k=>!['auth_user_id','role','active'].includes(k)))throw new CrmError('Проверьте сотрудника и роль',400);
 return (await biz.query('select pcs.staff_manage($1::uuid,$2,$3) result',[b.auth_user_id,b.role,b.active]))[0].result;
}
export function staffWorkflowDb(biz,ctx){return {query:async(q,p)=>{
 if(q!=='select pcs.portal_admin_action($1,$2::jsonb) result')throw Error('staff_query_not_allowed');
 return biz.query('select pcs.staff_workflow_action($1::uuid,$2,$3::jsonb) result',[ctx.auth_user_id,...p]);
}};}
export function redactStaffWorkflow(result,ctx){
 if(!staffCan(ctx,'settlements.view')&&!staffCan(ctx,'settlements.edit')){result.payments=[];result.instructions=null;}
 if(!staffCan(ctx,'applications.assign'))result.access=[];
 result.permissions=ctx.permissions;
 return result;
}
