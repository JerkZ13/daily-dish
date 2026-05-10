// 每周美食热点 API — Vercel Serverless Function
// 呼叫 DeepSeek API 生成每周美食热点资讯

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

let cache = { week: '', data: null };

function getWeekKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekOfMonth = Math.ceil(day / 7);
  return `${y}-${m}-W${weekOfMonth}`;
}

function getWeekStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekOfMonth = Math.ceil(day / 7);
  return `${y}年${m}月第${weekOfMonth}周`;
}

function buildPrompt(weekStr) {
  return {
    messages: [
      {
        role: 'system',
        content: '你是一位专业的美食资讯编辑，擅长收集和撰写美食行业热点新闻。请严格以 JSON 格式回应，不要包含任何其他文字。'
      },
      {
        role: 'user',
        content: `请为 "${weekStr}" 的美食周报生成 9 条美食热点资讯。

涵盖以下类别：新品上市、探店爆款、节日美食、行业趋势、地方风味、健康轻食。

每条资讯包含以下字段：
- title: 标题（吸引眼球、资讯风格，不超过25字）
- summary: 摘要（60-100字，描述事件核心）
- category: 分类（新品上市/探店爆款/节日美食/行业趋势/地方风味/健康轻食）
- source: 来源媒体名称（如小红书、大众点评、36氪等）
- publishTime: 发布日期（YYYY-MM-DD 格式，在本周范围内）
- views: 阅读量/热度（如 "12.3万"）
- imageIcon: 代表食物的emoji（一个）
- imageColor: 图片渐变色（CSS渐变，如 "linear-gradient(135deg, #F2994A, #E67E22)"）

同时生成：
- hotTop5: 本周热门TOP5列表，每条含 title（不超过18字）和 views
- sourceSites: 6个热门来源站点，含 name 和 count（文章数量）

请确保每条新闻内容真实可信、贴合当下季节和饮食趋势，类别分布均衡。

回传 JSON 格式：
{
  "news": [...],
  "hotTop5": [{"title": "...", "views": "..."}],
  "sourceSites": [{"name": "...", "count": "..."}]
}`
      }
    ],
    temperature: 0.85,
    max_tokens: 3000,
    response_format: { type: 'json_object' }
  };
}

function parseResponse(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      news: (parsed.news || []).slice(0, 9).map(n => ({
        id: Math.random().toString(36).slice(2, 8),
        title: n.title || '',
        summary: n.summary || '',
        category: n.category || '行业趋势',
        source: n.source || '综合',
        sourceColor: getSourceColor(n.source),
        publishTime: n.publishTime || '',
        views: n.views || '1万+',
        imageColor: n.imageColor || 'linear-gradient(135deg, #4A5568, #2D3748)',
        imageIcon: n.imageIcon || '📰',
        url: '#'
      })),
      hotTop5: (parsed.hotTop5 || []).slice(0, 5),
      sourceSites: (parsed.sourceSites || []).slice(0, 6)
    };
  } catch (e) {
    throw new Error('解析 AI 回传失败: ' + e.message);
  }
}

function getSourceColor(name) {
  const map = {
    '小红书': '#FF6B6B',
    '大众点评': '#E74C3C',
    '抖音': '#1E1E1E',
    '36氪': '#3498DB',
    '美食天下': '#27AE60',
    '名厨': '#2C3E50',
    '成都发布': '#E67E22',
    '北京发布': '#C0392B',
    '餐饮老板内参': '#3498DB'
  };
  for (const [k, v] of Object.entries(map)) {
    if (name.includes(k)) return v;
  }
  return '#5C3D2E';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Content-Type', 'application/json');

  const weekKey = getWeekKey();

  if (cache.week === weekKey && cache.data) {
    return res.status(200).json({ week: weekKey, ...cache.data, cached: true });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'DEEPSEEK_API_KEY 未设定',
      hint: '请在 Vercel 专案设定中新增 DEEPSEEK_API_KEY 环境变数'
    });
  }

  try {
    const prompt = buildPrompt(getWeekStr());
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        ...prompt,
        stream: false
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`DeepSeek API 错误 (${response.status})`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek API 回传格式异常');

    const parsed = parseResponse(content);
    cache = { week: weekKey, data: parsed };

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    return res.status(200).json({ week: weekKey, ...parsed, cached: false });

  } catch (err) {
    console.error('API Error:', err);
    if (cache.data) {
      return res.status(200).json({ week: weekKey, ...cache.data, cached: true, note: '使用最近快取' });
    }
    return res.status(500).json({ error: err.message || '内部伺服器错误' });
  }
}
