import {fetch,EndpointError} from 'sdk';
import {forwardRequest} from '../lib/legacy-api.js';
export default async function(input,ctx){
 try{return await forwardRequest(input,ctx,fetch)}
 catch(error){
  const auth=['telegram_user_required','admin_session_required'].includes(error?.message);
  const invalid=['invalid_request','unsupported_route','invalid_path','invalid_query','unsupported_operation','invalid_body','invalid_json'].includes(error?.message);
  throw new EndpointError(auth?'Требуется вход оператора.':invalid?'Некорректный запрос PCS.':'Ответ PCS не подтверждён. Проверьте запись перед повтором.',{code:auth?'AUTH_REQUIRED':invalid?'INVALID_REQUEST':'UPSTREAM_UNCONFIRMED'});
 }
}
