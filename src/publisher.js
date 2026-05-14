const axios = require('axios');
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DB_ID;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
async function getApprovedArticles() {
  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      property: 'Status',
      select: { equals: 'Approved' }
    }
  });
  return res.results;
}
async function postToFacebook(postText) {
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) {
    console.log('⚠️  Facebook credentials missing — skipping FB post');
    return false;
  }
  const url = `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`;
  const res = await axios.post(url, {
    message: postText,
    access_token: FB_ACCESS_TOKEN
  });
  return res.data.id;
}
async function markAsPublished(pageId) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        select: { name: 'Published' }
      },
      Published_At: {
        date: { start: new Date().toISOString() }
      }
    }
  });
}
async function publishApproved() {
  const articles = await getApprovedArticles();
  
  if (articles.length === 0) {
    console.log('📭 No approved articles to publish');
    return;
  }
  console.log(`📢 Found ${articles.length} approved articles`);
  for (const article of articles) {
    const props = article.properties;
    const title = props.Title?.title?.[0]?.text?.content || 'Untitled';
    const postText = props.Post_Text?.rich_text?.[0]?.text?.content || '';
    const platform = props.Platform?.select?.name || 'Facebook';
    if (!postText) {
      console.log(`⚠️  No post text for: ${title}`);
      continue;
    }
    console.log(`📤 Publishing: ${title.substring(0, 50)}...`);
    try {
      if (platform === 'Facebook' || platform === 'Both') {
        const fbPostId = await postToFacebook(postText);
        if (fbPostId) {
          console.log(`✅ Facebook post ID: ${fbPostId}`);
        }
      }
      await markAsPublished(article.id);
      console.log(`✅ Marked as Published in Notion`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`❌ Error publishing "${title}":`, err.message);
      console.error('FB Error details:', JSON.stringify(err.response?.data));
    }
  }
}
module.exports = { publishApproved };
