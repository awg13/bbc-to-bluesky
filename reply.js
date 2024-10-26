const { BskyAgent, AppBskyFeedPost, RichText } = require("@atproto/api");
const cheerio = require("cheerio");
const sharp = require("sharp");
const Parser = require("rss-parser");
const fetch = require("node-fetch");
const parser = new Parser();
const moment = require("moment");
const puppeteer = require("puppeteer");
const axios = require("axios");
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');


const settings = [
  {
    account: "bbcbreaking-bot.bsky.social",
    password: "password",
    url: "https://nitter-domain.com/i/lists/1084689383115490210/rss"
  },
];

function removeURLFromTitle(title) {

  if (title.includes("R to @BBCBREAKING:")) { 
    title = title.replace("R to @BBCBREAKING:", "").trim();
  }
  if (title.includes("RT by @BBCBREAKING:")) {
    title = title.replace("RT by @BBCBREAKING:", "").trim();
  }
  return title;
}

function transformDomain(url) {
  const nitterDomain = "nitter-domain.com";
  const twitterDomain = "twitter.com";

  if (url==null) return url;

  if (url.includes(nitterDomain)) {
    return url.replace(nitterDomain, twitterDomain);
  }
  return url;
}

async function getBloombergData(url) {
  // Utility function for delay
  function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
  }

  const browser = await puppeteer.launch({
    headless: true, // Run in headful mode to see notifications
    args: ['--enable-features=ExperimentalWebPlatformFeatures', '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', '--disable-dev-shm-usage', '--no-zygote', '--single-process'] // Enable necessary features
});
  const page = await browser.newPage();
//  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  
    // Get the final URL after any redirections
    const finalUrl = page.url();
    const finalUrlObj = new URL(finalUrl);
  
    if (finalUrlObj.hostname.endsWith('yahoo.com')) {
      // Handle Yahoo-specific interactions (cookies, popups)
      try {
        // Wait for the consent popup to appear
        await page.waitForSelector('button.accept-all', { visible: true });

        // Check for cookie consent popup
        //const acceptButton = await page.$('button.accept-all');
        const acceptButton = await page.$('button.accept-all.btn.secondary[name="agree"]' || 'button.reject-all.btn.secondary[name="reject"]');


        if (acceptButton) {
          console.log('Cookie consent popup detected. Accepting cookies...');
          await acceptButton.click();
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
        }

        // Handle potential redirection page
        await page.waitForSelector('.loader-text a', { timeout: 10000 });
        console.log('Redirection page detected. Clicking "here"...');

        const redirectLink = await page.$('.loader-text a');
        if (redirectLink) {
          await redirectLink.click();
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        }
      } catch (e) {
        console.log('No cookie consent or redirection detected, or timed out.');

      }
    }

    // Extract data
    const data = await page.evaluate(() => {
      const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
      const description = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content;
      const link = document.querySelector('meta[property="og:url"]')?.content || document.querySelector('link[rel="canonical"]')?.href;
      return { title, description, link };
      
    });
    return data;
    
  } catch (error) {
    console.error("Error fetching Bloomberg data:", error);
    await page.screenshot({ path: 'error-screenshot.png' });
    return { title: null, description: null, link: null };
  } finally {
    await browser.close();
  }
}



async function getTitleAndDescriptionFromURL(url) {
  if (url.includes('bloomberg.com') || url.includes('trib.al') || url.includes('yahoo.com')){
    return await getBloombergData(url);
  } else {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      const title = $("meta[property='og:title']").attr("content") || $("title").text() || null;
      const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || $('meta[property="twitter:description"]').attr("content") || null;
      const link = $("meta[property='og:url']").attr("content")|| $("link[rel='canonical']").attr("href") || $("url").text() || null;

      return { title, description, link };
    } catch (error) {
      console.error("Error fetching title and description from URL:", error);
      return { title: null, description: null, link: null };
    }
  }
}


let truncateHappened = false;

