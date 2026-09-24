// Çekirdek mantık testleri:  npm test
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createMatcher } from '../public/assets/js/shared/matcher.js';
import { createContext, aggregate, productionRows } from '../public/assets/js/shared/calc.js';
import { fold } from '../public/assets/js/shared/text.js';
import { signToken, verifyToken, parseUsers } from '../netlify/lib/auth.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✓', name); };

const products = [
  { id: 'shot', name: 'Detox Shot', packMultiplier: true },
  { id: 'mix', name: 'Detox Mix' },
  { id: 'zen', name: 'Zencefil Shot' },
  { id: 's500', name: 'Sultan Sirkesi 500ml' },
  { id: 's1l', name: 'Sultan Sirkesi 1 Lt' },
  { id: 'kakao', name: 'Ham Kakao Tozu' },
];

await test('Metin sadeleştirme ve birimler', () => {
  assert.equal(fold("ULTRA NATURA Detoks Shot 7'li"), 'ultra natura detoks shot 7li');
  assert.equal(fold('Sultan Sirkesi 1 Lt'), 'sultan sirkesi 1000ml');
  assert.equal(fold('0,5 L'), '500ml');
  assert.equal(fold('Çiğ Kakao 250 gr'), 'cig kakao 250g');
});

await test('Detox Shot ile Detox Mix karışmaz, ekler ayıklanır', () => {
  const m = createMatcher({ products });
  assert.equal(m('Ultra Natura Detox Shot - Zencefilli 60ml Hediyeli').productId, 'shot');
  assert.equal(m('DETOKS SHOT').productId, 'shot');
  assert.equal(m('Detox Mix Toz 250gr').productId, 'mix');
  assert.equal(m('Organik Detox Mix Kampanyalı').productId, 'mix');
  assert.equal(m('Zencefil Shotu').productId, 'zen');
  const set = m('Detox Shot + Detox Mix Set');
  assert.equal(set.method, 'bundle');
  assert.deepEqual(set.parts.map((x) => x.productId).sort(), ['mix', 'shot']);
  assert.equal(m('Elma Sirkesi').productId, null);
});

await test('Birleşik ad iki ürüne bölünür (Daily Shake Ginger Shot)', () => {
  const ps = [{ id: 'ds', name: 'Daily Shake' }, { id: 'gs', name: 'Ginger Shot' }, { id: 'd', name: 'Detox' }, { id: 'dsh', name: 'Detox Shot' }];
  let m = createMatcher({ products: ps });
  const r = m('Momordica Daily Shake Ginger Shot');
  assert.equal(r.method, 'bundle');
  assert.deepEqual(r.parts.map((x) => x.productId), ['ds', 'gs']);
  assert.equal(m('Daily Shake').productId, 'ds');
  assert.equal(m('Ginger Shot 7li').productId, 'gs');
  assert.equal(m('Detox Shot').productId, 'dsh'); // "Detox" alt kümesi → set sayılmaz
  // Katalogda set ürünün kendisi varsa o seçilir
  m = createMatcher({ products: [...ps, { id: 'set', name: 'Daily Shake Ginger Shot Set' }] });
  assert.equal(m('Daily Shake Ginger Shot Set').productId, 'set');
  // Elle set tanımı
  m = createMatcher({ products: ps, aliases: { [fold('DS+GS Paket')]: { productId: '__bundle', parts: [{ productId: 'ds', qty: 2 }, { productId: 'gs', qty: 1 }] } } });
  assert.deepEqual(m('DS+GS Paket').parts, [{ productId: 'ds', qty: 2 }, { productId: 'gs', qty: 1 }]);
  // Rapor: 3 adet set → 3 Daily Shake + 3 Ginger Shot
  const ctx = createContext({ products: ps, stores: [], campaigns: [], aliases: {}, settings: {} });
  const R = aggregate([{ k: 'a', date: '2026-09-24', sender: 'X', items: [{ name: 'Daily Shake Ginger Shot', qty: 3 }] }], ctx);
  assert.equal(R.products.get('ds').labelUnits, 3);
  assert.equal(R.products.get('gs').labelUnits, 3);
  assert.equal(R.unmatched.size, 0);
});

