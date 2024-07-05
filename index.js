const { BskyAgent, AppBskyFeedPost, RichText } = require("@atproto/api");
const cheerio = require("cheerio");
const sharp = require("sharp");
const Parser = require("rss-parser");
const fetch = require("node-fetch");
const parser = new Parser();
const moment = require("moment");


const settings = [
  {
    account: "did:plc:vdumjbeu23g5r4ormotpuomn",
    password: "app-password",
    url: "https://127.0.0.1:8811/i/lists/1714350895818031592/rss" // "https://nitter.myDomain.com/i/lists/1714350895818031592/rss"
  },
];

function removeURLFromTitle(title) {
  // Check if the title contains the phrase "R to @BBCBreaking:" OR "RT by @BBCBreaking:" and remove it
  if (title.includes("R to @BBCBreaking:")) {  // R to @BBCBreaking: 
    title = title.replace("R to @BBCBreaking:", "").trim();
  }
  if (title.includes("RT by @BBCBreaking:")) {
    title = title.replace("RT by @BBCBreaking:", "").trim();
  }
  return title;
}

function transformDomain(url) {

  const nitterDomain = "nitter.myDomain.com";
  const twitterDomain = "twitter.com";

  if (url.includes(nitterDomain)) {
    return url.replace(nitterDomain, twitterDomain);
  }
  return url;
}

async function getTitleAndDescriptionFromURL(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    let articleTitle = $("meta[property='og:title']").attr("content");
    const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content");

    return {
      title: articleTitle,
      description: description,
    };
  } catch (error) {
    console.error("Error fetching title and description from URL:", error);
    return {
      title: null,
      description: null,
    };
  }
}

async function get_feeds(url, maxItems = 2) {
  const feed = await parser.parseURL(url);
  let output = [];
  for (const item of feed.items.slice(0, maxItems)) {
    const title = removeURLFromTitle(item.title);
    const link = title.match(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g);
    const title2 = title.replace(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g, "").trim();
            // Check the pubDate and compare it with the current date
    const pubDate = moment(item.pubDate);
    const currentDate = moment();
    const daysDifference = currentDate.diff(pubDate, 'days');
    
    if (daysDifference > 2) {
    console.log(`Skipped item: ${title} (too old)`);
    continue; // Skip items older than 2 days
    }
    let image_url = null;
    const dom = cheerio.load(item.content);
    const image_url_ = dom('img').attr('src');
    let imageUrls = []; // Create an array to store multiple image URLs
    const imageTags = dom('img');

    if (image_url_) {
      image_url = image_url_;
    }
    imageTags.each((index, tag) => {
      imageUrls.push(dom(tag).attr('src'));
    });

    output.push({
      title,
      link: link ? link[0] : null,
      image_url: image_url,
      imageUrls: imageUrls,
      title2,
    });
  }
  return output;
} 


