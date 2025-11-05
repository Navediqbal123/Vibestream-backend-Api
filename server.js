// ✅ Core imports
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";

// ✅ Firestore (client SDK you've already set up in firebase.js)
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query as fsQuery,
  orderBy,
  limit as fsLimit,
  where
} from "firebase/firestore";
import { db } from "./firebase.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// =============== ENV =================
const API_KEY = process.env.YT_API_KEY;                  // YouTube Data API v3
const REGION = process.env.FEED_REGION || "IN";          // default India
const PAGE_SIZE = Number(process.env.FEED_PAGE_SIZE || 20);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */6 * * *"; // every 6 hours

if (!API_KEY) {
  console.warn("⚠️ YT_API_KEY missing. Set it in Render > Environment.");
}

// =============== HELPERS =============
/** Save/Upsert video by videoId (duplicate-safe) */
async function saveVideo(video) {
  // videos/{videoId} as document id ⇒ duplicate-safe
  const ref = doc(db, "videos", video.videoId);
  await setDoc(ref, video, { merge: true });
}

/** Bulk save */
async function saveMany(videos) {
  for (const v of videos) {
    try {
      await saveVideo(v);
    } catch (e) {
      console.error("❌ Save error", v.videoId, e?.message);
    }
  }
}

/** Map a YT videos.list item -> compact object */
function mapVideoItem(it) {
  const { id, snippet, statistics, contentDetails } = it;
  return {
    videoId: typeof id === "string" ? id : id?.videoId || "",
    title: snippet?.title || "",
    description: snippet?.description || "",
    channel: snippet?.channelTitle || "",
    publishedAt: snippet?.publishedAt || new Date().toISOString(),
    thumbnail:
      snippet?.thumbnails?.maxres?.url ||
      snippet?.thumbnails?.high?.url ||
      snippet?.thumbnails?.medium?.url ||
      snippet?.thumbnails?.default?.url ||
      "",
    duration: contentDetails?.duration || "", // ISO8601 (PTxxS/M/H)
    views: statistics?.viewCount || "0",
    likes: statistics?.likeCount || "0",
    tags: snippet?.tags || [],
    createdAt: new Date().toISOString(),
    // simple flag for shorts (YT API doesn't give explicit "shorts")
    isShort:
      (contentDetails?.duration || "").includes("PT") &&
      /PT(?:\d+S|\d{1,2}M(?:\d+S)?)$/i.test(contentDetails?.duration || "") // <= ~1 min approx
  };
}

/** Fetch details for list of IDs */
async function fetchDetailsByIds(ids = []) {
  if (!ids.length) return [];
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=snippet,contentDetails,statistics&id=${ids.join(",")}&key=${API_KEY}`;
  const r = await fetch(url);
  const json = await r.json();
  if (!json.items) return [];
  return json.items.map(mapVideoItem);
}

/** Search helper (search.list then hydrate with videos.list) */
async function ytSearch({ q, regionCode, maxResults = 25, videoDuration }) {
  const searchURL =
    "https://www.googleapis.com/youtube/v3/search" +
    `?part=snippet&type=video&maxResults=${maxResults}` +
    `&regionCode=${encodeURIComponent(regionCode || REGION)}` +
    (q ? `&q=${encodeURIComponent(q)}` : "") +
    (videoDuration ? `&videoDuration=${videoDuration}` : "") +
    `&order=date&relevanceLanguage=en&key=${API_KEY}`;

  const res = await fetch(searchURL);
  const data = await res.json();
  const ids = (data.items || []).map((i) => i.id.videoId).filter(Boolean);
  return fetchDetailsByIds(ids);
}

/** Trending (mostPopular) */
async function ytTrending({ regionCode, maxResults = 25 }) {
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=snippet,contentDetails,statistics&chart=mostPopular&maxResults=${maxResults}` +
    `&regionCode=${encodeURIComponent(regionCode || REGION)}&key=${API_KEY}`;
  const r = await fetch(url);
  const json = await r.json();
  if (!json.items) return [];
  return json.items.map(mapVideoItem);
}

