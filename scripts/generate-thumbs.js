#!/usr/bin/env node
/*
 * 生成首页卡片缩略图并上传到 Cloudflare R2。
 *
 * 设计要点：
 * - 只读取 data/{acg,setu,zrsetu}/*.json 里的 preview 地址，不修改 JSON；
 * - 缩略图统一放在桶根目录的 thumbs-720/ 下：
 *   例如 https://eo.setutime.top/acg_pic/pic-15-35.webp
 *      -> thumbs-720/acg_pic/pic-15-35.webp
 *      -> https://r2.setutime.top/thumbs-720/acg_pic/pic-15-35.webp
 * - 前端 js/index.js 的 getThumbUrl() 用完全相同的规则推导，所以新增内容只要
 *   跑一次本脚本即可，不需要提交 data 变更。
 * - 已存在的缩略图会跳过；传 FORCE=1 可全部重新生成。
 *
 * 需要的环境变量：
 *   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 * 可选：
 *   R2_PUBLIC_BASE（默认 https://r2.setutime.top）
 *   THUMB_WIDTH（默认 720）/ THUMB_QUALITY（默认 82）
 *   THUMB_CONCURRENCY（默认 6）/ THUMB_LIMIT（调试用）/ FORCE=1 / DRY_RUN=1
 *   THUMB_LOCAL_DIR：只生成到本地目录、不上传（GitHub Actions 里配合 rclone 使用）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CATEGORIES = ['acg', 'setu', 'zrsetu'];
const ALLOWED_HOSTS = new Set(['eo.setutime.top', 'r2.setutime.top']);
const THUMB_PREFIXES = new Set(['acg_pic', 'setu_pic', 'zrsetu_pic', 'V']);

const R2_PUBLIC_BASE = String(process.env.R2_PUBLIC_BASE || 'https://r2.setutime.top').replace(/\/+$/, '');
const THUMB_WIDTH = Math.max(120, parseInt(process.env.THUMB_WIDTH, 10) || 720);
const THUMB_QUALITY = Math.min(95, Math.max(40, parseInt(process.env.THUMB_QUALITY, 10) || 82));
const THUMB_DIR = String(process.env.THUMB_DIR || `thumbs-${THUMB_WIDTH}`).trim() || `thumbs-${THUMB_WIDTH}`;
const CONCURRENCY = Math.min(16, Math.max(1, parseInt(process.env.THUMB_CONCURRENCY, 10) || 6));
const FORCE = /^(1|true|yes)$/i.test(String(process.env.FORCE || ''));
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.DRY_RUN || ''));
const LOCAL_DIR = String(process.env.THUMB_LOCAL_DIR || '').trim()
  ? path.resolve(String(process.env.THUMB_LOCAL_DIR).trim())
  : '';
const LIMIT = Math.max(0, parseInt(process.env.THUMB_LIMIT, 10) || 0);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parsePreviewUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch (error) {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);
  const prefix = segments.shift();
  if (!prefix || !THUMB_PREFIXES.has(prefix) || !segments.length) return null;
  if (segments.some(segment => segment === '.' || segment === '..')) return null;

  const file = segments.pop();
  if (!file || file.endsWith('.')) return null;

  const webpName = file.replace(/\.[^.]+$/, '') + '.webp';
  const key = [THUMB_DIR, prefix].concat(segments, [webpName]).join('/');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  return {
    sourceUrl: url.href,
    key,
    publicUrl: R2_PUBLIC_BASE + '/' + encodedKey
  };
}

function collectTargets() {
  const targets = new Map();
  let total = 0;
  let withoutPreview = 0;

  for (const category of CATEGORIES) {
    const dir = path.join(DATA_DIR, category);
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      let data;
      try {
        data = readJson(path.join(dir, entry));
      } catch (error) {
        console.warn(`[skip] 无法解析 ${category}/${entry}: ${error.message}`);
        continue;
      }

      for (const item of data.items || []) {
        total += 1;
        if (!item || !item.preview) {
          withoutPreview += 1;
          continue;
        }
        const target = parsePreviewUrl(item.preview);
        if (!target) continue;
        if (!targets.has(target.key)) targets.set(target.key, target);
      }
    }
  }

  return { targets: Array.from(targets.values()), total, withoutPreview };
}

function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });
  return Promise.all(runners);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOriginal(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
        headers: {
          'user-agent': 'SetuTimeThumbBot/1.0 (+https://www.setutime.com/)',
          accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = String(response.headers.get('content-type') || '');
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error(`unexpected content-type: ${contentType}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 800);
    }
  }
  throw lastError || new Error('download failed');
}

async function listExistingKeys(s3, ListObjectsV2Command, bucket) {
  const keys = new Set();
  for (const prefix of THUMB_PREFIXES) {
    let token;
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${THUMB_DIR}/${prefix}/`,
        ContinuationToken: token
      }));
      for (const object of result.Contents || []) {
        if (object.Key) keys.add(object.Key);
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
  }
  return keys;
}

async function main() {
  const collected = collectTargets();
  const targets = LIMIT ? collected.targets.slice(0, LIMIT) : collected.targets;

  console.log(`[thumbs] 数据条目 ${collected.total}，无预览图 ${collected.withoutPreview}，待处理缩略图 ${targets.length}`);
  if (DRY_RUN) {
    for (const target of targets.slice(0, 10)) {
      console.log(`[dry-run] ${target.sourceUrl}\n          -> ${target.publicUrl}`);
    }
    console.log(`[dry-run] 共 ${targets.length} 个，未下载/上传`);
    return;
  }

  // 本地输出模式：只生成文件，由 workflow 里的 rclone 负责上传，绕开 S3 SDK/TLS
  if (LOCAL_DIR) {
    const sharpLocal = require('sharp');
    let generated = 0;
    let skippedLocal = 0;
    let bytes = 0;
    const failuresLocal = [];
    await mapLimit(targets, CONCURRENCY, async target => {
      const outPath = path.join(LOCAL_DIR, target.key);
      if (!FORCE) {
        try {
          const stat = await fs.promises.stat(outPath);
          if (stat.size > 0) {
            skippedLocal += 1;
            return;
          }
        } catch (error) {}
      }
      try {
        const original = await fetchOriginal(target.sourceUrl);
        const thumb = await sharpLocal(original, { failOn: 'none' })
          .rotate()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY, effort: 5, smartSubsample: true })
          .toBuffer();
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        await fs.promises.writeFile(outPath, thumb);
        generated += 1;
        bytes += thumb.length;
        if (generated % 25 === 0) console.log(`[thumbs] 已生成 ${generated}/${targets.length}`);
      } catch (error) {
        failuresLocal.push({ key: target.key, error: error.message });
        console.warn(`[thumbs] 失败 ${target.key}: ${error.message}`);
      }
    });
    const localSummary = [
      '',
      '### R2 缩略图生成结果（本地输出）',
      '',
      `- 数据条目：${collected.total}`,
      `- 待处理：${targets.length}`,
      `- 已生成：${generated}`,
      `- 已存在跳过：${skippedLocal}`,
      `- 失败：${failuresLocal.length}`,
      `- 输出目录：${LOCAL_DIR}`,
      `- 生成体积：${(bytes / 1024 / 1024).toFixed(1)} MB`,
      `- 目录：${THUMB_DIR}`
    ].join('\n');
    console.log(localSummary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, localSummary + '\n');
    }
    if (failuresLocal.length && generated === 0) process.exitCode = 1;
    return;
  }

  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = required.filter(name => !String(process.env[name] || '').trim());
  if (missing.length) {
    console.error(`[thumbs] 缺少环境变量: ${missing.join(', ')}`);
    console.error('[thumbs] 请在仓库 Settings → Secrets and variables → Actions 中配置：');
    console.error('         R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET');
    process.exit(1);
  }

  // sharp 和 S3 SDK 只在真正上传时加载，DRY_RUN 不需要安装依赖
  const sharp = require('sharp');
  const {
    S3Client,
    ListObjectsV2Command,
    HeadObjectCommand,
    PutObjectCommand
  } = require('@aws-sdk/client-s3');

  const bucket = String(process.env.R2_BUCKET).trim();
  // 兼容误把 Account ID 填成 URL 的情况
  const accountId = String(process.env.R2_ACCOUNT_ID)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    console.warn('[thumbs] R2_ACCOUNT_ID 看起来不是标准的 32 位十六进制 Account ID，请检查是否填成了 Zone ID / Token ID');
  }

  // R2 的 S3 端点：自定义 endpoint 时要用 path-style，否则 SDK 会请求
  // bucket.accountid.r2.cloudflarestorage.com，SNI/证书不匹配会直接 TLS handshake failure
  const endpoint = String(process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
  let endpointHost = endpoint;
  try { endpointHost = new URL(endpoint).host; } catch (error) {}
  console.log(`[thumbs] R2 endpoint: ${endpointHost}，bucket: ${bucket}，path-style: true`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: String(process.env.R2_ACCESS_KEY_ID).trim(),
      secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY).trim()
    }
  });

  let existing = new Set();
  let canList = true;
  try {
    existing = await listExistingKeys(s3, ListObjectsV2Command, bucket);
    console.log(`[thumbs] R2 中已有 ${existing.size} 个缩略图`);
  } catch (error) {
    canList = false;
    console.warn(`[thumbs] 列出现有缩略图失败，将逐个 HEAD（较慢）：${error.message}`);
  }

  async function thumbExists(key) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (error && (error.$metadata && error.$metadata.httpStatusCode === 404)) return false;
      throw error;
    }
  }

  let uploaded = 0;
  let skipped = 0;
  let downloadedBytes = 0;
  let uploadedBytes = 0;
  const failures = [];

  await mapLimit(targets, CONCURRENCY, async target => {
    if (!FORCE) {
      const alreadyExists = canList ? existing.has(target.key) : await thumbExists(target.key).catch(() => false);
      if (alreadyExists) {
        skipped += 1;
        return;
      }
    }

    try {
      const original = await fetchOriginal(target.sourceUrl);
      downloadedBytes += original.length;

      const thumb = await sharp(original, { failOn: 'none' })
        .rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY, effort: 5, smartSubsample: true })
        .toBuffer();

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: target.key,
        Body: thumb,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=15552000, s-maxage=15552000, stale-while-revalidate=86400'
      }));

      uploaded += 1;
      uploadedBytes += thumb.length;
      if (uploaded % 25 === 0) {
        console.log(`[thumbs] 已上传 ${uploaded}/${targets.length}，跳过 ${skipped}，失败 ${failures.length}`);
      }
    } catch (error) {
      failures.push({ key: target.key, source: target.sourceUrl, error: error.message });
      console.warn(`[thumbs] 失败 ${target.key}: ${error.message}`);
    }
  });

  const summary = [
    '',
    '### R2 缩略图生成结果',
    '',
    `- 数据条目：${collected.total}`,
    `- 待处理：${targets.length}`,
    `- 已上传：${uploaded}`,
    `- 已存在跳过：${skipped}`,
    `- 失败：${failures.length}`,
    `- 下载：${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`,
    `- 上传：${(uploadedBytes / 1024 / 1024).toFixed(1)} MB`,
    failures.length ? `- 示例失败：\`${failures.slice(0, 5).map(item => item.key).join('`, `')}\`` : ''
  ].filter(Boolean).join('\n');

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }

  // 个别图片失败下一轮会重试；全部失败才让 Action 红掉
  if (failures.length && uploaded === 0) process.exitCode = 1;
}

module.exports = {
  parsePreviewUrl,
  collectTargets
};

if (require.main === module) {
  main().catch(error => {
    console.error('[thumbs] 运行失败:', error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
