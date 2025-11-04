import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase.js"; // ✅ your firebase config

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Default route test
app.get("/", (req, res) => {
  res.send("🔥 Vibestream Backend + Firebase Connected Successfully (Debug Mode)!");
});

// ✅ YouTube video info fetch + Firestore save (DEBUG ENABLED)
app.get("/api/video", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Video ID required" });

    const API_KEY = process.env.YT_API_KEY;
    if (!API_KEY) {
      console.log("❌ Missing YT_API_KEY in environment!");
      return res.status(500).json({ error: "Missing YT_API_KEY in .env" });
    }

    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${id}&key=${API_KEY}`;
    console.log("🔗 Fetching URL:", url);

    const response = await fetch(url);
    const data = await response.json();

    // 👇 DEBUG: Show YouTube API full response
    console.log("🎥 YouTube API Response:", JSON.stringify(data, null, 2));

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    const videoData = {
      title: data.items[0].snippet.title,
      thumbnail: data.items[0].snippet.thumbnails.high.url,
      channel: data.items[0].snippet.channelTitle,
      views: data.items[0].statistics.viewCount,
      likes: data.items[0].statistics.likeCount,
      description: data.items[0].snippet.description,
      videoId: id,
      createdAt: new Date().toISOString(),
    };

    console.log("✅ Fetched Video Data:", videoData);

    // ✅ Try saving to Firestore (catch any permission issues)
    try {
      await addDoc(collection(db, "videos"), videoData);
      console.log("🔥 Firestore: Video saved successfully!");
    } catch (fireErr) {
      console.error("❌ Firestore Save Error:", fireErr);
      return res.status(500).json({ error: "Firestore permission error", details: fireErr.message });
    }

    res.json({ message: "✅ Video fetched & saved successfully!", video: videoData });

  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).json({ error: "Server error, please try again later" });
  }
});

// ✅ Fallback route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Vibestream Backend (Debug Mode) running on port ${PORT}`));
