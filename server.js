import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase.js"; // ✅ import your Firebase setup

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Default route test
app.get("/", (req, res) => {
  res.send("Vibestream Backend is Live 🚀");
});

// ✅ YouTube video info fetch + Firestore save route
app.get("/api/video", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Video ID required" });

    const API_KEY = process.env.YT_API_KEY;
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${id}&key=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

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

    // ✅ Save to Firestore
    await addDoc(collection(db, "videos"), videoData);

    res.json({ message: "Video fetched & saved!", video: videoData });
  } catch (error) {
    console.error("Error fetching video:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ 404 fallback route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Vibestream Backend running on port ${PORT}`));
