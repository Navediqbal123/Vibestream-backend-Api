// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Global Error Handlers ----------
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
});

// ---------- Logging Middleware ----------
app.use((req, res, next) => {
  console.log(`➡️ Request: ${req.method} ${req.url}`);
  next();
});

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ Debug log: env check (will not print sensitive keys)
console.log("🧩 Environment check:");
console.log("SUPABASE_URL:", SUPABASE_URL ? "✅ Found" : "❌ Missing");
console.log("SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_KEY ? "✅ Found" : "❌ Missing");
console.log("YOUTUBE_API_KEY:", YT_API_KEY ? "✅ Found" : "❌ Missing");

// ---------- Supabase Setup ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Helpers ----------
const YT_BASE = "https://www.googleapis.com/youtube/v3";

async function upsertVideo(v) {
  const { error } = await supabase.from("videos").upsert(v, { onConflict: "videoId" });
  if (error) console.error("❌ Supabase upsert error:", error.message);
}

function mapVideoItem(item) {
  const id = item.id?.videoId || item.id;
  const sn = item.snippet || {};
  const st = item.statistics || {};
  const thumbnails = sn.thumbnails || {};
  const thumb =
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    "";

  return {
    videoId: id,
    title: sn.title || "",
    description: sn.description || "",
    channel: sn.channelTitle || "",
    publishedAt: sn.publishedAt || new Date().toISOString(),
    thumbnail: thumb,
    views: st.viewCount ? Number(st.viewCount) : null,
    likes: st.likeCount ? Number(st.likeCount) : null,
    isShort: true,
    created_at: new Date().toISOString(),
  };
}

async function enrichDetails(videoIds) {
  if (!videoIds.length) return {};
  const url = `${YT_BASE}/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(
    ","
  )}&key=${YT_API_KEY}`;
  console.log("📡 Fetching video details:", url);
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) console.error("❌ YouTube detail API error:", j.error);
  const map = {};
  (j.items || []).forEach((it) => (map[it.id] = it));
  return map;
}

// ---------- Routes ----------
app.get("/", (_req, res) => {
  res.send("🔥 Vibestream Backend — Endpoints: /feed /trending /fetch/shorts");
});

// Feed (latest shorts)
app.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { data, error } = await supabase
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    res.json({ items: data });
  } catch (e) {
    console.error("🔥 /feed error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Trending (auto fetch from YouTube)
app.get("/trending", async (req, res) => {
  try {
    console.log("🔥 /trending route called — fetching YouTube data...");

    const region = (req.query.region || "IN").toUpperCase();
    const maxResults = Math.min(Number(req.query.limit) || 20, 50);

    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const url = `${YT_BASE}/search?part=snippet&type=video&videoDuration=short&order=viewCount&regionCode=${region}&maxResults=${maxResults}&publishedAfter=${publishedAfter}&key=${YT_API_KEY}`;
    
    console.log("🌍 Fetching from:", url);
    const r = await fetch(url);
    const j = await r.json();

    if (j.error) {
      console.error("❌ YouTube API error:", j.error);
      return res.status(500).json({ error: j.error.message });
    }

    console.log("🎬 YouTube items found:", (j.items || []).length);

    const ids = (j.items || []).map((i) => i.id.videoId).filter(Boolean);
    if (ids.length === 0) {
      console.warn("⚠️ No video IDs found. Possible quota issue or empty results.");
      return res.json({ items: [] });
    }

    const details = await enrichDetails(ids);
    const list = ids.map((id) => mapVideoItem(details[id] || { id, snippet: {} }));

    await Promise.all(list.map((v) => upsertVideo(v)));
    console.log("✅ Supabase upsert done for", list.length, "videos");

    res.json({ items: list });
  } catch (e) {
    console.error("🔥 /trending error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Manual YouTube fetch
app.post("/fetch/shorts", async (req, res) => {
  try {
    const {
      keywords = ["trending shorts", "funny shorts", "tech shorts", "news shorts", "bollywood shorts"],
      region = "IN",
      limit = 25,
    } = req.body || {};

    console.log("🛠️ Manual fetch started with keywords:", keywords);

    const collected = [];
    for (const kw of keywords) {
      console.log("🔎 Searching:", kw);
      const url = `${YT_BASE}/search?part=snippet&maxResults=${Math.min(
        limit,
        25
      )}&type=video&videoDuration=short&order=date&regionCode=${region}&q=${encodeURIComponent(
        kw
      )}&key=${YT_API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();

      if (j.error) console.error("❌ YouTube API error (manual):", j.error);

      const ids = (j.items || []).map((i) => i.id.videoId).filter(Boolean);
      const details = await enrichDetails(ids);
      const pack = ids.map((id) => mapVideoItem(details[id] || { id, snippet: {} }));
      collected.push(...pack);
    }

    const dedupMap = new Map();
    for (const v of collected) dedupMap.set(v.videoId, v);
    const finalList = Array.from(dedupMap.values()).slice(0, 30);

    await Promise.all(finalList.map((v) => upsertVideo(v)));
    console.log("✅ Manual fetch completed. Added:", finalList.length, "videos.");

    res.json({ added: finalList.length });
  } catch (e) {
    console.error("🔥 /fetch/shorts error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Cron (Auto fetch every 6 hrs) ----------
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */6 * * *";
const AUTO_KEYWORDS = [
  "trending shorts",
  "viral shorts",
  "music shorts",
  "funny shorts",
  "sports shorts",
  "gaming shorts",
  "tech shorts",
  "education shorts",
  "news shorts",
];

async function autoFetch() {
  try {
    console.log("⏱️ AutoFetch started…");
    const regions = ["IN", "US", "GB"];
    for (const region of regions) {
      console.log("🌎 Auto fetching region:", region);
      const url = `${YT_BASE}/search?part=snippet&type=video&videoDuration=short&order=date&regionCode=${region}&maxResults=25&q=${encodeURIComponent(
        AUTO_KEYWORDS.join(" | ")
      )}&key=${YT_API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      if (j.error) console.error("❌ YouTube AutoFetch API error:", j.error);
      const ids = (j.items || []).map((i) => i.id.videoId).filter(Boolean);
      const details = await enrichDetails(ids);
      const pack = ids.map((id) => mapVideoItem(details[id] || { id, snippet: {} }));
      const dedup = new Map();
      for (const v of pack) dedup.set(v.videoId, v);
      const finalList = Array.from(dedup.values()).slice(0, 30);
      await Promise.all(finalList.map((v) => upsertVideo(v)));
      console.log(`✅ AutoFetch region=${region} saved=${finalList.length}`);
    }
    console.log("⏱️ AutoFetch done.");
  } catch (e) {
    console.error("🔥 AutoFetch error:", e);
  }
}

cron.schedule(CRON_SCHEDULE, autoFetch, { timezone: "UTC" });

// ---------- 404 ----------
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ---------- Start ----------
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Vibestream Backend running on port ${PORT}`)
);
