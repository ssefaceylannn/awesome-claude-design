// Karma ayıklama kuralı sitede saklanır (Karma Ayıklama ve Kombinasyon Analizi aynı kuralı kullanır;
// yalnızca yönetici değiştirir). Kombinasyon ekranındaki "karmayı ayır" anahtarı bu tarayıcıya özeldir.
import { state, saveSection } from './api.js';
import { karmaRule } from '../shared/karma.js';
import { KARMA } from '../shared/combos.js';

const KEY = 'et-karma-view';
export const karmaPref = () => karmaRule(state.config.karma);
export const saveKarma = (rule, summary) => saveSection('karma', rule, summary);

export function karmaSplitOn() { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
export function setKarmaSplit(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* yok */ } }

/** Kombinasyon listesindeki satır adı: "Karma Siparişler – Sadece Şişe" */
export const karmaLabel = (key, rule = karmaPref()) => `${KARMA} – ${rule.names[key]}`;
