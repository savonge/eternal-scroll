// /api/entries.js
// Proxy endpoint — browser calls this, this calls Supabase server-side
export default async function handler(req, res) {
  // Allow all origins since this is our own public data
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const supaRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/live_entries?select=*&order=entry_num.asc`,
      {
        headers: {
          'apikey':        process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
        }
      }
    );

    if (!supaRes.ok) {
      const err = await supaRes.text();
      return res.status(500).json({ error: err });
    }

    const data = await supaRes.json();
    return res.status(200).json(data);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
