import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {documentUpload,selectedDocumentFiles,recognizedFields,MAX_DOCUMENT_BYTES} from '../server/supabase/pcs-contract-files/document-policy.mjs';
test('uploads normalize image extensions and reject invalid/oversized content',()=>{
 const result=documentUpload({mime:'image/jpeg',filename:'passport.HEIC',base64:'YWJj'});
 assert.equal(result.name,'passport.jpg');assert.equal(result.data.length,3);
 for(const [body,error] of [[{mime:'image/heic',base64:'YWJj'},'unsupported_file_type'],[{mime:'image/png',base64:'??=='},'invalid_base64'],[{mime:'image/png',base64:''},'file_required'],[{mime:'image/png',base64:'A'.repeat(Math.ceil(MAX_DOCUMENT_BYTES/3)*4+4)},'file_too_large']])assert.throws(()=>documentUpload(body),new RegExp(error));
});
test('OCR is limited to selected images in the reservation listing',()=>{
 const files=[{name:'a.jpg'},{name:'b.png'},{name:'other.pdf'}];
 assert.deepEqual(selectedDocumentFiles(files,['b.png','b.png']),[{name:'b.png'}]);
 for(const selection of [['../a.jpg'],['missing.jpg'],['other.pdf']])assert.throws(()=>selectedDocumentFiles(files,selection),/document_not_found/);
 assert.throws(()=>selectedDocumentFiles(files,Array(9).fill('a.jpg')),/too_many_images/);
 assert.equal(selectedDocumentFiles(files,undefined).length,2);
});
test('OCR output contains only supported textual fields',()=>{
 const fields=recognizedFields({full_name:' Test Name ',passport_number:123,extra:'drop'});
 assert.equal(fields.full_name,'Test Name');assert.equal(fields.passport_number,'');assert.equal(fields.extra,undefined);
 assert.throws(()=>recognizedFields([]),/vision_invalid_response/);
});
function fixture(){
 const nodes={ctDocuments:{dataset:{reservation:'reservation-1'}},ctDocumentList:{innerHTML:''},ctDocumentStatus:{textContent:''},ctPassportPhotos:{files:[{name:'passport.png',type:'image/png',size:3}],value:'chosen'},ctName:{value:'Manual Name'},ctPassport:{value:''},ctNationality:{value:''},ctLicense:{value:''}};
 const calls=[];let approved=true,failUpload=false;const selected=[{value:'selected.png'}];
 const context={window:{confirm:()=>approved},localStorage:{pcsToken:'test-token'},document:{getElementById:id=>nodes[id],querySelectorAll:s=>s.includes(':checked')?selected:[]},FileReader:class{readAsDataURL(){this.result='data:image/png;base64,YWJj';this.onload()}},fetch:async(url,options)=>{
 const body=options.body?JSON.parse(options.body):null;calls.push(body);
 if(failUpload&&body?.kind==='client_document')return{ok:false,status:413,json:async()=>({error:'file_too_large'})};
 return{ok:true,status:200,json:async()=>body?.kind==='ocr_documents'?{fields:{full_name:'OCR Name',passport_number:'ABC123',nationality:'TH',driving_license_number:'DL123'}}:body?{ok:true}:[{name:'selected.png',url:'https://example.test/signed'}]};
 }};
 vm.runInNewContext(readFileSync(new URL('../pcs-ai-operator-v6/contract-documents.js',import.meta.url),'utf8'),context);
 return{api:context.window.pcsContractDocuments,nodes,calls,setApproved:value=>approved=value,setFail:value=>failUpload=value};
}
test('photo upload refreshes list without losing unsaved form data',async()=>{
 const f=fixture();await f.api.mount({id:'contract-1',reservation_id:'reservation-1'});await f.api.upload('passport');
 assert.equal(f.nodes.ctName.value,'Manual Name');assert.equal(f.nodes.ctPassportPhotos.value,'');
 assert.equal(f.calls.filter(x=>x?.kind==='client_document').length,1);
 assert.equal(f.calls.find(x=>x?.kind==='client_document').reservation_id,'reservation-1');
 assert.match(f.nodes.ctDocumentStatus.textContent,/Сохранено фото: 1/);
});
test('OCR requires confirmation, sends selected names and preserves manual fields',async()=>{
 const f=fixture();await f.api.mount({id:'contract-1',reservation_id:'reservation-1'});f.setApproved(false);await f.api.recognize();assert.equal(f.calls.filter(x=>x?.kind==='ocr_documents').length,0);
 f.setApproved(true);await f.api.recognize();assert.deepEqual(f.calls.find(x=>x?.kind==='ocr_documents').filenames,['selected.png']);
 assert.equal(f.nodes.ctName.value,'Manual Name');assert.equal(f.nodes.ctPassport.value,'ABC123');assert.equal(f.nodes.ctLicense.value,'DL123');
});
test('upload errors remain visible and preserve file selection for retry',async()=>{
 const f=fixture();await f.api.mount({id:'contract-1',reservation_id:'reservation-1'});f.setFail(true);await f.api.upload('passport');assert.match(f.nodes.ctDocumentStatus.textContent,/15 МБ/);assert.equal(f.nodes.ctPassportPhotos.value,'chosen');
});
