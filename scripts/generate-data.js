const fs = require('fs');
const path = require('path');

const PAGESIZE = 50;
const categories = [
  { name: 'acg', folder: 'acg' },
  { name: 'setu', folder: 'setu' },
  { name: 'zrsetu', folder: 'zrsetu' }
];
const IMAGE_ORIGIN = 'https://r2.setu.mom';
const IMAGE_FOLDER_BY_CATEGORY = {
  acg: 'acg_pic',
  setu: 'setu_pic',
  zrsetu: 'zrsetu_pic'
};

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function extractCaption(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let regex = /<div[^>]*id=["']?setu-title["']?[^>]*class=["']?title-capsule["']?[^>]*>([\s\S]*?)<\/div>/i;
    let match = regex.exec(content);

    if (!match || !match[1]) {
      regex = /<p[^>]*style\s*=\s*["'][^"']*?\btext-align\s*:\s*left[^"']*?font-size\s*:\s*16px[^>]*>([\s\S]*?)<\/p>/i;
      match = regex.exec(content);
    }

    return match && match[1] ? stripHtml(match[1]) : '';
  } catch (error) {
    console.log(`读取标题失败 ${filePath}: ${error.message}`);
    return '';
  }
}

function extractPreview(filePath, category) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const imageItemRegex = /<div\b[^>]*class=["'][^"']*\bimage-item\b[^"']*["'][^>]*>[\s\S]*?<img\b([^>]*)>/gi;
    const images = [];
    let match;

    while ((match = imageItemRegex.exec(content)) !== null) {
      const attributes = match[1];
      const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(attributes);
      images.push({
        alt: altMatch ? altMatch[1].trim() : ''
      });
    }

    // 先按全部图片确定中间位置，不能因为 data-src 为空而改变封面序号。
    const middleIndex = images.length ? Math.ceil(images.length / 2) - 1 : -1;
    if (middleIndex < 0) return '';

    const imageNumber = images[middleIndex].alt.match(/\d+/)?.[0];
    const imageFolder = IMAGE_FOLDER_BY_CATEGORY[category];
    const issueNumber = path.basename(filePath, '.html');
    if (!imageFolder || !imageNumber || !/^\d+$/.test(issueNumber)) return '';

    // JSON 封面统一使用 eo 图床，不再依赖 HTML 中原图床地址是否有效。
    return `${IMAGE_ORIGIN}/${imageFolder}/pic-${issueNumber}-${imageNumber}.webp`;
  } catch (error) {
    console.log(`读取预览图失败 ${filePath}: ${error.message}`);
    return '';
  }
}

function getItems(folder) {
  const folderPath = path.join(__dirname, '..', folder);
  if (!fs.existsSync(folderPath)) return [];

  return fs.readdirSync(folderPath)
    .filter(file => /^\d+\.html$/.test(file))
    .map(file => {
      const filePath = path.join(folderPath, file);
      return {
        file,
        caption: extractCaption(filePath),
        preview: extractPreview(filePath, folder)
      };
    })
    .sort((a, b) => {
      const numA = parseInt(a.file.match(/\d+/)?.[0] || 0, 10);
      const numB = parseInt(b.file.match(/\d+/)?.[0] || 0, 10);
      return numB - numA;
    });
}

function writeCategoryData(name, items, updatedTime) {
  const dataDir = path.join(__dirname, '..', 'data', name);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  fs.readdirSync(dataDir)
    .filter(file => file.endsWith('.json'))
    .forEach(file => fs.unlinkSync(path.join(dataDir, file)));

  const totalPages = Math.ceil(items.length / PAGESIZE) || 1;
  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * PAGESIZE;
    const pageData = {
      updated: updatedTime,
      page,
      totalPages,
      total: items.length,
      items: items.slice(start, start + PAGESIZE)
    };

    fs.writeFileSync(
      path.join(dataDir, `${page}.json`),
      JSON.stringify(pageData, null, 2) + '\n'
    );
  }

  console.log(`[${name}] ${items.length} 条，${totalPages} 个分页文件`);
}

const updatedTime = new Date()
  .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  .replace(/\//g, '-');

for (const { name, folder } of categories) {
  writeCategoryData(name, getItems(folder), updatedTime);
}

console.log('全部数据生成完成。');
