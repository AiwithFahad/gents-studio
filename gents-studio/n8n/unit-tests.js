const {runCode}=require('./harness'); const crypto=require('crypto'); const assert=require('assert');
const salt='ab12'; const hash=crypto.pbkdf2Sync('Admin 321',salt,120000,32,'sha256').toString('hex');
const hdr={Appointments:['appointment_id','customer_id','customer_name','email','phone','service_id','service_name','barber_id','barber_name','appointment_date','start_time','end_time','duration','price','status','payment_status','stripe_session_id','notes','source','client_request_id','calendar_event_id','created_at','updated_at','deleted_at'],
Services:['service_id','name','description','category','price','duration','active','created_at','updated_at'],Barbers:['barber_id','name','title','email','years','specialties','working_days','start_time','end_time','active','created_at','updated_at'],
Customers:['customer_id','name','email','phone','created_at','updated_at'],Admins:['admin_id','name','email','password_hash','role','active','created_at','last_login_at'],Sessions:['session_id','token_hash','admin_id','email','created_at','expires_at','revoked_at'],ActivityLogs:['log_id','timestamp','actor','action','entity','entity_id','details'],Settings:['key','value','updated_at']};
const tomorrow=new Date(Date.now()+86400000*2).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});
const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(tomorrow+'T12:00:00Z').getUTCDay()];
const db={Appointments:[['GS-1','CUS-1','James W','j@x.com','+1 555 000 1111','SRV-001','Signature Haircut','BRB-001','Marcus Hale',tomorrow,'10:00','10:45','45','35','confirmed','unpaid','cs_test_abc','','website','crid-1','evt1','2026-11-01T00:00:00Z','','']],
Services:[['SRV-001','Signature Haircut','d','Hair','35','45','TRUE','',''],['SRV-002','Beard','d','Beard','25','30','FALSE','','']],
Barbers:[['BRB-001','Marcus Hale','Master','m@x.com','12','Fades','Mon,Tue,Wed,Thu,Fri,Sat,Sun','09:00','20:00','TRUE','',''],['BRB-002','Omar','F','o@x.com','8','x','Mon,Tue,Wed,Thu,Fri,Sat,Sun','09:00','12:00','TRUE','','']],
Customers:[['CUS-1','James W','j@x.com','+1 555 000 1111','','']],Admins:[['ADM-001','Owner','admin321@example.com','pbkdf2$120000$'+salt+'$'+hash,'owner','TRUE','','']],Sessions:[],ActivityLogs:[],
Settings:[['timezone','Asia/Karachi',''],['slotInterval','30',''],['bufferMinutes','0',''],['paymentsEnabled','true',''],['currency','usd','']]};
const tabs=['Appointments','Services','Barbers','Customers','Admins','Sessions','ActivityLogs','Settings'];
const load=(extra={})=>({statusCode:200,body:{valueRanges:tabs.map(t=>({values:[hdr[t]].concat(db[t].concat(extra[t]||[]))}))}});
function call(action, body={}, token='', extra){
  const cp=runCode('config_parse.js',{nodes:{},input:[{headers:token?{authorization:'Bearer '+token}:{},body:Object.assign({action},body)}]})[0];
  return runCode('decide.js',{nodes:{'Config & Parse Request':[cp]},input:[load(extra)]})[0];
}
let r;
r=call('get_services'); assert.equal(r.body.data.length,1,'only active services');
r=call('get_services',{all:true}); assert.equal(r.status,401);
r=call('get_availability',{serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow}); const s10=r.body.data.find(x=>x.time==='10:00'); assert.equal(s10.available,false,'booked slot unavailable'); assert.equal(r.body.data.find(x=>x.time==='09:00').available,true);
assert.equal(r.body.data.find(x=>x.time==='09:30').available,false,'09:30 overlaps 10:00 (45m)');
r=call('get_availability',{serviceId:'SRV-001',barberId:'any',date:tomorrow}); assert.equal(r.body.data.find(x=>x.time==='10:00').available,true,'any barber merges');
r=call('get_availability',{serviceId:'SRV-001',barberId:'BRB-001',date:'2020-01-01'}); assert.equal(r.status,422);
r=call('create_booking',{customerName:'A',email:'bad',phone:'1',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'09:00'}); assert.equal(r.status,422); assert(r.body.errors.email);
r=call('create_booking',{customerName:'Ali Raza',email:'ali@x.com',phone:'+1 555 222 3333',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'10:30'}); assert.equal(r.status,409); assert.equal(r.body.code,'SLOT_UNAVAILABLE');
r=call('create_booking',{customerName:'Ali Raza',email:'ali@x.com',phone:'+1 555 222 3333',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'08:00'}); assert.equal(r.body.code,'OUTSIDE_HOURS');
r=call('create_booking',{customerName:'Ali Raza',email:'ali@x.com',phone:'+1 555 222 3333',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'11:00',clientRequestId:'crid-1'}); assert.equal(r.body.data.duplicate,true,'idempotent');
const plan=call('create_booking',{customerName:'Ali Raza',email:'ali@x.com',phone:'+1 555 222 3333',serviceId:'SRV-001',barberId:'any',date:tomorrow,time:'11:00',returnUrl:'https://gents.example.com/booking.html',clientRequestId:'crid-2'});
assert.equal(plan.calendarOp,'create'); assert.equal(plan.stripe.kind,'create'); assert(plan.stripe.body.includes('unit_amount%5D=3500'));
assert(plan.calendar.start.endsWith('+05:00')); assert.equal(plan.writes.appends.find(a=>a.sheet==='Customers').values.length,1);
console.log('create plan ok', plan.ok.body.data.appointmentId, plan.calendar.start);
// pipeline: calendar success
let ac=runCode('apply_calendar.js',{nodes:{'Decide Action':[plan]},input:[{id:'evtNEW'}]})[0];
assert(!JSON.stringify(ac.writes).includes('__EVENT_ID__') && JSON.stringify(ac.writes).includes('evtNEW'));
let ap=runCode('apply_payment.js',{nodes:{'Config & Parse Request':[{cfg:{spreadsheetId:'SID'}}],'Apply Calendar Result':[ac],'Stripe: Create Checkout Session (Test)':[{statusCode:200,body:{id:'cs_test_X',url:'https://checkout.stripe.com/c/pay/cs_test_X',livemode:false}}]},input:[{}]})[0];
assert.equal(ap.ok.body.data.checkoutUrl,'https://checkout.stripe.com/c/pay/cs_test_X'); assert(JSON.stringify(ap.writes).includes('cs_test_X')); assert(ap.emails[0].html.includes('Pay now'));
// livemode guard
let apLive=runCode('apply_payment.js',{nodes:{'Config & Parse Request':[{cfg:{spreadsheetId:'SID'}}],'Apply Calendar Result':[ac],'Stripe: Create Checkout Session (Test)':[{statusCode:200,body:{id:'cs_live_X',url:'https://live',livemode:true}}]},input:[{}]})[0];
assert.equal(apLive.ok.body.data.checkoutUrl,null); assert(!JSON.stringify(apLive.writes).includes('cs_live_X'),'live session never stored');
// calendar failure halts
let acF=runCode('apply_calendar.js',{nodes:{'Decide Action':[plan]},input:[{error:{message:'quota'}}]})[0]; assert.equal(acF.halt,true); assert.equal(acF.status,502);
assert.equal(ap.requests.length,1); assert(ap.requests[0].url.includes('Appointments')); assert.equal(ap.logRows.length,1); assert.equal(ap.customerRows.length,1);
// lookup / ownership
r=call('get_booking',{appointmentId:'GS-1',identity:'other@x.com'}); assert.equal(r.status,404);
r=call('get_booking',{appointmentId:'gs-1',identity:'J@x.com'}); assert.equal(r.status,200); assert.equal(r.body.data.appointment.date,tomorrow);
r=call('get_booking',{appointmentId:'GS-1',identity:'5550001111'}); assert.equal(r.status,404,'phone needs exact digits match'); 
r=call('get_booking',{appointmentId:'GS-1',identity:'+1 (555) 000-1111'}); assert.equal(r.status,200);
r=call('update_booking',{appointmentId:'GS-1',identity:'j@x.com',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'10:00'}); assert.equal(r.calendarOp,'update','own slot reusable when excluded');
r=call('update_booking',{appointmentId:'GS-1',identity:'j@x.com',serviceId:'SRV-002',barberId:'BRB-001',date:tomorrow,time:'10:00'}); assert.equal(r.body.code,'INVALID_SERVICE','inactive service rejected for customer');
r=call('cancel_booking',{appointmentId:'GS-1',identity:'j@x.com'}); assert.equal(r.calendarOp,'delete'); assert(JSON.stringify(r.writes).includes('cancelled')); assert.equal(r.emails.length,1);
r=call('delete_booking',{appointmentId:'GS-1',identity:'j@x.com'}); assert(JSON.stringify(r.writes.updates).includes('deleted'));
// auth
r=call('admin_login',{email:'admin321@example.com',password:'wrong'}); assert.equal(r.ok.status,401); assert(r.writes.appends.some(a=>a.sheet==='ActivityLogs'));
r=call('admin_login',{email:'admin321@example.com',password:'Admin 321'}); assert.equal(r.ok.status,200); const token=r.ok.body.data.token; assert(!JSON.stringify(r.writes).includes(token),'raw token never stored');
const sess=r.writes.appends.find(a=>a.sheet==='Sessions').values[0];
const ex={Sessions:[sess]};
r=call('verify_session',{},token,ex); assert.equal(r.status,200);
r=call('get_dashboard',{},token,ex); assert.equal(r.body.data.stats.totalAppointments,1); assert.equal(r.body.data.stats.monthlyRevenue,0,'unpaid confirmed not revenue');
r=call('get_dashboard',{},'f'.repeat(64),ex); assert.equal(r.status,401);
const expired=[...sess]; expired[5]='2020-01-01T00:00:00Z'; r=call('get_dashboard',{},token,{Sessions:[expired]}); assert.equal(r.status,401,'expired session');
r=call('get_customers',{},token,ex); assert.equal(r.body.data[0].totalBookings,1);
r=call('manage_service',{name:'Kids Cut',price:20,duration:30},token,ex); assert.equal(r.ok.status,201);
r=call('manage_service',{id:'SRV-001',active:false},token,ex); assert(JSON.stringify(r.writes.updates).includes('false'));
r=call('manage_service',{name:'Signature Haircut',price:1,duration:30},token,ex); assert.equal(r.body.code,'DUPLICATE');
r=call('manage_barber',{name:'Zed',specialties:['Fades']},token,ex); assert.equal(r.ok.status,201);
r=call('update_status',{appointmentId:'GS-1',status:'completed'},token,ex); assert.equal(r.calendarOp,'none');
r=call('save_settings',{openTime:'20:00',closeTime:'09:00'},token,ex); assert.equal(r.status,422);
r=call('create_booking',{customerName:'Walk In',email:'w@x.com',phone:'+15551112222',serviceId:'SRV-001',barberId:'BRB-001',date:tomorrow,time:'12:00',status:'pending'},token,ex); assert.equal(r.stripe.kind,'none','admin bookings skip stripe'); assert(JSON.stringify(r.writes).includes('pending'));
r=call('verify_payment',{sessionId:'cs_test_abc',appointmentId:'GS-1'}); assert.equal(r.stripe.kind,'retrieve');
let vp=runCode('apply_calendar.js',{nodes:{'Decide Action':[r]},input:[{}]})[0];
let vpp=runCode('apply_payment.js',{nodes:{'Config & Parse Request':[{cfg:{spreadsheetId:'SID'}}],'Apply Calendar Result':[vp],'Stripe: Retrieve Checkout Session (Test)':[{statusCode:200,body:{livemode:false,payment_status:'paid',amount_total:3500,metadata:{appointment_id:'GS-1'}}}]},input:[{}]})[0]; assert.equal(vpp.halt,false);
vpp=runCode('apply_payment.js',{nodes:{'Config & Parse Request':[{cfg:{spreadsheetId:'SID'}}],'Apply Calendar Result':[vp],'Stripe: Retrieve Checkout Session (Test)':[{statusCode:200,body:{livemode:true,payment_status:'paid',amount_total:3500,metadata:{appointment_id:'GS-1'}}}]},input:[{}]})[0]; assert.equal(vpp.body.code,'LIVE_MODE_BLOCKED');
vpp=runCode('apply_payment.js',{nodes:{'Config & Parse Request':[{cfg:{spreadsheetId:'SID'}}],'Apply Calendar Result':[vp],'Stripe: Retrieve Checkout Session (Test)':[{statusCode:200,body:{livemode:false,payment_status:'unpaid',amount_total:3500,metadata:{appointment_id:'GS-1'}}}]},input:[{}]})[0]; assert.equal(vpp.body.code,'NOT_PAID');
r=call('verify_payment',{sessionId:'cs_test_zzz',appointmentId:'GS-1'}); assert.equal(r.status,404,'session must match booking');
r=call('nope'); assert.equal(r.status,400);
r=runCode('decide.js',{nodes:{'Config & Parse Request':[runCode('config_parse.js',{nodes:{},input:[{headers:{},body:{action:'get_services'}}]})[0]]},input:[{statusCode:500}]})[0]; assert.equal(r.status,503);
console.log('ALL BACKEND UNIT TESTS PASSED');