function truncateAndAppendLink(text, link, maxLength = 299) {
  if (!text) return '';

  const ellipsis = '...';
  const transformedLink = 'Read more';
  const linkLength = transformedLink ? transformedLink.length : 0; // +1 for space before link
  const truncatedLength = maxLength - ellipsis.length - linkLength;

  // Check if there is a URL in the text
  const urlMatches = text.match(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g);
  let shortenedText = text;

  if (urlMatches) {
    // If URL present, try to shorten it by removing query parameters
    const cleanedURL = urlMatches[0].split('?')[0];
    shortenedText = text.replace(urlMatches[0], cleanedURL);
  }

  // Check if shortened text still exceeds maxLength
  if (shortenedText.length <= maxLength) {
    truncateHappened = false;
    return shortenedText;
  }

  // Proceed with truncation and appending link if necessary
  
  let truncatedText = shortenedText.slice(0, truncatedLength).trim() + ellipsis;
  if (transformedLink) truncatedText += ' ' + transformedLink;
  truncateHappened = truncatedText !== shortenedText;
  
  return truncatedText;
}

function removeLinkQueryParameters (text) {
  if (!text) return '';

    // Check if there is a URL in the text
    const urlMatches = text.match(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g);
    let shortenedText = text;
  
    if (urlMatches) {
      // If URL present, try to shorten it by removing query parameters
      const cleanedURL = urlMatches[0].split('?')[0];
      shortenedText = text.replace(urlMatches[0], cleanedURL);
      return shortenedText;
    } else {
      return text;
    }

}


async function get_feeds(url, maxItems = 8) {
  const parser = new Parser();
  const feed = await parser.parseURL(url);
  let output = [];

  for (const item of feed.items.slice(0, maxItems)) {
    let title = removeURLFromTitle(item.title);
    let title5 = removeURLFromTitle(item.title);
    const link = title.match(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g);
    const title3 = item.title;
    const linked = item.link;
    const title4 = title.replace(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g, "").trim();
    let title2 = title.replace(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g, "").trim();
    const pubDate = moment(item.pubDate);
    const currentDate = moment();
    const daysDifference = currentDate.diff(pubDate, 'hours');
    const daysDifference2 = currentDate.diff(pubDate, 'seconds');

    if (daysDifference > 1 || daysDifference2 < 10) {
      console.log(`Skipped item: ${title} (${daysDifference > 1 ? 'too old' : 'too new'})`);
      continue;
    }

    let image_url = null;
    const dom = cheerio.load(item.content);
    const image_url_ = dom('img').attr('src');
    let imageUrls = [];
    const imageTags = dom('img');

    if (image_url_) {
      image_url = image_url_;
    }
    imageTags.each((index, tag) => {
      imageUrls.push(dom(tag).attr('src'));
    });

    title = truncateAndAppendLink(title, linked);
    title2 = truncateAndAppendLink(title2, linked);
    title5 = removeLinkQueryParameters(title5);

    let cardTitle = null;
    let cardDescription = null;

    try {
      const response = await fetch(linked);
      const html = await response.text();
      const linkedDom = cheerio.load(html);
      
      const mainTweet = linkedDom('.main-thread .main-tweet');
      if (mainTweet.length > 0) {
        cardTitle = mainTweet.find('.card-title').text().trim();
        cardDescription = mainTweet.find('.card-description').text().trim();
      }
    } catch (error) {
      console.log(`Error fetching or parsing ${linked}: ${error.message}`);
    }

    output.push({
      title,
      link: link ? link[0] : null,
      image_url: image_url,
      imageUrls: imageUrls,
      title2,
      pubDate: item.pubDate,
      title3,
      linked,
      title4,
      title5,
      cardTitle,
      cardDescription
    });
  }

  return output;
}

async function getAltTextFromOpenAI(imageBuffer, title4) {
  const openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
  
  // Convert image buffer to base64
  const base64Image = imageBuffer.toString('base64');
  
  const requestBody = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Provide a detailed description of this image for alt-text purposes. Make sure to use the following context when creating the description & feel free to definitively name the person(s), place(s) or object(s) based on this context: "${title4}". The description should be helpful for blind and low-vision users. You should only output the alt-text description, nothing else, but include much information as possible.`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 300
  };

  try {
    const response = await axios.post(openaiEndpoint, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer sk-*******************************************************************`
      }
    });

    const altText = response.data.choices[0].message.content.trim();
    return altText;
  } catch (error) {
    console.error('Full error:', error);
    console.error('Error response:', error.response ? error.response.data : 'No response data');
    return null;
  }
}

