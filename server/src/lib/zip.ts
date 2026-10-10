// 最小 ZIP 读写器（STORE + DEFLATE）：零子进程依赖——沙箱环境 spawnSync 拉起
// 系统打包器会被 EBUSY 拦（2026-10-09 实锤），纯 JS 结构手写最稳。
// 与 deploy/scripts/lib/zip.mjs 同源（部署侧出模板包 / 服务端实时改包，两份各自演进）。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosStamp() {
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  return { dosTime, dosDate };
}

/** entries → 标准 ZIP Buffer（local header + central directory + EOCD） */
export function writeZip(entries: ZipEntry[]): Buffer {
  const { dosTime, dosDate } = dosStamp();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const crc = crc32(e.data);
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const data = useDeflate ? deflated : e.data;
    const method = useDeflate ? 8 : 0;
    const name = Buffer.from(e.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // compressed size
    local.writeUInt32LE(e.data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

/** ZIP Buffer → entries（仅支持本库/常规压缩器产出的包：无 zip64、无加密、单盘） */
export function readZip(buf: Buffer): ZipEntry[] {
  // 从尾部找 EOCD（容许注释 ≤ 1KB）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 1024); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP EOCD 未找到');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory 起始偏移
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP central #${i} 签名异常`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const namelen = buf.readUInt16LE(p + 28);
    const extralen = buf.readUInt16LE(p + 30);
    const commentlen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + namelen).toString('utf8');
    // local header：name/extra 长度可能与 central 不同，须按 local 自己的字段跳
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    let data = buf.subarray(dataStart, dataStart + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`ZIP 条目 ${name} 压缩方法 ${method} 不支持`);
    entries.push({ name, data: Buffer.from(data) });
    p += 46 + namelen + extralen + commentlen;
  }
  return entries;
}

/** 目录 → zip Buffer（递归；目录内文件名须为 ASCII，小程序产物满足） */
export function zipBuffer(dir: string): Buffer {
  const out: ZipEntry[] = [];
  const walk = (d: string, base: string): void => {
    for (const name of fs.readdirSync(d)) {
      const abs = path.join(d, name);
      const rel = path.relative(base, abs).replaceAll('\\', '/');
      if (fs.statSync(abs).isDirectory()) walk(abs, base);
      else out.push({ name: rel, data: fs.readFileSync(abs) });
    }
  };
  walk(dir, dir);
  return writeZip(out);
}