/** Auto fetch combo: shorts + normal (mixed) */
async function autoFetchCombo({ regionCode = REGION, maxResults = 25 } = {}) {
  // Shorts (approx via videoDuration=short)
  const shorts = await ytSearch({
    q: "trending shorts",
    regionCode,
    maxResults,
    videoDuration: "short"
  });

  // Normal videos (mix medium + long via trending list)
  const normal = await ytTrending({ regionCode, maxResults });

  // combine (unique by videoId)
  const map = new Map();
  [...shorts, ...normal].forEach((v) => map.set(v.videoId, v));
  return Array.from(map.values());
}

// ============== ROUTES =================

// Health
app.get("/", (req, res) => {
  res.send("🔥 Vibestream Backend Ready — Feed + Trending + Auto-Fetch + Search");
});

// 1) Single video fetch + save (already in your app)
app.get("/api/video", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Video ID required" });
    if (!API_KEY) return res.status(500).json({ error: "Missing YT_API_KEY" });

    const details = await fetchDetailsByIds([id]);
    if (!details.length) return res.status(404).json({ error: "Video not found" });

    const video = details[0];
    await saveVideo(video);
    res.json({ message: "✅ Video fetched & saved successfully!", video });
  } catch (e) {
    console.error("❌ /api/video error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 2) Home Feed (latest mix from Firestore)
app.get("/feed/mix", async (req, res) => {
  try {
    const col = collection(db, "videos");
    // latest first
    const q = fsQuery(col, orderBy("createdAt", "desc"), fsLimit(PAGE_SIZE));
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    res.json({ count: items.length, items });
  } catch (e) {
    console.error("❌ /feed/mix error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 3) Trending (direct from YT, optional save)
app.get("/feed/trending", async (req, res) => {
  try {
    const regionCode = req.query.region || REGION;
    const items = await ytTrending({ regionCode, maxResults: PAGE_SIZE });
    // optional: save to DB
    await saveMany(items);
    res.json({ count: items.length, items });
  } catch (e) {
    console.error("❌ /feed/trending error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 4) Search (query → fetch from YT → return + save)
app.get("/feed/search", async (req, res) => {
  try {
    const qStr = req.query.q || "";
    if (!qStr) return res.status(400).json({ error: "q (query) required" });

    const items = await ytSearch({
      q: qStr,
      regionCode: req.query.region || REGION,
      maxResults: PAGE_SIZE
    });

    // save
    await saveMany(items);

    res.json({ count: items.length, items });
  } catch (e) {
    console.error("❌ /feed/search error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 5) Manual fetch now (mix)
app.post("/fetch/manual", async (req, res) => {
  try {
    const regionCode = req.body?.region || REGION;
    const max = Number(req.body?.max || 30);
    const items = await autoFetchCombo({ regionCode, maxResults: max });
    await saveMany(items);
    res.json({ message: "✅ Manual fetch done", saved: items.length });
  } catch (e) {
    console.error("❌ /fetch/manual error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 6) Just-shorts feed (optional endpoint)
app.get("/feed/shorts", async (req, res) => {
  try {
    const col = collection(db, "videos");
    const q = fsQuery(
      col,
      where("isShort", "==", true),
      orderBy("createdAt", "desc"),
      fsLimit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    res.json({ count: items.length, items });
  } catch (e) {
    console.error("❌ /feed/shorts error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ============== CRON (AUTO-FETCH) ==============
if (API_KEY) {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      console.log("⏰ CRON: Auto-fetch started…");
      const items = await autoFetchCombo({ regionCode: REGION, maxResults: 30 });
      await saveMany(items);
      console.log(`✅ CRON: Saved ${items.length} videos`);
    } catch (e) {
      console.error("❌ CRON error:", e);
    }
  });
  console.log(`⏱️ CRON scheduled: ${CRON_SCHEDULE} (region=${REGION})`);
} else {
  console.log("⚠️ CRON disabled (YT_API_KEY missing).");
}

// ============== START ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Vibestream Backend running on port ${PORT}`)
);
