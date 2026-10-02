import { useState } from "react";

const templates = [
  { name: "商品标签", title: "手工香薰蜡烛", detail: "雪松与白茶 · 180g", price: "89.00", code: "690 2025 0816", tag: "PRODUCT LABEL", size: "60 × 40 mm" },
  { name: "收纳标签", title: "日常的小物", detail: "文具 / 纸品 / 灵感", price: "01", code: "A PLACE FOR EVERYTHING", tag: "HOME ORGANIZATION", size: "60 × 40 mm" },
  { name: "地址标签", title: "寄给美好的一天", detail: "上海市静安区 · 创意工作室", price: "021", code: "SF 1086 2025 0916", tag: "SHIPPING LABEL", size: "60 × 40 mm" },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

function Barcode({ small = false }: { small?: boolean }) {
  return <svg role="img" aria-label="装饰条码，非可扫描条码" viewBox="0 0 240 38" className={small ? "h-7 w-full" : "h-11 w-full"} preserveAspectRatio="none">{Array.from({ length: 75 }, (_, index) => <rect key={index} x={index * 3.2} y="0" width={index % 5 === 0 ? 2.7 : index % 3 === 0 ? 1.8 : 1} height={index < 3 || index > 71 ? 38 : 33} fill="currentColor" />)}</svg>;
}

export default function App() {
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState(templates[0].title);
  const [detail, setDetail] = useState(templates[0].detail);
  const [price, setPrice] = useState(templates[0].price);
  const [printed, setPrinted] = useState(0);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [platform, setPlatform] = useState("Windows");
  const current = templates[selected];
  function changeTemplate(index: number) {
    setSelected(index); setTitle(templates[index].title); setDetail(templates[index].detail); setPrice(templates[index].price); setPrinted(0);
  }
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-24 max-w-[1320px] items-center justify-between border-b border-border px-6 lg:px-12">
        <a href="#" className="flex items-center gap-3" aria-label="标记首页"><span className="flex h-9 w-9 rotate-[-8deg] items-center justify-center rounded-[7px] bg-primary text-xl font-bold text-white">标</span><span className="text-[22px] font-bold">标记<span className="ml-3 hidden text-[11px] font-medium tracking-[0.14em] text-muted-foreground sm:inline">LABEL STUDIO</span></span></a>
        <nav className="hidden items-center gap-9 text-[13px] md:flex"><a href="#workflow" className="hover:text-primary">产品功能</a><a href="#templates" className="hover:text-primary">标签灵感</a><a href="#help" className="hover:text-primary">使用指南</a></nav>
        <button onClick={() => setDownloadOpen(true)} className="rounded-md border border-border px-5 py-2.5 text-xs font-medium transition hover:border-primary hover:text-primary">下载桌面版 <span className="ml-4">↗</span></button>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1320px] gap-14 px-6 pb-16 pt-14 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 lg:px-12 lg:pb-20 lg:pt-16">
          <div className="flex flex-col items-start pt-3 lg:pt-10">
            <div className="mb-8 flex items-center gap-2.5 text-[11px] tracking-[0.16em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />你的数字标签印刷室 <span className="ml-3 font-mono text-[10px]">EST. 2026</span></div>
            <h1 className="text-[46px] font-semibold leading-[1.32] sm:text-[58px] lg:text-[65px]">小小标签，<br />让好想法<span className="relative text-primary">落纸。<span className="absolute -bottom-2 left-0 h-1 w-full rounded-full bg-primary/20" /></span></h1>
            <p className="mt-8 text-[15px] leading-8 text-muted-foreground">从一张商品价签，到井井有条的日常。<br />设计、排版、打印，把每一份用心变成看得见的标签。</p>
            <div className="mt-9 flex flex-wrap items-center gap-6"><button onClick={() => setDownloadOpen(true)} className="flex items-center gap-8 rounded-md bg-primary px-6 py-4 text-sm font-medium text-white shadow-lg shadow-primary/10 transition hover:bg-[#263fba]">下载桌面版 <span>↓</span></button><a href="#playground" className="text-sm">先试着做一张 <span className="ml-2"><Arrow /></span></a></div>
            <p className="mt-4 text-[10px] tracking-wide text-muted-foreground">桌面端软件概念展示 · 无需注册即可体验网页演示</p>
            <div className="mt-14 flex gap-7 border-t border-border pt-5 text-[11px] text-muted-foreground"><span><span className="mr-2 text-primary">✓</span>所见即所得</span><span><span className="mr-2 text-primary">✓</span>灵活标签排版</span><span><span className="mr-2 text-primary">✓</span>设计到打印</span></div>
          </div>

          <div id="playground" className="scroll-mt-8 overflow-hidden rounded-xl border border-[#d9dcd2] bg-[#edeee7] shadow-[0_12px_32px_-22px_#555944]">
            <div className="flex items-center justify-between border-b border-[#d9dcd2] bg-white/40 px-5 py-4 text-[10px]"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#93a58c]" /> 标签实验台 <span className="ml-2 text-muted-foreground">/ LIVE PLAYGROUND</span></span><span className="font-mono text-muted-foreground">01 — 03</span></div>
            <div className="relative flex min-h-[282px] items-center justify-center overflow-hidden bg-[radial-gradient(#c7cbbd_1px,transparent_1px)] bg-[size:16px_16px] px-12 py-11">
              <div className="absolute left-4 top-4 text-[9px] text-muted-foreground">打印预览 · 100%</div>
              <div className="relative w-full max-w-[325px]">
                <div className="absolute -top-6 flex w-full items-center gap-2 text-[9px] text-muted-foreground"><span>↔</span><span className="h-px flex-1 bg-[#bcc1b1]" /><span className="font-mono">60 mm</span><span className="h-px flex-1 bg-[#bcc1b1]" /><span>↔</span></div>
                <div key={`${selected}-${printed}`} className={`rounded-[3px] bg-[#fffefb] px-7 py-5 text-[#292c26] shadow-[3px_7px_12px_#39412a16] ${printed ? "print-paper motion-safe:animate-[paper-feed_650ms_ease-out]" : ""}`}>
                  <div className="flex items-center justify-between border-b border-[#33372e] pb-2"><span className="text-[9px] font-semibold tracking-[0.17em]">{selected === 0 ? "FORM & FIELD" : selected === 1 ? "A LITTLE ORDER" : "SPECIAL DELIVERY"}</span><span className="text-[8px]">{selected === 0 ? "自然生活系列" : "有序 · 日常"}</span></div>
                  <h2 className="mb-1 mt-4 break-words text-[23px] font-semibold">{title || "你的标签名称"}</h2>
                  <p className="truncate text-[10px] text-[#707268]">{detail}</p>
                  <div className="mb-3 mt-3 flex items-end justify-between"><span className="text-[8px] tracking-[0.1em]">{current.tag}</span><span className="text-xl font-semibold">{selected === 0 ? "¥ " : "NO. "}{price || "0"}</span></div>
                  <Barcode /><p className="mt-1 text-center font-mono text-[8px] tracking-[0.22em]">{current.code}</p>
                </div>
                <span className="absolute -right-9 top-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap font-mono text-[9px] text-muted-foreground">40 mm</span>
              </div>
              <span className="absolute bottom-3 right-4 text-[9px] text-muted-foreground">示意条码 · 不用于扫描</span>
            </div>
            <div className="border-t border-[#d9dcd2] bg-[#f7f8f3] p-5">
              <div className="mb-4 flex gap-2">{templates.map((template, index) => <button key={template.name} onClick={() => changeTemplate(index)} aria-pressed={selected === index} className={`flex-1 rounded-md py-2.5 text-[11px] transition ${selected === index ? "bg-white font-medium text-primary shadow-sm ring-1 ring-[#dcded5]" : "text-muted-foreground hover:bg-white/60"}`}>{template.name}</button>)}</div>
              <div className="grid grid-cols-[1fr_90px] gap-3"><label className="text-[10px] text-muted-foreground">{selected === 0 ? "商品名称" : "标签标题"}<input value={title} maxLength={18} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded border border-border bg-white px-3 py-2 text-xs text-foreground" /></label><label className="text-[10px] text-muted-foreground">{selected === 0 ? "价格 / 元" : "编号"}<input value={price} maxLength={8} onChange={(event) => setPrice(event.target.value)} className="mt-1.5 w-full rounded border border-border bg-white px-3 py-2 text-xs text-foreground" /></label></div>
              <label className="mt-3 block text-[10px] text-muted-foreground">标签描述<input value={detail} maxLength={32} onChange={(event) => setDetail(event.target.value)} className="mt-1.5 w-full rounded border border-border bg-white px-3 py-2 text-xs text-foreground" /></label>
              <div className="mt-4 flex items-center justify-between gap-2"><span role="status" className="text-[9px] text-muted-foreground">{printed ? `✓ 已完成第 ${printed} 次模拟打印` : "修改文字，看看标签的新样子"}</span><button onClick={() => setPrinted(printed + 1)} className="rounded bg-[#292e26] px-4 py-2.5 text-[11px] text-white transition hover:bg-primary">模拟打印 <span className="ml-4">↳</span></button></div>
            </div>
          </div>
        </section>

        <section id="templates" className="border-y border-border bg-[#f0f0e9] px-6 py-14 lg:px-12">
          <div className="mx-auto max-w-[1224px]"><div className="mb-9 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-3 text-[10px] tracking-[0.18em] text-muted-foreground">A LABEL FOR EVERY LITTLE THING</p><h2 className="text-[28px] font-medium">每一种日常，都有自己的标签。</h2></div><a href="#playground" className="text-xs text-muted-foreground hover:text-primary">挑一个模板，开始创作 <span className="ml-3">↗</span></a></div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <button onClick={() => { changeTemplate(0); document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }); }} className="group text-left"><div className="flex h-44 items-center justify-center rounded-lg bg-[#e5e4db] transition group-hover:bg-[#deddd0]"><div className="w-40 rotate-[-7deg] border border-[#c6c7b8] bg-[#fdfbf2] p-4 text-center shadow-md"><p className="text-[8px] tracking-[0.2em]">ROASTED WITH LOVE</p><p className="my-2 font-serif text-2xl">Morning Blend</p><div className="border-t border-[#babcae] pt-2 text-[9px]">晨间拼配 · 咖啡豆</div><p className="mt-2 text-[8px]">250g / MEDIUM ROAST</p></div></div><div className="mt-4 flex justify-between text-xs"><span>让好产品，自带好印象</span><span className="text-muted-foreground">01 ↗</span></div><p className="mt-2 text-[10px] text-muted-foreground">商品包装 / 品牌标签</p></button>
              <button onClick={() => { changeTemplate(1); document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }); }} className="group text-left"><div className="flex h-44 flex-col items-center justify-center gap-3 rounded-lg bg-[#e2e7e3] transition group-hover:bg-[#d9e0da]"><div className="w-44 rotate-[-4deg] rounded-sm bg-[#fcfcf8] px-4 py-3 shadow-md"><div className="flex items-center justify-between"><span className="text-xs">灵感与纸张</span><span className="font-mono text-[10px]">01</span></div><p className="mt-1 text-[7px] tracking-[0.2em]">IDEAS & PAPER</p></div><div className="w-44 rotate-[4deg] rounded-sm bg-[#fcfcf8] px-4 py-3 shadow-md"><div className="flex items-center justify-between"><span className="text-xs">日常小物</span><span className="font-mono text-[10px]">02</span></div><p className="mt-1 text-[7px] tracking-[0.2em]">LITTLE EVERYDAY THINGS</p></div></div><div className="mt-4 flex justify-between text-xs"><span>给每一件小物，安个家</span><span className="text-muted-foreground">02 ↗</span></div><p className="mt-2 text-[10px] text-muted-foreground">居家收纳 / 办公整理</p></button>
              <button onClick={() => { changeTemplate(0); document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }); }} className="group text-left"><div className="flex h-44 items-center justify-center rounded-lg bg-[#e7e2dc] transition group-hover:bg-[#ded6cd]"><div className="w-40 rotate-[6deg] rounded bg-white p-4 shadow-md"><p className="text-[8px] text-muted-foreground">简单生活 · 日用精选</p><p className="mb-3 mt-1 text-xs font-medium">陶瓷马克杯</p><div className="mb-3 flex items-end justify-between"><span className="text-[8px]">奶油白 / 350ml</span><span className="text-xl font-bold">¥ 39</span></div><Barcode small /></div></div><div className="mt-4 flex justify-between text-xs"><span>让每一次交易，清晰一点</span><span className="text-muted-foreground">03 ↗</span></div><p className="mt-2 text-[10px] text-muted-foreground">零售价签 / 商品条码</p></button>
              <button onClick={() => { changeTemplate(2); document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }); }} className="group text-left"><div className="flex h-44 items-center justify-center rounded-lg bg-[#dfe3eb] transition group-hover:bg-[#d4dbe6]"><div className="w-44 rotate-[-5deg] bg-[#fffefa] p-4 shadow-md"><div className="flex justify-between border-b border-black pb-2 text-[9px]"><span className="font-bold">一份心意，正在路上</span><span>↗</span></div><p className="my-2 text-[10px]">TO: 美好生活工作室</p><p className="mb-3 text-[7px]">上海市静安区 · 创意园 12 号</p><Barcode small /></div></div><div className="mt-4 flex justify-between text-xs"><span>把心意，送到对的地方</span><span className="text-muted-foreground">04 ↗</span></div><p className="mt-2 text-[10px] text-muted-foreground">地址标签 / 包裹寄送</p></button>
            </div>
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-[1320px] px-6 py-20 lg:px-12"><div className="grid gap-8 md:grid-cols-[1fr_2fr]"><div><p className="mb-3 text-[10px] tracking-[0.17em] text-muted-foreground">FROM SCREEN TO PAPER</p><h2 className="text-3xl font-medium leading-relaxed">从一个想法，<br />到一张好标签。</h2></div><div className="grid gap-8 sm:grid-cols-3">{[{ title: "选一张，开始", body: "商品、收纳或寄送，从适合你的标签开始。" }, { title: "做成你的样子", body: "修改文字与内容，实时看见设计的变化。" }, { title: "让设计落纸", body: "确认尺寸与版面，从预览走向打印。" }].map((step, index) => <div key={step.title} className="border-t border-border pt-5"><span className="font-mono text-xs text-primary">0{index + 1} /</span><h3 className="mb-3 mt-6 text-base font-medium">{step.title}</h3><p className="text-xs leading-6 text-muted-foreground">{step.body}</p></div>)}</div></div></section>
        <section id="help" className="mx-auto max-w-[1224px] border-t border-border px-6 py-10"><div className="flex flex-wrap items-center justify-between gap-5"><div><h2 className="text-lg font-medium">先体验，再把灵感带到桌面。</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">当前为交互官网演示。实际系统支持、打印机兼容与安装包将在产品发布时提供。</p></div><button onClick={() => setDownloadOpen(true)} className="rounded-md border border-border px-5 py-3 text-xs hover:border-primary hover:text-primary">查看桌面版 <span className="ml-6">↗</span></button></div></section>
      </main>
      <footer className="mx-auto flex max-w-[1320px] flex-wrap justify-between gap-4 px-6 py-7 text-[10px] text-muted-foreground lg:px-12"><span>© 2026 标记 LABEL STUDIO</span><span>小小标签，认真对待。 <span className="ml-5">DESIGNED TO MAKE IT TANGIBLE.</span></span></footer>

      {downloadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5 backdrop-blur-sm" onClick={() => setDownloadOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="download-title" className="w-full max-w-md rounded-xl border border-border bg-background p-8 shadow-xl" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setDownloadOpen(false); }}><div className="flex items-center justify-between"><p className="text-[10px] tracking-widest text-primary">LABEL STUDIO / DESKTOP</p><button autoFocus onClick={() => setDownloadOpen(false)} aria-label="关闭下载窗口" className="px-2 text-xl">×</button></div><h2 id="download-title" className="mb-3 mt-7 text-2xl font-medium">让设计，留在你的桌面。</h2><p className="text-sm leading-7 text-muted-foreground">这是官网设计演示，尚未接入真实软件安装包。你可以先在标签实验台体验编辑与模拟打印。</p><div className="my-6 flex gap-3">{["Windows", "macOS"].map((option) => <button key={option} onClick={() => setPlatform(option)} aria-pressed={platform === option} className={`flex-1 rounded-md border py-3 text-sm ${platform === option ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>{option}</button>)}</div><p role="status" className="mb-6 text-xs text-muted-foreground">{platform} 安装包待提供 · 系统兼容性待确认</p><button onClick={() => { setDownloadOpen(false); document.getElementById("playground")?.scrollIntoView({ behavior: "smooth" }); }} className="w-full rounded-md bg-primary py-3 text-sm text-white">先体验标签设计 →</button></section></div>}
    </div>
  );
}
