/**
 * 框架基准。
 *
 *   node scripts/bench/reactivity.mjs    纯原语：信号读写、effect 重跑、Owner 生命周期
 *   node scripts/bench/e2e.mjs           端到端：真实 DOM 更新循环（jsdom + 真实渲染器）
 *   node scripts/bench/jsdom-control.mjs 对照：同样的 DOM 操作绕过 vobs 做一遍
 *
 * ## 两条方法论，都是踩过坑才定下来的
 *
 * 1. **端到端必须显式 flush。** vobs 的更新是微任务批处理的：在同步循环里写信号只做了
 *    「入队 + notify」，真正的 flush 要等循环结束。第一版基准没注意这点，测出「200 行
 *    调和只要 0.02µs」这种荒谬数字 —— 测的是入队，不是更新。现在每轮显式调
 *    `scheduler.flush()` 同步推进。
 *
 * 2. **必须把 jsdom 的成本剥出来。** jsdom 的 DOM 操作比真实浏览器慢一个数量级，
 *    不剥离就会把 jsdom 的慢算到框架头上（挂载 3.3ms 里 jsdom 自己占 1.1ms）。
 *    所以 e2e 的每个数字都要对照 jsdom-control 的同类操作看。
 *
 * 3. 每个用例重复多轮报**最小值**与中位数：噪声只会让耗时变大，最小值最接近真值。
 *
 * ## 当前基线（改动前请先自己跑一遍，别信这里的数字）
 *
 *   信号写入（零订阅者）      6.3 ns        Owner 创建+销毁      194 ns
 *   信号读取                 6.4 ns        memo 读取            4.0 ns
 *
 *   端到端（最小）                         纯 jsdom 对照         vobs 自身开销
 *   100 绑定共享 1 个信号     62.7 µs      17.1 µs              45.6 µs（456 ns/次）
 *   100 个 class 绑定         91.3 µs      34.5 µs              56.7 µs（567 ns/次）
 *   200 行只改 1 行           34.0 µs       0.2 µs              33.8 µs（170 ns/行）
 *
 * 已知的两个目标（都有数字支撑）：
 *   A. 每次 effect 重跑 456~567 ns —— 深读指出每轮把依赖**全部退订再重收**
 *      （`packages/reactivity/src/effect.ts` 的 cleanupDependencies + 重收）
 *   B. 列表每行「什么都不用做」仍要 170 ns —— 记账（Map/Set/seq/LIS + 逐行检查）
 *      对比手写 Map+查表 200 行只要 4.9 µs
 */
console.log(`运行：node scripts/bench/reactivity.mjs / e2e.mjs / jsdom-control.mjs
详见本文件顶部的方法论说明。`)
