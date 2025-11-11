// ✅ Vibestream Backend — FINAL HARD-CODED ADMIN VERSION
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

// ✅ Hard-coded admin credentials (Render env ke bina bhi chalega)
const ADMIN_EMAIL = "vibeadmin@stream.ai";
const ADMIN_PASS = "Stream@999";

console.log("🚀 Vibestream backend starting...");
console.log(" SUPABASE_URL:", SUPABASE_URL ? "✅ Found" : "❌ Missing");
console.log(" SUPABASE_KEY:", SUPABASE_KEY ? "✅ Found" : "❌ Missing");
console.log(" YT_API_KEY:", YT_API_KEY ? "✅ Found" : "❌ Missing");
console.log(" 🔐 Using hard-coded admin:", ADMIN_EMAIL);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* Logger */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] → ${req.method} ${req.url}`);
  next();
});

/* Root */
app.get("/", (_req, res) =>
  res.send("🔥 Vibestream backend live — endpoints: /env /ping /feed /trending /auto-feed /admin")
);

/* Env Check */
app.get("/env", (_req, res) => {
  res.json({
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    YT_API_KEY: !!YT_API_KEY,
    ADMIN_EMAIL,
  });
});

/* Health check */
app.get("/ping", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* Feed from Supabase */
app.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { data, error } = await supabase
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ ok: true, items: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Trending Shorts */
app.get("/trending", async (req, res) => {
  try {
    if (!YT_API_KEY) throw new Error("YT_API_KEY missing");
    const region = (req.query.region || "IN").toUpperCase();
    const q = encodeURIComponent("trending shorts");
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=10&regionCode=${region}&q=${q}&key=${YT_API_KEY}`;

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

    res.json({ ok: true, count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Auto-feed */
app.get("/auto-feed", async (req, res) => {
  try {
    const topic = req.query.topic || "trending shorts";
    const region = (req.query.region || "IN").toUpperCase();
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=15&q=${encodeURIComponent(
      topic
    )}&regionCode=${region}&key=${YT_API_KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);

    const videos = (j.items || []).map((v) => ({
      videoId: v.id.videoId,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumbnail: v.snippet.thumbnails.high.url,
      publishedAt: v.snippet.publishedAt,
    }));

    res.json({ ok: true, count: videos.length, items: videos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Test Supabase */
app.get("/test-supabase", async (_req, res) => {
  try {
    const { count, error } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    res.json({ ok: true, totalVideos: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* 🔥 ADMIN PANEL ROUTES 🔥 */

// Admin Login
app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    res.json({ ok: true, token: "admin-auth-token", message: "Login success ✅" });
  } else {
    res.status(401).json({ error: "Invalid admin credentials ❌" });
  }
});

// Admin users
app.get("/admin/users", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("users").select("*");
    if (error) throw error;
    res.json({ ok: true, users: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin uploads
app.get("/admin/uploads", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("uploads").select("*");
    if (error) throw error;
    res.json({ ok: true, uploads: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin history
app.get("/admin/history", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("history").select("*");
    if (error) throw error;
    res.json({ ok: true, history: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Fallback */
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));

app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Vibestream backend running on port ${PORT}`)
);
