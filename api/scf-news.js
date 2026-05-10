'use strict';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// Week cache
const cache = {};

function getWeekKey() {
  const d = new Date();
  const w = Math.ceil(d.getDate() / 7);
  return `${d.getFullYear()}-${d.getMonth() + 1}-W${w}`;
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

async function callDeepSeek(weekStr) {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一位专业美食资讯编辑，擅长撰写美食行业热点新闻。请严格以 JSON 格式回应。' },
        { role: 'user', content: `请为 "${weekStr}" 的美食周报生成 9 条美食热点资讯。

涵盖类别：新品上市、探店爆款、节日美食、行业趋势、地方风味、健康轻食。

每条资讯包含：
- title: 标题（不超过25字）
- summary: 摘要（60-100字）
- category: 分类
- source: 来源媒体
- publishTime: 发布日期（YYYY-MM-DD，本周内）
- views: 阅读量
- imageIcon: 食物emoji

同时生成：
- hotTop5: TOP5列表，含 title（不超过18字）和 views
- sourceSites: 6个来源站点，含 name 和 count

回传 JSON 格式：
{
  "news": [{ "title": "...", "summary": "...", "category": "...", "source": "...", "publishTime": "...", "views": "...", "imageIcon": "..." }],
  "hotTop5": [{ "title": "...", "views": "..." }],
  "sourceSites": [{ "name": "...", "count": "..." }]
}` }
      ],
      temperature: 0.85,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
  const result = await response.json();
  return JSON.parse(result.choices[0].message.content);
}

function formatResponse(raw) {
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
      imageColor: CAT_COLORS[n.category] || 'linear-gradient(135deg, #4A5568, #2D3748)',
      imageIcon: n.imageIcon || '📰',
      url: '#'
    })),
    hotTop5: (raw.hotTop5 || []).slice(0, 5),
    sourceSites: (raw.sourceSites || []).slice(0, 6)
  };
}

// ===== Web Function handler =====
// 腾讯云 Web 函数直接接收 HTTP 请求事件
exports.main_handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      isBase64Encoded: false,
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    };
  }

  if (event.httpMethod !== 'GET') {
    return { isBase64Encoded: false, statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const weekKey = getWeekKey();

  // Return cache if available
  if (cache[weekKey]) {
    return {
      isBase64Encoded: false,
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify({ ...cache[weekKey], cached: true })
    };
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return {
      isBase64Encoded: false,
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ week: weekKey, news: [], hotTop5: [], sourceSites: [], error: 'API Key not configured' })
    };
  }

  try {
    const raw = await callDeepSeek(getWeekStr());
    const parsed = formatResponse(raw);
    cache[weekKey] = parsed;

    return {
      isBase64Encoded: false,
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify({ ...parsed, cached: false })
    };
  } catch (err) {
    console.error(err);
    if (cache[weekKey]) {
      return {
        isBase64Encoded: false,
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ...cache[weekKey], cached: true, note: 'use cache' })
      };
    }
    return {
      isBase64Encoded: false,
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
