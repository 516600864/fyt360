/**
 * 微信支付 V3（JSAPI）最小封装——自营交易链（决策：商户号已有，凭据 site_payment 跟 site_id 走）。
 * 签名 = SHA256withRSA（商户私钥）；回调解密 = AES-256-GCM（APIv3 key）。
 * 仅实现交易链所需：JSAPI 下单 / 前端 paySign / 平台证书拉取 / 回调验签解密。
 */
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';

export interface PayConfig {
  mchId: string;
  apiV3Key: string;
  serialNo: string;
  privateKeyPem: string;
  commissionRate: number;
  appid: string;
}

/** 站点支付配置（status='active'）；未配置 → 503 WXPAY_NOT_CONFIGURED。appid 取 site 表（决策#25 站点级唯一真源） */
export async function resolvePayConfig(siteId: string): Promise<PayConfig> {
  const { rows } = await pool.query(
    `SELECT p.mch_id, p.mch_key, p.serial_no, p.cert, p.commission_rate::float AS rate,
            s.appid
       FROM site_payment p JOIN site s ON s.site_id = p.site_id
      WHERE p.site_id = $1 AND p.status = 'active' LIMIT 1`,
    [siteId],
  );
  if (!rows[0]) throw new HttpError(503, '微信支付未配置（site_payment 无启用凭据）', 'WXPAY_NOT_CONFIGURED');
  return {
    mchId: rows[0].mch_id,
    apiV3Key: rows[0].mch_key,
    serialNo: rows[0].serial_no,
    privateKeyPem: rows[0].cert,
    commissionRate: Number(rows[0].rate ?? 0.2),
    appid: rows[0].appid ?? '',
  };
}

const sha256Rsa = (data: string, privateKeyPem: string) =>
  crypto.createSign('RSA-SHA256').update(data).sign(privateKeyPem, 'base64');

/** V3 请求签名头 */
function authHeader(method: string, url: string, body: string, cfg: PayConfig): string {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const msg = `${method}\n${url}\n${ts}\n${nonce}\n${body}\n`;
  const sign = sha256Rsa(msg, cfg.privateKeyPem);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonce}",signature="${sign}",timestamp="${ts}",serial_no="${cfg.serialNo}"`;
}

const WXPAY_HOST = 'https://api.mch.weixin.qq.com';

/** JSAPI 下单 → prepay_id */
export async function jsapiPrepay(opts: {
  cfg: PayConfig;
  outTradeNo: string;
  description: string;
  totalFen: number;
  openid: string;
  notifyUrl: string;
}): Promise<string> {
  const body = JSON.stringify({
    appid: opts.cfg.appid,
    mchid: opts.cfg.mchId,
    description: opts.description.slice(0, 120),
    out_trade_no: opts.outTradeNo,
    notify_url: opts.notifyUrl,
    amount: { total: opts.totalFen, currency: 'CNY' },
    payer: { openid: opts.openid },
  });
  const r = await fetch(`${WXPAY_HOST}/v3/pay/transactions/jsapi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader('POST', '/v3/pay/transactions/jsapi', body, opts.cfg) },
    body,
  });
  const j = (await r.json().catch(() => null)) as { prepay_id?: string; code?: string; message?: string } | null;
  if (!j?.prepay_id) {
    throw new HttpError(502, `微信下单失败：${j?.code ?? r.status} ${j?.message ?? ''}`.trim(), 'WXPAY_PREPAY_ERROR');
  }
  return j.prepay_id;
}

/** 小程序 requestPayment 参数（paySign 用商户私钥） */
export function buildPayParams(prepayId: string, cfg: PayConfig) {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;
  const paySign = sha256Rsa(`${cfg.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`, cfg.privateKeyPem);
  return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
}

/** 退款（V3 /v3/refund/domestic/refunds；out_refund_no 幂等，同单号重复请求返回同一退款单） */
export async function refund(opts: {
  cfg: PayConfig;
  outTradeNo: string;
  outRefundNo: string;
  totalFen: number;   // 原订单金额（分）
  refundFen: number;  // 本次退款金额（分）
  notifyUrl?: string;
  reason?: string;
}): Promise<{ refundStatus: string; refundId: string }> {
  const urlPath = '/v3/refund/domestic/refunds';
  const body = JSON.stringify({
    out_trade_no: opts.outTradeNo,
    out_refund_no: opts.outRefundNo,
    reason: (opts.reason ?? '到店团购订单退款').slice(0, 80),
    notify_url: opts.notifyUrl,
    amount: { refund: opts.refundFen, total: opts.totalFen, currency: 'CNY' },
  });
  const r = await fetch(`${WXPAY_HOST}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader('POST', urlPath, body, opts.cfg) },
    body,
  });
  const j = (await r.json().catch(() => null)) as { refund_id?: string; status?: string; code?: string; message?: string } | null;
  if (!j?.refund_id) {
    throw new HttpError(502, `微信退款失败：${j?.code ?? r.status} ${j?.message ?? ''}`.trim(), 'WXPAY_REFUND_ERROR');
  }
  return { refundStatus: j.status ?? 'PROCESSING', refundId: j.refund_id };
}

/** 回调解密（Wechatpay-Signature 验签需平台证书；v1 简化 = AES-GCM 解密成功 + 金额/单号核对即接受） */
export function decryptCallbackResource(cfg: PayConfig, resource: {
  ciphertext: string; nonce: string; associated_data?: string;
}): { out_trade_no: string; transaction_id: string; trade_state: string; amount?: { payer_total?: number } } {
  const { ciphertext, nonce, associated_data = '' } = resource;
  const buf = Buffer.from(ciphertext, 'base64');
  const key = Buffer.from(cfg.apiV3Key, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  decipher.setAAD(Buffer.from(associated_data, 'utf8'));
  const plain = Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}
