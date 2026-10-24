import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.error import URLError, HTTPError

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools/video'),str(ROOT/'tools/ltx')]
from ltx_provider import validate_job,job_digest,MODEL,REVISION,PACKAGES,artifact_receipt
from prepare_content_video import prepare,provider_input
from content_video_worker import ManagerAPI,WorkerError,verify_generated,process_one,oidc_token,NoRedirect
from urllib.request import Request

ID='11111111-1111-4111-8111-111111111111'
CLAIM='22222222-2222-4222-8222-222222222222'
def job():
 return {'id':ID,'claim_id':CLAIM,'version':1,'stage':'PREPARING',
  'spec':{'version':1,'mode':'TEXT_TO_VIDEO','preset':'landscape','fit':'contain',
   'shots':[{'prompt':'A green leaf moves in a light breeze.','negative_prompt':'text, logo','seed':42,'frames':17}]}}

class API:
 def __init__(self,value=None):self.job=copy.deepcopy(value);self.calls=[]
 def call(self,action,**body):
  self.calls.append((action,copy.deepcopy(body)))
  if action=='claim':return {'ok':True,'job':copy.deepcopy(self.job)}
  assert body['job_id']==self.job['id'] and body['claim_id']==self.job['claim_id']
  assert body['expected_version']==self.job['version']
  if action=='upload':
   kind=body['kind'];path=f'jobs/{ID}/{CLAIM}/'+('final.mp4' if kind=='video' else 'cover.png')
   return {'ok':True,'job':copy.deepcopy(self.job),'upload':{'path':path,'signed_url':'https://nnlzgertmmxuteozoeel.supabase.co/storage/v1/object/upload/sign/pcs-content-video/'+path}}
  self.job['version']+=1
  if action=='progress':self.job['stage']=body['stage']
  if action=='complete':self.job.update(stage='READY',artifact=body['artifact'])
  if action=='fail':self.job.update(stage='FAILED',error_code=body['error_code'])
  return {'ok':True,'job':copy.deepcopy(self.job)}

