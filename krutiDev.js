'use strict';

// Kruti Dev 010 -> Unicode Devanagari converter used only during Excel import.
// Kept dependency-free so the existing Render deployment does not need any new package.

const legacy = [
'ñ','Q+Z','sas','aa',')Z','ZZ','‘','’','“','”',
'å','ƒ','„','…','†','‡','ˆ','‰','Š','‹',
'¶+','d+','[+k','[+','x+','T+','t+','M+','<+','Q+',';+','j+','u+',
'Ùk','Ù','ä','–','—','é','™','=kk','f=k',
'à','á','â','ã','ºz','º','í','{k','{','=','«',
'Nî','Vî','Bî','Mî','<î','|','K','}',
'J','Vª','Mª','<ªª','Nª','Ø','Ý','nzZ','æ','ç','Á','xz','#',':',
'v‚','vks','vkS','vk','v','b±','Ã','bZ','b','m','Å',',s',',','_',
'ô','d','Dk','D','[k','[','x','Xk','X','Ä','?k','?','³',
'pkS','p','Pk','P','N','t','Tk','T','>','÷','¥',
'ê','ë','V','B','ì','ï','M+','<+','M','<','.k','.',
'r','Rk','R','Fk','F',')','n','/k','èk','/','Ë','è','u','Uk','U',
'i','Ik','I','Q','¶','c','Ck','C','Hk','H','e','Ek','E',
';','¸','j','y','Yk','Y','G','o','Ok','O',
"'k","'",'"k','"','l','Lk','L','g',
'È','z','Ì','Í','Î','Ï','Ñ','Ò','Ó','Ô','Ö','Ø','Ù','Ük','Ü',
'‚','ks','kS','k','h','q','w','`','s','S',
'a','¡','%','W','•','·','∙','·','~j','~','\\','+',' ः',
'^','*','Þ','ß','(','¼','½','¿','À','¾','A','-','&','&','Œ',']','~ ','@'
];

const unicode = [
'॰','QZ+','sa','a','र्द्ध','Z','"','"',"'","'",
'०','१','२','३','४','५','६','७','८','९',
'फ़्','क़','ख़','ख़्','ग़','ज़्','ज़','ड़','ढ़','फ़','य़','ऱ','ऩ',
'त्त','त्त्','क्त','दृ','कृ','न्न','न्न्','=k','f=',
'ह्न','ह्य','हृ','ह्म','ह्र','ह्','द्द','क्ष','क्ष्','त्र','त्र्',
'छ्य','ट्य','ठ्य','ड्य','ढ्य','द्य','ज्ञ','द्व',
'श्र','ट्र','ड्र','ढ्र','छ्र','क्र','फ्र','र्द्र','द्र','प्र','प्र','ग्र','रु','रू',
'ऑ','ओ','औ','आ','अ','ईं','ई','ई','इ','उ','ऊ','ऐ','ए','ऋ',
'क्क','क','क','क्','ख','ख्','ग','ग','ग्','घ','घ','घ्','ङ',
'चै','च','च','च्','छ','ज','ज','ज्','झ','झ्','ञ',
'ट्ट','ट्ठ','ट','ठ','ड्ड','ड्ढ','ड़','ढ़','ड','ढ','ण','ण्',
'त','त','त्','थ','थ्','द्ध','द','ध','ध','ध्','ध्','ध्','न','न','न्',
'प','प','प्','फ','फ्','ब','ब','ब्','भ','भ्','म','म','म्',
'य','य्','र','ल','ल','ल्','ळ','व','व','व्',
'श','श्','ष','ष्','स','स','स्','ह',
'ीं','्र','द्द','ट्ट','ट्ठ','ड्ड','कृ','भ','्य','ड्ढ','झ्','क्र','त्त्','श','श्',
'ॉ','ो','ौ','ा','ी','ु','ू','ृ','े','ै',
'ं','ँ','ः','ॅ','ऽ','ऽ','ऽ','ऽ','्र','्','?','़',':',
'‘','’','“','”',';','(',')','{','}','=', '।','.', '-', 'µ','॰',',','् ','/'
];

function replaceAllPlain(text, from, to) {
  return from ? text.split(from).join(to) : text;
}

