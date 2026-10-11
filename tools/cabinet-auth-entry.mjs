import {createAuthClient} from '@neondatabase/auth';
// Same-origin Vercel proxy keeps session cookies usable inside webviews.
window.PCSCabinetAuth=createAuthClient(location.origin+'/pcs-auth');
