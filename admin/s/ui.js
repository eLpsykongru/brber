// Pieces every section page draws the same way (README §8 tokens).
import { esc } from '/app.js';

// the 62 px page header a section draws when the shell's top bar is off
export const pageHead = (title, sub, right = '') => `
  <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:14px;padding:0 24px;box-sizing:border-box">
    <span style="font-size:15px;font-weight:700;white-space:nowrap">${esc(title)}</span>
    <span class="num" style="font-size:12px;color:#6B6B72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub || '')}</span>
    <span style="flex:1"></span>${right}
  </div>`;

// the 46 px row of section tabs: [label, href, on]
export const subTabs = (tabs) => `
  <div style="height:46px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:5px;padding:0 24px;overflow-x:auto">
    ${tabs.map(([label, href, on]) => `<a href="${href}" style="height:28px;border-radius:8px;display:flex;align-items:center;padding:0 12px;font-size:12px;flex:none;white-space:nowrap;text-decoration:none;${on ? 'background:#212125;font-weight:700;color:#fff' : 'font-weight:500;color:#9A9CA3'}">${esc(label)}</a>`).join('')}
  </div>`;

// filter chips (§6): the chosen one is red; [label, href, on, count?]
export const chips = (list, right = '') => `
  <div style="height:52px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:8px;padding:0 24px">
    ${list.map(([label, href, on, n]) => `<a href="${href}" style="height:30px;border-radius:8px;display:flex;align-items:center;gap:7px;padding:0 13px;font-size:11.5px;text-decoration:none;${on ? 'background:#E8442E;font-weight:700;color:#fff' : 'background:#17171A;border:1px solid #26262B;font-weight:600;color:#9A9CA3'}">${esc(label)}${n ? `<span class="num" style="font-size:10px;font-weight:700;color:${on ? '#fff' : '#E8A100'}">${esc(n)}</span>` : ''}</a>`).join('')}
    <span style="flex:1"></span>${right}
  </div>`;

export const btnP = (label, attrs = '') => `<span ${attrs} class="btn-p" style="display:flex;align-items:center;gap:7px;height:32px;border-radius:9px;background:#E8442E;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">${label}</span>`;
export const btnS = (label, attrs = '') => `<span ${attrs} class="btn-s" style="display:flex;align-items:center;gap:7px;height:32px;border-radius:9px;background:#212125;border:1px solid #3A3A40;padding:0 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">${label}</span>`;
export const plus = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 5v14M5 12h14"></path></svg>';
export const avatar = (text, bg = '#212125', size = 32) => `<span style="width:${size}px;height:${size}px;border-radius:999px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:${size > 30 ? 11 : 10.5}px;font-weight:700;flex:none">${esc(text)}</span>`;
export const label9 = (t, color = '#9A9CA3') => `<span style="font-size:9.5px;letter-spacing:.13em;font-weight:700;color:${color}">${esc(t)}</span>`;

// README §4: an owner page drawn only as a phone screen sits in a centred column
// (max-width 640) under a row of that section's tabs: [label, href, on]
export const column = (inner, tabs = []) => `<div style="height:100%;display:flex;flex-direction:column;min-width:0">
  ${tabs.length ? subTabs(tabs) : ''}
  <div style="flex:1;min-height:0;overflow:auto"><div style="max-width:640px;margin:0 auto;padding:22px 20px 48px;display:flex;flex-direction:column;gap:13px;box-sizing:border-box">${inner}</div></div></div>`;
export const card = (inner, extra = '') => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px;${extra}">${inner}</div>`;
export const eyebrow = (t, color = '#9A9CA3') => `<span style="font-size:10px;letter-spacing:.14em;font-weight:700;color:${color}">${esc(t)}</span>`;
export const kv = (label, value, color = '#fff', strong = false) => `<div style="display:flex;align-items:center;gap:12px"><span style="flex:1;font-size:12.5px;color:${strong ? '#fff' : '#9A9CA3'};font-weight:${strong ? 700 : 400}">${esc(label)}</span><span class="num" style="font-size:${strong ? 15 : 13.5}px;font-weight:700;color:${color}">${esc(value)}</span></div>`;
export const rule = '<div style="height:1px;background:#26262B"></div>';

// §5.3 — one data-driven file for a shop, a barber, a customer: crumbs, a pill,
// avatar and name, tiles, a "call" panel with actions, sectioned rows.
// p = { crumbs:[[label, href?]], pill:[text, tone], initials, name, tag:[text, tone]?, sub,
//       rating?, tiles:[{label, value, sub?, color?, subColor?}], call:{tone, title, body, actions:[{label, href, primary?}]}?,
//       sections:[{title, rows:[{title, sub?, right?, rightColor?, href?}], empty?}], side?:[{title, rows}] }
const TONES = { red: ['#F87171', 'rgba(248,113,113,.08)', 'rgba(248,113,113,.3)'], amber: ['#E8A100', 'rgba(232,161,0,.08)', 'rgba(232,161,0,.28)'],
  green: ['#4ADE80', 'rgba(74,222,128,.07)', 'rgba(74,222,128,.25)'], grey: ['#9A9CA3', '#17171A', '#1E1E22'] };
