// server.js — final working version for Vibestream Backend
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const YT_API_KEY = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || "";

console.log("🚀 STARTUP: Checking environment variables...");
console.log(" SUPABASE_URL:", SUPABASE_URL ? "FOUND ✅" : "MISSING ❌");
console.log(" SUPABASE_KEY:", SUPABASE_KEY ? "FOUND ✅" : "MISSING ❌");
console.log(" YT_API_KEY:", YT_API_KEY ? "FOUND ✅" : "MISSING ❌");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Middleware logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} --> ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) =>
  res.send("🔥 Vibestream backend is live — endpoints: /env /ping /feed /trending")
);

/* 1️⃣ /env -> check environment variables */
app.get("/env", (_req, res) => {
  res.json({
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    YT_API_KEY: !!YT_API_KEY,
    NODE_ENV: process.env.NODE_ENV || null,
  });
});

/* 2️⃣ /ping -> health check */
app.get("/ping", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* 3️⃣ /feed -> latest videos from Supabase */
app.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { data, error } = await supabase
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (e) {
    console.error("❌ /feed error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 4️⃣ /trending -> fetch trending shorts from YouTube */
app.get("/trending", async (req, res) => {
  try {
    if (!YT_API_KEY) throw new Error("YT_API_KEY missing");

    const region = (req.query.region || "IN").toUpperCase();
    const q = encodeURIComponent("trending shorts");
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=10&regionCode=${region}&q=${q}&key=${YT_API_KEY}`;

    console.log("📡 Fetching trending from:", url);
    const r = await fetch(url);
    const j = await r.json();

    if (j.error) throw new Error(j.error.message);
    const items = (j.items || []).map((v) => ({
      videoId: v.id.videoId,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumbnail: v.snippet.thumbnails?.high?.url,
      publishedAt: v.snippet.publishedAt,
    }));

    res.json({ count: items.length, items });
  } catch (e) {
    console.error("❌ /trending error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* 5️⃣ /test-supabase -> test database connection */
app.get("/test-supabase", async (req, res) => {
  try {
    const { data, error, count } = await supabase
      .from("videos")
      .select("id", { count: "exact" })
      .limit(1);
    if (error) throw error;
    res.json({ ok: true, sampleCount: data?.length || 0, totalCount: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* 404 fallback */
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Vibestream backend running on port ${PORT}`)
);
