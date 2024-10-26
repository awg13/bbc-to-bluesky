Forked in order to post tweets with the help of [Nitter](https://github.com/zedeus/nitter). This assumes you have a working instance of Nitter running. 

Alternatively, you could use a third-party hosted instance like nitter.privacydev.net, but be cautious, as these instances are often rate-limited.

***

- index.js handles main tweets, while reply.js manages reply tweets.
    
- If a tweet exceeds 300 characters, it will be truncated to 300 characters, and a screenshot of the full tweet will be posted as a reply.

- By default, it uses OpenAI to generate alt text for images. If this isn’t set up, it will use the tweet text or the og:description tag if a URL is present.

- For video tweets, if the duration is less than 60 seconds, it will post the video directly (ensure yt-dlp is installed). If longer, it will post the video link instead.

**PS: This was largely done with the help of ChatGPT and I have no idea what I am doing :')**

#### Caveats:
- If a tweet thread with more than three tweets is posted within a short timeframe (1–2 minutes), only the main tweet and the last two tweets in the thread will be posted.
Retweets will post as new tweets.

- Quote tweets may not work.
- If a tweet contains multiple images and a video, only the video might be posted.
***

**Original README: 👇** 


# Introduction

I used to use Twitter as a news reader. It offered a great user experience as it made it easy to discuss news with friends. Now, I want to introduce this user experience in Bluesky.

This repository provides the implementation of Bluesky bots (@bbcnews-uk-rss.bsky.social and @bbcnews-world-rss.bsky.social) designed to repost RSS feeds of BBC News. I wish you readers implement bots with your favourite news sources.

# Implementation

The following function is implemented and deployed using Google Cloud Functions with Pub/Sub trigger.	

1. Fetch the latest RSS feeds from BBC RSS using the `rss-parser` package.
2. Fetch the latest posts from the bot account using the `@atproto/api` package. 
3. For each RSS feed (fetched in Step 1) that was not posted to bluesky (fetched in Step 2),
    1. Fetch the HTML of the news.
    2. Extract description and image using the `cheerio` package.
    3. Reduce the size of image using the `sharp` package.
    4. Upload the image as a blob, and create a post with the image and link by `@atproto/api` package.

See `index.js` for the detailed implementation.

Then, the function is periodically (say, every 15 minutes) triggered using Google Cloud Scheduler, i.e., it has the following cron setting.

```
*/15 * * * * *
```

# References

- https://zenn.dev/ryo_kawamata/articles/8d1966f6bb0a82 for reducing image sizes.

