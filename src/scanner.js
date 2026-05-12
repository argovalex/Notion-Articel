const axios = require('axios');
const xml2js = require('xml2js');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DB_ID = process.env.NOTION_DB_ID;

const SEARCH_TERMS = [
  'PTSD treatment digital',
  'breathing exercises anxiety therapy',
  'trauma mental health app',
  'diaphragmatic breathing stress reduction',
  'grounding techniques anxiety',
  'chatbot mental health support',
  'box breathing clinical trial',
  'emotional regulation PTSD',
  'mindfulness trauma recovery',
  'AI mental health intervention'
];

async function searchPubMed(term) {
  try {
    // שלב 1: חיפוש IDs
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=5&sort=pub+date&retmode=json&datetype=pdat&mindate=2022&maxdate=2025`;
    const searchRes = await axios.get(searchUrl);
    const ids = searchRes.data.esearchresult.idlist;
    
    if (!ids || ids.length === 0) return [];

    // שלב 2: שליפת פרטים
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`;
    const fetchRes = await axios.get(fetchUrl);
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(fetchRes.data);
    const articles = result?.PubmedArticleSet?.PubmedArticle || [];

    return articles.map(article => {
      const medline = article.MedlineCitation[0];
      const articleData = medline.Article[0];
      
      const title = articleData.ArticleTitle?.[0] || 'No title';
      const abstract = articleData.Abstract?.[0]?.AbstractText?.[0] || '';
      const pmid = medline.PMID?.[0]?._ || medline.PMID?.[0] || '';
      
      // מחברים
      const authors = articleData.AuthorList?.[0]?.Author || [];
      const firstAuthor = authors[0];
      const authorName = firstAuthor 
        ? `${firstAuthor.LastName?.[0] || ''} et al.`
        : 'Unknown';
      
      // כתב עת ושנה
      const journal = articleData.Journal?.[0]?.Title?.[0] || '';
      const year = articleData.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0] || '2024';
      
      return {
        title: typeof title === 'string' ? title : title._ || 'No title',
        abstract: typeof abstract === 'string' ? abstract : abstract._ || '',
        pmid,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        author: authorName,
        journal,
        year
      };
    });
  } catch (err) {
    console.error(`PubMed search error for "${term}":`, err.message);
    return [];
  }
}

async function generatePostText(article) {
  const prompt = `אתה כותב תוכן שיווקי לSafeHarbor — בוט WhatsApp לתמיכה רגשית ועיגון בעברית.

כתוב פוסט לפייסבוק/לינקדאין בעברית בפורמט הזה בדיוק:

[אמוג'י רלוונטי] [כותרת קצרה ומושכת]

מה המחקר אומר:
[2-3 משפטים. ממצא מפתיע ומעניין. פשוט ונגיש]

למה זה רלוונטי לך:
[חיבור ישיר לSafeHarbor. דוגמה קונקרטית איך הבוט עוזר]

המקור: ${article.author}, ${article.journal}, ${article.year}
${article.url}

---
מאמר לסיכום:
כותרת: ${article.title}
תקציר: ${article.abstract.substring(0, 800)}

כללים:
- עברית בלבד
- לא יותר מ-150 מילים סה"כ
- טון חם ומקצועי
- הפוסט צריך להרגיש כמו תובנה ולא פרסומת`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}

async function isAlreadyInNotion(pmid) {
  const res = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      property: 'PMID',
      rich_text: { equals: pmid }
    }
  });
  return res.results.length > 0;
}

async function saveToNotion(article, postText) {
  await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: {
      Title: {
        title: [{ text: { content: article.title.substring(0, 200) } }]
      },
      URL: {
        url: article.url
      },
      PMID: {
        rich_text: [{ text: { content: article.pmid } }]
      },
      Status: {
        select: { name: 'Draft' }
      },
      Platform: {
        select: { name: 'Facebook' }
      },
      Post_Text: {
        rich_text: [{ text: { content: postText.substring(0, 2000) } }]
      },
      Date_Found: {
        date: { start: new Date().toISOString().split('T')[0] }
      }
    }
  });
  console.log(`✅ Saved: ${article.title.substring(0, 60)}...`);
}

async function scanAndSave() {
  console.log(`🔍 Scanning ${SEARCH_TERMS.length} topics...`);
  let saved = 0;

  for (const term of SEARCH_TERMS) {
    console.log(`  → Searching: "${term}"`);
    const articles = await searchPubMed(term);
    
    for (const article of articles) {
      if (!article.pmid) continue;
      
      const exists = await isAlreadyInNotion(article.pmid);
      if (exists) continue;

      if (!article.abstract || article.abstract.length < 100) continue;

      try {
        const postText = await generatePostText(article);
        await saveToNotion(article, postText);
        saved++;
        
        // המתנה כדי לא לעמוס על ה-APIs
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`Error processing article ${article.pmid}:`, err.message);
      }
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`✅ Scan complete. ${saved} new articles saved to Notion.`);
  return saved;
}

module.exports = { scanAndSave };
