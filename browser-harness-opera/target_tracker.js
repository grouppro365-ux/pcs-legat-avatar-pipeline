(() => {
  const KEY='agency.browserHarness.state.v1';
  const web=url=>/^https?:/i.test(url||'');
  const meta=tab=>{try{const u=new URL(tab.url);return{tabId:tab.id,origin:u.origin,title:tab.title||u.hostname};}catch{return null;}};
  let reconciling=false;

  async function mutate(fn){
    const obj=await chrome.storage.local.get(KEY);const state=obj[KEY];if(!state)return;
    const changed=await fn(state);if(changed)await chrome.storage.local.set({[KEY]:state});
  }

  chrome.tabs.onCreated.addListener(tab=>{
    mutate(state=>{
      if(!state.run||!['running','waiting_chatgpt','sending_chatgpt'].includes(state.run.status)||!state.target)return false;
      if(tab.openerTabId!==state.target.tabId)return false;
      state.pendingChildTabId=tab.id;
      return true;
    }).catch(()=>{});
  });

  chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
    if(!web(tab.url))return;
    mutate(state=>{
      if(state.pendingChildTabId===tabId&&state.run&&!['blocked','cancelled','done'].includes(state.run.status)){
        const next=meta(tab);if(!next)return false;
        state.target=next;delete state.pendingChildTabId;
        state.logs ||= [];state.logs.push({ts:new Date().toISOString(),level:'info',message:'Harness принял новую вкладку, открытую рабочим действием.',data:{title:next.title,origin:next.origin}});state.logs=state.logs.slice(-500);
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

  // A service-worker action and tabs.onUpdated can race. If an older state object
  // is written after navigation, reconcile the persisted target against the live
  // browser tab. This keeps generic cross-page tasks from reverting target origin/
  // title metadata to the pre-navigation snapshot.
  chrome.storage.onChanged.addListener((changes,areaName)=>{
    if(areaName!=='local'||!changes[KEY]||reconciling)return;
    const state=changes[KEY].newValue;
    const tabId=state?.target?.tabId;
    if(!Number.isInteger(tabId))return;
    reconciling=true;
    (async()=>{
      const tab=await chrome.tabs.get(tabId).catch(()=>null);if(!tab||!web(tab.url))return;
      const next=meta(tab);if(!next)return;
      if(next.origin===state.target.origin&&next.title===state.target.title)return;
      await mutate(current=>{
        if(current.target?.tabId!==tabId)return false;
        const live=meta(tab);if(!live)return false;
        if(current.target.origin===live.origin&&current.target.title===live.title)return false;
        current.target=live;return true;
      });
    })().catch(()=>{}).finally(()=>{reconciling=false;});
  });
})();
