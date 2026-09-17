// The page's only stylesheet, inlined so the first paint costs no extra round
// trip. Values are README §8's light surfaces, measured off QL-18 and QL-23 … QL-26.
export const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#EBE8E1}
body{color:#111;font:400 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
body.warm,.warm .dock{background:#F2F0EB}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid #E8442E;outline-offset:2px}
p,h1,h2{margin:0}
.wrap{max-width:430px;margin:0 auto;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.page{flex:1;padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.page.loose{padding-top:22px;gap:14px}
.serif{font-family:"Playfair Display",Georgia,"Times New Roman",serif;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.plain{text-transform:none;letter-spacing:0}
h1{font-size:25px;line-height:1.1}
.h24{font-size:24px}
.h26{font-size:26px;line-height:1.15}
.meta{font-size:12px;color:#8A8A85;margin-top:5px}
.lede{font-size:12.5px;line-height:1.55;color:#5C5C58;margin-top:8px;text-wrap:pretty}
.grow{flex:1;min-width:0}
.brand{display:flex;align-items:center;gap:9px}
.logo{width:24px;height:24px;border-radius:7px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none}
.logo.ink{background:#111}
.wordmark{flex:1;font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase}
.live{display:flex;align-items:center;gap:6px;background:rgba(232,68,46,.1);border-radius:999px;padding:5px 10px;font-size:9.5px;font-weight:800;letter-spacing:.12em;color:#E8442E}
.live i{width:6px;height:6px;border-radius:999px;background:#E8442E}
.live.off{background:rgba(0,0,0,.07);color:#8A8A85}
.live.off i{background:#8A8A85}
.wait{background:#101010;color:#fff;border-radius:22px;padding:18px;display:flex;align-items:center;gap:15px}
.now{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.12em;color:rgba(255,255,255,.5)}
.big{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:26px;line-height:1.1;font-variant-numeric:tabular-nums}
.vr{width:1px;align-self:stretch;background:rgba(255,255,255,.12)}
.wait p{flex:1;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.65);text-wrap:pretty}
.label{font-size:10.5px;font-weight:700;letter-spacing:.15em;color:#8A8A85}
.list{background:#fff;border-radius:18px;padding:4px 14px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.lrow{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.07)}
.lrow:last-child{border-bottom:0}
.lno{font-size:17px;letter-spacing:0;width:54px;white-space:nowrap;flex:none;font-variant-numeric:tabular-nums}
.lrow span{font-size:12px;color:#5C5C58}
.lrow small{font-size:11px;color:#8A8A85;flex:none;font-variant-numeric:tabular-nums}
.lrow small.hot{font-weight:700;color:#E8442E}
.chairs{display:flex;gap:9px;overflow-x:auto;margin:-4px -20px;padding:4px 20px;scrollbar-width:none}
.chair{flex:1 0 88px;background:#fff;border-radius:16px;padding:10px 6px;display:flex;flex-direction:column;align-items:center;gap:5px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.chair.on{outline:2px solid #101010;outline-offset:-2px}
.chair.dim{opacity:.55}
.av{width:34px;height:34px;border-radius:999px;background:#F2F0EB;color:#8A8A85;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none}
.chair.on .av{background:rgba(232,68,46,.12);color:#E8442E}
.chair b{font-size:12px;font-weight:700}
.chair small{font-size:10px;color:#8A8A85;font-variant-numeric:tabular-nums}
.chair small.soon{color:#16A34A;font-weight:600}
.note{display:flex;align-items:flex-start;gap:9px;background:#fff;border-radius:16px;padding:11px 15px;box-shadow:0 4px 12px rgba(0,0,0,.04);font-size:12px;line-height:1.5;color:#5C5C58;text-wrap:pretty}
.note svg,.amber svg{flex:none;margin-top:1px}
.note strong{color:#111}
.dock{position:sticky;bottom:0;padding:12px 20px calc(30px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:9px;background:#EBE8E1;box-shadow:0 -10px 24px rgba(235,232,225,.9)}
.dock.flat{box-shadow:none}
.cta{min-height:54px;border-radius:999px;background:#101010;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;letter-spacing:.08em;text-align:center;padding:0 16px}
.cta:active{background:#000}
button.cta{width:100%}
.textlink{display:block;width:100%;text-align:center;font-size:12px;color:#5C5C58;text-decoration:underline;text-underline-offset:3px;padding:6px 0}
.textlink.muted{color:#8A8A85;font-size:11.5px}
.fine{text-align:center;font-size:11px;line-height:1.5;color:#8A8A85}
.back{display:flex;align-items:center;gap:7px;font-size:12px;color:#8A8A85;min-height:32px}
.fields{display:flex;flex-direction:column;gap:14px}
.field{display:flex;flex-direction:column;gap:8px}
.field .label{font-size:10px;letter-spacing:.14em}
.input{height:54px;border:0;border-radius:14px;background:#fff;padding:0 16px;font:600 15px Inter,system-ui,sans-serif;color:#111;box-shadow:0 4px 12px rgba(0,0,0,.05);width:100%;min-width:0;font-variant-numeric:tabular-nums}
.input:focus{outline:2px solid #E8442E;outline-offset:-2px}
.phone{display:flex;gap:9px}
.cc{height:54px;border-radius:14px;background:#fff;display:flex;align-items:center;padding:0 14px;font-size:14px;font-weight:700;flex:none;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.err{font-size:12px;line-height:1.5;font-weight:600;color:#D23B3B}
.tk{background:#fff;border-radius:24px;padding:22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 6px 18px rgba(0,0,0,.06)}
.tk.unconfirmed{outline:2px dashed rgba(180,83,9,.4);outline-offset:-2px}
.tk.ink{background:#101010;color:#fff;box-shadow:none;gap:16px}
.badge{align-self:flex-start;display:flex;align-items:center;gap:7px;border-radius:999px;padding:6px 12px;font-size:9.5px;font-weight:800;letter-spacing:.12em}
.badge.amber{background:rgba(180,83,9,.1);color:#B45309}
.badge.green{background:rgba(22,163,74,.18);color:#4ADE80}
.badge.grey{background:rgba(0,0,0,.06);color:#8A8A85}
.kicker{display:block;font-size:10px;font-weight:700;letter-spacing:.12em;color:#8A8A85}
.ink .kicker{color:rgba(255,255,255,.5)}
.t52{display:block;font-size:52px;line-height:1.02;letter-spacing:0;margin-top:6px;font-variant-numeric:tabular-nums}
.tsub{display:block;font-size:12.5px;color:#5C5C58;margin-top:6px}
.stats{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.07);border-radius:16px;padding:13px 15px}
.stats>span{display:flex;flex-direction:column;gap:1px;flex:none}
.stats .serif{font-size:20px;letter-spacing:0;font-variant-numeric:tabular-nums;text-transform:none}
.inkbox{background:#101010;border-radius:20px;padding:17px;display:flex;flex-direction:column;gap:11px}
.quote{background:rgba(255,255,255,.08);border-radius:15px;padding:13px 15px;font-size:12.5px;line-height:1.55;color:rgba(255,255,255,.9);overflow-wrap:anywhere}
.amber{display:flex;align-items:flex-start;gap:9px;background:rgba(180,83,9,.08);border-radius:16px;padding:13px 15px;font-size:12px;line-height:1.5;color:#5C5C58;text-wrap:pretty}
.amber strong{color:#111}
.card{background:#fff;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:11px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.card .eyebrow{color:#8A8A85;letter-spacing:.14em}
.card p{font-size:12.5px;line-height:1.55;color:#5C5C58;text-wrap:pretty}
.soft{min-height:44px;border-radius:999px;background:#F2F0EB;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.06em}
.big22{padding:22px;gap:9px}
.big22 h2{font-size:21px;line-height:1.2}
.hours{padding:4px 16px;gap:0}
.hrow{display:flex;align-items:center;padding:11px 0;border-bottom:1px solid rgba(0,0,0,.07);font-size:12px;color:#5C5C58}
.hrow:last-child{border-bottom:0}
.hrow .d{flex:1;font-size:12.5px}
.hrow .d.first{font-weight:700;color:#111}
.hrow .h.off{color:#8A8A85}
.pause{width:64px;height:64px;border-radius:999px;background:rgba(232,161,0,.18);display:flex;align-items:center;justify-content:center}
.fact{display:flex;align-items:center;gap:10px;font-size:12.5px}
.fact i{width:19px;height:19px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex:none;background:rgba(74,222,128,.2)}
.fact.no{color:#8A8A85}
.fact.no i{background:rgba(0,0,0,.07)}
.step{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;line-height:1.5;color:#111;text-wrap:pretty}
.step+.step{border-top:1px solid #EFECE4;padding-top:11px}
.step i{width:22px;height:22px;border-radius:999px;background:rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center;flex:none;font-style:normal;font-size:11px;font-weight:800;color:#5C5C58}
.fine.left{text-align:left}
`;
