/* Issue #3: SVG原稿から配信用素材を生成する。npm install --no-save --package-lock=false sharp */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = 'design-system/yoyakuru/assets';
const C = { ink:'#164E63', primary:'#0E7490', cyan:'#0891B2', green:'#059669', pale:'#ECFEFF', border:'#A5F3FC', muted:'#475569' };
function write(p, data) { const f=path.join(ROOT,p); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,data); }
function svg(w,h,body,label='') { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"${label?` aria-label="${label}"`:''}>${body}</svg>`; }
function rect(x,y,w,h,fill,rx=0,stroke='none') { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`; }
function text(x,y,s,size=22,color=C.ink,weight=400) { return `<text x="${x}" y="${y}" font-family="Noto Sans CJK JP,Noto Sans JP,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${s}</text>`; }
function line(x1,y1,x2,y2,color=C.border) { return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}"/>`; }
// カレンダー（予約）、吹き出し（対話）、チェック（受付）を一つの輪郭にする。
function mark(white=false) { return `<g fill="none" stroke="${white?'#FFFFFF':C.primary}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M30 29H70Q85 29 85 44V69Q85 78 79 82L81 94L66 87H30Q15 87 15 72V44Q15 29 30 29Z"/><path d="M35 17V34M65 17V34"/></g><path d="M34 57L46 69L69 46" fill="none" stroke="${white?'#FFFFFF':C.green}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`; }
const wordmarkRaw=fs.readFileSync(path.join(ROOT,SOURCE,'wordmark.svg'),'utf8');
const wordmark=wordmarkRaw.match(/<g[\s\S]*<\/g>/)[0];
function logo(x=0,y=0,w=400,white=false) {return `<g transform="translate(${x} ${y}) scale(${w/400})">${mark(white)}<g transform="translate(112 32) scale(0.193)" fill="${white?'#FFFFFF':C.ink}">${wordmark.replace('fill="#000000"','fill="inherit"')}</g></g>`;}
function chip(x,y,w,label,color=C.primary){return rect(x,y,w,36,'#FFFFFF',18,C.border)+text(x+16,y+25,label,17,color,700);}
function dashboard(){
 let s=rect(0,0,704,420,'#FFFFFF',18,'#D6E8EE')+rect(0,0,704,55,C.primary,18)+rect(0,32,704,23,C.primary)+logo(16,7,155,true)+text(480,34,'こもれび整体院',17,'#FFFFFF',700);
 s+=text(26,95,'予約台帳',25,C.ink,700)+text(26,126,'11月12日（木）',17,C.muted)+chip(500,77,174,'電話・Web・チャット');
 const xs=[112,298,484];
 ['スタッフA','スタッフB','スタッフC'].forEach((v,i)=>s+=text(xs[i]+20,163,v,16,C.ink,700));
 [190,244,298,352,405].forEach((y,i)=>{s+=line(85,y,680,y,'#E2EDF0');if(i<4)s+=text(22,y+27,`${10+i}:00`,15,C.muted);});
 xs.forEach(x=>s+=`<path d="M${x-12} 175V405" stroke="#E2EDF0"/>`);
 [[112,199,'山田 花子 様','Web予約','#E0F2FE'],[298,252,'鈴木 太郎 様','AI電話','#D1FAE5'],[484,199,'佐藤 美咲 様','チャット','#CFFAFE'],[112,310,'田中 一郎 様','AI電話','#D1FAE5']].forEach(([x,y,name,route,color])=>{s+=rect(x,y,169,48,color,7)+text(x+12,y+20,name,15,C.ink,700)+text(x+12,y+39,route,13,C.muted);});
 return s;
}
function phone(){
 let s=rect(0,0,260,494,C.ink,34)+rect(8,8,244,478,'#FFFFFF',28)+rect(94,16,72,6,C.ink,3);
 s+=text(27,64,'こもれび整体院',21,C.ink,700)+text(27,89,'ご予約',15,C.muted)+line(26,104,234,104);
 s+=text(27,134,'日時を選ぶ',19,C.ink,700)+text(27,163,'11月12日（木）',16,C.muted);
 ['10:00','11:00','13:00','14:00','15:00','16:00'].forEach((v,i)=>{const x=26+i%2*109,y=181+Math.floor(i/2)*49;const selected=i===2;s+=rect(x,y,99,39,selected?C.primary:'#FFFFFF',8,selected?C.primary:'#C4DCE4')+text(x+21,y+26,v,17,selected?'#FFFFFF':C.ink,700);});
 s+=rect(26,343,208,46,C.primary,10)+text(72,374,'次へ進む',18,'#FFFFFF',700);
 s+=rect(26,408,208,49,C.pale,10)+text(44,439,'チャットで相談する',16,C.primary,700);
 return s;
}
async function png(source,target,w,h){let img=sharp(Buffer.from(source)).resize(w,h);if(!target.endsWith('logo-email.png'))img=img.flatten({background:'#FFFFFF'});await img.png({compressionLevel:9}).toFile(path.join(ROOT,target));}
async function main(){
 const markSvg=svg(100,100,mark(),'ヨヤクル');
 const logoSvg=svg(400,110,logo(),'ヨヤクル');
 for(const [p,s] of [['frontend/public/brand/mark.svg',markSvg],['backend/apps/core/static/core/brand/mark.svg',markSvg],['frontend/public/brand/logo.svg',logoSvg],['frontend/public/brand/logo-white.svg',svg(400,110,logo(0,0,400,true),'ヨヤクル')],['frontend/src/app/icon.svg',svg(100,100,rect(0,0,100,100,'#FFFFFF',20)+mark(),'ヨヤクル')]])write(p,s);
 for(const p of ['frontend/public/brand/logo-email.png','frontend/src/app/apple-icon.png','frontend/public/icons/icon-192.png','frontend/public/icons/icon-512.png','frontend/src/app/favicon.ico','frontend/public/og/default.png','frontend/public/og/store-base.png','frontend/public/lp/hero-pc.png','frontend/public/lp/hero-sp.png'])write(p,'');
 await png(logoSvg,'frontend/public/brand/logo-email.png',480,132);
 const appIcon=svg(100,100,rect(0,0,100,100,'#FFFFFF')+`<g transform="translate(7 4) scale(.86)">${mark()}</g>`);
 for(const [p,size] of [['frontend/src/app/apple-icon.png',180],['frontend/public/icons/icon-192.png',192],['frontend/public/icons/icon-512.png',512]])await png(appIcon,p,size,size);
 // ICO directory: PNG frames are supported by modern browsers and Windows.
 const frames=await Promise.all([16,32,48].map(size=>sharp(Buffer.from(appIcon)).resize(size,size).png().toBuffer()));
 const header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);let off=header.length;
 frames.forEach((b,i)=>{let p=6+i*16;header[p]=[16,32,48][i];header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(b.length,p+8);header.writeUInt32LE(off,p+12);off+=b.length;});
 write('frontend/src/app/favicon.ico',Buffer.concat([header,...frames]));
 const og=svg(1200,630,rect(0,0,1200,630,C.pale)+rect(26,26,1148,578,'#FFFFFF',28)+rect(72,74,6,72,C.green,3)+logo(96,60,310)+text(76,279,'施術に集中。',66,C.ink,700)+text(76,367,'予約受付は、ヨヤクル。',66,C.ink,700)+text(80,438,'AI電話・Web・チャットを、ひとつの予約台帳へ。',27,C.muted)+chip(80,498,150,'AI電話受付')+chip(248,498,150,'Web予約')+chip(416,498,180,'チャット予約')+`<g transform="translate(870 175) scale(2.5)">${mark()}</g>`,'ヨヤクル AI電話・Web・チャット予約');
 const base=svg(1200,630,rect(0,0,1200,630,C.pale)+rect(40,40,1120,550,'#FFFFFF',24)+rect(76,80,64,5,C.green,2)+text(76,139,'オンライン予約',28,C.primary,700)+logo(76,468,230)+text(78,565,'ご希望の日時を選んで、ご予約いただけます。',22,C.muted)+`<g opacity=".06" transform="translate(890 70) scale(2.1)">${mark()}</g>`,'店舗予約ページ用OGP下地');
 const pc=svg(920,840,rect(0,0,920,840,C.pale,32)+`<circle cx="770" cy="620" r="210" fill="#D1FAE5"/>`+text(48,76,'予約の入口を、ひとつに。',32,C.ink,700)+text(48,113,'電話も、Webも、チャットも。',21,C.muted)+`<g transform="translate(42 165)">${dashboard()}</g><g transform="translate(610 284)">${phone()}</g>`+rect(56,634,478,95,'#FFFFFF',16,C.border)+text(80,671,'AI電話で受け付けた予約も',23,C.ink,700)+text(80,705,'同じ台帳で確認できます。',23,C.ink,700)+text(48,804,'画面イメージ / 店舗・予約情報はすべて架空です',16,C.muted),'ヨヤクルの予約台帳とWeb予約の画面イメージ');
 const sp=svg(654,440,rect(0,0,654,440,C.pale,24)+text(28,45,'予約受付を、ひとつに。',26,C.ink,700)+`<g transform="translate(24 82) scale(.64)">${dashboard()}</g><g transform="translate(470 78) scale(.64)">${phone()}</g>`+text(28,407,'画面イメージ / 架空の店舗・予約情報',15,C.muted),'予約台帳とWeb予約の画面イメージ');
 for(const [name,source,target,w,h] of [['og-default',og,'frontend/public/og/default.png',1200,630],['og-store-base',base,'frontend/public/og/store-base.png',1200,630],['hero-pc',pc,'frontend/public/lp/hero-pc.png',920,840],['hero-sp',sp,'frontend/public/lp/hero-sp.png',654,440]]){write(`${SOURCE}/${name}.svg`,source);await png(source,target,w,h);}
 console.log('ロゴ・アイコン・OGP・LP素材を生成しました。');
}
main().catch(e=>{console.error(e);process.exit(1);});