await test('Yapıştırılan ürün listesi: SKU ile eşleştir, sıra, tekrar, marka ayrımı', async () => {
  const { parseProductList, planCatalogReplace } = await import('../public/assets/js/core/catalog.js');
  const text = 'IC-CCN-250ML\tMomordica\tCoconut Mix\nIC-DTX-250ML\tMomordica\tDetoxMix\nGDA-DSK-200GR\tMomordica\tDaily Shake Ara Öğün Tozu\n' +
    'TAK-KMK-680GR - ULT\tUltra Natura\tKaramürver ve Karadut Özü\nTAK-KMK-680GR\tPower Vital\tKaramürver ve Karadut Özü\nIC-CCN-250ML\tMomordica\tCoconut Mix\n';
  const rows = parseProductList(text);
  assert.equal(rows.length, 5); // son satır tekrar
  const existing = [
    { id: 'old1', name: 'Coconut Mix', sku: 'IC-CCN-250ML', keywords: 'coconut mix' },
    { id: 'old2', name: 'Detox Mix', sku: 'IC-DTX-250ML', keywords: '' },
    { id: 'old3', name: 'Daily Shake', sku: '', keywords: '' },
    { id: 'gone', name: 'Silinecek Ürün', sku: 'X-1' },
  ];
  const plan = planCatalogReplace(existing, rows);
  assert.deepEqual(plan.products.map((p) => p.name), ['Coconut Mix', 'DetoxMix', 'Daily Shake Ara Öğün Tozu', 'Karamürver ve Karadut Özü', 'Karamürver ve Karadut Özü']);
  assert.equal(plan.products[0].id, 'old1');
  assert.equal(plan.products[1].id, 'old2');        // SKU ile eşleşti, adı değişti
  assert.equal(plan.removed.map((p) => p.id).join(), 'gone');
  // SKU'suz "Daily Shake" → listedeki "Daily Shake Ara Öğün Tozu"na birleşir, bağlantıları taşınır
  assert.equal(plan.remap.old3, plan.products[2].id);
  assert.ok(createMatcher({ products: plan.products })('Daily Shake').productId === plan.products[2].id);
  // Yanlış SKU: eski kayıtta Kabak yağı Tatlı Badem SKU'sunu taşıyorsa ad benzemediği için eşleşmez
  const p2 = planCatalogReplace([{ id: 'k', name: 'Kabak Çekirdeği Yağı', sku: 'YAG-TBD-250ML' }], parseProductList('YAG-KCY-250ML\tUltra Natura\tKabak Çekirdeği Yağı\nYAG-TBD-250ML\tUltra Natura\tTatlı Badem Yağı'));
  assert.equal(p2.products[0].id, 'k');
  assert.notEqual(p2.products[1].id, 'k');
  assert.equal(plan.products[3].category, 'Takviye & Kapsül');
  // Eski adla etiketler hâlâ eşleşir
  const m = createMatcher({ products: plan.products });
  assert.equal(m('Detox Mix').productId, 'old2');
  // Aynı adlı iki marka: mağazanın markasına göre ayrılır
  const ctx = createContext({ products: plan.products, stores: [{ id: 'pv', name: 'Power Vital İkas', platform: 'ikas', senders: ['Power Vital İkas'] }, { id: 'un', name: 'Ultra Natura İkas', platform: 'ikas', senders: ['Ultra Natura İkas'] }], campaigns: [], aliases: {}, settings: {} });
  const who = (sender) => aggregate([{ k: 'a', date: '2026-09-24', sender, items: [{ name: 'Karamürver ve Karadut Özü 680 gr', qty: 1 }] }], ctx);
  const pv = who('Power Vital İkas'), un = who('Ultra Natura İkas');
  assert.equal(plan.products.find((p) => p.brand === 'Power Vital').id, [...pv.products.keys()][0]);
  assert.equal(plan.products.find((p) => p.brand === 'Ultra Natura').id, [...un.products.keys()][0]);
});

await test('Gramaj/hacim farkı ayrı ürün sayılır', () => {
  const m = createMatcher({ products });
  assert.equal(m('Sultan Sirkesi - 500ml').productId, 's500');
  assert.equal(m('Sultan Sirkesi 1000 ml Cam Şişe').productId, 's1l');
  assert.equal(m('Sultan Sirkesi').productId, null);
});

