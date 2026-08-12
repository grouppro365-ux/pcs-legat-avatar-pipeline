(() => {
  const KEY='agency.browserHarness.state.v1';
  const web=url=>/^https?:/i.test(url||'');
  const meta=tab=>{try{const u=new URL(tab.url);return{tabId:tab.id,origin:u.origin,title:tab.title||u.hostname};}catch{return null;}};

  async function mutate(fn){
    const obj=await chrome.storage.local.get(KEY);const state=obj[KEY];if(!state)return;
    const changed=await fn(state);if(changed)await chrome.storage.local.set({[KEY]:state});
  }

  chrome.tabs.onCreated.addListener(tab=>{
    mutate(state=>{
      if(!state.run||state.run.status!=='running'||!state.target)return false;
      if(tab.openerTabId!==state.target.tabId)return false;
      state.pendingChildTabId=tab.id;
      return true;
    }).catch(()=>{});
  });

  chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
    if(!web(tab.url))return;
    mutate(state=>{
      if(state.pendingChildTabId===tabId&&state.run?.status==='running'){
        const next=meta(tab);if(!next)return false;
        state.target=next;delete state.pendingChildTabId;
        state.logs ||= [];state.logs.push({ts:new Date().toISOString(),level:'info',message:'Harness принял новую вкладку, открытую рабочим действием.',data:{title:next.title,origin:next.origin}});state.logs=state.logs.slice(-300);
        return true;
      }
      if(state.target?.tabId===tabId){
        const next=meta(tab);if(!next)return false;
        if(next.origin===state.target.origin&&next.title===state.target.title)return false;
        state.target=next;return true;
      }
      return false;
    }).catch(()=>{});
  });
})();
