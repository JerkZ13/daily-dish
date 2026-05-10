// 騰訊雲 SCF 函數 — 每周美食熱點 API
// 觸發方式: API Gateway (GET)
// 環境變數: DEEPSEEK_API_KEY

'use strict';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// 記憶體快取
let cache = { week: '', data: null };

function getWeekKey() {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekOfMonth = Math.ceil(day / 7);
  return `${d.getFullYear()}-${m}-W${weekOfMonth}`;
}

function getWeekStr() {
  const d = new Date();
  const weekOfMonth = Math.ceil(d.getDate() / 7);
  return `${d.getFullYear()}年${d.getMonth() + 1}月第${weekOfMonth}周`;
}

const categoryColors = {
  '新品上市': 'linear-gradient(135deg, #F2994A, #E67E22)',
  '探店爆款': 'linear-gradient(135deg, #E74C3C, #C0392B)',
  '节日美食': 'linear-gradient(135deg, #5C3D2E, #8B6914)',
  '行业趋势': 'linear-gradient(135deg, #4A5568, #2D3748)',
  '地方风味': 'linear-gradient(135deg, #27AE60, #1E8449)',
  '健康轻食': 'linear-gradient(135deg, #2ECC71, #27AE60)'
};

const sourceColors = {
  '小红书': '#FF6B6B', '大众点评': '#E74C3C', '抖音': '#1E1E1E',
  '36氪': '#3498DB', '美食天下': '#27AE60', '名厨': '#2C3E50',
  '成都发布': '#E67E22', '北京发布': '#C0392B', '餐饮老板内参': '#3498DB'
};

function getSourceColor(name) {
  for (const [k, v] of Object.entries(sourceColors)) {
    if (name.includes(k)) return v;
  }
  return '#5C3D2E';
}

function buildPrompt(weekStr) {
  return [
    { role: 'system', content: '你是一位专业的美食资讯编辑，擅长收集和撰写美食行业热点新闻。请严格以 JSON 格式回应，不要包含任何其他文字。' },
    { role: 'user', content: `请为 "${weekStr}" 的美食周报生成 9 条美食热点资讯。

涵盖以下类别：新品上市、探店爆款、节日美食、行业趋势、地方风味、健康轻食。

每条资讯包含以下字段：
- title: 标题（吸引眼球、资讯风格，不超过25字）
- summary: 摘要（60-100字，描述事件核心）
- category: 分类
- source: 来源媒体名称
- publishTime: 发布日期（YYYY-MM-DD）
- views: 阅读量/热度
- imageIcon: 代表食物的emoji（一个）
- imageColor: 图片渐变色（CSS渐变）

同时生成：
- hotTop5: 本周热门TOP5，每项含 title（不超过18字）和 views
- sourceSites: 6个热门来源站点，含 name 和 count（文章数量）

回传 JSON:
{
  "news": [...],
  "hotTop5": [{"title": "...", "views": "..."}],
  "sourceSites": [{"name": "...", "count": "..."}]
}` }
  ];
}

function parseResponse(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    week: getWeekKey(),
    news: (parsed.news || []).slice(0, 9).map((n, i) => ({
      id: i + 1,
      title: n.title || '',
      summary: n.summary || '',
      category: n.category || '行业趋势',
      source: n.source || '综合',
      sourceColor: getSourceColor(n.source),
      publishTime: n.publishTime || '',
      views: n.views || '1万+',
      imageColor: categoryColors[n.category] || 'linear-gradient(135deg, #4A5568, #2D3748)',
      imageIcon: n.imageIcon || '📰',
      url: '#'
    })),
    hotTop5: (parsed.hotTop5 || []).slice(0, 5),
    sourceSites: (parsed.sourceSites || []).slice(0, 6)
  };
}

function buildResponse(statusCode, body) {
  return {
    isBase64Encoded: false,
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}

exports.main_handler = async (event) => {
  // OPTIONS 預檢請求
  if (event.httpMethod === 'OPTIONS') {
    return buildResponse(200, {});
  }

  if (event.httpMethod !== 'GET') {
    return buildResponse(405, { error: 'Method not allowed' });
  }

  const weekKey = getWeekKey();

  // 快取命中
  if (cache.week === weekKey && cache.data) {
    return buildResponse(200, { ...cache.data, cached: true });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return buildResponse(200, { week: weekKey, news: [], hotTop5: [], sourceSites: [], error: 'DEEPSEEK_API_KEY 未設定' });
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildPrompt(getWeekStr()),
        temperature: 0.85,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API 錯誤 (${response.status})`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 回傳格式异常');

    const parsed = parseResponse(content);
    cache = { week: weekKey, data: parsed };

    return buildResponse(200, { ...parsed, cached: false });

  } catch (err) {
    console.error('SCF Error:', err);
    if (cache.data) {
      return buildResponse(200, { ...cache.data, cached: true, note: '使用最近快取' });
    }
    return buildResponse(500, { error: err.message || '内部错误' });
  }
};