async function post(agent, item) {
  let articleTitle = null;
  let description = null;

  if (item.link) {
    item.link = transformDomain(item.link);

    const { title, description: extractedDescription } = await getTitleAndDescriptionFromURL(item.link);
    articleTitle = title;
    description = extractedDescription;
  }

  const bskyText = new RichText({ text: item.title });
  const bskyText2 = new RichText({ text: item.title2 });
  await bskyText.detectFacets(BskyAgent);
  await bskyText2.detectFacets(BskyAgent);

  let post = {
    $type: "app.bsky.feed.post",
    text: item.title,
    createdAt: new Date().toISOString(),
    langs: ["en"],
    facets: bskyText.facets,
  };

  // Check if item.link is available before using it
  if (item.link) {
    const dom = await fetch(item.link)
      .then((response) => response.text())
      .then((html) => cheerio.load(html));

    let image_url = null;
    const image_url_ = dom('head > meta[property="og:image"]');
    const articleLink_ = dom('head > meta[property="og:url"]');
    if (image_url_) {
      image_url = image_url_.attr("content");
    }
    if (articleLink_) {
      articleLink = articleLink_.attr("content");
    }

    if (item.image_url && item.image_url.includes("card_img")) {
      const buffer = await fetch(item.image_url)
        .then((response) => response.arrayBuffer())
        .then((buffer) => sharp(buffer))
        .then((s) =>
          s.resize(
            s
              .resize(800, null, {
                fit: "inside",
                withoutEnlargement: true,
              })
              .jpeg({
                quality: 80,
                progressive: true,
              })
              .toBuffer()
          )
        );
      const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });
      post = {
        text: item.title2,
        $type: "app.bsky.feed.post",
        createdAt: new Date().toISOString(),
        langs: ["en"],
        facets: bskyText2.facets,
      };
      post["embed"] = {
        external: {
          uri: articleLink || item.link,
          title: articleTitle || item.title,
          description: description || item.title,
          thumb: image.data.blob,
        },
        $type: "app.bsky.embed.external",
      };
    } else if (item.image_url && item.image_url.includes("media")) {
      if (item.imageUrls.length > 0) {
        const imagePromises = item.imageUrls.map(async (imageUrl) => {
          const buffer = await fetch(imageUrl)
            .then((response) => response.arrayBuffer())
            .then((buffer) =>
              sharp(buffer)
                .resize(800, null, {
                  fit: "inside",
                  withoutEnlargement: true,
                })
                .jpeg({
                  quality: 80,
                  progressive: true,
                })
                .toBuffer()
            );
  
          const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });
  
          return {
            alt: description || "",
            image: image.data.blob,
          };
        });
  
        const images = await Promise.all(imagePromises);
  
        post["embed"] = {
          $type: "app.bsky.feed.post",
          text: item.title,
          createdAt: new Date().toISOString(),
          langs: ["en"],
          facets: bskyText.facets,
          $type: "app.bsky.embed.images",
          images: images,
        };
      }
    }
  } else {
    // Handle cases when item.link is not available
    if (item.image_url && item.image_url.includes("media")) {
      if (item.imageUrls.length > 0) {
        const imagePromises = item.imageUrls.map(async (imageUrl) => {
          const buffer = await fetch(imageUrl)
            .then((response) => response.arrayBuffer())
            .then((buffer) =>
              sharp(buffer)
                .resize(800, null, {
                  fit: "inside",
                  withoutEnlargement: true,
                })
                .jpeg({
                  quality: 80,
                  progressive: true,
                })
                .toBuffer()
            );
  
          const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });
  
          return {
            alt: "",
            image: image.data.blob,
          };
        });
  
        const images = await Promise.all(imagePromises);
  
        post["embed"] = {
          $type: "app.bsky.feed.post",
          text: item.title,
          createdAt: new Date().toISOString(),
          langs: ["en"],
          facets: bskyText.facets,
          $type: "app.bsky.embed.images",
          images: images,
        };
      }
  }
  }
  const res = AppBskyFeedPost.validateRecord(post);
  if (res.success) {
    console.log(post);
    await agent.post(post);
  } else {
    console.log(res.error);
  }
}

async function main(setting) {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: setting.account,
    password: setting.password,
  });

  let processed = new Set();
  let cursor = "";
  for (let i = 0; i < 3; ++i) {
    const response = await agent.getAuthorFeed({
      actor: setting.account,
      limit: 100,
      cursor: cursor,
    });
    cursor = response.cursor;
    for (const feed of response.data.feed) {
      if (feed && feed.post && feed.post.record && feed.post.record.embed && feed.post.record.embed.external && feed.post.record.embed.external.uri) {
        processed.add(feed.post.record.embed.external.uri);
      }
      if (feed && feed.post && feed.post.record && feed.post.record.text) {
        processed.add(feed.post.record.text);
      }
    }
  }
  for (const feed of await get_feeds(setting.url)) {
    if (feed && feed.title && feed.title2) {
      if (!processed.has(feed.title) && !processed.has(feed.title2)) {
        await post(agent, feed);
      } else {
        console.log("skipped " + feed.title);
      }
    }
  }
}

async function entrypoint() {
  for (const setting of settings) {
    console.log("process " + setting.url);
    await main(setting);
  }
  console.log("--- finish ---");
}

entrypoint();
