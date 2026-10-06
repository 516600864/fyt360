/**
 * 装修素材图片上传（走全局 fetch 包装：自动带 token + 站点上下文）。
 * 用法：const url = await uploadImage(file) — file 为 el-upload http-request 的 file。
 */
export async function uploadImage(file) {
  if (!file || file.size > 3 * 1024 * 1024) throw new Error('图片须 ≤3MB');
  const data = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, data }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.message ?? '上传失败');
  return body.data.url;
}