await test('Paket çarpanı ve elle eşleştirme önceliği', () => {
  const m = createMatcher({ products, aliases: { [fold('Detox Shot + Detox Mix Set')]: { productId: 'mix', multiplier: 2 }, [fold('Kargo Bedeli')]: { productId: '__ignore' } } });
  assert.equal(m("Detox Shot 7'li Paket").multiplier, 7);
  assert.equal(m('Detox Shot x 14').multiplier, 14);
  assert.equal(m('Zencefil Shot 7li').multiplier, 1); // çarpan kapalı
  const a = m('Detox Shot + Detox Mix Set');
  assert.equal(a.productId, 'mix'); assert.equal(a.multiplier, 2); assert.equal(a.method, 'manual');
  assert.equal(m('Kargo Bedeli').ignored, true);
});

await test('Hariç kelime', () => {
  const m = createMatcher({ products: [{ id: 'd', name: 'Detox', exclude: 'mix shot' }, ...products] });
  assert.equal(m('Detox Çayı').productId, 'd');
  assert.equal(m('Detox Mix').productId, 'mix');
});

const config = {
  products,
  stores: [
    { id: 'ty1', name: 'UN Trendyol', platform: 'trendyol', senders: ['Ultra Natura Trendyol'] },
    { id: 'ik1', name: 'UN ikas', platform: 'ikas', senders: ['Ultra Natura Ikas'] },
    { id: 'sh1', name: 'UN Shop', platform: 'shopify', senders: ['Ultra Natura Shop'], active: false },
  ],
  campaigns: [
    { id: 'c1', name: 'Shot 2 al 1', active: true, platforms: ['trendyol', 'ikas'], storeIds: [], triggerProductIds: ['shot'], minQty: 2, rewardQty: 1, rewardProductId: '', mode: 'every', start: '2026-09-01', end: '' },
    { id: 'c2', name: 'Mix yanına kakao', active: true, platforms: [], storeIds: ['sh1'], triggerProductIds: ['mix'], minQty: 1, rewardQty: 1, rewardProductId: 'kakao', mode: 'once', start: '', end: '' },
    { id: 'c3', name: 'Durdurulmuş', active: false, platforms: [], storeIds: [], triggerProductIds: ['kakao'], minQty: 1, rewardQty: 5, rewardProductId: '', mode: 'every' },
    { id: 'c4', name: 'Karışık sepet', active: true, archived: true, platforms: [], storeIds: ['ik1'], triggerProductIds: ['shot', 'mix'], minQty: 3, rewardQty: 1, rewardProductId: 'kakao', countMode: 'sum', mode: 'every', start: '2026-09-20', end: '2026-09-25' },
  ],
  aliases: {},
  settings: {},
};

await test('Kampanyalar: platform, mağaza, tarih, katlanma, karışık sepet', () => {
  const ctx = createContext(config);
  const orders = [
    { k: 'a', date: '2026-09-23', sender: 'ULTRA NATURA TRENDYOL', items: [{ name: 'Detox Shot', qty: 5 }] }, // +2 shot
    { k: 'b', date: '2026-08-30', sender: 'Ultra Natura Trendyol', items: [{ name: 'Detox Shot', qty: 4 }] }, // kampanya başlamadan
    { k: 'c', date: '2026-09-23', sender: 'Ultra Natura Shop', items: [{ name: 'Detox Mix', qty: 3 }, { name: 'Ham Kakao Tozu', qty: 1 }] }, // +1 kakao, pasif mağaza yine tanınır
    { k: 'd', date: '2026-09-23', sender: 'Ultra Natura Ikas', items: [{ name: 'Detox Shot', qty: 1 }, { name: 'Detox Mix', qty: 2 }] }, // c4: 3 → +1 kakao
    { k: 'e', date: '2026-09-23', sender: 'Bilinmeyen Mağaza', items: [{ name: 'Elma Sirkesi', qty: 2 }] },
  ];
  const R = aggregate(orders, ctx);
  assert.equal(R.orders, 5);
  assert.equal(R.labelUnits, 5 + 4 + 3 + 1 + 1 + 2 + 2);
  assert.equal(R.campaignOrders, 3);
  assert.equal(R.products.get('shot').campaignUnits, 2);
  assert.equal(R.products.get('kakao').campaignUnits, 2);
  assert.equal(R.unmatched.size, 1);
  assert.ok([...R.stores.keys()].some((k) => k.startsWith('?')));
  const rows = productionRows(R, ctx);
  assert.deepEqual(rows.map((r) => r.product.id), ['shot', 'mix', 'kakao']); // katalog sırası
  assert.equal(rows[0].total, 5 + 4 + 1 + 2);
  const onlyTy = aggregate(orders, ctx, { platforms: ['trendyol'] });
  assert.equal(onlyTy.orders, 2);
});

