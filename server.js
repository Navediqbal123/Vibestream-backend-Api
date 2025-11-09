// server.js — diagnostic server for debugging Render/Supabase/YouTube
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
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const YT_API_KEY = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || "";

console.log("STARTUP: env presence:");
console.log(" SUPABASE_URL:", SUPABASE_URL ? "FOUND" : "MISSING");
console.log(" SUPABASE_KEY:", SUPABASE_KEY ? "FOUND" : "MISSING");
console.log(" YT_API_KEY:", YT_API_KEY ? "FOUND" : "MISSING");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// simple logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} --> ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => res.send("Diag server live — endpoints: /env /ping /test-youtube /test-supabase /feed"));

/* 1) /env -> shows which env vars are present (does NOT print secrets) */
app.get("/env", (_req, res) => {
  res.json({
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    YT_API_KEY: !!YT_API_KEY,
    NODE_ENV: process.env.NODE_ENV || null,
  });
});

/* 2) /ping -> simple health */
app.get("/ping", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* 3) /test-youtube -> tries a YouTube search, returns count or error */
app.get("/test-youtube", async (req, res) => {
  if (!YT_API_KEY) return res.status(400).json({ error: "YT_API_KEY missing" });
  try {
    const q = encodeURIComponent("trending shorts");
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=5&q=${q}&key=${YT_API_KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) return res.status(500).json({ error: j.error });
    return res.json({ items: (j.items || []).length, sample: j.items?.[0]?.id || null });
  } catch (e) {
    console.error("test-youtube error", e);
    res.status(500).json({ error: String(e) });
  }
});

/* 4) /test-supabase -> tries a trivial select from videos table */
app.get("/test-supabase", async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(400).json({ error: "Supabase URL or Key missing" });
  try {
    const { data, error, count } = await supabase
      .from("videos")
      .select("id", { count: "exact", head: false })
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, sampleCount: data?.length ?? 0, totalCount: count ?? null });
  } catch (e) {
    console.error("test-supabase error", e);
    res.status(500).json({ error: String(e) });
  }
});

/* 5) /feed -> returns videos from supabase (same as your frontend expects) */
app.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { data, error } = await supabase
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    console.error("/feed error", e);
    res.status(500).json({ error: String(e) });
  }
});

/* generic 404 */
app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, "0.0.0.0", () => console.log(`Diag server listening on ${PORT}`));
