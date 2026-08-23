import { AssistantLanguage } from './assistantTypes';

interface FallbackRule {
  keywords: RegExp;
  reply: string;
}

const FALLBACK_EN: FallbackRule[] = [
  {
    keywords: /(temperature|hot|heat|temp)/i,
    reply:
      'Keep drying temperatures gentle: rice 43–50°C, wheat/soybean 50–60°C, corn up to ~60°C, coffee 45–55°C. High heat cracks grain and lowers quality. If the dryer exceeds 60°C, reduce heat or increase airflow.'
  },
  {
    keywords: /(humidity|damp|moist|basang)/i,
    reply:
      'Watch the ambient humidity on your dashboard. Drying is fastest when relative humidity is below ~60%. If humidity stays high, keep the fan running and extend drying time instead of raising the temperature. Note: your dryer has no grain-moisture sensor — use ambient humidity plus feel/smell checks.'
  },
  {
    keywords: /(mold|spoil|fungus|amag|bulok)/i,
    reply:
      'Mold grows when grain sits wet. Start drying within hours after harvest, spread grain in thin layers, and keep air moving even between batches. If you smell mustiness, dry immediately at moderate temperature with full airflow.'
  },
  {
    keywords: /(rice|palay)/i,
    reply:
      'For rice/palay: dry at 43–50°C for roughly 6–12 hours depending on weather. Avoid temperatures above 50°C to prevent cracked grains, and stir if possible for even drying.'
  },
  {
    keywords: /(corn|mais)/i,
    reply:
      'For corn: 55–60°C is safe for feed corn, about 8–15 hours depending on initial dampness. Cooler, longer drying protects seed corn quality.'
  },
  {
    keywords: /(wheat|trigo)/i,
    reply:
      'For wheat: dry around 50–60°C. Overheating damages gluten and milling quality — stay in band and rely on airflow.'
  },
  {
    keywords: /(soybean|soya)/i,
    reply:
      'Soybeans are oil-rich and crack easily: keep temperatures near 50–55°C and avoid very hot, fast drying. Gentle airflow matters more than heat.'
  },
  {
    keywords: /(coffee|kape)/i,
    reply:
      'For coffee beans: dry slowly at 45–55°C over several days if possible. Rapid high-heat drying dulls flavor. Keep beans turning for uniform drying.'
  },
  {
    keywords: /(how long|duration|oras|tagal|hours)/i,
    reply:
      'Typical drying runs 6–12 hours for rice and 8–15 hours for corn, but it depends on weather and how wet the grain was. Check temperature/humidity trends in the app rather than guessing by time alone.'
  },
  {
    keywords: /(start|begin|operate|paano simulan)/i,
    reply:
      'To start a batch: open the Dryer screen, choose AUTO mode with target temperature and fan speed, then press START. The device picks up the command within seconds — watch the status change to "running".'
  }
];

const FALLBACK_FIL: FallbackRule[] = [
  {
    keywords: /(temperature|init|temperatura|mainit)/i,
    reply:
      'Panatilihing banayad ang temperatura sa pagpapatuyo: palay 43–50°C, trigo/soybean 50–60°C, mais hanggang ~60°C, kape 45–55°C. Mataas na init ay nagpapapunit ng butil at bumababa ang kalidad. Kung lumampas sa 60°C, bawasan ang init o taasan ang hangin.'
  },
  {
    keywords: /(humidity|lamang lamigi|halumigmig|basang)/i,
    reply:
      'Obserbahan ang halumigmig ng paligid sa dashboard. Mas mabilis ang pagpapatuyo kapag mababa sa ~60% ang relative humidity. Kung mataas pa rin, patuloy na ipaandar ang bentilador at habaan ang oras imbes na taasan ang temperatura. Paalala: walang moisture sensor ang dryer ninyo — gamitin ang humidity ng paligid at pakiramdam/amoy ng butil.'
  },
  {
    keywords: /(mold|amag|bulok|masira)/i,
    reply:
      'Lumalago ang amag kapag nakatengga ang basang butil. Simulan ang pagpapatuyo ilang oras pagkatapos ng ani, magkalat ng manipis na layer, at panatilihing umiikot ang hangin. Kapag may amoy-amag, patuyuin agad sa katamtamang temperatura na buong lakas ang hangin.'
  },
  {
    keywords: /(rice|palay)/i,
    reply:
      'Para sa palay: patuyuin sa 43–50°C nang mga 6–12 oras depende sa panahon. Iwasan ang lagpas 50°C para hindi mapupunit ang butil, at haluin kung kaya para pantay ang tuyo.'
  },
  {
    keywords: /(corn|mais)/i,
    reply:
      'Para sa mais: 55–60°C ay ligtas, mga 8–15 oras depende sa basa ng butil. Mas mahabang oras at mas mababang init ang mas ligtas para sa binhing mais.'
  },
  {
    keywords: /(coffee|kape)/i,
    reply:
      'Para sa kape: dahan-dahang patuyuin sa 45–55°C. Mabilis at napaka-init na pagpapatuyo ay nagpapahina ng lasa. Panatilihing gumalaw ang butil para pantay.'
  },
  {
    keywords: /(how long|gaano katagal|oras|tagal)/i,
    reply:
      'Karaniwang 6–12 oras ang palay at 8–15 oras ang mais, pero depende ito sa panahon at sa basa ng ani. Tingnan ang temperature/humidity trend sa app imbes na umasa sa oras lang.'
  },
  {
    keywords: /(start|simulan|buksan|operahan)/i,
    reply:
      'Para magsimula: buksan ang Dryer screen, piliin ang AUTO mode na may target na temperatura at fan speed, tapos pindutin ang START. Makukuha ng device ang command sa loob ng ilang segundo — panoorin ang status na magiging "running".'
  }
];

const DEFAULT_EN =
  'I can help with drying temperatures, humidity monitoring, drying times per grain (rice, corn, wheat, soybean, coffee), and operating the dryer. Ask me something like "What temperature should I dry rice at?"';
const DEFAULT_FIL =
  'Matutulungan kita sa temperatura ng pagpapatuyo, pagsubaybay sa humidity, tagal ng pagtutuyo bawat butil (palay, mais, trigo, soybean, kape), at pagpapatakbo ng dryer. Itanong mo halimbawa: "Anong temperatura dapat sa palay?"';

export function localFallbackReply(lastUserMessage: string, lang: AssistantLanguage): string {
  const rules = lang === 'FIL' ? FALLBACK_FIL : FALLBACK_EN;
  for (const rule of rules) {
    if (rule.keywords.test(lastUserMessage)) return rule.reply;
  }
  return lang === 'FIL' ? DEFAULT_FIL : DEFAULT_EN;
}
