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

let lastVideo = {};

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

    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    await channel.send({
      content: `🎬 ${streamer.name} vừa ra video mới!`,
      embeds: [
        {
          title: title,
          url: url,
          color: 3447003,
          image: { url: thumbnail },
          author: { name: streamer.name },
          footer: { text: "NEW VIDEO" }
        }
      ]
    });

    res.sendStatus(200);
  } catch (err) {
    console.log("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// 🔴 LIVE gần realtime (30–60s)
async function checkLiveFast() {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

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

      if (lastVideo[s.channelId + "_live"] === videoId) continue;

      lastVideo[s.channelId + "_live"] = videoId;

      await channel.send({
        content: `🔴 ${s.name} đang LIVE!`,
        embeds: [
          {
            title: live.snippet.title,
            url: `https://youtube.com/watch?v=${videoId}`,
            color: 16711680,
            image: {
              url: live.snippet.thumbnails.high.url
            },
            footer: { text: "LIVE NOW" }
          }
        ]
      });

    } catch (e) {}
  }
}

async function subscribeAll() {
  for (const s of streamers) {
    console.log("Subscribing:", s.name);

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

client.on("clientReady", async () => {
  console.log("HYBRID BOT RUNNING");

  loadStreamers();
  await subscribeAll();

  // reload streamer
  cron.schedule("*/1 * * * *", loadStreamers);

  // auto subscribe
  cron.schedule("*/2 * * * *", async () => {
    console.log("Auto re-subscribe...");
    await subscribeAll();
  });

  // 🔴 LIVE gần realtime (1 phút)
  cron.schedule("*/1 * * * *", checkLiveFast);
});

client.login(process.env.DISCORD_TOKEN);

app.listen(process.env.PORT, () => {
  console.log("Webhook server running");
});
