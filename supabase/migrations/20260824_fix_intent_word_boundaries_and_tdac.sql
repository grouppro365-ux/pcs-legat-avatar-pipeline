-- PCS incident fix: `car` previously matched the `Card` substring in
-- "Thailand Digital Arrival Card (TDAC)" and could force car_rent intent.
-- Keep English car/vehicle tokens word-bounded and classify TDAC explicitly as visa.

create or replace function public.pcs_strong_intent_from_text_base_v1(p_text text)
returns text
language plpgsql
immutable
set search_path to 'public','pg_temp'
as $function$
declare t text:=lower(coalesce(p_text,''));
begin
  if t ~ '(жалоб|претензи|возврат|верн.{0,15}деньг|refund|complaint|reclamo|rimborso|queja|reembolso|plainte|remboursement|beschwerde|rückerstattung|投诉|退款|苦情|返金|불만|환불|شكوى|استرداد|шағым|қайтар)' then return 'complaint';
  elsif t ~ '(срочно|экстрен|аварийн|emergency|urgent|emergenza|urgence|notfall|pilne|nagły|ฉุกเฉิน|紧急|緊急|응급|طوارئ|عاجل|шұғыл)' then return 'emergency';
  elsif t ~ '(партн[её]рств|сотруднич|стать партн|предлаг.*партн|partnership|become.*partner|collaborat|合作|提携|파트너십|شراكة|серіктестік)' then return 'partnership';
  elsif t ~ '(бизнес[- ]?сопровожд|открыть компанию|зарегистрировать компанию|регистрац.*компан|вести бизнес|business support|company setup|set up.*company|business setup|法人設立|会社設立|公司注册|公司註冊|사업 지원|회사 설립|تأسيس شركة|دعم الأعمال|компания ашу|бизнес қолдау)' then return 'business_support';
  elsif t ~ '(уборк|помыть|клининг|cleaning|clean[[:space:]].*(condo|apartment|house)|pulizia|limpieza|nettoyage|reinigung|sprząt|ทำความสะอาด|清洁|清潔|掃除|청소|تنظيف|тазалау)' then return 'cleaning';
  elsif t ~ '(ремонт|почин|сломал|не работает|repair|fix[[:space:]]|riparazione|reparación|réparation|reparatur|napraw|ซ่อม|维修|維修|修理|수리|إصلاح|жөндеу)' then return 'repair';
  elsif t ~ '(интернет|wi[- ]?fi|вайфай|подключить интернет|internet|broadband|fib(er|re)|อินเทอร์เน็ต|ไวไฟ|网络|網路|インターネット|와이파이|인터넷|إنترنت|واي فاي|интернет қос)' then return 'internet';
  elsif t ~ '(школ|детск.*сад|садик|обучен|учеб|курс.*язык|education|school|kindergarten|nursery|language course|scuola|escuela|école|schule|szkoł|przedszkol|โรงเรียน|อนุบาล|学校|幼儿园|幼兒園|幼稚園|학교|유치원|مدرسة|روضة|мектеп|балабақша)' then return 'education';
  elsif t ~ '(переводчик|translation|translator|interpreter|traduttore|traductor|traduction|übersetzer|tłumacz|แปล|ล่าม|翻译|翻譯|通訳|翻訳|번역|통역|مترجم|ترجمة|аудармашы)' then return 'translation';
  elsif t ~ '(трансфер|встретить.*аэропорт|airport.*(transfer|pickup)|pickup.*airport|transfer|trasferimento|traslado|transfert|transfer lotnisk|รับส่ง|接送|送迎|픽업|환승|نقل|توصيل)' then return 'transfer';
  elsif t ~ '(доставк|курьер|delivery|courier|consegna|entrega|livraison|lieferung|dostaw|จัดส่ง|ส่งของ|配送|送货|配達|배송|توصيل)' and t !~ '(доставк.*(машин|авто)|car delivery|vehicle delivery)' then return 'delivery';
  elsif t ~ '(экскурс|тур[[:space:]]|tour|escursione|excursión|visite|ausflug|wyciecz|ทัวร์|เที่ยว|旅游|旅遊|ツアー|관광|투어|جولة|رحلة)' then return 'tour';
  elsif t ~ '(яхт|яхточ|yacht|barca|yate|jacht|เรือยอชต์|游艇|遊艇|ヨット|요트|يخت)' then return 'yacht';
  elsif t ~ '(стомат|зуб|dent|dentist|zahnarzt|dentysta|ทันต|牙医|牙醫|歯科|치과|أسنان|طبيب.*أسنان|тіс)' then return 'dentistry';
  elsif t ~ '(медицин|врач|hospital|medical|doctor|arzt|krankenhaus|lekarz|szpital|medycz|แพทย์|โรงพยาบาล|医生|醫生|医院|醫院|病院|医療|병원|의사|طبيب|مستشفى|дәрігер|аурухана)' then return 'medical';
  elsif t ~ '(юрист|договор|legal|lawyer|адвокат|anwalt|prawnik|umow|prawo|ทนาย|สัญญา|律师|律師|合同|契約|弁護士|법률|변호사|계약|محامي|قانوني|عقد|заңгер|келісімшарт)' then return 'legal';
  elsif t ~ '(банк|bank|banca|banco|banque|bankowy|konto.*bank|ธนาคาร|银行|銀行|口座|은행|مصرف|بنك)' then return 'bank';
  elsif t ~ '(виз|viza|visa|visum|visto|visado|wiza|วีซ่า|签证|簽證|ビザ|비자|تأشيرة|dtv|ltr|tm-?30|tdac|digital[ -]?arrival[ -]?card|thailand[ -]?digital[ -]?arrival[ -]?card|re[- ]?entry|non[- ]?[ob]|90[- ]?(днев|day|วัน)|инвестор|инвестиц|инвестир|investment|investor|wealthy global|wealthy pension|пенсион|пенсионер|retire|retirement|долго жить|долгосроч.*(жить|пребыв|виза)|long[- ]?term.*(stay|visa)|рабочая виза|work visa|work permit|разрешен.*работ|student visa|education visa|студенческ.*виз|учебн.*виз|thailand privilege|privilege visa|smart visa|投资.*签证|投資.*簽證|退休.*签证|退休.*簽證|工作.*签证|工作.*簽證|学生.*签证|學生.*簽證|投資.*ビザ|退職.*ビザ|就労.*ビザ|学生.*ビザ|투자.*비자|은퇴.*비자|취업.*비자|학생.*비자|تأشيرة.*استثمار|تأشيرة.*تقاعد|تأشيرة.*عمل|تأشيرة.*دراسة|wiza.*inwest|wiza.*emeryt|wiza.*prac|wiza.*stud|инвесторлық.*виза|зейнет.*виза)' then return 'visa';
  elsif t ~ '(((купить|покупк|приобрест|хочу купить|продаж).{0,30}(машин|авто|тачк))|((машин|авто|тачк).{0,30}(купить|покупк|приобрест|продаж))|buy.*(^|[^a-z])(car|cars|vehicle|vehicles)([^a-z]|$)|(^|[^a-z])(car|cars|vehicle|vehicles)([^a-z]|$).*(buy|purchase|for sale)|auto.*kaufen|samoch[oó]d.*kupi|comprar.*coche|acheter.*voiture|comprare.*auto|ซื้อ.*รถ|汽车.*(购买|买)|買.*車|車.*購入|자동차.*구매|شراء.*سيارة|көлік.*сатып)' then return 'car_buy';
  elsif t ~ '(((купить|покупк|приобрест|хочу купить|инвест.*недвиж|продаж).{0,40}(квартир|жиль|апартамент|кондо|недвиж))|((квартир|жиль|апартамент|кондо|недвиж).{0,40}(купить|покупк|приобрест|продаж))|buy.*(apartment|condo|property)|(apartment|condo|property).*(buy|purchase|for sale)|wohnung.*kaufen|mieszkan.*kupi|comprar.*apartamento|acheter.*appartement|comprare.*appartamento|ซื้อ.*คอนโด|(公寓|房).*(购买|买)|買.*(公寓|房)|マンション.*購入|아파트.*구매|شراء.*(شقة|عقار)|пәтер.*сатып)' then return 'housing_buy';
  elsif t ~ '(байк|скутер|мопед|motorbike|bike|scooter|motorrad|moto|motocicletta|motocykl|skuter|จักรยานยนต์|มอเตอร์ไซค์|摩托车|摩托車|スクーター|バイク|오토바이|스쿠터|دراجة.*نارية|سكوتر|мотоцикл)' then return 'bike_rent';
  elsif t ~ '(машин|машн|тачк|авто|автошк|rent.?car|rent.*(^|[^a-z])car([^a-z]|$)|(^|[^a-z])car([^a-z]|$).*rent|(^|[^a-z])(car|cars|vehicle|vehicles)([^a-z]|$)|mietwagen|auto.*mieten|noleggio|macchina|coche|voiture|samoch[oó]d|wynajem.*auta|auto.*wynajem|รถ|รถเช่า|租车|汽車租賃|汽车租赁|レンタカー|車.*レンタル|렌터카|자동차.*대여|سيارة|تأجير.*سيارة|көлік|автокөлік)' then return 'car_rent';
  elsif t ~ '(квартир|кваритр|квратир|жиль|апартамент|кондо|condo|apartment|accommodation|housing|alloggio|appartament|unterkunft|wohnung|alojamiento|apartamento|logement|mieszkan|nocleg|zakwaterowan|บ้าน|คอนโด|ที่พัก|住宿|公寓|住房|租房|ホテル|宿泊|アパート|住居|숙소|아파트|주택|سكن|شقة|إقامة|пәтер|тұрғын)' then return 'housing_rent';
  else return null;
  end if;
end
$function$;