class VideoWorkerTests(unittest.TestCase):
 def test_redirects_cannot_forward_ephemeral_bearer_or_signed_upload_requests(self):
  for method in ['GET','POST','PUT']:
   request=Request('https://nnlzgertmmxuteozoeel.supabase.co/private',method=method,
    headers={'Authorization':'Bearer ephemeral'})
   for status in [301,302,303,307,308]:
    with self.assertRaisesRegex(WorkerError,'video_http_redirect_refused'):
     NoRedirect().redirect_request(request,None,status,'redirect',{},'https://untrusted.example/')

 def test_minimized_notebook_reuses_existing_private_kernel_and_excludes_editorial_snapshot(self):
  value=job();value['snapshot']={'private_internal_note':'DO_NOT_TRANSMIT_THIS_INTERNAL_NOTE'}
  with tempfile.TemporaryDirectory() as tmp:
   meta=prepare(value,tmp);original=json.loads((ROOT/'kernel-metadata.json').read_text())
   self.assertEqual(meta['id'],original['id']);self.assertEqual(meta['title'],original['title']);self.assertTrue(meta['is_private'])
   self.assertEqual(meta['dataset_sources'],[])
   content=(Path(tmp)/meta['code_file']).read_text();self.assertNotIn('DO_NOT_TRANSMIT_THIS_INTERNAL_NOTE',content)
   notebook=json.loads(content);code=''.join(notebook['cells'][0]['source']);compile(code,'<video-job>','exec')
   self.assertIn('virtualenv==20.35.3',code);self.assertIn(REVISION,code)
   self.assertEqual(set(provider_input(value)),{'id','claim_id','spec'})

 def test_capabilities_are_bounded_and_references_or_boolean_seeds_cannot_slip_in(self):
  for field,value in [('frames',65),('seed',True),('prompt','short')]:
   data=provider_input(job());data['spec']['shots'][0][field]=value
   with self.assertRaises(ValueError):validate_job(data)
  for field,value in [('reference_image','https://private.example/doc'),('width',1920),('version',True)]:
   data=provider_input(job());data['spec'][field]=value
   with self.assertRaises(ValueError):validate_job(data)
  data=provider_input(job());data['secret']='no'
  with self.assertRaises(ValueError):validate_job(data)

 def test_real_decoded_source_receipt_rejects_nonce_dependency_and_file_tampering(self):
  import imageio_ffmpeg
  data=provider_input(job())
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'shot-001.mp4'
   subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-f','lavfi','-i','testsrc2=size=320x256:rate=8','-frames:v','17','-c:v','libx264','-pix_fmt','yuv420p',str(path)],check=True,capture_output=True)
   receipt={'job_id':ID,'run_id':CLAIM,'input_sha256':job_digest(data),'outcome':'GENERATED_VIDEO_SHOTS',
    'model':MODEL,'model_revision':REVISION,'implementation':'diffusers.LTXPipeline','dependencies':PACKAGES,
    'gpu':'SYNTHETIC_FIXTURE_ONLY','shots':[artifact_receipt(path)],'published':False,'customer_send':False,'private_assets_used':False}
   report=root/'result.json';report.write_text(json.dumps(receipt));self.assertEqual(verify_generated(data,root)[1],[path])
   for mutation in [{'run_id':ID},{'dependencies':{**PACKAGES,'torch':'wrong'}},{'input_sha256':'0'*64}]:
    report.write_text(json.dumps({**receipt,**mutation}))
    with self.assertRaises(WorkerError):verify_generated(data,root)
   report.write_text(json.dumps(receipt));path.write_bytes(b'corrupt')
   with self.assertRaises(RuntimeError):verify_generated(data,root)

 def test_transient_api_retry_reuses_command_and_refreshes_oidc_without_a_stored_pcs_secret(self):
  requests=[];tokens=[]
  def token():tokens.append('ephemeral');return 'ephemeral-'+str(len(tokens))
  def transport(req):
   requests.append(req)
   if len(requests)==1:raise URLError('temporary network fault')
   return {'ok':True,'job':None}
  self.assertEqual(ManagerAPI(token,transport,lambda _:None).call('claim'),{'ok':True,'job':None})
  self.assertEqual(requests[0].data,requests[1].data);self.assertNotEqual(requests[0].get_header('Authorization'),requests[1].get_header('Authorization'))
  self.assertEqual(len(tokens),2)
  with self.assertRaises(WorkerError):oidc_token({'ACTIONS_ID_TOKEN_REQUEST_URL':'https://evil.example','ACTIONS_ID_TOKEN_REQUEST_TOKEN':'private'})

 def test_confirmed_database_quota_stops_retries_and_never_logs_raw_response(self):
  calls=[];sleeps=[];streams=[]
  def transport(req):
   calls.append(req);stream=io.BytesIO(json.dumps({'code':'database_quota_exceeded','error':'private provider details'}).encode());streams.append(stream)
   raise HTTPError(req.full_url,503,'Unavailable',{},stream)
  with self.assertRaisesRegex(WorkerError,'^DATABASE_QUOTA_EXCEEDED$'):
   ManagerAPI(lambda:'ephemeral',transport,sleeps.append).call('claim')
  self.assertEqual(len(calls),1);self.assertEqual(sleeps,[]);self.assertTrue(streams[0].closed)
  for raw in [b'not json',b'[]',b'{"code":"other"}',b'x'*4097]:
   attempts=[]
   def transient(req):
    attempts.append(1)
    if len(attempts)==1:raise HTTPError(req.full_url,503,'Unavailable',{},io.BytesIO(raw))
    return {'ok':True,'job':None}
   self.assertEqual(ManagerAPI(lambda:'ephemeral',transient,lambda _:None).call('claim'),{'ok':True,'job':None})
   self.assertEqual(len(attempts),2)

 def test_quota_during_preparation_stops_before_gpu_and_preserves_claim_without_extra_db_write(self):
  api=API(job());original=api.call;launches=[]
  def call(action,**body):
   if action=='progress':raise WorkerError('DATABASE_QUOTA_EXCEEDED')
   return original(action,**body)
  api.call=call
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(WorkerError,'^DATABASE_QUOTA_EXCEEDED$'):
    process_one(api,object(),tmp,build=lambda *args:None,launch=lambda *args:launches.append(1))
  self.assertEqual(launches,[]);self.assertEqual([name for name,_ in api.calls],['claim']);self.assertEqual(api.job['stage'],'PREPARING')

 def test_success_requires_all_stages_two_private_uploads_and_review_without_publishing(self):
  api=API(job());launches=[];uploads=[]
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   def launch(client,folder,receipt):launches.append(folder);return {'kernel':'tatyanathai/pcs-legat-ai-avatar-pipeline','version':100,'ref':'tatyanathai/pcs-legat-ai-avatar-pipeline/100'}
   def verify(value,directory):
    directory.mkdir(parents=True,exist_ok=True);path=directory/'shot-001.mp4';path.write_bytes(b'fixture');return {},[path]
   def adapt(manifest,source,target):
    target.mkdir();(target/'final.mp4').write_bytes(b'fixture-video');(target/'cover.png').write_bytes(b'fixture-cover')
    return {'outcome':'TECHNICAL_QA_PASSED','manual_review_required':True,'manifest_sha256':'a'*64,
     'artifact':{'file':'final.mp4','sha256':hashlib.sha256(b'fixture-video').hexdigest(),'width':1280,'height':720,'fps':24,'frames':51,'duration_seconds':2.125,'decode_verified':True,'codec':'h264'},
     'cover':{'file':'cover.png','sha256':hashlib.sha256(b'fixture-cover').hexdigest()}}
   def upload(url,path,**kw):uploads.append(url);return {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
   result=process_one(api,object(),root,build=lambda *args:None,launch=launch,await_gpu=lambda *args:None,download=lambda *args:None,verify=verify,adapt=adapt,upload=upload)
   self.assertEqual(result['outcome'],'READY_FOR_REVIEW');self.assertEqual(len(launches),1);self.assertEqual(len(uploads),2)
   self.assertEqual([body['stage'] for name,body in api.calls if name=='progress'],['GENERATING','GENERATING','POST_PROCESSING','QA'])
   self.assertEqual(api.job['stage'],'READY');self.assertTrue(api.job['artifact']['manual_review_required'])
   self.assertFalse(any('publish' in name or 'send' in name for name,_ in api.calls))

 def test_unknown_gpu_launch_is_marked_once_and_never_blindly_retried(self):
  api=API(job());launches=[]
  def launch(*args):launches.append(1);raise TimeoutError('unknown push result')
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(WorkerError,'GPU_LAUNCH_UNKNOWN'):
    process_one(api,object(),tmp,build=lambda *args:None,launch=launch)
  self.assertEqual(len(launches),1);self.assertEqual(api.job['error_code'],'GPU_LAUNCH_UNKNOWN')
  self.assertEqual([name for name,_ in api.calls],['claim','progress','fail'])
  with tempfile.TemporaryDirectory() as tmp:self.assertEqual(process_one(API(),object(),tmp),{'outcome':'EMPTY_QUEUE'})

if __name__=='__main__':unittest.main()
