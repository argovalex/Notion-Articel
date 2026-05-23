const axios = require('axios');
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DB_ID;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

// ─── Notion: שליפת פוסטים מאושרים שהגיע זמנם ───────────────────────────────
async function getApprovedArticles() {
  // DEBUG: הדפס את כל שמות העמודות ב-DB
  try {
    const dbInfo = await notion.databases.retrieve({ database_id: DB_ID });
    const propNames = Object.keys(dbInfo.properties);
    console.log('📋 DB Properties found:', propNames.join(', '));
  } catch (e) {
    console.error('❌ Could not retrieve DB info:', e.message);
  }

  const now = new Date().toISOString();

  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      and: [
        {
          property: 'Status',
          select: { equals: 'Approved' }
        },
        {
          or: [
            {
              property: 'Scheduled_At',
              date: { is_empty: true }
            },
            {
              property: 'Scheduled_At',
              date: { on_or_before: now }
            }
          ]
        }
      ]
    }
  });

  return res.results;
}

// ─── Facebook: פרסום פוסט ────────────────────────────────────────────────────
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

// ─── Notion: סימון פוסט כ-Published ─────────────────────────────────────────
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

// ─── Main: לולאת פרסום ───────────────────────────────────────────────────────
async function publishApproved() {
  console.log(`🕐 Scheduler check at ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`);

  const articles = await getApprovedArticles();

  if (articles.length === 0) {
    console.log('📭 No approved articles ready to publish');
    return;
  }

  console.log(`📢 Found ${articles.length} article(s) ready to publish`);

  for (const article of articles) {
    const props = article.properties;
    const title      = props.Title?.title?.[0]?.text?.content || 'Untitled';
    const postText   = props.Post_Text?.rich_text?.[0]?.text?.content || '';
    const platform   = props.Platform?.select?.name || 'Facebook';
    const scheduled  = props.Scheduled_At?.date?.start
      ? new Date(props.Scheduled_At.date.start).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
      : 'מיידי';

    console.log(`\n📄 "${title.substring(0, 60)}"`);
    console.log(`   Platform: ${platform} | Scheduled: ${scheduled}`);

    if (!postText) {
      console.log(`   ⚠️  No post text — skipping`);
      continue;
    }

    try {
      if (platform === 'Facebook' || platform === 'Both') {
        const fbPostId = await postToFacebook(postText);
        if (fbPostId) {
          console.log(`   ✅ Facebook post ID: ${fbPostId}`);
        }
      }

      await markAsPublished(article.id);
      console.log(`   ✅ Marked as Published in Notion`);

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`   ❌ Error publishing "${title}":`, err.message);
      if (err.response?.data) {
        console.error('   Details:', JSON.stringify(err.response.data));
      }
    }
  }

  console.log('\n✅ Scheduler run complete');
}

module.exports = { publishApproved };
