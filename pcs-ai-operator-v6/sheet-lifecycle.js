(()=>{
 'use strict';
 let revision=0;
 const main=()=>document.getElementById('main');
 // A deferred form belongs to both its opening intent and the rendered page.
 // A second intent, a replacement sheet, close, or navigation invalidates it.
 const capture=()=>({revision,page:window.PCS?.page,main:main()});
 const begin=()=>{revision++;return capture()};
 const current=ticket=>Boolean(ticket&&ticket.revision===revision&&ticket.page===window.PCS?.page&&ticket.main===main());
 const invalidate=()=>{revision++};
 window.pcsSheetLifecycle={begin,capture,current,invalidate};
})();
