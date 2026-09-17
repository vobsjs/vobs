# vobs 待办

## 框架改进

- [ ] **select 初始值自动重同步**：向 `<select>` 插入 `<option>`（含列表渲染的选项）时，自动按当前绑定的 value 重写 `select.value`——消除「选项晚于 value 到达时选中项空白」的场景，所有 select 从此不再需要 `ref + queueMicrotask` 兜底（Labelune 踩坑⑥ 的框架级解法，SolidJS 同款做法）。
  - 现状（1.4.x/1.5.0 实测）：静态选项 + `value={signal}` 与选项列表渲染均已正常（bindProperty effect 会在挂载后校正）；仅「选项异步到达且 value 信号不再变化」时不会重写。
  - 建议实现点：runtime `insertBefore`/`appendChild` 感知目标为 select 且插入 option 时，触发该 select 的 value 重绑定刷新；或 bindProperty 对 select 记录 pending value、在子树首次插入 option 后补写一次。
  - 回归测试：选项晚到场景（先绑定 value、后插入 options，断言选中项正确）。