async function post(agent, item, previousItem) {
  const containsURL = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return urlRegex.test(text);
  };


  let articleTitle = null;
  let description = null;
  let videoUrl = null;
  let thumbBlob = null;

  const response = await fetch(item.linked);
  const html = await response.text();
  const $ = cheerio.load(html);
  videoUrl = $("meta[property='og:video:url']").attr("content");
  thumbURL = $("meta[property='og:image']").attr("content");
  thumbTitle = $("meta[property='og:title']").attr("content");

  const { spawn } = require('child_process');

  async function downloadVideoWithYtDlp(url, outputPath) {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        '-f', 'best[ext=mp4]',
        '-o', outputPath,
        url
      ]);
  
      ytdlp.stderr.on('data', (data) => {
        console.error(`yt-dlp stderr: ${data}`);
      });
  
      ytdlp.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp process exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }
  
  async function getVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_packets',
        '-show_entries',
        'stream=width,height,duration',
        '-of',
        'json',
        filePath
      ]);
  
      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
  
      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe process exited with code ${code}`));
        } else {
          const metadata = JSON.parse(output);
          resolve(metadata.streams[0]);
        }
      });
    });
  }



if ($("div.before-tweet.thread-line").length) {
  const latestTweet = $("div.before-tweet.thread-line .timeline-item").last();
  let tweetLink = latestTweet.find("a.tweet-link").attr("href");

  if (tweetLink && !tweetLink.startsWith("http")) {
    tweetLink = `https://nitter-domain.com${tweetLink}`;
  }

  const tweetResponse = await fetch(tweetLink);
  const tweetHtml = await tweetResponse.text();
  const tweet$ = cheerio.load(tweetHtml);
  let previousItemV2 = tweet$("meta[property='og:description']").attr("content");
  let previousLinked = tweet$("link[rel='canonical']").attr("href");
  const previousItemV2OG = tweet$("meta[property='og:description']").attr("content");

  previousItemV2 = truncateAndAppendLink(previousItemV2, previousLinked);

  console.log(`"THE REAL PREVIOUS ITEM:" ${previousItemV2}`);



  const bskyText = new RichText({ text: item.title });
  const bskyText2 = new RichText({ text: item.title2 });
  await bskyText.detectFacets(agent);
  await bskyText2.detectFacets(agent);

  let facets1 = bskyText.facets || [];
  let facets2 = bskyText2.facets || [];
  let linked2 = transformDomain(item.linked);
  
  // Check if item.title ends with "Read more"
  if (item.title.endsWith("Read more")) {
    const readMore = item.title.match(/Read more/);
    const startIndex2 = readMore ? readMore.index : 0;
    const endIndex2 = startIndex2 + 11;
  
    facets1 = [
      {
        index: {
          byteStart: startIndex2,
          byteEnd: endIndex2,
        },
        features: [
          {
            $type: "app.bsky.richtext.facet#link",
            uri: linked2,
          },
        ],
      },
      ...facets1,
    ];
  }
  
  // Check if item.title2 ends with "Read more"
  if (item.title2.endsWith("Read more")) {
    const readMore = item.title2.match(/Read more/);
    const startIndex2 = readMore ? readMore.index : 0;
    const endIndex2 = startIndex2 + 11;
  
    facets2 = [
      {
        index: {
          byteStart: startIndex2,
          byteEnd: endIndex2,
        },
        features: [
          {
            $type: "app.bsky.richtext.facet#link",
            uri: linked2,
          },
        ],
      },
      ...facets2,
    ];
  } 


  let post = {
    $type: "app.bsky.feed.post",
    text: item.title,
    createdAt: new Date().toISOString(),
    langs: ["en"],
    facets: facets1,
  };

  if (videoUrl) {
    try {
      const videoFileName = `temp_video_${Date.now()}.mp4`;
      const videoFilePath = path.join(__dirname, videoFileName);
      videoUrl = transformDomain(videoUrl);

      // Download the video using yt-dlp
      await downloadVideoWithYtDlp(videoUrl, videoFilePath);

      // Get video metadata
      const metadata = await getVideoMetadata(videoFilePath);
      const duration = parseFloat(metadata.duration);
      const width = parseInt(metadata.width);
      const height = parseInt(metadata.height);

      // Process thumbnail
      const buffer = await fetch(thumbURL)
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
      thumbBlob = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });

      if (duration <= 60) {
        // Direct video upload for videos up to 60 seconds
        const videoBuffer = await fs.readFile(videoFilePath);
        const videoBlob = await agent.uploadBlob(videoBuffer, { encoding: "video/mp4" });

        post["embed"] = {
          $type: "app.bsky.embed.video",
          video: videoBlob.data.blob,
          thumb: thumbBlob.data.blob,
          aspectRatio: {
            width: width,
            height: height
          }
        };
      } else {
        // External embed for videos longer than 60 seconds
        post["embed"] = {
          external: {
            uri: videoUrl,
            title: `VIDEO: ${thumbTitle} on Twitter (X)`,
            description: item.title,
            thumb: thumbBlob.data.blob,
          },
          $type: "app.bsky.embed.external",
        };
      }

      // Clean up: delete the temporary video file
      await fs.unlink(videoFilePath);

    } catch (error) {
      console.error("Error processing video:", error);
      // Fallback to external embed if video processing fails
      post["embed"] = {
        external: {
          uri: videoUrl,
          title: `VIDEO: ${thumbTitle} on Twitter (X)`,
          description: item.title,
          thumb: thumbBlob.data.blob,
        },
        $type: "app.bsky.embed.external",
      };
    }
  }

  let replyRef = null;

  // Ensure previousItemV2 is not null before proceeding
