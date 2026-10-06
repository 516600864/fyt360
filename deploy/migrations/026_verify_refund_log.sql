-- 026: 核销员退款日志（2026-09-29：核销员有退款权限）
-- verify_log.result 扩 'refund'（核销员发起退款时记录一条 result='refund', times=0）
ALTER TABLE verify_log DROP CONSTRAINT IF EXISTS verify_log_result_check;
ALTER TABLE verify_log ADD CONSTRAINT verify_log_result_check CHECK (result IN ('success','fail','refund'));
