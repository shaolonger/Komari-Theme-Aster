import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function checkLuminousSearch({ cdp, waitUntil, failGate, width, fits, captureScreenshot }) {
  const field = ".luminous-search input";
  const key = async (name, code) => {
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
  };
  const click = async selector => {
    await cdp.value(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    const point = await cdp.value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    failGate(point.hit, `Search control cannot be clicked: ${selector}`);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const type = async text => {
    await cdp.value(`document.querySelector('${field}').focus()`);
    await cdp.call("Input.insertText", { text });
  };
  const count = async n => {
    await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length===${n} && document.querySelector('.luminous-search-count')?.textContent==='${n} 台'`, 4000);
  };
  const clear = async () => {
    if (await cdp.value("!!document.querySelector('.luminous-search-clear')")) await click(".luminous-search-clear");
    await waitUntil(cdp, "document.querySelectorAll('.home-node-card-slot').length===15", 4000);
  };
  const paste = async text => {
    await cdp.value(`(()=>{const i=document.querySelector('${field}');i.focus();const clipboardData=new DataTransfer();clipboardData.setData('text',${JSON.stringify(text)});i.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));})()`);
  };
  const shot = async name => {
    const base = process.env.BROWSER_LUMINOUS_SCREENSHOT_BASE;
    if (!base) return;
    mkdirSync(dirname(base), { recursive: true });
    await cdp.value("window.scrollTo(0,0)");
    await captureScreenshot(cdp, `${base}-${name}.png`);
  };

  await type("洛杉矶 core");
  await count(0);
  await clear();
  await type("洛杉矶 edge,东京 core");
  await count(4);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search>.luminous-search-chip').length===1 && document.querySelector('.luminous-search input').value==='东京 core'"), "Comma must commit only the completed group");
  await key("Enter", 13);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===2 && document.querySelector('.luminous-search input').value===''"), "Enter did not commit the live draft");
  await type("洛杉矶 EDGE");
  await key("Enter", 13);
  await count(4);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===2"), "Duplicate groups were not normalized");
  await clear();
  await type("洛杉矶 xxxx");
  await cdp.value(`(()=>{const i=document.querySelector('${field}');i.setSelectionRange(i.value.indexOf('xxxx'),i.value.length)})()`);
  await paste("Edge\n东京 Core");
  await count(4);
  await clear();
  await paste("洛杉矶 Edge\r\n东京 Core，node-14\n192.0.2.5\n2001:db8::7\n洛杉矶 EDGE\n\n");
  await count(7);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===5 && document.querySelector('.luminous-search input').value===''"), "Multiline names/IPs lost terms, spaces or deduplication");
  await shot("search-batch");
  await clear();
  await type("192.0.2.");
  await count(15);
  await clear();
  await type("production");
  await count(5);
  await clear();
  await type("洛杉矶,洛杉矶 edge");
  await key("Enter", 13);
  await count(2);
  await clear();

  await type("node-14,zz-no-such-vps");
  await key("Enter", 13);
  await count(1);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>[data-unmatched=true]').length===1"), "Unmatched token needs an individual warning");
  await click('.luminous-search-all [aria-label="修改搜索条件 zz-no-such-vps"]');
  await type("node-13");
  await key("Enter", 13);
  await count(2);
  await key("Backspace", 8);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===2 && document.querySelector('.luminous-search-all>[data-selected=true]')!==null"), "First Backspace must select, not delete, the last token");
  await key("Backspace", 8);
  await count(1);
  await type("node-12");
  await count(2);
  await click('.luminous-search-all [aria-label="删除搜索条件 node-14"]');
  await count(1);
  failGate(await cdp.value("document.querySelector('.luminous-search input').value==='node-12'"), "Deleting a token lost the uncommitted draft");
  await key("Enter", 13);
  await clear();

  // A composition confirmation must not commit a token or change the filter early.
  await cdp.value(`(()=>{const i=document.querySelector('${field}');i.focus();i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'东京');i.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'东京'}));i.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true}));})()`);
  failGate(await cdp.value("document.querySelectorAll('.server-card').length===15 && document.querySelectorAll('.luminous-search>.luminous-search-chip').length===0"), "IME Enter prematurely committed a condition");
  await cdp.value(`document.querySelector('${field}').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'东京'}))`);
  await count(2);
  await key("Enter", 13);
  failGate(await cdp.value("document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===1"), "IME text was lost after confirmation");
  await key("Escape", 27);
  failGate(await cdp.value("document.querySelector('.luminous-search-panel')===null"), "Escape did not dismiss search details");
  await clear();

  await type("洛杉矶 edge,东京 core");
  await key("Enter", 13);
  const region = async value => {
    await cdp.value(`(()=>{const s=document.querySelector('[aria-label="光域未来地区筛选"]');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await cdp.value(`document.querySelector('${field}').focus()`);
  };
  await region("HK");
  await count(0);
  failGate(await cdp.value("document.querySelector('.luminous-search-result').textContent.includes('另有 4 台被筛选隐藏') && !document.querySelector('.luminous-search-all>[data-unmatched=true]')"), "Filtered-out nodes must not be reported as unmatched search terms");
  await region("US");
  await count(2);
  await region("");
  await count(4);
  await cdp.value("document.querySelector('.luminous-status-filters button:nth-child(2)').click()");
  // React may commit the URL-backed filter after this evaluation returns.
  await count(3);
  failGate(await cdp.value("document.querySelectorAll('.server-card.is-offline').length===0"), "Multi-search bypassed the online filter");
  await cdp.value(`document.querySelector('${field}').focus()`);
  failGate(await cdp.value("document.querySelector('.luminous-search-result').textContent.includes('当前筛选下')"), "Search omitted the current filter context");
  await cdp.value("document.querySelector('.luminous-status-filters button').click()");
  await count(4);
  for (const [mode, selector] of [["compact", ".compact-node-card"], ["large", ".server-card"], ["list", ".node-list-body .node-list-row"], ["standard", ".server-card"]]) {
    await cdp.value(`(()=>{const s=document.querySelector('.luminous-view-switch select');s.value=${JSON.stringify(mode)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitUntil(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length===4 && document.querySelector('.luminous-search-count').textContent==='4 台'`, 6000);
  }
  await clear();
  await paste("node-0,node-2,node-4,node-6,node-8,node-14");
  await count(6);
  for (const w of [1920, 1024, 390, 320]) {
    await width(w);
    await fits(`multi-search ${w}`);
    await waitUntil(cdp, "(()=>{const r=document.querySelector('.luminous-home-search').getBoundingClientRect(),i=document.querySelector('.luminous-search input').getBoundingClientRect();return i.width>=55 && i.right<=r.right})()", 3000);
    failGate(await cdp.value("document.querySelector('.luminous-home-heading').getBoundingClientRect().height<=46"), "Search tokens expanded the reference heading height");
    await cdp.value(`document.querySelector('${field}').blur()`);
    await click(".luminous-search-more");
    await waitUntil(cdp, "document.querySelectorAll('.luminous-search-all>.luminous-search-chip').length===6", 3000);
    await fits(`expanded search ${w}`);
    if (w === 1920 || w === 390) await shot(`search-${w}`);
    await cdp.value(`document.querySelector('${field}').focus()`);
    await key("Escape", 27);
  }
  await clear();
  await paste("very-long-vps-hostname-without-any-matches.example.net,node-14");
  await count(1);
  for (const w of [390, 320]) {
    await width(w);
    await fits(`long search token ${w}`);
    failGate(await cdp.value("(()=>{const r=document.querySelector('.luminous-search').getBoundingClientRect(),i=document.querySelector('.luminous-search input').getBoundingClientRect(),b=document.querySelector('.luminous-search-clear').getBoundingClientRect();return i.width>=55 && b.right<=r.right})()"), "Long hostname pushed search controls out of the field");
  }
  await width(2048);
  await clear();
  await key("Escape", 27);
  return "OR groups, AND words, IME, multiline paste, IPv4/IPv6, deduplication, edits/deletion, filter context, four views, 320–1920px";
}
