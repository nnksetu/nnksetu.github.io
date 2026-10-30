# R2 首页缩略图

首页卡片现在优先加载 480px 的 WebP 缩略图，原图只作为回退；缩略图由 GitHub Actions 生成并上传到 R2，不经过 EdgeOne 图片处理，也不产生 EO 的额外费用。

## 工作方式

- 数据文件 `data/{acg,setu,zrsetu}/*.json` 里的 `preview` 仍是原图地址；
- 脚本按固定规则推导缩略图 key：

  ```
  https://eo.setutime.top/acg_pic/pic-15-35.webp
    -> acg_pic/thumbs/pic-15-35.webp
    -> https://r2.setutime.top/acg_pic/thumbs/pic-15-35.webp
  ```

- 前端 `js/index.js` 用同样的规则推导 URL，先加载缩略图，404/失败时回退到原图，所以**不需要修改 JSON、也不需要提交图片**；
- 缩略图放在 `acg_pic/thumbs/`、`setu_pic/thumbs/`、`zrsetu_pic/thumbs/`、`V/thumbs/` 下。现有 r2.setutime.top 网关已经把 `/acg_pic`、`/setu_pic`、`/zrsetu_pic`、`/V` 作为公开图片前缀，因此缩略图可以直接公开访问，不需要改 R2 Worker。

## 一次性配置

在 GitHub 仓库：

**Settings → Secrets and variables → Actions → New repository secret**

添加：

| 名称 | 内容 |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare 账户 ID |
| `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret Access Key |
| `R2_BUCKET` | 存放 `acg_pic` 等图片的 bucket 名称 |

R2 API Token 权限：

- Object Read & Write（需要 List，脚本用它跳过已生成的缩略图）
- 限定到上面这个 bucket 即可
- 如果只想用变量而不是 Secret，也可以配置成 Repository variables，工作流会优先读 Secrets，再读 Variables

## 首次生成

1. 打开 **Actions → Generate R2 Thumbnails**
2. 点 **Run workflow**
3. 第一次建议勾选 **force**（忽略已有缩略图，全量生成）
4. 跑完后访问任意一条验证：

   ```
   https://r2.setutime.top/acg_pic/thumbs/pic-15-35.webp
   ```

当前数据约 1183 张封面，首次会下载约 450 MB 原图，生成约 30–50 MB 缩略图，通常几分钟到十几分钟。

## 之后的自动化

工作流会在这些时机运行：

- `Auto Update data.json` 完成后自动跟进（数据提交带 `[skip ci]`，不能靠 data 的 push 触发）；
- 每天 03:30 UTC 兜底跑一次；
- 也可以随时手动触发。

已存在的缩略图会跳过，只处理新增图片。原图文件名如果被复用但内容变了，需要手动跑一次并勾选 **force**。

## 本地调试

不需要 R2 凭据也能检查地址推导：

```bash
DRY_RUN=1 node scripts/generate-thumbs.js
```

需要实际上传时：

```bash
npm ci --prefix scripts
R2_ACCOUNT_ID=... \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=... \
node scripts/generate-thumbs.js
```

## 可调参数

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `THUMB_WIDTH` | `480` | 缩略图宽度，`withoutEnlargement` 不会放大 |
| `THUMB_QUALITY` | `75` | WebP 质量 |
| `THUMB_CONCURRENCY` | `6` | 并发下载/上传数 |
| `FORCE` | `false` | 为 `1` 时忽略已有缩略图 |
| `R2_PUBLIC_BASE` | `https://r2.setutime.top` | 公开访问前缀 |

如果要改宽度，前端不需要改；URL 只和路径有关。

## 常见问题

- **缩略图 404**：脚本还没跑，或 R2 token 没有该 bucket 权限。前端会自动回退原图，不影响访问。
- **上传成功但打不开**：确认路径在 `/acg_pic/thumbs/...` 这类公开前缀下；如果换了 R2 网关域名，改 `R2_PUBLIC_BASE` 和 `js/index.js` 里的 `THUMB_ORIGIN`。
- **想省 R2 存储**：缩略图通常只有几十 KB，1183 张约 30–50 MB，R2 免费额度足够。
