export default async function handler(req, res) {

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const newsRes = await fetch(
      `https://newsapi.org/v2/top-headlines?language=en&pageSize=10&apiKey=${process.env.NEWS_API_KEY}`
    );
    const newsData = await newsRes.json();
    const headlines = newsData.articles
      .slice(0, 8)
      .map(a => a.title)
      .join('\n');

    const countRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/live_entries?select=entry_num&order=entry_num.desc&limit=1`,
      { headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
      }}
    );
    const countData = await countRes.json();
    const nextNum = countData.length > 0 ? countData[0].entry_num + 1 : 1;

    const today = new Date();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const dateStr = `${months[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

    const prompt = `You are writing a new passage for The Eternal Scroll — a living continuation of the Hebrew Bible in strict KJV style.

Today is ${dateStr}. Here are recent world headlines:
${headlines}

Write a single passage of 10-14 verses. Requirements:
- Strict KJV English: thee, thou, thy, thine, hath, doth, saith, cometh
- Name specific nations, leaders, and events from the headlines using Biblical equivalents
- "Thus saith the LORD:" must appear at least once  
- The Jewish people and Israel must be the moral center
- Treat current events as theology — find the eternal pattern in the daily news
- Be SPECIFIC: name the kings, the nations, the conflicts. Do not be vague.
- Mix narrative and prophetic voice

TITLE RULES — this is critical:
- The title must be 1-3 words maximum
- Named after a person, place, or single concept — like the actual Bible books
- Examples of good titles: "The Decree", "Nineveh", "The Iron Throne", "Babylon", "The Envoys"
- NO titles like "A Passage Concerning..." — that is forbidden
- Think: Genesis, Exodus, Lamentations — that register

Return ONLY a JSON object, no other text:
{
  "title": "1-3 word title here",
  "date_biblical": "In the [ordinal] month, [poetic description of current season]",
  "verses": [
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
        model: 'claude-opus-4-7',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');
    const passage = JSON.parse(jsonMatch[0]);

    const insertRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/live_entries`,
      {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
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

    return res.status(200).json({ success: true, entry_num: nextNum, title: passage.title });

  } catch (error) {
    console.error('Generate error:', error);
    return res.status(500).json({ error: error.message });
  }
}
