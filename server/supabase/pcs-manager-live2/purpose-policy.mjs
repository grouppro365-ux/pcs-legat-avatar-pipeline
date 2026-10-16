import {CrmError,readCrmBody} from './crm-policy.mjs';
import {staffCan} from './staff-access.mjs';

export const purposePermissions=Object.freeze({
 'contracts.read':['applications.view','clients.manage'],
 'contracts.write':['applications.execute','clients.manage'],
 'contracts.documents.read':['applications.view','clients.manage'],
 'contracts.documents.write':['applications.execute','clients.manage'],
 'contracts.documents.ocr':['applications.execute','clients.manage'],
 'catalog.write':['catalog.edit'],
 'catalog.pricing.read':['pricing.view_internal','catalog.view'],
 'catalog.pricing.write':['pricing.edit'],
 'bot.configure':['settings.edit']
});
// The caller identity and current permissions are resolved by authorizeStaff, never by request JSON/JWT roles.
export async function authorizePurposeRequest(req,staff,isAdmin=false){
 if(req.method!=='POST')throw new CrmError('Метод не поддерживается',405);
 const b=await readCrmBody(req);
 if(Object.keys(b).length!==1||typeof b.purpose!=='string'||!Object.hasOwn(purposePermissions,b.purpose))throw new CrmError('Некорректная цель доступа',400);
 if(!isAdmin&&(!staff||!purposePermissions[b.purpose].every(p=>staffCan(staff,p))))throw new CrmError('Недостаточно прав для этого действия',403);
 return {ok:true,purpose:b.purpose};
}