export function profile(p) {
  const [pf] = TONES[p.pill?.[1] || 'grey'];
  const sec = (s) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden;display:flex;flex-direction:column">
    <span style="padding:14px 16px 10px;font-size:12.5px;font-weight:700">${esc(s.title)}</span>
    ${s.rows.map((r) => `<${r.href ? `a href="${esc(r.href)}" class="hov"` : 'div'} style="display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:600">${esc(r.title)}</span>${r.sub ? `<span style="font-size:10.5px;color:#9A9CA3">${esc(r.sub)}</span>` : ''}</span>
      ${r.right != null ? `<span class="num" style="flex:none;font-size:12px;font-weight:700;color:${r.rightColor || '#fff'}">${esc(r.right)}</span>` : ''}</${r.href ? 'a' : 'div'}>`).join('') || `<span style="padding:0 16px 14px;font-size:11.5px;color:#6B6B72">${esc(s.empty || 'Nothing here.')}</span>`}</div>`;
  const call = p.call ? (() => {
    const [fg, bg, border] = TONES[p.call.tone || 'grey'];
    return `<div style="border-radius:16px;padding:15px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:${bg};border:1px solid ${border}">
      <span style="width:30px;height:30px;border-radius:999px;background:${fg}22;display:flex;align-items:center;justify-content:center;flex:none"><span style="width:8px;height:8px;border-radius:999px;background:${fg}"></span></span>
      <span style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:4px"><span style="font-size:12.5px;font-weight:700;color:${fg}">${esc(p.call.title)}</span><span style="font-size:11.5px;line-height:1.55;color:#C9CAD0">${esc(p.call.body)}</span></span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">${(p.call.actions || []).map((a) => `<a href="${esc(a.href)}" style="height:36px;box-sizing:border-box;border-radius:9px;display:flex;align-items:center;padding:0 14px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;text-decoration:none;${a.primary ? 'background:#E8442E;color:#fff;border:1px solid #E8442E' : 'background:#212125;color:#fff;border:1px solid #3A3A40'}">${esc(a.label)}</a>`).join('')}</span></div>`;
  })() : '';
  return `<div style="height:100%;overflow:auto">
    <div style="position:sticky;top:0;z-index:3;height:62px;box-sizing:border-box;background:#0D0D0F;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px">
      <span style="display:flex;align-items:center;gap:7px;font-size:12px;min-width:0">${p.crumbs.map(([l, h], i) => `${i ? '<span style="color:#3A3A40">›</span>' : ''}${h ? `<a href="${h}" style="color:#6B6B72;font-weight:500">${esc(l)}</a>` : `<span style="color:#fff;font-weight:700">${esc(l)}</span>`}`).join('')}</span>
      <span style="flex:1"></span>
      ${p.pill ? `<span style="display:flex;align-items:center;gap:7px;height:30px;box-sizing:border-box;padding:0 11px;border-radius:8px;background:${pf}14;border:1px solid ${pf}40"><span style="width:6px;height:6px;border-radius:999px;background:${pf}"></span><span style="font-size:11px;font-weight:700;color:${pf}">${esc(p.pill[0])}</span></span>` : ''}
    </div>
    <div style="padding:20px 22px 44px;display:flex;flex-direction:column;gap:14px;max-width:1180px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:14px">
        <span style="width:54px;height:54px;border-radius:14px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:none">${esc(p.initials)}</span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
          <span style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><span style="font-size:18px;font-weight:700">${esc(p.name)}</span>${p.tag ? `<span style="font-size:9px;letter-spacing:.08em;font-weight:700;border-radius:5px;padding:3px 7px;color:${TONES[p.tag[1]][0]};background:${TONES[p.tag[1]][0]}1F">${esc(p.tag[0])}</span>` : ''}</span>
          <span style="font-size:11.5px;line-height:1.45;color:#9A9CA3">${p.sub || ''}</span></span>
        ${p.rating != null ? `<span style="flex:none;text-align:right"><span style="display:block;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">RATING</span><span class="num" style="display:block;font-size:19px;font-weight:700;margin-top:4px">${esc(p.rating)}</span></span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">${p.tiles.map((t) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${esc(t.label)}</span><span class="num" style="font-size:21px;font-weight:700;color:${t.color || '#fff'}">${esc(t.value)}</span><span style="font-size:10px;color:${t.subColor || '#9A9CA3'}">${esc(t.sub || '')}</span></div>`).join('')}</div>
      ${call}
      <div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px">
        <div style="flex:999 1 480px;min-width:0;display:flex;flex-direction:column;gap:14px">${p.sections.map(sec).join('')}</div>
        ${p.side ? `<div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:14px">${p.side.map(sec).join('')}</div>` : ''}
      </div>
    </div></div>`;
}

// the shop's day, in the shop's timezone, as the instants the database compares
export function shopDay(offsetDays = 0) {
  const now = new Date();
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });   // YYYY-MM-DD
  const off = Date.parse(now.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' })) - Date.parse(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const start = Date.parse(ymd + 'T00:00:00Z') - off + offsetDays * 86400000;
  return { ymd: new Date(start + off).toISOString().slice(0, 10), from: new Date(start).toISOString(), to: new Date(start + 86400000).toISOString(), off };
}
// minutes since the shop's midnight, for an instant
export const shopMin = (iso, off) => { const d = new Date(Date.parse(iso) + off); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const CHAIR_TINTS = ['#E8442E', '#5B8DEF', '#4ADE80', '#E8A100', '#A78BFA'];
export const stars = (n) => `<span style="letter-spacing:1px"><span style="color:#E8A100">${'★'.repeat(n)}</span><span style="color:#3A3A40">${'★'.repeat(5 - n)}</span></span>`;

// "Downloaded" (§6): a CSV with a BOM, so Excel opens the French and Arabic names right
export function csv(name, cols, rows) {
  const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const body = [cols.map((c) => cell(c[0])).join(',')].concat(rows.map((r) => cols.map((c) => cell(c[1](r))).join(','))).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  a.download = `sterncut-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