if (!previousItemV2) {
  console.error("either failed to fetch the previous item or it's not a reply tweet.");
  return;
} else {

    console.log("Searching for similar posts in BlueSky...");
    let processed = new Set();
    let cursor = "";
    for (let i = 0; i < 3; ++i) {
      console.log(`Fetching author feed, iteration ${i + 1}`);
      const response = await agent.getAuthorFeed({
        actor: "afp-bot.bsky.social",
        limit: 55,
        cursor: cursor,
      });
      cursor = response.cursor;
      console.log(`Fetched ${response.data.feed.length} posts`);

      for (const feed of response.data.feed) {
        const postText = feed.post.record.text;
        const postTest = feed.post.record;
        const postCreatedAt = new Date(feed.post.record.createdAt);

        console.log(`Checking post: "${postText}" created at ${postCreatedAt}`);
        console.log(`Previous item title: "${previousItemV2}"`);

        if (similarity(postText, previousItemV2) >= 0.8) {

          console.log(`Found similar post: ${JSON.stringify(postTest, null, 2)}`);
          console.log(`Similarity score: ${similarity(postText, previousItemV2)}`);
          replyRef = {
            parent: {
              cid: feed.post.cid,
              uri: feed.post.uri,
            },

            root: {
              cid: feed?.reply?.root?.cid || feed?.reply?.parent?.cid || feed.post.cid,
              uri: feed?.reply?.root?.uri || feed?.reply?.parent?.uri || feed.post.uri,
            },
          };
          break;
        } else if (similarity(postText, previousItemV2OG) >= 0.8) {

          console.log(`Found similar post: ${JSON.stringify(postTest, null, 2)}`);
          console.log(`Similarity score: ${similarity(postText, previousItemV2OG)}`);
          replyRef = {
            parent: {
              cid: feed.post.cid,
              uri: feed.post.uri,
            },

            root: {
              cid: feed?.reply?.root?.cid || feed?.reply?.parent?.cid || feed.post.cid,
              uri: feed?.reply?.root?.uri || feed?.reply?.parent?.uri || feed.post.uri,
            },
          };
          break;

        } else {
          console.log(`No match found for post: "${postText}"`);
          console.log(`Similarity score: ${similarity(postText, previousItemV2)}`);
        }
      }

      if (replyRef) {
        console.log(`Replying to similar post: ${replyRef.parent.uri}`);
        break;
      }
    }

    if (!replyRef) {
      console.log("No similar posts found.");
    }
  }

  if (replyRef) {
    post.reply = replyRef;
  } else if 
  ((!replyRef && item.title3.startsWith("R to @BBCBREAKING:") && item.title2.startsWith("#BREAKING")) || (!replyRef && item.title3.startsWith("R to @BBCBREAKING:") && item.title2.startsWith("BREAKING")) ) {
    console.log("even though there's no similar post for previous item in the bsky feed, it's a breaking news updae, so continuing:")
  } 
