// api/cleanup.js — Fix titles: remove @tags, keep quality info, fetch TMDB

const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const TMDB_KEY = "2dca580c2a14b55200e784d157207b4d";

async function loadDB() {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
    headers: { "X-Master-Key": JSONBIN_KEY }
  });
  const data = await res.json();
  return data.record || { dramas: [], last_updated: null };
}

async function saveDB(db) {
  await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_KEY
    },
    body: JSON.stringify(db)
  });
}

function cleanTitle(filename) {
  let name = filename.replace(/\.(mkv|mp4|avi|mov|wmv)$/i, "").trim();
  name = name.replace(/@\w+/g, "").trim();
  
  const yearMatch = name.match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
  
  let searchName = name.replace(/\s*\(\d{4}\).*$/, "").trim();
  
  return { displayTitle: name, searchName, year };
}

async function fetchTMDB(searchName, year) {
  try {
    const query = encodeURIComponent(searchName);
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${query}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (!data.results || !data.results.length) return null;
    
    const result = data.results[0];
    const detailUrl = `https://api.themoviedb.org/3/${result.media_type}/${result.id}?api_key=${TMDB_KEY}&append_to_response=credits`;
    const detailRes = await fetch(detailUrl);
    const detail = await detailRes.json();
    
    const cast = (detail.credits?.cast || []).slice(0, 4).map(c => c.name);
    const genres = (detail.genres || []).map(g => g.name);
    const posterUrl = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null;
    const rating = detail.vote_average ? detail.vote_average.toFixed(1) : "";
    const isMovie = result.media_type === "movie";

    return {
      rating,
      genre: genres,
      language: "Hindi/English",
      network: isMovie ? "Cinema" : (detail.networks?.[0]?.name || ""),
      episodes: isMovie ? "1 (Movie)" : (detail.number_of_episodes?.toString() || ""),
      cast,
      synopsis: detail.overview || "",
      poster_url: posterUrl
    };
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.query.key !== "cleanup2024") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const db = await loadDB();
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < db.dramas.length; i++) {
      const drama = db.dramas[i];
      const isFilename = /\.(mkv|mp4|avi|mov|wmv)$/i.test(drama.title) || 
                         /(480p|720p|1080p|BluRay|WEB-DL|x264|x265)/i.test(drama.title);
      
      if (isFilename) {
        const { displayTitle, searchName, year } = cleanTitle(drama.title);
        const tmdbInfo = await fetchTMDB(searchName, year);
        
        if (tmdbInfo) {
          db.dramas[i] = {
            ...drama,
            title: displayTitle,
            year,
            ...tmdbInfo,
            id: drama.id,
            channel_link: drama.channel_link,
            file_id: drama.file_id,
            added_date: drama.added_date
          };
          updated++;
        } else {
          db.dramas[i].title = displayTitle;
          db.dramas[i].year = year;
          failed++;
        }
        
        await new Promise(r => setTimeout(r, 300));
      }
    }

    db.last_updated = new Date().toISOString();
    await saveDB(db);

    return res.status(200).json({ ok: true, updated, failed, total: db.dramas.length });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
      }
