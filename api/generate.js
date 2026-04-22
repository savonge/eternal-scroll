// Runs on the 1st and 15th of every month at 09:00 UTC
// Fetches recent news, generates a Biblical passage, saves to Supabase

export default async function handler(req, res) {

  // Security: only allow Vercel cron calls
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Fetch recent news headlines
    const newsRes = await fetch(
      `https://newsapi.org/v2/top-headlines?language=en&pageSize=10&apiKey=${process.env.NEWS_API_KEY}`
    );
    const newsData = await newsRes.json();
    const headlines = newsData.articles
      .slice(0, 8)
      .map(a => a.title)
      .join('\n');

    // 2. Get current entry count from Supabase
    const countRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/live_entries?select=entry_num&order=entry_num.desc&limit=1`,
      { headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
      }}
    );
    const countData = await countRes.json();
    const nextNum = countData.length > 0 ? countData[0].entry_num + 1 : 1;

    // 3. Generate passage with Claude
    const today = new Date();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const dateStr = `${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

    const prompt = `You are writing a new passage for The Eternal Scroll — a living continuation of the Hebrew Bible in strict KJV style.

Today is ${dateStr}. Here are recent world headlines to draw themes from:
${headlines}

Write a single passage of 10-14 verses. Requirements:
- Strict KJV English: thee, thou, thy, thine, hath, doth, saith, cometh
- "Thus saith the LORD:" must appear at least once
- The Jewish people and Israel must be the moral center
- Treat current events as theology — find the eternal pattern in the daily news
- Mix narrative and prophetic voice
- No verse numbers — just the text of each verse

Return ONLY a JSON object in this exact format, no other text:
{
  "title": "A Passage Concerning [theme]",
  "date_biblical": "In the [ordinal] month, [poetic description]",
  "verses": [
    "verse text here",
    "verse text here"
  ]
}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text.trim();

    // Parse JSON response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');
    const passage = JSON.parse(jsonMatch[0]);

    // 4. Save to Supabase
    const insertRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/live_entries`,
      {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          entry_num:     nextNum,
          title:         passage.title,
          date:          today.toISOString().split('T')[0],
          date_biblical: passage.date_biblical,
          verses:        passage.verses
        })
      }
    );

    if (!insertRes.ok) {
      const err = await insertRes.text();
      throw new Error(`Supabase insert failed: ${err}`);
    }

    return res.status(200).json({
      success: true,
      entry_num: nextNum,
      title: passage.title
    });

  } catch (error) {
    console.error('Generate error:', error);
    return res.status(500).json({ error: error.message });
  }
}
