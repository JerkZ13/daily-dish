'use strict';

const http = require('http');
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

const cache = {};

function getWeekKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-W${Math.ceil(d.getDate() / 7)}`;
}

function getWeekStr() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月第${Math.ceil(d.getDate() / 7)}周`;
}

const CAT_COLORS = {
  '新品上市': 'linear-gradient(135deg, #F2994A, #E67E22)',
  '探店爆款': 'linear-gradient(135deg, #E74C3C, #C0392B)',
  '节日美食': 'linear-gradient(135deg, #5C3D2E, #8B6914)',
  '行业趋势': 'linear-gradient(135deg, #4A5568, #2D3748)',
  '地方风味': 'linear-gradient(135deg, #27AE60, #1E8449)',
  '健康轻食': 'linear-gradient(135deg, #2ECC71, #27AE60)'
};

const SRC_COLORS = {
  '小红书': '#FF6B6B', '大众点评': '#E74C3C', '抖音': '#1E1E1E',
  '36氪': '#3498DB', '美食天下': '#27AE60', '名厨': '#2C3E50',
  '成都发布': '#E67E22', '餐饮老板内参': '#3498DB'
};

function getSourceColor(name) {
  for (const [k, v] of Object.entries(SRC_COLORS)) {
    if (name.includes(k)) return v;
  }
  return '#5C3D2E';
}

// 根據文章標題產生穩定的圖片 URL
// 使用 picsum.photos 的 seed 機制：同一標題永遠回傳同一張圖
function getImageUrl(title, category) {
  const seed = title
    .replace(/[^\w一-鿿]/g, '')
    .slice(0, 30);
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/400/300`;
}

async function callDeepSeek(weekStr) {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一位专业美食资讯编辑。请严格以 JSON 格式回应。' },
        { role: 'user', content: `请为 "${weekStr}" 的美食周报生成 9 条美食热点资讯。

类别：新品上市、探店爆款、节日美食、行业趋势、地方风味、健康轻食。

每条资讯含：
- title（不超过25字）
- summary（60-100字）
- category
- source
- publishTime（本周内）
- views
- imageIcon（食物emoji）

同时生成 hotTop5（title不超过18字）和 sourceSites（含 name 和 count）

JSON 格式：{ "news": [...], "hotTop5": [...], "sourceSites": [...] }` }
      ],
      temperature: 0.85,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

function format(raw) {
  return {
    week: getWeekKey(),
    news: (raw.news || []).slice(0, 9).map((n, i) => ({
      id: i + 1,
      title: n.title || '',
      summary: n.summary || '',
      category: n.category || '行业趋势',
      source: n.source || '综合',
      sourceColor: getSourceColor(n.source),
      publishTime: n.publishTime || '',
      views: n.views || '1万+',
      imageUrl: getImageUrl(n.title, n.category),
      imageColor: CAT_COLORS[n.category] || 'linear-gradient(135deg, #4A5568, #2D3748)',
      imageIcon: n.imageIcon || '📰',
      url: '#'
    })),
    hotTop5: (raw.hotTop5 || []).slice(0, 5),
    sourceSites: (raw.sourceSites || []).slice(0, 6)
  };
}

// ===== HTTP Server (Web Function 模式) =====
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only accept GET
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const weekKey = getWeekKey();

  // Return cache
  if (cache[weekKey]) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify({ ...cache[weekKey], cached: true }));
    return;
  }

  // No API key configured
  if (!process.env.DEEPSEEK_API_KEY) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ week: weekKey, news: [], hotTop5: [], sourceSites: [], error: 'DEEPSEEK_API_KEY not set' }));
    return;
  }

  try {
    const raw = await callDeepSeek(getWeekStr());
    const parsed = format(raw);
    cache[weekKey] = parsed;

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(JSON.stringify({ ...parsed, cached: false }));
  } catch (err) {
    console.error(err);
    if (cache[weekKey]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...cache[weekKey], cached: true, note: 'use cache' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

// Web Function 監聽 9000 埠（騰訊雲標準）
server.listen(9000, () => console.log('SCF Web Function ready on 9000'));