else {
  console.log("No previous item found, skipping similarity search");
  return;
}

  // Add additional debug logging to ensure the replyRef is correctly set
  if (post.reply) {
    console.log("Reply reference set: ", post.reply);
  } else {
    console.log("No reply reference set.");
  }

  if (item.link) {
    const dom = await fetch(item.linked)
      .then((response) => response.text())
      .then((html) => cheerio.load(html));

    let image_url = null;
    const image_url_ = dom('head > meta[property="og:image"]');
    if (image_url_) {
      image_url = image_url_.attr("content");
    }


    if (item.image_url && item.image_url.includes("card_img") && !(videoUrl)) {
      const { title: extractedTitle, description: extractedDescription, link: extractedLink } = await getTitleAndDescriptionFromURL(item.link);

      const articleTitle = extractedTitle;
      const description = extractedDescription;
      const articleLinko = extractedLink;
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
                quality: 100,
                progressive: true,
              })
              .toBuffer()
          )
        );
      const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });
      post = {
        text: item.title2,
        // reply: replyRef,
        $type: "app.bsky.feed.post",
        createdAt: new Date().toISOString(),
        langs: ["en"],
        facets: facets2,
      };
      post["embed"] = {
        external: {
          uri: articleLinko || item.link,
          title: item.cardTitle || articleTitle || item.title,
          description: item.cardDescription || description || item.title,
          thumb: image.data.blob,
        },
        $type: "app.bsky.embed.external",
      };
      if (replyRef && !(item.title3.startsWith("R to @BBCBREAKING:") && item.title2.startsWith("#BREAKING")) || replyRef && !(item.title3.startsWith("R to @BBCBREAKING:") && item.title2.startsWith("BREAKING")) ) {
        post.reply = replyRef;
      }
    } else if (item.image_url && item.image_url.includes("media") && !(videoUrl) || item.image_url && item.image_url.includes("video_thumb") && !(videoUrl)) {
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
                  quality: 100,
                  progressive: true,
                })
                .toBuffer()
            );
          const altText = await getAltTextFromOpenAI(buffer, item.title4);
          const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });

          return {
            alt: altText || description || "",
            image: image.data.blob,
          };
        });

        const images = await Promise.all(imagePromises);

        post["embed"] = {
          $type: "app.bsky.embed.images",
          images: images,
        };
      }
    }
  } else {
    if (item.image_url && item.image_url.includes("media") && !(videoUrl) || item.image_url && item.image_url.includes("video_thumb") && !(videoUrl)) {
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
                  quality: 100,
                  progressive: true,
                })
                .toBuffer()
            );
          const altText = await getAltTextFromOpenAI(buffer, item.title4);
          const image = await agent.uploadBlob(buffer, { encoding: "image/jpeg" });

          return {
            alt: altText || "",
            image: image.data.blob,
          };
        });

        const images = await Promise.all(imagePromises);

        post["embed"] = {
          $type: "app.bsky.embed.images",
          images: images,
        };
      }
    }
  }

  const res = AppBskyFeedPost.validateRecord(post);
  if (res.success) {
    console.log(post);
    const postResponse = await agent.post(post);
    const postResponse2 = post;
    if (postResponse && postResponse.cid && item.title2 !== item.title4 || postResponse && postResponse.cid && item.title !== item.title5 && !(item.image_url && item.image_url.includes("card_img"))) {
      console.log("Truncation occurred. Taking screenshot and posting as a reply...");
  
      try {
        // Launch browser and navigate to the page
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
  
        // Set the viewport to a mobile device size
        await page.setViewport({ width: 6000, height: 10672, isMobile: true });
  
        // Set the user agent string to a mobile browser
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 13_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.4 Mobile/15E148 Safari/604.1');
  
        await page.goto(item.linked, { waitUntil: 'networkidle0' });
  
        // Wait for the main item to load and take a screenshot
        await page.waitForSelector('.main-tweet .timeline-item', { visible: true, timeout: 10000 });
        const mainItem = await page.$('.main-tweet .timeline-item');
        
        if (!mainItem) {
          throw new Error('Main item not found');
        }
  
        const screenshotBuffer = await mainItem.screenshot();
  
        // Save the screenshot locally
        const screenshotPath = path.join(__dirname, `screenshot-${Date.now()}.png`);
        await fs.writeFile(screenshotPath, screenshotBuffer);
        console.log(`Screenshot saved locally at: ${screenshotPath}`);
  
        await browser.close();
  
        // Upload the screenshot to Bluesky
        const uploadedScreenshot = await agent.uploadBlob(screenshotBuffer, { encoding: "image/png" });
  
        console.log("Screenshot uploaded successfully to Bluesky");
        console.log("Uploaded screenshot structure:", uploadedScreenshot);
        console.log(`"DEEZ NUTS: ${JSON.stringify(postResponse)}"`);
  
        // const bskyText3 = new RichText({ text: item.link });
        // await bskyText3.detectFacets(agent);
        const bskyText3 = item.link ? new RichText({ text: item.link }) : null;
        bskyText3?.detectFacets(agent);

        // Create a reply post with the screenshot
        const replyPost = {
          $type: "app.bsky.feed.post",
          text: item.link || ``,
          createdAt: new Date().toISOString(),
          langs: ["en"],
          facets: bskyText3?.facets || [],
          //facets: bskyText3.facets,
          reply: {
            parent: {
              cid: postResponse.cid,
              uri: postResponse.uri,
            },
            root: {
              cid: postResponse2?.reply?.root?.cid || postResponse2?.reply?.parent?.cid || postResponse.cid,
              uri: postResponse2?.reply?.root?.uri || postResponse2?.reply?.parent?.uri || postResponse.uri,
            },
          },
          embed: {
            $type: "app.bsky.embed.images",
            images: [{
              alt: item.title4,
              image: uploadedScreenshot.data.blob,
            }]
          }
        };
  
        const replyRes = AppBskyFeedPost.validateRecord(replyPost);
        if (replyRes.success) {
          await agent.post(replyPost);
          console.log("Reply with screenshot posted successfully");
        } else {
          console.error("Error validating reply post:", replyRes.error);
        }
      } catch (error) {
        console.error("Error capturing or posting screenshot:", error);
      }
    }
  } else {
    console.log(res.error);
  }
}}

