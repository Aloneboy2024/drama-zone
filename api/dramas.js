export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const JSONBIN_ID = process.env.JSONBIN_ID;
  const JSONBIN_KEY = process.env.JSONBIN_KEY;

  try {
    if (!JSONBIN_ID || !JSONBIN_KEY) {
      return res.status(200).json({ dramas: [], last_updated: null });
    }

    const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });

    const data = await response.json();
    const db = data.record || { dramas: [], last_updated: null };

    return res.status(200).json(db);
  } catch (err) {
    return res.status(200).json({ dramas: [], last_updated: null, error: err.message });
  }
}
