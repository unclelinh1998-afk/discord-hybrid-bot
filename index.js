require("dotenv").config();
const fs = require("fs");

const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const { Client, GatewayIntentBits } = require("discord.js");
const xml2js = require("xml2js");

let streamers = [];

function loadStreamers() {
  try {
    const data = JSON.parse(fs.readFileSync("./streamers.json"));
    streamers = data;
    console.log("Reloaded streamers:", streamers.length);
  } catch (err) {
    console.log("Load streamer error:", err.message);
  }
}

const API_KEYS = (process.env.YOUTUBE_API_KEYS || "").split(",");
function getKey(i) {
  return API_KEYS[i % API_KEYS.length];
}

const app = express();
app.use(express.text({ type: "*/*" }));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const sentLive = new Set();

function getChannels() {
  return process.env.CHANNEL_IDS.split(",");
}

// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  res.send(req.query["hub.challenge"]);
});

app.post("/webhook", async (req, res) => {
  try {
    const data = await xml2js.parseStringPromise(req.body);
    const entry = data.feed.entry?.[0];
    if (!entry) return res.sendStatus(200);

    const videoId = entry["yt:videoId"][0];
    const title = entry.title[0];
    const channelId = entry["yt:channelId"][0];

    const streamer = streamers.find(s => s.channelId === channelId);
    if (!streamer) return res.sendStatus(200);

    const url = `https://youtube.com/watch?v=${videoId}`;
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    let isLive = false;

    try {
      const key = getKey(0);

      const check = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${key}`
      );

      const v = check.data.items[0];

      if (v?.liveStreamingDetails?.actualStartTime) {
        isLive = true;
      }

    } catch (e) {}

    // 🔴 CHỈ gửi LIVE
    if (isLive) {
      if (sentLive.has(videoId)) return res.sendStatus(200);
      sentLive.add(videoId);

      const channelIds = getChannels();

      for (const id of channelIds) {
        const ch = await client.channels.fetch(id);

        const embed = {
          color: 0xFF0000,

          author: {
            name: `[ ${streamer.name.toUpperCase()} ĐANG LIVESTREAM ]`
          },

          title: title,
          url: url,

          description:
            `${streamer.name} đang live stream tại:\n${url}\n\n` +
            `👉 Tới ngay để xem trước khi lỡ mất!`,

          image: {
            url: thumbnail
          },

          footer: {
            text: "🔴 LIVE NOW"
          },

          timestamp: new Date()
        };

        await ch.send({
          content: `🔴 ${streamer.name} đang LIVE!`,
          embeds: [embed]
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.log("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// ===== LIVE CHECK (backup) =====
async function checkLiveFast() {
  const channelIds = getChannels();

  for (let i = 0; i < streamers.length; i++) {
    const s = streamers[i];
    const key = getKey(i);

    try {
      const res = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${s.channelId}&eventType=live&type=video&maxResults=1&key=${key}`
      );

      const live = res.data.items[0];
      if (!live) continue;

      const videoId = live.id.videoId;

      if (sentLive.has(videoId)) continue;
      sentLive.add(videoId);

      for (const id of channelIds) {
        const ch = await client.channels.fetch(id);

        const embed = {
          color: 0xFF0000,

          author: {
            name: `[ ${s.name.toUpperCase()} ĐANG LIVESTREAM ]`
          },

          title: live.snippet.title,
          url: `https://youtube.com/watch?v=${videoId}`,

          description:
            `${s.name} đang live stream tại:\nhttps://youtube.com/watch?v=${videoId}\n\n` +
            `👉 Tới ngay để xem trước khi lỡ mất!`,

          image: {
            url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
          },

          footer: {
            text: "🔴 LIVE NOW"
          },

          timestamp: new Date()
        };

        await ch.send({
          content: `🔴 ${s.name} đang LIVE!`,
          embeds: [embed]
        });
      }

    } catch (e) {}
  }
}

// ===== SUBSCRIBE =====
async function subscribeAll() {
  for (const s of streamers) {
    const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${s.channelId}`;

    await axios.post("https://pubsubhubbub.appspot.com/subscribe", null, {
      params: {
        "hub.mode": "subscribe",
        "hub.topic": topic,
        "hub.callback": process.env.BASE_URL + "/webhook",
        "hub.verify": "async"
      }
    }).catch(() => {});
  }
}

// ===== START =====
client.on("clientReady", async () => {
  console.log("LIVE ONLY BOT RUNNING");

  loadStreamers();
  await subscribeAll();

  cron.schedule("*/1 * * * *", loadStreamers);
  cron.schedule("*/2 * * * *", subscribeAll);
  cron.schedule("*/1 * * * *", checkLiveFast);
});

// reset cache
setInterval(() => {
  sentLive.clear();
}, 1000 * 60 * 60 * 6);

client.login(process.env.DISCORD_TOKEN);

app.listen(process.env.PORT, () => {
  console.log("Webhook server running");
});
