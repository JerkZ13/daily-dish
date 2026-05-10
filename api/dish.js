// 每日美食推薦 API — Vercel Serverless Function
// 呼叫 DeepSeek API 生成三道料理推薦

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// 簡易記憶體快取（同一個 warm instance 內有效）
let cache = { date: '', data: null };

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildPrompt(todayStr, weekday) {
  return {
    messages: [
      {
        role: 'system',
        content: `你是一位專業的美食推薦專家，擅長根據季節、天氣與飲食文化推薦最適合當日享用的料理。
請嚴格以 JSON 陣列格式回應，不要包含任何其他文字。`
      },
      {
        role: 'user',
        content: `今天是 ${todayStr}，${weekday}。

請推薦 3 道今天最適合享用的料理。請考慮：
1. 季節性與當令食材
2. 菜系多樣性（中式、日式、義式、法式、泰式、印度等）
3. 口味均衡（清爽、濃郁、甜點等）
4. 不同難易度組合

回傳 JSON 陣列，每個元素包含以下欄位：
{
  "name": "菜名（繁體中文）",
  "name_en": "英文或拼音名稱",
  "emoji": "代表食物的表情符號（一個）",
  "cuisine": "菜系分類（如：日式、義式、中式等）",
  "description": "關於這道菜的精彩介紹，包含風味特色、口感與文化背景（80-120字）",
  "reason": "為什麼今天推薦這道菜，結合季節、天氣或飲食建議（40-60字）",
  "tasting_notes": "品味重點，包含適合搭配的飲品或食用建議（30-50字）",
  "difficulty": "難易度（簡單 / 中等 / 困難）"
}

請確保每道菜的推薦原因都與「今天」有關，且三道菜的風格差異夠大。`
      }
    ],
    temperature: 0.85,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };
}

function parseDishes(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // DeepSeek 可能回傳 { dishes: [...] } 或直接 [...] 或 { recommendation: [...] } 等
    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed.dishes && Array.isArray(parsed.dishes)) {
      list = parsed.dishes;
    } else if (parsed.recommendation && Array.isArray(parsed.recommendation)) {
      list = parsed.recommendation;
    } else if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
      list = parsed.recommendations;
    } else {
      // 找第一個陣列欄位
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0 && parsed[key][0].name) {
          list = parsed[key];
          break;
        }
      }
    }

    if (!list || !Array.isArray(list) || list.length === 0) {
      throw new Error('無法解析 AI 回傳的料理資料');
    }

    return list.slice(0, 3).map((d, i) => ({
      name: d.name || `料理 #${i + 1}`,
      name_en: d.name_en || '',
      emoji: d.emoji || '🍽️',
      cuisine: d.cuisine || '綜合',
      description: d.description || d.intro || '暫無介紹',
      reason: d.reason || d.why || '今日精選推薦',
      tasting_notes: d.tasting_notes || d.tip || d.notes || d.pairing || '',
      difficulty: d.difficulty || '中等'
    }));
  } catch (e) {
    throw new Error(`解析 AI 回應失敗: ${e.message}`);
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  const todayStr = getTodayStr();
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][new Date().getDay()];

  // 檢查快取
  if (cache.date === todayStr && cache.data) {
    return res.status(200).json({ date: todayStr, dishes: cache.data, cached: true });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'DEEPSEEK_API_KEY 未設定',
      hint: '請在 Vercel 專案設定中新增 DEEPSEEK_API_KEY 環境變數'
    });
  }

  try {
    const prompt = buildPrompt(todayStr, weekday);

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
      throw new Error(`DeepSeek API 錯誤 (${response.status}): ${errBody}`);
    }

    const result = await response.json();

    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
      throw new Error('DeepSeek API 回傳格式異常');
    }

    const content = result.choices[0].message.content;
    const dishes = parseDishes(content);

    // 寫入快取
    cache = { date: todayStr, data: dishes };

    // 設定 CDN 快取 4 小時
    res.setHeader('Cache-Control', 'public, s-maxage=14400, stale-while-revalidate=3600');

    return res.status(200).json({
      date: todayStr,
      dishes: dishes,
      cached: false
    });

  } catch (err) {
    console.error('API Error:', err);

    // 如果快取有昨天的資料， fallback
    if (cache.data && cache.data.length > 0) {
      return res.status(200).json({
        date: todayStr,
        dishes: cache.data,
        cached: true,
        note: '使用最近一次成功快取'
      });
    }

    return res.status(500).json({
      error: err.message || '內部伺服器錯誤'
    });
  }
}
