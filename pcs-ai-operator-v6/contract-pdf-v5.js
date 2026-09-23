/* Download a native, selectable-text PDF from the stored contract version. */
(function (root) {
  'use strict';

  const base = typeof document === 'undefined' ? null : new URL('./', document.currentScript.src);
  const thaiNationality = {
    'россия': 'รัสเซีย', 'российская федерация': 'รัสเซีย',
    'russia': 'รัสเซีย', 'russian': 'รัสเซีย', 'russian federation': 'รัสเซีย',
    'таиланд': 'ไทย', 'thai': 'ไทย', 'thailand': 'ไทย'
  };
  const thaiColor = {
    'белый': 'สีขาว', 'чёрный': 'สีดำ', 'черный': 'สีดำ',
    'красный': 'สีแดง', 'синий': 'สีน้ำเงิน', 'синий металлик': 'สีน้ำเงินเมทัลลิก',
    'серый': 'สีเทา', 'серебристый': 'สีเงิน'
  };
  const translated = (dictionary, value) => dictionary[String(value || '').trim().toLowerCase()] || String(value || '').trim();
  const datePart = value => String(value || '').slice(0, 10);

  function mapContract(contract) {
    const renter = contract.renter_data || {};
    const vehicle = contract.vehicle_data || {};
    const rental = contract.rental_data || {};
    const price = contract.pricing_snapshot || {};
    const handover = contract.handover_data || {};
    return {
      name: renter.name || '', passport: renter.id_or_passport || '',
      license: renter.license_no || '',
      nationality: translated(thaiNationality, renter.nationality),
      phone: renter.phone || '', line: renter.line || renter.telegram || '',
      address: renter.address || '', model: vehicle.model || '',
      registration: vehicle.registration_no || '',
      color: translated(thaiColor, vehicle.color),
      issued: datePart(contract.finalized_at || contract.created_at),
      start: datePart(rental.start_date), end: datePart(rental.end_date),
      startTime: rental.start_time || '', endTime: rental.end_time || '',
      rate: price.rate ?? '', total: price.total ?? '',
      advance: price.booking_deposit ?? '', balance: price.balance ?? '',
      security: price.deposit ?? '', delivery: price.transfer_fee ?? '',
      fuel: handover.fuel_level || '', equipment: handover.equipment || '',
      condition: handover.condition_note || '', remark: rental.remark || '',
      currency: price.currency || 'THB'
    };
  }

  let dependenciesPromise;
  let activeUrl;
  const loadScript = path => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, base).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Не удалось загрузить генератор PDF'));
    document.head.appendChild(script);
  });
  async function dependencies() {
    if (dependenciesPromise) return dependenciesPromise;
    dependenciesPromise = (async () => {
      if (!root.pdfMake) await loadScript('vendor/contract-pdf/pdfmake.min.js');
      await loadScript('vendor/contract-pdf/vfs_fonts.js');
      const vfs = {};
      for (const file of ['Sarabun-Regular.ttf', 'Sarabun-Bold.ttf']) {
        const response = await fetch(new URL('vendor/contract-pdf/' + file, base));
        if (!response.ok) throw new Error('Не удалось загрузить тайский шрифт');
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        vfs[file] = btoa(binary);
      }
      root.pdfMake.addVirtualFileSystem(vfs);
      root.pdfMake.addFonts({
        Sarabun: {
          normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf',
          italics: 'Sarabun-Regular.ttf', bolditalics: 'Sarabun-Bold.ttf'
        },
        Roboto: {
          normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf',
          italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf'
        }
      });
    })().catch(error => { dependenciesPromise = null; throw error; });
    return dependenciesPromise;
  }

  async function download(contractId) {
    try {
      const contract = await root.contractCall('/contracts/' + encodeURIComponent(contractId));
      if (!['ready_to_sign', 'signed'].includes(contract.status))
        throw new Error('Сначала проверьте и подтвердите финальную версию договора');
      if (contract.missing_fields?.length)
        throw new Error('Договор содержит незаполненные поля');
      const data = mapContract(contract);
      if (data.currency !== 'THB')
        throw new Error('Этот бланк рассчитан на THB. Проверьте валюту бронирования');
      const definition = root.PCSContractDocument.definition(data);
      await dependencies();
      const blob = await new Promise((resolve, reject) => {
        try { root.pdfMake.createPdf(definition).getBlob(resolve); }
        catch (error) { reject(error); }
      });
      if (blob.size < 1000) throw new Error('PDF получился пустым');
      if (activeUrl) URL.revokeObjectURL(activeUrl);
      activeUrl = URL.createObjectURL(blob);
      const booking = String(contract.reservation_id || contractId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12);
      const file = `PCS-car-rental-${booking}-v${Number(contract.version) || 1}.pdf`;
      const link = document.createElement('a');
      link.href = activeUrl;
      link.download = file;
      link.textContent = 'Скачать готовый PDF';
      link.className = 'btn';
      const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
      root.openSheet('Готовый договор PDF', `<p>Сформирован договор, версия ${escape(contract.version)}. Файл содержит текст и тайский шрифт, а не фотографию бланка.</p><div id="contractPdfDownload"></div><object id="contractPdfPreview" type="application/pdf" style="display:block;width:100%;height:68vh;margin-top:16px" aria-label="Предпросмотр PDF"><p>Предпросмотр недоступен. Скачайте PDF кнопкой выше.</p></object>`);
      document.getElementById('contractPdfDownload').appendChild(link);
      document.getElementById('contractPdfPreview').data = activeUrl;
      link.click();
    } catch (error) {
      root.toast(error.message || 'Не удалось создать PDF');
    }
  }

  root.PCSContractPdf = { mapContract, download };
  root.downloadContractPdf = download;
  if (typeof module !== 'undefined') module.exports = { mapContract };
})(typeof window !== 'undefined' ? window : globalThis);