await test('Kampanya: ürün hariç / tüm ürünler / mağaza hariç / tutar / farklı ürün / üst sınır / hediye paketi', () => {
  const base = { active: true, platforms: [], storeIds: [], start: '', end: '' };
  const cfg = (campaigns) => createContext({ ...config, campaigns });
  const o = { k: 'x', date: '2026-09-23', sender: 'Ultra Natura Trendyol', amount: 750, items: [{ name: 'Detox Shot', qty: 4 }, { name: 'Detox Mix', qty: 2 }, { name: 'Ham Kakao Tozu', qty: 1 }] };
  const rw = (c) => aggregate([o], cfg([{ id: 'c', name: 'c', ...base, ...c }])).products;
  // Ürün seçilmedi → tüm ürünler, her ürün ayrı: 4→+2, 2→+1, 1→0
  let P = rw({ triggerProductIds: [], minQty: 2, mode: 'every', rewards: [{ productId: '', qty: 1 }] });
  assert.equal(P.get('shot').campaignUnits, 2); assert.equal(P.get('mix').campaignUnits, 1);
  // Detox Shot hariç
  P = rw({ triggerProductIds: ['shot'], productMode: 'exclude', minQty: 2, rewards: [{ productId: '', qty: 1 }] });
  assert.equal(P.get('shot').campaignUnits, 0); assert.equal(P.get('mix').campaignUnits, 1);
  // Mağaza hariç → uygulanmaz
  P = rw({ storeIds: ['ty1'], storeMode: 'exclude', rewards: [{ productId: 'kakao', qty: 1 }], condition: 'order' });
  assert.equal(P.get('kakao').campaignUnits, 0);
  // Tutar: 750 TL, her 300 TL için 1 kakao → +2
  P = rw({ condition: 'amount', minAmount: 300, mode: 'every', rewards: [{ productId: 'kakao', qty: 1 }] });
  assert.equal(P.get('kakao').campaignUnits, 2);
  // 3 farklı ürün alana bir kez 1 zencefil
  P = rw({ condition: 'distinct', minQty: 3, mode: 'once', rewards: [{ productId: 'zen', qty: 1 }] });
  assert.equal(P.get('zen').campaignUnits, 1);
  // Karışık sepet toplamı 7 → her 2'de 1 (3), üst sınır 2
  P = rw({ condition: 'qty', countMode: 'sum', minQty: 2, mode: 'every', maxPerOrder: 2, rewards: [{ productId: 'kakao', qty: 1 }] });
  assert.equal(P.get('kakao').campaignUnits, 2);
  // Hediye paketi: her siparişe 1 kakao + 2 zencefil
  P = rw({ condition: 'order', rewards: [{ productId: 'kakao', qty: 1 }, { productId: 'zen', qty: 2 }] });
  assert.equal(P.get('kakao').campaignUnits, 1); assert.equal(P.get('zen').campaignUnits, 2);
});

