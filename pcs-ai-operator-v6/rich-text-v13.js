(()=>{
  const BOLD=/\*\*([^*\n][\s\S]*?[^*\n]|[^*\n])\*\*/g;
  function formatTextNode(node){
    if(!node||node.nodeType!==Node.TEXT_NODE)return;
    const text=node.nodeValue||'';
    if(!text.includes('**'))return;
    BOLD.lastIndex=0;
    let m,last=0,found=false;
    const frag=document.createDocumentFragment();
    while((m=BOLD.exec(text))){
      found=true;
      if(m.index>last)frag.append(document.createTextNode(text.slice(last,m.index)));
      const strong=document.createElement('strong');
      strong.className='pcs-rich-bold';
      strong.textContent=m[1];
      frag.append(strong);
      last=m.index+m[0].length;
    }
    if(!found)return;
    if(last<text.length)frag.append(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }
  function scan(root=document.body){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
      const p=node.parentElement;
      if(!p||['SCRIPT','STYLE','TEXTAREA','INPUT','OPTION','CODE','PRE'].includes(p.tagName))return NodeFilter.FILTER_REJECT;
      return (node.nodeValue||'').includes('**')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }});
    const nodes=[];let n;while((n=walker.nextNode()))nodes.push(n);
    nodes.forEach(formatTextNode);
  }
  window.pcsRenderRichText=scan;
  const mo=new MutationObserver(records=>{
    for(const r of records){
      for(const node of r.addedNodes){
        if(node.nodeType===Node.TEXT_NODE)formatTextNode(node);
        else if(node.nodeType===Node.ELEMENT_NODE)scan(node);
      }
    }
  });
  const boot=()=>{scan();mo.observe(document.body,{childList:true,subtree:true});};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot,{once:true}):boot();
})();