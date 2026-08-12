const assert=require('assert');
const {Driver,ElementProxy,matchesDescriptor}=require('../browser_harness_core.js');

const d={ref:'bh7',tag:'button',role:'button',name:'Опубликовать',label:'',text:'Опубликовать',hints:{id:'publish',name:'',testid:'',aria:'',placeholder:'',type:'submit',hrefPath:''}};
assert(matchesDescriptor(d,{ref:'bh7'}));
assert(matchesDescriptor(d,{role:'button',name:'опубли'}));
assert(matchesDescriptor(d,{hints:{id:'publish'}}));
assert(!matchesDescriptor(d,{role:'link'}));

const driver=new Driver(123);
const proxy=new ElementProxy(driver,d);
assert.equal(proxy.isElementProxy,true);
assert.equal(proxy.target().ref,'bh7');

(async()=>{
  let n=0;
  const result=await driver.waitFor(async()=>{n++;return n>=3?'ok':false;},{timeoutMs:200,retryMs:5});
  assert.equal(result,'ok');
  assert(n>=3);
  console.log('core_test PASS');
})().catch(err=>{console.error(err);process.exit(1);});