await test('2. ürün 1 TL: yalnızca tek ürünlü ve 1 adetlik siparişe +1', () => {
  const ctx = createContext({
    products: [{ id: 'coco', name: 'Coconut Mix' }, { id: 'detox', name: 'Detox Shot' }],
    stores: [{ id: 'mom', name: 'Momordica Trendyol', platform: 'trendyol', senders: ['Momordica Trendyol'] }, { id: 'oth', name: 'Diğer', platform: 'trendyol', senders: ['Diğer Mağaza'] }],
    campaigns: [{ id: 'c', name: '2. ürün 1 TL', active: true, platforms: [], storeIds: ['mom'], triggerProductIds: ['coco'], condition: 'qty', countMode: 'each', mode: 'once', minQty: 1, maxQty: 1, pureOnly: true, rewards: [{ productId: '', qty: 1 }] }],
    aliases: {}, settings: {},
  });
  const extra = (items, sender = 'Momordica Trendyol') => aggregate([{ k: 'x', date: '2026-09-24', sender, items }], ctx).campaignUnits;
  assert.equal(extra([{ name: 'Coconut Mix', qty: 1 }]), 1);                                     // 1 coconut → +1
  assert.equal(extra([{ name: 'Coconut Mix', qty: 2 }]), 0);                                     // 2 coconut → yok
  assert.equal(extra([{ name: 'Coconut Mix', qty: 1 }, { name: 'Detox Shot', qty: 1 }]), 0);     // karışık → yok
  assert.equal(extra([{ name: 'Coconut Mix', qty: 1 }, { name: 'Detox Shot', qty: 2 }]), 0);     // karışık → yok
  assert.equal(extra([{ name: 'Detox Shot', qty: 1 }]), 0);                                      // kampanyasız ürün
  assert.equal(extra([{ name: 'Coconut Mix', qty: 1 }], 'Diğer Mağaza'), 0);                     // başka mağaza
});

await test('Katına tamamla: 1→2, 2→2, 3→4, 4→4', () => {
  const ctx = createContext({ products: [{ id: 'a', name: 'Coconut Mix' }], stores: [], aliases: {}, settings: {},
    campaigns: [{ id: 'c', name: 'Çifte tamamla', active: true, platforms: [], storeIds: [], triggerProductIds: ['a'], condition: 'qty', countMode: 'each', mode: 'roundup', minQty: 2, rewards: [{ productId: '', qty: 1 }] }] });
  const total = (q) => aggregate([{ k: 'x', date: '2026-09-24', sender: 'X', items: [{ name: 'Coconut Mix', qty: q }] }], ctx).totalUnits;
  assert.deepEqual([1, 2, 3, 4, 5].map(total), [2, 2, 4, 4, 6]);
});

await test('Excel ürün hücresi ayrıştırma', async () => {
  const { parseItems } = await import('../public/assets/js/core/sheets.js');
  assert.deepEqual(parseItems('Okyanus Oda Kokusu OK, one size x1, Lavanta Oda Kokusu LK, one size x2', 3), [
    { name: 'Okyanus Oda Kokusu OK, one size', qty: 1 }, { name: 'Lavanta Oda Kokusu LK, one size', qty: 2 },
  ]);
  assert.deepEqual(parseItems('Detox Shot', 4), [{ name: 'Detox Shot', qty: 4 }]);
});

await test('Oturum jetonu imza ve süre kontrolü', async () => {
  const t = await signToken({ u: 'sami', r: 'admin', exp: Date.now() + 1000 }, 'gizli-anahtar-1234567890');
  assert.equal((await verifyToken(t, 'gizli-anahtar-1234567890')).u, 'sami');
  assert.equal(await verifyToken(t, 'baska-anahtar-1234567890'), null);
  assert.equal(await verifyToken(t.slice(0, -2) + 'xx', 'gizli-anahtar-1234567890'), null);
  const old = await signToken({ u: 'sami', r: 'admin', exp: Date.now() - 1 }, 'gizli-anahtar-1234567890');
  assert.equal(await verifyToken(old, 'gizli-anahtar-1234567890'), null);
});

await test('USERS değişkeni ayrıştırma', () => {
  const u = parseUsers('Sami:Gizli:Şifre!1:admin, ayse:abc123:personel;\nmuhasebe:x:izleyici\nbos:\nali:sifre');
  assert.deepEqual(u.map((x) => [x.username, x.password, x.role]), [
    ['sami', 'Gizli:Şifre!1', 'admin'], ['ayse', 'abc123', 'personel'], ['muhasebe', 'x', 'izleyici'], ['ali', 'sifre', 'personel'],
  ]);
});

console.log(`\n${passed} test geçti`);