function transformDomain(link) {
  if (!link) return link;
  return link.replace("nitter-domain.com", "twitter.com");
}

function similarity(s1, s2) {
  let longer = s1;
  let shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  const longerLength = longer.length;
  if (longerLength === 0) {
    return 1.0;
  }
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }
  return costs[s2.length];
}

const SESSION_FILE = path.join(process.cwd(), 'bsky-session.json');
async function login(agent, setting) {
  try {
    const { data } = await agent.login({
      identifier: setting.account,
      password: setting.password,
    });
    // Store the session data in a file
    await fs.writeFile(SESSION_FILE, JSON.stringify(data));
    console.log('Logged in and saved session');
  } catch (error) {
    console.error('Login failed:', error);
  }
}

async function main(setting) {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  // Try to resume the session
  let session;
  try {
    const sessionData = await fs.readFile(SESSION_FILE, 'utf8');
    session = JSON.parse(sessionData);
  } catch (error) {
    console.log('No valid session found in file system');
  }

  if (session) {
    try {
      // Attempt to resume the session
      await agent.resumeSession(session);
      console.log('Session resumed successfully');
    } catch (error) {
      console.log('Failed to resume session, falling back to login');
      await login(agent, setting);
    }
  } else {
    // If no session exists, perform a regular login
    await login(agent, setting);
  }

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

  const feeds = await get_feeds(setting.url);
  console.log("Fetched feeds:", feeds);
    // Sort feeds by date, most recent first
//    feeds.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const previousItem = i > 0 ? feeds[i - 1] : null;
    console.log(`Processing feed item ${i}:`, feed);
    console.log(`Previous item for feed ${i}:`, previousItem);

    if (feed && feed.title && feed.title2) {
      if (!processed.has(feed.title) && !processed.has(feed.title2)) {
        await post(agent, feed, previousItem);
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
