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

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;

// ---------- Supabase Setup ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------- helpers ----------
const YT_BASE = "https://www.googleapis.com/youtube/v3";

// Safe insert/update (no duplicates)
async function upsertVideo(v) {
  const { error } = await supabase
    .from("videos")
    .upsert(v, { onConflict: "videoId" });

  if (error) console.error("❌ Supabase upsert error:", error.message);
}

// extract short record from videos.list item
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
    createdAt: Date.now(),
  };
}

// fetch videos.details for stats/enrichment
async function enrichDetails(videoIds) {
  if (!videoIds.length) return {};
  const url = `${YT_BASE}/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(
    ","
  )}&key=${YT_API_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  const map = {};
  (j.items || []).forEach((it) => (map[it.id] = it));
  return map;
}

// ---------- routes ----------
app.get("/", (_req, res) => {
  res.send("🔥 Vibestream Backend (Supabase) — Endpoints: /feed /trending /fetch/shorts");
});

// Home feed (latest shorts)
app.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const { data, error } = await supabase
      .from("videos")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
  } catch (e) {
    console.error("/feed error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Trending shorts (region wise)
app.get("/trending", async (req, res) => {
  try {
    const region = (req.query.region || "IN").toUpperCase();
    const maxResults = Math.min(Number(req.query.limit) || 20, 50);

    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const url = `${YT_BASE}/search?part=snippet&type=video&videoDuration=short&order=viewCount&regionCode=${region}&maxResults=${maxResults}&publishedAfter=${publishedAfter}&key=${YT_API_KEY}`;
    const r = await fetch(url);
    const j = await r.json();

    const ids = (j.items || []).map((i) => i.id.videoId).filter(Boolean);
    const details = await enrichDetails(ids);

    const list = ids.map((id) => mapVideoItem(details[id] || { id, snippet: {} }));
    await Promise.all(list.map((v) => upsertVideo(v)));

    res.json({ items: list });
  } catch (e) {
    console.error("/trending error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Manual fetch (topics/keywords)
app.post("/fetch/shorts", async (req, res) => {
  try {
    const {
      keywords = ["trending shorts", "funny shorts", "tech shorts", "news shorts", "bollywood shorts"],
      region = "IN",
      limit = 25,
    } = req.body || {};

    const collected = [];
    for (const kw of keywords) {
      const url = `${YT_BASE}/search?part=snippet&maxResults=${Math.min(
        limit,
        25
      )}&type=video&videoDuration=short&order=date&regionCode=${region}&q=${encodeURIComponent(
        kw
      )}&key=${YT_API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      const ids = (j.items || []).map((i) => i.id.videoId).filter(Boolean);

      const details = await enrichDetails(ids);
      const pack = ids.map((id) => mapVideoItem(details[id] || { id, snippet: {} }));
      collected.push(...pack);
    }

    const dedupMap = new Map();
    for (const v of collected) dedupMap.set(v.videoId, v);
    const finalList = Array.from(dedupMap.values()).slice(0, 30);

    await Promise.all(finalList.map((v) => upsertVideo(v)));
    res.json({ added: finalList.length });
  } catch (e) {
    console.error("/fetch/shorts error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- CRON ----------
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
      const body = { keywords: AUTO_KEYWORDS, region, limit: 25 };
      const url = `${YT_BASE}/search?part=snippet&type=video&videoDuration=short&order=date&regionCode=${region}&maxResults=25&q=${encodeURIComponent(
        AUTO_KEYWORDS.join(" | ")
      )}&key=${YT_API_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
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
    console.error("AutoFetch error:", e);
  }
}

cron.schedule(CRON_SCHEDULE, autoFetch, { timezone: "UTC" });

// ---------- 404 ----------
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ---------- start ----------
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Vibestream Backend running on ${PORT}`)
);
