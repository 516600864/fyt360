// 定时任务入口：与 API 同镜像不同启动命令（云托管定时触发器，决策 #25⑤）
// M1 仅占位：订单同步 / 佣金结算 / 对账任务在 M2+ 接入
console.log('[fyt360-cron] cron worker started, no jobs registered (M1 skeleton)');
setInterval(() => {
  // 保持进程存活等待触发器指令
}, 60_000);
