// The page's only stylesheet, inlined so the first paint costs no extra round
// trip. Values are README §8's light surfaces, measured off QL-03/QL-08/QL-09.
export const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#EBE8E1}
body{color:#111;font:400 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid #E8442E;outline-offset:2px}
p,h1{margin:0}
.wrap{max-width:430px;margin:0 auto;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.page{flex:1;padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.page.loose{padding-top:26px;gap:14px}
.serif{font-family:"Playfair Display",Georgia,"Times New Roman",serif;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
h1{font-size:25px;line-height:1.1}
.h24{font-size:24px}
.h26{font-size:26px;line-height:1.12}
.meta{font-size:12px;color:#8A8A85;margin-top:5px}
.lede{font-size:13px;line-height:1.55;color:#5C5C58;margin-top:10px;text-wrap:pretty}
.brand{display:flex;align-items:center;gap:9px}
.logo{width:24px;height:24px;border-radius:7px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none}
.wordmark{flex:1;font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase}
.live{display:flex;align-items:center;gap:6px;background:rgba(232,68,46,.1);border-radius:999px;padding:5px 10px;font-size:9.5px;font-weight:800;letter-spacing:.12em;color:#E8442E}
.live i{width:6px;height:6px;border-radius:999px;background:#E8442E}
.wait{background:#101010;color:#fff;border-radius:22px;padding:18px;display:flex;align-items:center;gap:15px}
.now{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.12em;color:rgba(255,255,255,.5)}
.big{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:26px;line-height:1.1;font-variant-numeric:tabular-nums}
.vr{width:1px;align-self:stretch;background:rgba(255,255,255,.12)}
.wait p{flex:1;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.65);text-wrap:pretty}
.label{font-size:10.5px;font-weight:700;letter-spacing:.15em;color:#8A8A85}
.chairs{display:flex;gap:9px;overflow-x:auto;margin:-4px -20px;padding:4px 20px;scrollbar-width:none}
.chair{flex:1 0 88px;background:#fff;border-radius:16px;padding:12px 6px;display:flex;flex-direction:column;align-items:center;gap:5px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.chair.on{outline:2px solid #101010;outline-offset:-2px}
.chair.dim{opacity:.55}
.av{width:34px;height:34px;border-radius:999px;background:#F2F0EB;color:#8A8A85;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none}
.chair.on .av{background:rgba(232,68,46,.12);color:#E8442E}
.chair b{font-size:12px;font-weight:700}
.chair small{font-size:10px;color:#8A8A85;font-variant-numeric:tabular-nums}
.chair small.soon{color:#16A34A;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative;border-radius:999px;background:#fff;color:#5C5C58;font-size:12px;font-weight:600;padding:10px 16px}
.chip::after{content:"";position:absolute;inset:-4px 0}
.chip.on{background:#101010;color:#fff}
.note{display:flex;align-items:flex-start;gap:9px;background:#fff;border-radius:16px;padding:13px 15px;box-shadow:0 4px 12px rgba(0,0,0,.04);font-size:12px;line-height:1.5;color:#5C5C58;text-wrap:pretty}
.note svg,.tip svg{flex:none;margin-top:1px}
.dock{position:sticky;bottom:0;padding:12px 20px calc(30px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;background:#EBE8E1;box-shadow:0 -10px 24px rgba(235,232,225,.9)}
.cta{min-height:54px;border-radius:999px;background:#101010;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;letter-spacing:.08em;text-align:center;padding:0 16px}
.cta:active{background:#000}
.fine{text-align:center;font-size:11px;line-height:1.5;color:#8A8A85}
.banner{display:flex;align-items:center;gap:11px;background:rgba(74,222,128,.14);border:1px solid rgba(22,163,74,.3);border-radius:18px;padding:13px 15px}
.tick{width:30px;height:30px;border-radius:999px;background:rgba(22,163,74,.2);display:flex;align-items:center;justify-content:center;flex:none}
.banner b{display:block;font-size:12.5px;font-weight:700;color:#15803D}
.banner b+span{display:block;font-size:11px;color:#5C5C58;margin-top:2px}
.rows{display:flex;flex-direction:column;gap:9px}
.row{display:flex;align-items:center;gap:12px;background:#fff;border-radius:18px;padding:13px 15px;box-shadow:0 4px 12px rgba(0,0,0,.05);min-height:64px}
.row.dim{opacity:.55}
.row .av{width:38px;height:38px}
.who{flex:1;min-width:0}
.who b{display:block;font-size:13.5px;font-weight:700}
.row.dim .who b{font-weight:600}
.who span{display:block;font-size:11px;color:#8A8A85;margin-top:2px}
.when{text-align:right;flex:none}
.when b{display:block;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.when b.soon{color:#16A34A}
.when span{display:block;font-size:10px;color:#8A8A85;margin-top:1px;font-variant-numeric:tabular-nums}
.nt{font-size:11px;font-weight:700;color:#8A8A85;flex:none}
.tip{display:flex;align-items:center;gap:10px;background:#E3E0D8;border-radius:16px;padding:12px 15px;font-size:11.5px;line-height:1.45;color:#5C5C58}
.tip strong{color:#111;font-family:ui-monospace,Menlo,monospace}
.pause{width:64px;height:64px;border-radius:999px;background:rgba(232,161,0,.18);display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:20px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.card .eyebrow{color:#8A8A85;letter-spacing:.14em}
.fact{display:flex;align-items:center;gap:10px;font-size:12.5px}
.fact i{width:19px;height:19px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex:none;background:rgba(74,222,128,.2)}
.fact.no{color:#8A8A85}
.fact.no i{background:rgba(0,0,0,.07)}

.sheetpage{min-height:100vh;min-height:100dvh;background:#64625E;display:flex;flex-direction:column;justify-content:flex-end}
.sheet{width:100%;max-width:430px;margin:0 auto;background:#F2F0EB;border-radius:28px 28px 0 0;padding:12px 24px calc(34px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px;box-shadow:0 -12px 40px rgba(0,0,0,.3)}
.grab{align-self:center;width:40px;height:4px;border-radius:2px;background:#D8D4CA}
.sheethead{display:flex;align-items:center}
.sheethead h1{flex:1;text-align:center;font-size:18px;letter-spacing:.03em}
.slot{width:44px;height:44px;margin:-6px;display:flex;align-items:center;justify-content:center;flex:none}
.mini{display:flex;align-items:center;gap:12px;background:#101010;color:#fff;border-radius:18px;padding:14px 16px}
.mini .serif{font-size:24px;letter-spacing:0;flex:none}
.mini .vr{background:rgba(255,255,255,.14)}
.mini .grow{font-size:12px;line-height:1.5;color:rgba(255,255,255,.65)}
.field{display:flex;flex-direction:column;gap:8px}
.input{height:54px;border:0;border-radius:16px;background:#fff;padding:0 18px;font:600 15px Inter,system-ui,sans-serif;color:#111;box-shadow:0 4px 12px rgba(0,0,0,.05);width:100%;min-width:0;font-variant-numeric:tabular-nums}
.input:focus{outline:2px solid #E8442E;outline-offset:-2px}
.hint{font-size:11px;color:#8A8A85;padding-left:2px}
.phone{display:flex;gap:9px}
.cc{height:54px;border-radius:16px;background:#fff;display:flex;align-items:center;padding:0 15px;font-size:15px;font-weight:600;color:#5C5C58;flex:none;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.err{font-size:12px;line-height:1.5;font-weight:600;color:#D23B3B}
.textedto{font-size:13px;line-height:1.5;color:#5C5C58;text-align:center;text-wrap:pretty}
.textedto strong{color:#111}
.digits{position:relative;display:flex;justify-content:center;gap:11px}
.digits input{height:74px;width:100%;max-width:290px;border:0;border-radius:18px;background:#fff;text-align:center;font:700 30px "Playfair Display",Georgia,serif;letter-spacing:.6em;box-shadow:0 4px 12px rgba(0,0,0,.06)}
.digits span{display:none}
.js .digits input{position:absolute;inset:0;max-width:none;opacity:0}
.js .digits span{display:flex;width:62px;height:74px;border-radius:18px;background:#fff;align-items:center;justify-content:center;font:700 30px "Playfair Display",Georgia,serif;box-shadow:0 4px 12px rgba(0,0,0,.06)}
.js .digits span.on{outline:2px solid #E8442E;outline-offset:-2px}
.resend{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;font-size:12px;color:#8A8A85;font-variant-numeric:tabular-nums}
.resend button{font-size:12px;font-weight:700;color:#E8442E;padding:12px}
.held{background:#fff;border-radius:18px;padding:15px 17px;display:flex;flex-direction:column;gap:10px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.held .eyebrow,.card .eyebrow{color:#8A8A85}
.heldrow{display:flex;align-items:flex-end;justify-content:space-between}
.no24{display:block;font-size:24px;line-height:1;letter-spacing:0}
.sub{display:block;font-size:11.5px;color:#8A8A85;margin-top:4px}
.count{display:block;font-size:16px;font-weight:800;color:#E8442E;margin-top:4px;font-variant-numeric:tabular-nums;text-align:right}
button.cta{width:100%;border:0;cursor:pointer}
.link{display:block;width:100%;text-align:center;font-size:12.5px;font-weight:600;color:#E8442E;padding:12px 0}
.ghost{width:100%;height:50px;border-radius:999px;border:1.5px solid rgba(232,68,46,.4);color:#E8442E;font-size:12.5px;font-weight:700;letter-spacing:.05em}
.inrow{display:flex;align-items:center;gap:11px}
.okc{width:40px;height:40px;border-radius:999px;background:rgba(74,222,128,.2);display:flex;align-items:center;justify-content:center;flex:none}
.h20{font-size:20px}
.ticket{background:#101010;color:#fff;border-radius:24px;padding:22px 20px;display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center}
.t52{font-size:52px;line-height:1;letter-spacing:0}
.tsub{font-size:13px;color:rgba(255,255,255,.6)}
.stats{display:flex;gap:22px;justify-content:center;width:100%;margin-top:12px;border-top:1px solid rgba(255,255,255,.1);padding-top:14px}
.stats>span{display:flex;flex-direction:column;gap:2px}
.stats b{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.stats em{font-style:normal;font-size:12px;font-weight:400;color:rgba(255,255,255,.5)}
.stats small{font-size:10px;letter-spacing:.1em;color:rgba(255,255,255,.5)}
.stats i{width:1px;background:rgba(255,255,255,.1)}
.texted{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;line-height:1.5;color:#5C5C58;text-wrap:pretty}
.texted strong{color:#111}
.ico{width:26px;height:26px;border-radius:8px;background:rgba(232,68,46,.1);display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px}
.av.hot{background:rgba(232,68,46,.1);color:#E8442E}
.av.me{background:#101010;color:#fff}
.row.me{outline:2px solid #101010;outline-offset:-2px}
.badge{font-size:9.5px;letter-spacing:.1em;font-weight:800;color:#fff;background:#E8442E;border-radius:999px;padding:4px 9px;flex:none}
.coral{font-size:12px;font-weight:700;color:#E8442E;flex:none;font-variant-numeric:tabular-nums}
.held10{background:#101010;color:#fff;border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:14px}
.held10 .r1{display:flex;align-items:center;gap:13px}
.held10 .r1 .serif{font-size:34px;line-height:1;letter-spacing:0;flex:none}
.held10 .vr{background:rgba(255,255,255,.12)}
.held10 .r1 b{display:block;font-size:13px}
.held10 .r1 small{display:block;font-size:11.5px;color:rgba(255,255,255,.6);margin-top:3px}
.stats.start{justify-content:flex-start;margin-top:0;border-top-color:rgba(255,255,255,.12)}
.offer{display:flex;align-items:flex-start;gap:11px;background:#fff;border-radius:20px;padding:16px 18px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.offer .ico{width:30px;height:30px;border-radius:9px}
.offer b{display:block;font-size:13px}
.offer p{font-size:12px;line-height:1.5;color:#5C5C58;margin-top:4px;text-wrap:pretty}
.grow{flex:1;min-width:0}

.alarm{display:flex;align-items:center;gap:9px;background:rgba(232,68,46,.1);border-radius:14px;padding:12px 14px;font-size:12.5px;line-height:1.45;font-weight:600;color:#B5301F;text-wrap:pretty}
.alarm svg,.amberbox svg,.amberbar svg{flex:none}
.js .digits.bad span{color:#E8442E;outline:2px solid #E8442E;outline-offset:-2px}
.cta svg{flex:none;margin-right:9px}
.cta.hot{background:#E8442E}
.cta.hot:active{background:#C33421}
.lockc{width:64px;height:64px;border-radius:999px;background:rgba(0,0,0,.07);display:flex;align-items:center;justify-content:center}
.lbl{display:block;font-size:11.5px;color:#8A8A85}
.no26{display:block;font-size:26px;line-height:1;letter-spacing:0;margin-top:4px}
.heldrow .r{text-align:right}
.w20{display:block;font-size:20px;font-weight:800;margin-top:5px;font-variant-numeric:tabular-nums}
.cardnote{font-size:12px;line-height:1.5;color:#5C5C58;border-top:1px solid #EFECE4;padding-top:12px;text-wrap:pretty}
.cardtext{font-size:12.5px;line-height:1.5;color:#5C5C58;text-wrap:pretty}
.amberbox{display:flex;align-items:flex-start;gap:11px;background:rgba(232,161,0,.13);border-radius:18px;padding:14px 16px;font-size:12px;line-height:1.5;color:#7A5400;text-wrap:pretty}
.amberbox svg{margin-top:1px}
.amberbar{display:flex;align-items:center;gap:10px;background:rgba(232,161,0,.16);border-radius:16px;padding:13px 15px;font-size:12.5px;line-height:1.45;font-weight:600;color:#7A5400;text-wrap:pretty}
.stats b.dimnum{color:rgba(255,255,255,.4)}
.missed{background:#101010;color:#fff;border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:13px}
.missed .r1{display:flex;align-items:center;gap:13px}
.missed .vr{background:rgba(255,255,255,.12)}
.strike{font-size:34px;line-height:1;letter-spacing:0;color:rgba(255,255,255,.34);text-decoration:line-through;flex:none}
.missed b{display:block;font-size:12.5px}
.missed small{display:block;font-size:11.5px;color:rgba(255,255,255,.55);margin-top:3px}
.missed p{font-size:12px;line-height:1.5;color:rgba(255,255,255,.62);border-top:1px solid rgba(255,255,255,.12);padding-top:13px;text-wrap:pretty}
.kicker{display:block;font-size:10px;font-weight:700;letter-spacing:.16em;color:#8A8A85}
.mt9{margin-top:9px}
.inkcard{background:#101010;color:#fff;border-radius:20px;padding:17px 19px;display:flex;align-items:flex-end;justify-content:space-between}
.inkcard .eyebrow{display:block}
.inkcard .right{text-align:right}
.inkcard b{display:block;font-size:14px;margin-top:5px}
.t28{display:block;font-size:28px;line-height:1.05;letter-spacing:0;margin-top:5px}
.hrow{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:#5C5C58}
.hrow b{color:#111;font-variant-numeric:tabular-nums}
.hrow b.off{color:#8A8A85}
.near{display:flex;align-items:center;gap:12px;background:#fff;border-radius:18px;padding:13px 15px;box-shadow:0 4px 12px rgba(0,0,0,.05)}
.near .pin{width:34px;height:34px;border-radius:999px;background:rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center;flex:none}
.near b{display:block;font-size:12.5px}
.near small{display:block;font-size:11px;color:#8A8A85;margin-top:2px}

body.hot{background:#E8442E;color:#fff}
.hot .dock{background:#E8442E;box-shadow:none}
.kick{display:inline-block;background:rgba(0,0,0,.34);border-radius:999px;padding:5px 11px;font-size:10.5px;font-weight:800;letter-spacing:.2em}
.h46{font-size:46px;line-height:1.02;margin-top:12px}
.holdcard{background:rgba(0,0,0,.34);border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center}
.holdcard .eyebrow{color:#fff;letter-spacing:.16em}
.hold56{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:56px;line-height:1;font-variant-numeric:tabular-nums}
.holdcard p{font-size:12.5px;line-height:1.5;text-wrap:pretty}
.inkrow{background:#101010;border-radius:20px;padding:16px 18px;display:flex;align-items:center;gap:13px}
.inkrow .pin{width:38px;height:38px;border-radius:11px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;flex:none}
.inkrow b{display:block;font-size:13px;color:#fff}
.darkbox{background:rgba(0,0,0,.34);border-radius:16px;padding:12px 15px;font-size:12.5px;line-height:1.5;text-wrap:pretty}
.darkbox strong{font-weight:700}
.cta.white{background:#fff;color:#111}
.cta.white:active{background:#F2F0EB}
.cta.ink{background:#101010;min-height:50px;font-size:12.5px;letter-spacing:.05em}
`;
