// api/webhook.js — Telegram Bot Webhook Handler
// Vercel serverless function

const BOT_TOKEN = process.env.BOT_TOKEN;
const DRAMA_CHANNEL_ID = process.env.DRAMA_CHANNEL_ID; // -1002160893131
const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID; // -1003080073617
const WEBSITE_URL = process.env.WEBSITE_URL || "https://your-site.vercel.app";

// Simple in-memory store won't persist, so we use Vercel KV or external DB
// For simplicity, we use JSONBin.io as free DB
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadDB() {
  try {
    if (!JSONBIN_ID || !JSONBIN_KEY) return { dramas: [], last_updated: null };
    const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    const data = await res.json();
    return data.record || { dramas: [], last_updated: null };
  } catch (e) {
    console.error("DB load error:", e);
    return { dramas: [], last_updated: null };
  }
}

async function saveDB(db) {
  try {
    if (!JSONBIN_ID || !JSONBIN_KEY) return;
    await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY
      },
      body: JSON.stringify(db)
    });
  } catch (e) {
    console.error("DB save error:", e);
  }
}

// ─── Caption parser ───────────────────────────────────────────────────────────

function parseCaption(caption) {
  const info = {
    title: "", rating: "", genre: [], language: "",
    network: "", episodes: "", cast: [], synopsis: ""
  };
  if (!caption) return info;

  const lines = caption.split("\n");
  for (const line of lines) {
    const l = line.trim();
    const lower = l.toLowerCase();

    if (lower.includes("title:") || l.includes("🎬"))
      info.title = l.split(":").slice(1).join(":").trim().replace(/^🎬\s*/, "").trim();
    else if (lower.includes("rating:") || l.includes("⭐") || l.includes("💫"))
      info.rating = l.split(":").slice(1).join(":").trim().replace(/^[⭐💫]\s*/, "").trim();
    else if (lower.includes("genre:") || l.includes("🧩"))
      info.genre = l.split(":").slice(1).join(":").split(",").map(g => g.trim().replace("#",""));
    else if (lower.includes("language:") || l.includes("🗣"))
      info.language = l.split(":").slice(1).join(":").trim().replace(/^🗣\s*/, "").trim();
    else if (lower.includes("network:") || l.includes("📺"))
      info.network = l.split(":").slice(1).join(":").trim().replace(/^📺\s*/, "").trim();
    else if (lower.includes("episodes:") || l.includes("📅"))
      info.episodes = l.split(":").slice(1).join(":").trim().replace(/^📅\s*/, "").trim();
    else if (lower.includes("cast:") || lower.includes("actors:") || l.includes("⭐"))
      info.cast = l.split(":").slice(1).join(":").split(",").map(c => c.trim());
    else if (lower.includes("story:") || lower.includes("synopsis:") || l.includes("📝"))
      info.synopsis = l.split(":").slice(1).join(":").trim().replace(/^📝\s*/, "").trim();
  }

  if (!info.title && lines.length > 0) info.title = lines[0].trim();
  return info;
}

// ─── Telegram sender ──────────────────────────────────────────────────────────

async function sendTelegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function postToUpdateChannel(drama, fileId) {
  const watchLink = `${WEBSITE_URL}`;
  const genres = (drama.genre || []).join(", ");

  const caption = `🎬 <b>${drama.title}</b>

${drama.rating ? `💫 Rating: ${drama.rating}` : ""}
${drama.language ? `🗣 Language: ${drama.language}` : ""}
${drama.network ? `📺 Network: ${drama.network}` : ""}
${drama.episodes ? `📅 Episodes: ${drama.episodes}` : ""}
${genres ? `🧩 Genre: ${genres}` : ""}

${drama.synopsis ? `📝 ${drama.synopsis}` : ""}

━━━━━━━━━━━━━━
👁 <a href="${watchLink}">Watch Online</a>  |  📥 <a href="${drama.channel_link || watchLink}">Download</a>
━━━━━━━━━━━━━━
🌐 <a href="${WEBSITE_URL}">Full Site Visit Karo</a>`.replace(/\n{3,}/g, "\n\n");

  if (fileId) {
    await sendTelegram("sendPhoto", {
      chat_id: UPDATE_CHANNEL_ID,
      photo: fileId,
      caption,
      parse_mode: "HTML"
    });
  } else {
    await sendTelegram("sendMessage", {
      chat_id: UPDATE_CHANNEL_ID,
      text: caption,
      parse_mode: "HTML",
      disable_web_page_preview: false
    });
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  try {
    const update = req.body;
    const message = update.channel_post || update.message;

    if (!message) return res.status(200).json({ ok: true });

    const chatId = String(message.chat?.id);
    const sourceChatId = String(DRAMA_CHANNEL_ID);

    // Sirf drama channel ke posts process karo
    if (chatId !== sourceChatId && chatId !== sourceChatId.replace("-100", "-")) {
      return res.status(200).json({ ok: true });
    }

    const caption = message.caption || message.text || "";
    const drama = parseCaption(caption);

    if (!drama.title) return res.status(200).json({ ok: true });

    const db = await loadDB();

    // Duplicate check
    const exists = db.dramas.some(d => d.title.toLowerCase() === drama.title.toLowerCase());
    if (exists) return res.status(200).json({ ok: true, note: "duplicate" });

    // Poster file ID
    let fileId = null;
    let posterUrl = null;
    if (message.photo && message.photo.length > 0) {
      fileId = message.photo[message.photo.length - 1].file_id;
      // Get poster URL
      const fileInfo = await sendTelegram("getFile", { file_id: fileId });
      if (fileInfo.result?.file_path) {
        posterUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
      }
    }

    // Channel link
    const channelUsername = message.chat.username;
    const channelLink = channelUsername
      ? `https://t.me/${channelUsername}/${message.message_id}`
      : `https://t.me/c/${String(message.chat.id).replace("-100", "")}/${message.message_id}`;

    const newDrama = {
      id: (db.dramas.length + 1),
      title: drama.title,
      year: new Date().getFullYear(),
      rating: drama.rating,
      genre: drama.genre,
      language: drama.language,
      network: drama.network,
      episodes: drama.episodes,
      cast: drama.cast,
      synopsis: drama.synopsis,
      file_id: fileId,
      poster_url: posterUrl,
      channel_link: channelLink,
      added_date: new Date().toISOString()
    };

    db.dramas.unshift(newDrama); // Nayi dramas pehle
    db.last_updated = new Date().toISOString();
    await saveDB(db);

    // Update channel pe post karo
    await postToUpdateChannel(newDrama, fileId);

    return res.status(200).json({ ok: true, added: drama.title });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: true, error: err.message });
  }
}
