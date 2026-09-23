/* Native PDF document: text, tables and embedded fonts. No photographed pages. */
(function(root){
  'use strict';
  const date=s=>{if(!s)return '________________';const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)throw Error('Проверьте дату');return `${m[3]}/${m[2]}/${Number(m[1])+543}`;};
  const text=s=>String(s??'').split(/([\u0400-\u04ff]+)/).filter(Boolean).map(t=>({text:t,font:/[\u0400-\u04ff]/.test(t)?'Roboto':'Sarabun'}));
  const val=s=>({text:text(s==null||s===''?'________________':s),margin:[0,1,0,1]});
  const money=n=>n===''||n==null?'________________':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function validate(d){
    for(const [key,label] of Object.entries({name:'ФИО',passport:'Паспорт',license:'Права',model:'Модель',registration:'Госномер',start:'Дата выдачи',end:'Дата возврата'}))if(!String(d[key]||'').trim())throw Error('Заполните: '+label);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d.start)||!/^\d{4}-\d{2}-\d{2}$/.test(d.end)||d.end<d.start)throw Error('Проверьте даты аренды');
    for(const key of ['rate','total','advance','balance','security','delivery'])if(d[key]!==''&&d[key]!=null&&(!Number.isFinite(Number(d[key]))||Number(d[key])<0))throw Error('Проверьте суммы');
    if(d.total===''||d.total==null)throw Error('Укажите стоимость аренды');
    if(d.advance!==''&&d.advance!=null&&Number(d.advance)>Number(d.total))throw Error('Предоплата превышает стоимость');
    for(const key of ['nationality','color','condition','equipment','remark'])if(/[\u0400-\u04ff]/.test(d[key]||''))throw Error('Описания для договора заполните на тайском: '+({nationality:'гражданство',color:'цвет',condition:'состояние',equipment:'оборудование',remark:'примечание'})[key]);
  }
  function definition(d){
    validate(d);
    const blank='________________';
    const balance=d.balance!==''&&d.balance!=null?Number(d.balance):d.advance===''||d.advance==null?'':Number(d.total)-Number(d.advance);
    const days=Math.max(1,Math.ceil((new Date(d.end+'T00:00:00')-new Date(d.start+'T00:00:00'))/86400000));
    const line='#263a52', pale='#eef1f4';
    const label=(th,en)=>({stack:[{text:th,bold:true,fontSize:6.4},{text:en,fontSize:4.8,color:'#526070'}],margin:[1,0,1,0]});
    const cell=v=>({text:text(v==null||v===''?blank:v),fontSize:7.2,margin:[1,1,1,1]});
    const row=(th,en,v,unit)=>[label(th,en),cell(v),...(unit?[{text:unit,fontSize:5.5,alignment:'center',margin:[0,2,0,0]}]:[])];
    const layout={hLineWidth:()=>.55,vLineWidth:()=>.55,hLineColor:()=>line,vLineColor:()=>line,paddingLeft:()=>2,paddingRight:()=>2,paddingTop:()=>1,paddingBottom:()=>1};
    const leftLayout={...layout,paddingTop:()=>2,paddingBottom:()=>2};
    const rightLayout={...layout,paddingTop:()=>4.75,paddingBottom:()=>4.75};
    const rulesSvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 92"><g fill="none" stroke="#263a52" stroke-width="4"><circle cx="48" cy="34" r="26"/><path d="M30 16l36 36M38 23v24m-9 0h35M40 31h17v16"/><circle cx="150" cy="34" r="26"/><path d="M130 17l40 35M132 29h36M144 29v11h14V29"/><circle cx="252" cy="34" r="26"/><path d="M232 15l40 39M236 42l9-13 9 8 8-11 7 18"/></g><g fill="#263a52" font-family="Arial" font-size="9" font-weight="bold" text-anchor="middle"><text x="48" y="74">NO ALCOHOL</text><text x="150" y="74">NO FIREARMS</text><text x="252" y="74">NO PETS</text></g><g fill="#263a52" font-family="sans-serif" font-size="7" text-anchor="middle"><text x="48" y="85">ห้ามเครื่องดื่มแอลกอฮอล์</text><text x="150" y="85">ห้ามอาวุธปืน</text><text x="252" y="85">ห้ามสัตว์เลี้ยง</text></g></svg>`;
    const carSvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 180"><g fill="none" stroke="#263a52" stroke-width="2"><path d="M12 47h12l24-23h77l34 23h23v31H12zM45 47l18-17h50l25 17z"/><circle cx="45" cy="78" r="14"/><circle cx="146" cy="78" r="14"/><path d="M211 20h68l25 20v45h-118V40zM195 58h101M216 30v44m64-44v44"/><circle cx="211" cy="75" r="8"/><circle cx="280" cy="75" r="8"/><path d="M16 115c0-13 21-23 53-23h81c27 0 43 10 43 23v42c0 13-16 20-43 20H69c-32 0-53-7-53-20zM42 101l9 65m112-65l-9 65M70 96v76m79-76v76M204 112h92v57h-92zM216 124h68v32h-68zM204 140h92"/></g></svg>`;
    const leftTable={table:{widths:[76,'*'],body:[row('ชื่อ','Name',d.name),row('เลขบัตร / หนังสือเดินทาง','ID / Passport',d.passport),row('สัญชาติ','Nationality',d.nationality),row('ใบขับขี่','License No.',d.license),row('โทรศัพท์','Phone',d.phone),row('ไลน์','Line',d.line),row('ที่อยู่','Address',d.address)]},layout:leftLayout};
    const rightBody=[row('วันที่เช่า','Date Rental',date(d.issued)),row('ยี่ห้อ / รุ่น','Car Model',d.model),row('เลขทะเบียน','REG No.',d.registration),row('สีรถ','Color Car',d.color),row('วันที่รับรถ','Rent Date',date(d.start)+'  '+(d.startTime||blank)),row('วันที่คืนรถ','Return Date',date(d.end)+'  '+(d.endTime||blank)),row('รวมเวลาเช่า','Total Time',days+' วัน'),row('อัตราค่าเช่า','Rate Rental',money(d.rate),'บาท'),row('ค่ารับ–ส่ง','Transfer Fee',money(d.delivery),'บาท'),row('เงินประกัน','Deposit',money(d.security),'บาท'),row('รวมทั้งหมด','Total',money(d.total),'บาท'),row('เงินจอง / มัดจำ','Booking Dep.',money(d.advance),'บาท'),row('ยอดชำระคงเหลือ','Balance',money(balance),'บาท'),row('สภาพรถรับเช่า','Vehicle Condition',d.condition),row('หมายเหตุ','Remark',d.remark)];
    while(rightBody.length<22)rightBody.push([{text:'',fontSize:5},{text:'',fontSize:5},{text:'',fontSize:5}]);
    const rightTable={table:{widths:[72,'*',27],body:rightBody},layout:rightLayout};
    const renewHeader=['วันที่\nDate','ตั้งแต่ – ถึง\nFrom–To Date','รวม\nTotal','จำนวนเงินรวม\nTotal Amount','อื่น ๆ\nOther'].map(t=>({text:t,bold:true,fontSize:6,alignment:'center'}));
    const renew={table:{headerRows:1,widths:[74,120,58,115,'*'],heights:[18,18,18,18],body:[renewHeader,['','','','',''],['','','','',''],['','','','','']]},layout};
    return {pageSize:'A4',pageMargins:[27,95,27,20],info:{title:'สัญญาเช่ารถ — PCS Premium Concierge Service',author:'PCS Premium Concierge Service'},defaultStyle:{font:'Sarabun',fontSize:7,color:line},content:[
      {table:{widths:[265,'*',52],body:[[{stack:[{text:[{text:'PCS',bold:true,fontSize:28},{text:'  PREMIUM',fontSize:22}],margin:[2,0,0,-4]},{text:'Concierge Service',fontSize:10,margin:[73,0,0,1]}],border:[true,true,true,true]},{stack:[{text:'Service Car Rental',bold:true,fontSize:11,alignment:'center'},{text:'+66 83 612 2210',fontSize:10,alignment:'center'}],margin:[0,7,0,0],border:[true,true,true,true]},{qr:'https://vipthaiconcierge.com',fit:42,alignment:'center',margin:[2,2,2,2],border:[true,true,true,true]}],[{text:'vipthaiconcierge.com',bold:true,fontSize:10,colSpan:2,margin:[4,1,0,1],border:[true,true,true,true]},{},{text:'24/7  WA  TG  LINE',fontSize:6,alignment:'center',margin:[0,2,0,0],border:[true,true,true,true]}]]},layout},
      {columns:[{width:'50%',stack:[{text:'Name Rental Details  (รายละเอียดการเช่าของผู้เช่ารถยนต์)',bold:true,fontSize:6.4,fillColor:pale,margin:[3,3,2,2]},leftTable,{svg:rulesSvg,width:250,margin:[5,13,5,0]},{table:{widths:[90,'*'],body:[[label('ระดับน้ำมัน','PETROL'),cell(d.fuel)],[{text:'เชื้อเพลิง / Fuel',bold:true,fontSize:6},{text:'Diesel / Gasohol  91 / 95',fontSize:6}]]},layout,margin:[0,3,0,0]},{text:'หมวกกันน็อก / Helmet ____________________ ใบ / ชิ้น',fontSize:6,margin:[3,4,0,0]},{svg:carSvg,width:252,margin:[2,39,2,17]}]},{width:'50%',stack:[{text:'Rental Details  (รายละเอียดการเช่ารถยนต์)',bold:true,fontSize:6.4,fillColor:pale,margin:[3,3,2,2]},rightTable]}],columnGap:0},
      {text:'Renew',fontSize:6,alignment:'center',margin:[0,2,0,1]},renew,
      {columns:[{text:'________________________\nผู้เช่า / ผู้รับรถ',alignment:'center'},{text:'________________________\nผู้ให้เช่า',alignment:'center'},{text:'________________________\nผู้ส่งมอบรถ',alignment:'center'}],fontSize:6.3,margin:[0,12,0,0]},
      {text:'PCS Premium Concierge Service',bold:true,fontSize:6.5,alignment:'center',margin:[0,6,0,0]}
    ]};
  }
  root.PCSContractDocument={definition,validate,date};
  if(typeof module!=='undefined')module.exports=root.PCSContractDocument;
})(typeof window!=='undefined'?window:globalThis);
