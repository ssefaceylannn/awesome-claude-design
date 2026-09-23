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
  assert.equal(m('Detox Shot + Detox Mix Set').method, 'ambiguous');
  assert.equal(m('Elma Sirkesi').productId, null);
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
