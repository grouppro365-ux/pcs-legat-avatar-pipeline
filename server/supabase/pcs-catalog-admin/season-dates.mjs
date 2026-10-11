export function normalizeSeasonDate(value){
 if(typeof value!=='string')return null;
 const input=value.trim();let year,month,day;
 let match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
 if(match)[,year,month,day]=match;
 else{match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input);if(!match)return null;[,day,month,year]=match;}
 const y=Number(year),m=Number(month),d=Number(day);
 if(y<1000||y>9999||m<1||m>12||d<1)return null;
 const leap=y%4===0&&(y%100!==0||y%400===0);
 if(d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1])return null;
 return `${year}-${month}-${day}`;
}
export function seasonDateRange(from,to){
 const date_from=normalizeSeasonDate(from),date_to=normalizeSeasonDate(to);
 return date_from&&date_to&&date_from<date_to?{date_from,date_to}:null;
}