function convertKrutiDevToUnicode(input) {
  let s = String(input ?? '');
  if (!s) return s;

  for (let i = 0; i < legacy.length; i++) s = replaceAllPlain(s, legacy[i], unicode[i]);

  // Special Kruti Dev glyphs.
  s = s.replace(/±/g, 'Zं').replace(/Æ/g, 'र्f').replace(/Ç/g, 'fa').replace(/É/g, 'र्fa').replace(/Ê/g, 'ीZ');

  // Move short-i matra (f) after the consonant/group it belongs to.
  let pos = s.indexOf('f');
  let guard = 0;
  while (pos !== -1 && pos < s.length - 1 && guard++ < 10000) {
    const next = s.charAt(pos + 1);
    s = s.slice(0, pos) + next + 'ि' + s.slice(pos + 2);
    pos = s.indexOf('f', pos + 1);
  }

  // fa represents ि + anusvara and is positioned before the consonant in Kruti Dev.
  pos = s.indexOf('fa'); guard = 0;
  while (pos !== -1 && pos < s.length - 2 && guard++ < 10000) {
    const next = s.charAt(pos + 2);
    s = s.slice(0, pos) + next + 'िं' + s.slice(pos + 3);
    pos = s.indexOf('fa', pos + 2);
  }

  // Fix short-i matra that landed before a half-letter.
  pos = s.indexOf('ि्'); guard = 0;
  while (pos !== -1 && pos < s.length - 2 && guard++ < 10000) {
    const next = s.charAt(pos + 2);
    s = s.slice(0, pos) + '्' + next + 'ि' + s.slice(pos + 3);
    pos = s.indexOf('ि्', pos + 2);
  }

  // Kruti Dev reph marker Z -> Unicode र् at the start of the consonant cluster.
  const matras = new Set('अआइईउऊएऐओऔािीुूृेैोौंःँॅ'.split(''));
  pos = s.indexOf('Z'); guard = 0;
  while (pos > 0 && guard++ < 10000) {
    let start = pos - 1;
    while (start > 0 && matras.has(s.charAt(start))) start--;
    const chunk = s.slice(start, pos);
    s = s.slice(0, start) + 'र्' + chunk + s.slice(pos + 1);
    pos = s.indexOf('Z');
  }

  return s.normalize('NFC');
}

function looksLikeUnicodeDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text ?? ''));
}

function looksLikeKrutiDev(text) {
  const s = String(text ?? '').trim();
  if (!s || looksLikeUnicodeDevanagari(s)) return false;
  // Distinctive Kruti Dev characters are a strong signal.
  if (/[ñåƒ„…†‡ˆ‰Š‹¶Ùäé™àáâãºíîªØÝæçÁ‚ÃÅôÄ³÷¥êëìïÈÌÍÎÏÑÒÓÔÖÜ¡•·∙Þß¼½¿À¾Œ]/.test(s)) return true;
  // Common high-confidence Kruti Dev Hindi patterns. Require at least two hits
  // so normal English text is not converted accidentally in Auto mode.
  const pats = [/(?:^|\s)D;k(?:\s|$)/g,/(?:^|\s)gS(?:\s|$)/g,/(?:^|\s)Hkk\S*/g,/(?:^|\s)jkt\S*/g,/(?:^|\s)iz\S*/g,/(?:^|\s)fd\S*/g,/(?:^|\s)esa(?:\s|$)/g,/(?:^|\s)ds(?:\s|$)/g,/(?:^|\s)dk(?:\s|$)/g,/(?:^|\s)dh(?:\s|$)/g,/(?:^|\s)dks(?:\s|$)/g,/(?:^|\s)vki(?:\s|$)/g,/(?:^|\s)vkSj(?:\s|$)/g,/[/;][A-Za-z]/g,/\S+[+`~]\S*/g];
  let hits = 0;
  for (const re of pats) { const m = s.match(re); if (m) hits += m.length; if (hits >= 2) return true; }
  return false;
}

function convertByMode(text, mode='auto') {
  const s = String(text ?? '');
  if (mode === 'krutidev') return convertKrutiDevToUnicode(s);
  if (mode === 'unicode') return s;
  return looksLikeKrutiDev(s) ? convertKrutiDevToUnicode(s) : s;
}

module.exports = { convertKrutiDevToUnicode, looksLikeKrutiDev, convertByMode };
