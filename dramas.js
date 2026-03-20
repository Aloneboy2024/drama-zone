// api/dramas.js — Returns drama list from JSONBin DB

const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  try {
    if (!JSONBIN_ID || !JSONBIN_KEY) {
      // Env variables nahi set hai toh empty return karo
      return res.status(200).json({ dramas: [], last_updated: null, note: "Setup pending" });
    }

    const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });

    const data = await response.json();
    const db = data.record || { dramas: [], last_updated: null };

    return res.status(200).json(db);
  } catch (err) {
    console.error("Dramas fetch error:", err);
    return res.status(200).json({ dramas: [], last_updated: null, error: err.message });
  }
}
