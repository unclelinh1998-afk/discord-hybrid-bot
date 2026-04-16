require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const xml2js = require("xml2js");

const streamers = JSON.parse(fs.readFileSync("./streamers.json"));

const API_KEYS = (process.env.YOUTUBE_API_KEYS || "").split(",");
function getKey(i){ return API_KEYS[i % API_KEYS.length]; }

const app = express();
app.use(express.text({ type: "*/*" }));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

async function subscribeAll(){
  for (const s of streamers){
    const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${s.channelId}`;
    await axios.post("https://pubsubhubbub.appspot.com/subscribe", null, {
      params: {
        "hub.mode": "subscribe",
        "hub.topic": topic,
        "hub.callback": process.env.BASE_URL + "/webhook",
        "hub.verify": "async"
      }
    }).catch(()=>{});
  }
}

async function fallbackCheck(){
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

  for (let i=0;i<streamers.length;i++){
    const s = streamers[i];
    const key = getKey(i);

    try{
      const res = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${s.channelId}&order=date&maxResults=1&type=video&key=${key}`
      );

      const vid = res.data.items[0]?.id.videoId;
      if (!vid) continue;

      if (!lastVideo[s.channelId]){
        lastVideo[s.channelId] = vid;
      } else if (lastVideo[s.channelId] !== vid){
        lastVideo[s.channelId] = vid;

        await channel.send({
          content: `♻️ Fallback: Video mới!`,
          embeds: [{
            title: res.data.items[0].snippet.title,
            url: `https://youtube.com/watch?v=${vid}`
          }]
        });
      }

    }catch(e){}
  }
}

client.on("clientReady", async ()=>{
  console.log("HYBRID BOT RUNNING");

  await subscribeAll();

  cron.schedule("0 */6 * * *", subscribeAll);
  cron.schedule("*/30 * * * *", fallbackCheck);
});

client.login(process.env.DISCORD_TOKEN);

app.listen(process.env.PORT, ()=>{
  console.log("Webhook server running");
});
